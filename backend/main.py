import json
import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from engine import SimulationEngine
from manager import SimulationManager

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

engine = SimulationEngine()
engine.spawn(initial=True)
manager = SimulationManager(engine)
active_websockets = []

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting background task...")
    task = asyncio.create_task(manager.run_loop(broadcast_state))
    yield
    task.cancel()

async def broadcast_state(data):
    msg = json.dumps(data)
    for ws in active_websockets:
        try: await ws.send_text(msg)
        except: active_websockets.remove(ws)

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"])

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            if msg["type"] == "RESUME": manager.is_running = True
            if msg["type"] == "PAUSE": manager.is_running = False
            if msg["type"] == "SET_ENV":
                manager.env_params[0] = msg["temp"]
                manager.env_params[1] = msg["rad"]
            if msg["type"] == "SET_FLOW":
                if "D" in msg:
                    manager.env_params[8] = max(0.0, float(msg["D"]))
                if "S_in" in msg:
                    manager.env_params[9] = max(0.0, float(msg["S_in"]))
            if msg["type"] == "SET_ADAPTIVE_DT":
                if "enabled" in msg:
                    manager.adaptive_dt_enabled = bool(msg["enabled"])
                if "dt_min" in msg:
                    manager.dt_min = max(1e-5, float(msg["dt_min"]))
                if "dt_max" in msg:
                    manager.dt_max = max(manager.dt_min, float(msg["dt_max"]))
            if msg["type"] == "SET_FEED":
                if "enabled" in msg:
                    manager.auto_feed_enabled = bool(msg["enabled"])
                if "per_batch" in msg:
                    manager.feed_per_batch = max(0.0, float(msg["per_batch"]))
                if "max_s" in msg:
                    manager.feed_max_s = max(0.0, float(msg["max_s"]))
    except WebSocketDisconnect:
        active_websockets.remove(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)