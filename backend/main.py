import json
import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from engine import SimulationEngine
from manager import SimulationManager
import numpy as np

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

engine = None
manager = None
active_websockets = []

def initialize_simulation():
    """シミュレーションを初期化"""
    global engine, manager
    engine = SimulationEngine()
    manager = SimulationManager(engine)
    logger.info("Simulation initialized")

# 初期化
initialize_simulation()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting background task...")
    task = asyncio.create_task(run_simulation_loop())
    yield
    task.cancel()

async def run_simulation_loop():
    """シミュレーションループ（絶滅検出付き）"""
    while True:
        try:
            if manager and manager.is_running:
                # 通常のループ実行
                await manager.run_loop(broadcast_state)

                # 絶滅チェック
                active_idx = np.where(engine.active_mask)[0]
                if len(active_idx) == 0:
                    logger.warning("Extinction detected - simulation stopped")
                    manager.is_running = False
                    # 絶滅通知を送信
                    await broadcast_state({
                        "type": "SIMULATION_ENDED",
                        "reason": "extinction",
                        "final_step": engine.total_steps
                    })
            else:
                await asyncio.sleep(0.1)
        except Exception:
            logger.exception("Simulation loop error")
            if manager:
                manager.is_running = False
            await asyncio.sleep(0.1)

async def broadcast_state(data):
    msg = json.dumps(data)
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_text(msg)
        except:
            disconnected.append(ws)
    for ws in disconnected:
        active_websockets.remove(ws)

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"])

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    logger.info(f"WebSocket connected (total: {len(active_websockets)})")
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg["type"] == "START":
                # シミュレーション開始（初期設定を受信）
                logger.info("START received - initializing with custom settings")
                initialize_simulation()
                
                # 初期株設定
                engine.spawn(initial=True)
                idx = np.where(engine.active_mask)[0][0]
                
                if "initial_strain" in msg:
                    strain_config = msg["initial_strain"]
                    engine.traits[idx] = np.array([
                        strain_config.get("mu_max", 0.4),
                        strain_config.get("Ks", 1.0),
                        strain_config.get("p", 0.0),
                        strain_config.get("r", 0.0),
                        strain_config.get("T_opt", 25.0),
                        strain_config.get("pH_opt", 7.0),
                        strain_config.get("Rad_res", 0.0)
                    ])
                    engine.N[idx] = strain_config.get("N0", 500.0)
                    engine.m_costs[idx] = engine.calculate_maintenance(engine.traits[idx])
                
                # 環境設定
                if "environment" in msg:
                    env_config = msg["environment"]
                    manager.S = env_config.get("S0", 500.0)
                    manager.T = env_config.get("T0", 0.0)
                    manager.pH = env_config.get("pH0", 7.0)
                    manager.env_params[0] = env_config.get("temp", 25.0)
                    manager.env_params[1] = env_config.get("rad", 0.0)
                    manager.env_params[5] = env_config.get("Y", 100.0)
                    manager.auto_feed_enabled = env_config.get("auto_feed_enabled", True)
                    manager.feed_per_batch = env_config.get("feed_per_batch", 200.0)
                    manager.feed_max_s = env_config.get("feed_max_s", 10000.0)
                
                manager.is_running = True
                logger.info(f"Simulation started - S={manager.S}, N={engine.N[idx]}, mu_max={engine.traits[idx,0]}")
                
            elif msg["type"] == "RESET":
                # シミュレーションリセット
                logger.info("RESET received")
                initialize_simulation()
                await broadcast_state({"type": "RESET_COMPLETE"})
                
            elif msg["type"] == "RESUME":
                manager.is_running = True
                
            elif msg["type"] == "PAUSE":
                manager.is_running = False
                
            elif msg["type"] == "SET_ENV":
                manager.env_params[0] = msg["temp"]
                manager.env_params[1] = msg["rad"]
                
            elif msg["type"] == "SET_FLOW":
                if "D" in msg:
                    manager.env_params[8] = max(0.0, float(msg["D"]))
                if "S_in" in msg:
                    manager.env_params[9] = max(0.0, float(msg["S_in"]))
                    
            elif msg["type"] == "SET_ADAPTIVE_DT":
                if "enabled" in msg:
                    manager.adaptive_dt_enabled = bool(msg["enabled"])
                if "dt_min" in msg:
                    manager.dt_min = max(1e-5, float(msg["dt_min"]))
                if "dt_max" in msg:
                    manager.dt_max = max(manager.dt_min, float(msg["dt_max"]))
                    
            elif msg["type"] == "SET_FEED":
                if "enabled" in msg:
                    manager.auto_feed_enabled = bool(msg["enabled"])
                if "per_batch" in msg:
                    manager.feed_per_batch = max(0.0, float(msg["per_batch"]))
                if "max_s" in msg:
                    manager.feed_max_s = max(0.0, float(msg["max_s"]))
                    
    except WebSocketDisconnect:
        active_websockets.remove(websocket)
        logger.info(f"WebSocket disconnected (remaining: {len(active_websockets)})")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)