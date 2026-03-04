import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from engine import SimulationEngine
from manager import SimulationManager

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

# インスタンス化
engine = SimulationEngine()
engine.spawn(initial=True) # 初期細菌
manager = SimulationManager(engine)

@app.on_event("startup")
async def startup():
    import asyncio
    asyncio.create_task(manager.run_loop(broadcast_state))

active_websockets = []

async def broadcast_state(data):
    for ws in active_websockets:
        await ws.send_text(json.dumps(data))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            # プレイヤー操作の反映
            if msg["type"] == "RESUME": manager.is_running = True
            if msg["type"] == "PAUSE": manager.is_running = False
            if msg["type"] == "SET_ENV":
                manager.env_params[0] = msg["temp"]
                manager.env_params[1] = msg["rad"]
                manager.history_logs.append(f"User adjusted Temp to {msg['temp']}°C")
    except WebSocketDisconnect:
        active_websockets.remove(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)