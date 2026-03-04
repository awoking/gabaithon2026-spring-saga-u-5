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
    except WebSocketDisconnect:
        active_websockets.remove(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)