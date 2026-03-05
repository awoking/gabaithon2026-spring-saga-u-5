import json
import logging
import asyncio
from typing import Any, Dict
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
step_requested = False


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

def initialize_simulation():
    """シミュレーションを初期化"""
    global engine, manager
    engine = SimulationEngine()
    manager = SimulationManager(engine)
    logger.info("Simulation initialized")

# 初期化
initialize_simulation()


def apply_initial_strain_config(strain_config: Dict[str, Any]):
    idx_candidates = np.where(engine.active_mask)[0]
    if len(idx_candidates) == 0:
        return

    idx = idx_candidates[0]
    engine.traits[idx] = np.array([
        _to_float(strain_config.get("mu_max"), 0.4),
        _to_float(strain_config.get("Ks"), 1.0),
        _to_float(strain_config.get("p"), 0.0),
        _to_float(strain_config.get("r"), 0.0),
        _to_float(strain_config.get("T_opt"), 25.0),
        _to_float(strain_config.get("pH_opt"), 7.0),
        _to_float(strain_config.get("Rad_res"), 0.0),
    ])
    engine.N[idx] = _to_float(strain_config.get("N0"), 500.0)
    engine.m_costs[idx] = engine.calculate_maintenance(engine.traits[idx])


def apply_environment_config(env_config: Dict[str, Any]):
    manager.S = _to_float(env_config.get("S0"), 500.0)
    manager.T = _to_float(env_config.get("T0"), 0.0)
    manager.pH = _to_float(env_config.get("pH0"), 7.0)
    manager.env_params[0] = _to_float(env_config.get("temp"), 25.0)
    manager.env_params[1] = _to_float(env_config.get("rad"), 0.0)
    manager.env_params[2] = max(0.0, _to_float(env_config.get("k_tox"), manager.env_params[2]))
    manager.env_params[3] = max(0.0, _to_float(env_config.get("k_rad"), manager.env_params[3]))
    manager.env_params[4] = max(0.0, _to_float(env_config.get("k_acid"), manager.env_params[4]))
    manager.env_params[5] = _to_float(env_config.get("Y"), 100.0)
    manager.env_params[6] = max(0.0, _to_float(env_config.get("d_T"), manager.env_params[6]))
    manager.env_params[7] = max(0.0, _to_float(env_config.get("hgt_prob"), manager.env_params[7]))
    manager.env_params[8] = max(0.0, _to_float(env_config.get("D"), manager.env_params[8]))
    manager.env_params[9] = max(0.0, _to_float(env_config.get("S_in"), manager.env_params[9]))
    manager.auto_feed_enabled = bool(env_config.get("auto_feed_enabled", True))
    manager.feed_per_batch = max(0.0, _to_float(env_config.get("feed_per_batch"), 200.0))
    manager.feed_max_s = max(0.0, _to_float(env_config.get("feed_max_s"), 10000.0))
    manager.batch_size = max(1, _to_int(env_config.get("batch_size"), 100))
    manager.max_rel_change_per_step = max(1e-8, _to_float(env_config.get("max_rel_change_per_step"), manager.max_rel_change_per_step))
    manager.max_abs_s_change_per_step = max(1e-8, _to_float(env_config.get("max_abs_s_change_per_step"), manager.max_abs_s_change_per_step))
    manager.k_hgt = max(0.0, _to_float(env_config.get("k_hgt"), manager.k_hgt))
    manager.division_threshold = max(1.0, _to_float(env_config.get("division_threshold"), 5000.0))


def apply_runtime_params(params: Dict[str, Any]):
    if "S" in params:
        manager.S = _to_float(params.get("S"), manager.S)
    if "T" in params:
        manager.T = _to_float(params.get("T"), manager.T)
    if "pH" in params:
        manager.pH = _to_float(params.get("pH"), manager.pH)

    if "k_tox" in params:
        manager.env_params[2] = max(0.0, _to_float(params.get("k_tox"), manager.env_params[2]))
    if "k_rad" in params:
        manager.env_params[3] = max(0.0, _to_float(params.get("k_rad"), manager.env_params[3]))
    if "k_acid" in params:
        manager.env_params[4] = max(0.0, _to_float(params.get("k_acid"), manager.env_params[4]))
    if "d_T" in params:
        manager.env_params[6] = max(0.0, _to_float(params.get("d_T"), manager.env_params[6]))
    if "hgt_prob" in params:
        manager.env_params[7] = max(0.0, _to_float(params.get("hgt_prob"), manager.env_params[7]))
    if "D" in params:
        manager.env_params[8] = max(0.0, _to_float(params.get("D"), manager.env_params[8]))
    if "S_in" in params:
        manager.env_params[9] = max(0.0, _to_float(params.get("S_in"), manager.env_params[9]))

    if "max_rel_change_per_step" in params:
        manager.max_rel_change_per_step = max(1e-8, _to_float(params.get("max_rel_change_per_step"), manager.max_rel_change_per_step))
    if "max_abs_s_change_per_step" in params:
        manager.max_abs_s_change_per_step = max(1e-8, _to_float(params.get("max_abs_s_change_per_step"), manager.max_abs_s_change_per_step))

    if "k_hgt" in params:
        manager.k_hgt = max(0.0, _to_float(params.get("k_hgt"), manager.k_hgt))
    if "division_threshold" in params:
        manager.division_threshold = max(1.0, _to_float(params.get("division_threshold"), manager.division_threshold))


async def handle_start_message(msg: Dict[str, Any]):
    logger.info("START received - initializing with custom settings")
    initialize_simulation()
    engine.spawn(initial=True)

    if "initial_strain" in msg:
        apply_initial_strain_config(msg["initial_strain"])

    if "environment" in msg:
        apply_environment_config(msg["environment"])

    idx_candidates = np.where(engine.active_mask)[0]
    idx = idx_candidates[0] if len(idx_candidates) > 0 else 0
    manager.is_running = True
    logger.info(f"Simulation started - S={manager.S}, N={engine.N[idx]}, mu_max={engine.traits[idx,0]}")


async def handle_control_message(msg: Dict[str, Any]):
    global step_requested
    msg_type = msg.get("type")

    if msg_type == "RESET":
        logger.info("RESET received")
        initialize_simulation()
        await broadcast_state({"type": "RESET_COMPLETE"})
        return

    if msg_type == "RESUME":
        manager.is_running = True
        return

    if msg_type == "PAUSE":
        manager.is_running = False
        return

    if msg_type == "STEP":
        if manager:
            step_requested = True
        return

    if msg_type == "SET_ENV":
        if "temp" in msg:
            manager.env_params[0] = _to_float(msg.get("temp"), manager.env_params[0])
        if "rad" in msg:
            manager.env_params[1] = _to_float(msg.get("rad"), manager.env_params[1])
        return

    if msg_type == "SET_FLOW":
        if "D" in msg:
            manager.env_params[8] = max(0.0, _to_float(msg.get("D"), manager.env_params[8]))
        if "S_in" in msg:
            manager.env_params[9] = max(0.0, _to_float(msg.get("S_in"), manager.env_params[9]))
        return

    if msg_type == "SET_ADAPTIVE_DT":
        if "enabled" in msg:
            manager.adaptive_dt_enabled = bool(msg.get("enabled"))
        if "dt_min" in msg:
            manager.dt_min = max(1e-5, _to_float(msg.get("dt_min"), manager.dt_min))
        if "dt_max" in msg:
            manager.dt_max = max(manager.dt_min, _to_float(msg.get("dt_max"), manager.dt_max))
        return

    if msg_type == "SET_FEED":
        if "enabled" in msg:
            manager.auto_feed_enabled = bool(msg.get("enabled"))
        if "per_batch" in msg:
            manager.feed_per_batch = max(0.0, _to_float(msg.get("per_batch"), manager.feed_per_batch))
        if "max_s" in msg:
            manager.feed_max_s = max(0.0, _to_float(msg.get("max_s"), manager.feed_max_s))
        return

    if msg_type == "SET_BATCH_SIZE":
        if "batch_size" in msg:
            manager.batch_size = max(1, _to_int(msg.get("batch_size"), manager.batch_size))

    if msg_type == "SET_DIVISION":
        if "threshold" in msg:
            manager.division_threshold = max(1.0, _to_float(msg.get("threshold"), manager.division_threshold))
        return

    if msg_type == "SET_RUNTIME_PARAMS":
        apply_runtime_params(msg)


async def check_and_notify_extinction():
    global step_requested
    active_idx = np.where(engine.active_mask)[0]
    if len(active_idx) != 0:
        return

    logger.warning("Extinction detected - simulation stopped")
    manager.is_running = False
    step_requested = False
    await broadcast_state({
        "type": "SIMULATION_ENDED",
        "reason": "extinction",
        "final_step": engine.total_steps
    })

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting background task...")
    task = asyncio.create_task(run_simulation_loop())
    yield
    task.cancel()

async def run_simulation_loop():
    """シミュレーションループ（絶滅検出付き）"""
    global step_requested
    while True:
        try:
            if manager and (manager.is_running or step_requested):
                force_step = (not manager.is_running) and step_requested
                await manager.run_loop(broadcast_state, force_step=force_step)
                if force_step:
                    step_requested = False
                await check_and_notify_extinction()
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
            if msg.get("type") == "START":
                await handle_start_message(msg)
            else:
                await handle_control_message(msg)
                    
    except WebSocketDisconnect:
        active_websockets.remove(websocket)
        logger.info(f"WebSocket disconnected (remaining: {len(active_websockets)})")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)