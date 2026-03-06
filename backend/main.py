import json
import logging
import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union, Literal, Annotated
from uuid import uuid4
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError, ConfigDict, TypeAdapter
from engine import SimulationEngine
from manager import SimulationManager
from ai_support import ai_vector_store
import numpy as np

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

class WSBaseModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class InitialStrainConfig(WSBaseModel):
    mu_max: float = 0.4
    Ks: float = 1.0
    N0: float = 500.0
    p: float = 0.0
    r: float = 0.0
    T_opt: float = 25.0
    pH_opt: float = 7.0
    Rad_res: float = 0.0


class EnvironmentConfig(WSBaseModel):
    S0: float = 500.0
    T0: float = 0.0
    pH0: float = 7.0
    temp: float = 25.0
    rad: float = 0.0
    k_tox: float = 1.0
    k_rad: float = 1.0
    k_acid: float = 0.0
    Y: float = 100.0
    d_T: float = 0.1
    hgt_prob: float = 0.005
    D: float = 0.0
    S_in: float = 0.0
    auto_feed_enabled: bool = True
    feed_per_batch: float = 200.0
    feed_max_s: float = 10000.0
    batch_size: int = 100
    max_rel_change_per_step: float = 0.05
    max_abs_s_change_per_step: float = 0.05
    k_hgt: float = 1e-9
    division_threshold: float = 5000.0


class StartMessage(WSBaseModel):
    type: Literal["START"]
    initial_strain: InitialStrainConfig = Field(default_factory=InitialStrainConfig)
    environment: EnvironmentConfig = Field(default_factory=EnvironmentConfig)


class ResetMessage(WSBaseModel):
    type: Literal["RESET"]


class ResumeMessage(WSBaseModel):
    type: Literal["RESUME"]


class PauseMessage(WSBaseModel):
    type: Literal["PAUSE"]


class StepMessage(WSBaseModel):
    type: Literal["STEP"]


class SetEnvMessage(WSBaseModel):
    type: Literal["SET_ENV"]
    temp: Optional[float] = None
    rad: Optional[float] = None


class SetFlowMessage(WSBaseModel):
    type: Literal["SET_FLOW"]
    D: Optional[float] = None
    S_in: Optional[float] = None


class SetAdaptiveDtMessage(WSBaseModel):
    type: Literal["SET_ADAPTIVE_DT"]
    enabled: Optional[bool] = None
    dt_min: Optional[float] = None
    dt_max: Optional[float] = None


class SetFeedMessage(WSBaseModel):
    type: Literal["SET_FEED"]
    enabled: Optional[bool] = None
    per_batch: Optional[float] = None
    max_s: Optional[float] = None


class SetBatchSizeMessage(WSBaseModel):
    type: Literal["SET_BATCH_SIZE"]
    batch_size: int


class SetDivisionMessage(WSBaseModel):
    type: Literal["SET_DIVISION"]
    threshold: float


class SetRuntimeParamsMessage(WSBaseModel):
    type: Literal["SET_RUNTIME_PARAMS"]
    S: Optional[float] = None
    T: Optional[float] = None
    pH: Optional[float] = None
    k_tox: Optional[float] = None
    k_rad: Optional[float] = None
    k_acid: Optional[float] = None
    d_T: Optional[float] = None
    hgt_prob: Optional[float] = None
    D: Optional[float] = None
    S_in: Optional[float] = None
    max_rel_change_per_step: Optional[float] = None
    max_abs_s_change_per_step: Optional[float] = None
    k_hgt: Optional[float] = None
    division_threshold: Optional[float] = None


class GetLineageMessage(WSBaseModel):
    type: Literal["GET_LINEAGE"]
    strain_id: int
    max_depth: int = 200


class AIIngestCaseMessage(WSBaseModel):
    type: Literal["AI_INGEST_CASE"]
    before_snapshot: Dict[str, Any]
    after_snapshot: Dict[str, Any]
    action: Optional[Dict[str, Any]] = None


class AISupportRequestMessage(WSBaseModel):
    type: Literal["AI_SUPPORT_REQUEST"]
    current_snapshot: Optional[Dict[str, Any]] = None
    top_k: int = 8


InboundMessage = Annotated[
    Union[
        StartMessage,
        ResetMessage,
        ResumeMessage,
        PauseMessage,
        StepMessage,
        SetEnvMessage,
        SetFlowMessage,
        SetAdaptiveDtMessage,
        SetFeedMessage,
        SetBatchSizeMessage,
        SetDivisionMessage,
        SetRuntimeParamsMessage,
        GetLineageMessage,
        AIIngestCaseMessage,
        AISupportRequestMessage,
    ],
    Field(discriminator="type"),
]

message_adapter = TypeAdapter(InboundMessage)


@dataclass
class SimulationSession:
    session_id: str
    websocket: WebSocket
    engine: SimulationEngine = field(default_factory=SimulationEngine)
    manager: SimulationManager = field(init=False)
    step_requested: bool = False
    loop_task: Optional[asyncio.Task] = None

    def __post_init__(self):
        self.manager = SimulationManager(self.engine)


sessions: Dict[str, SimulationSession] = {}


def initialize_simulation(session: SimulationSession):
    session.engine = SimulationEngine()
    session.manager = SimulationManager(session.engine)
    session.step_requested = False
    logger.info("Simulation initialized for session=%s", session.session_id)


def apply_initial_strain_config(session: SimulationSession, strain_config: InitialStrainConfig):
    idx_candidates = np.where(session.engine.active_mask)[0]
    if len(idx_candidates) == 0:
        return

    idx = idx_candidates[0]
    session.engine.traits[idx] = np.array([
        float(strain_config.mu_max),
        float(strain_config.Ks),
        float(strain_config.p),
        float(strain_config.r),
        float(strain_config.T_opt),
        float(strain_config.pH_opt),
        float(strain_config.Rad_res),
    ])
    session.engine.N[idx] = float(strain_config.N0)
    session.engine.m_costs[idx] = session.engine.calculate_maintenance(session.engine.traits[idx])


def apply_environment_config(session: SimulationSession, env_config: EnvironmentConfig):
    manager = session.manager
    manager.S = float(env_config.S0)
    manager.T = float(env_config.T0)
    manager.pH = float(env_config.pH0)
    manager.env_params[0] = float(env_config.temp)
    manager.env_params[1] = float(env_config.rad)
    manager.env_params[2] = max(0.0, float(env_config.k_tox))
    manager.env_params[3] = max(0.0, float(env_config.k_rad))
    manager.env_params[4] = max(0.0, float(env_config.k_acid))
    manager.env_params[5] = float(env_config.Y)
    manager.env_params[6] = max(0.0, float(env_config.d_T))
    manager.env_params[7] = max(0.0, float(env_config.hgt_prob))
    manager.env_params[8] = max(0.0, float(env_config.D))
    manager.env_params[9] = max(0.0, float(env_config.S_in))
    manager.auto_feed_enabled = bool(env_config.auto_feed_enabled)
    manager.feed_per_batch = max(0.0, float(env_config.feed_per_batch))
    manager.feed_max_s = max(0.0, float(env_config.feed_max_s))
    manager.batch_size = max(1, int(env_config.batch_size))
    manager.max_rel_change_per_step = max(1e-8, float(env_config.max_rel_change_per_step))
    manager.max_abs_s_change_per_step = max(1e-8, float(env_config.max_abs_s_change_per_step))
    manager.k_hgt = max(0.0, float(env_config.k_hgt))
    manager.division_threshold = max(1.0, float(env_config.division_threshold))


def apply_runtime_params(session: SimulationSession, params: SetRuntimeParamsMessage):
    manager = session.manager
    if params.S is not None:
        manager.S = float(params.S)
    if params.T is not None:
        manager.T = float(params.T)
    if params.pH is not None:
        manager.pH = float(params.pH)

    if params.k_tox is not None:
        manager.env_params[2] = max(0.0, float(params.k_tox))
    if params.k_rad is not None:
        manager.env_params[3] = max(0.0, float(params.k_rad))
    if params.k_acid is not None:
        manager.env_params[4] = max(0.0, float(params.k_acid))
    if params.d_T is not None:
        manager.env_params[6] = max(0.0, float(params.d_T))
    if params.hgt_prob is not None:
        manager.env_params[7] = max(0.0, float(params.hgt_prob))
    if params.D is not None:
        manager.env_params[8] = max(0.0, float(params.D))
    if params.S_in is not None:
        manager.env_params[9] = max(0.0, float(params.S_in))

    if params.max_rel_change_per_step is not None:
        manager.max_rel_change_per_step = max(1e-8, float(params.max_rel_change_per_step))
    if params.max_abs_s_change_per_step is not None:
        manager.max_abs_s_change_per_step = max(1e-8, float(params.max_abs_s_change_per_step))
    if params.k_hgt is not None:
        manager.k_hgt = max(0.0, float(params.k_hgt))
    if params.division_threshold is not None:
        manager.division_threshold = max(1.0, float(params.division_threshold))


def build_current_snapshot(session: SimulationSession) -> Dict[str, Any]:
    snapshot = session.manager.get_snapshot()
    snapshot["control"] = {
        "D": float(session.manager.env_params[8]),
        "S_in": float(session.manager.env_params[9]),
        "batch_size": int(session.manager.batch_size),
        "k_hgt": float(session.manager.k_hgt),
        "division_threshold": float(session.manager.division_threshold),
    }
    return snapshot


async def handle_start_message(msg: StartMessage, session: SimulationSession):
    logger.info("START received - initializing with custom settings: session=%s", session.session_id)
    initialize_simulation(session)
    session.engine.spawn(initial=True)
    apply_initial_strain_config(session, msg.initial_strain)
    apply_environment_config(session, msg.environment)

    idx_candidates = np.where(session.engine.active_mask)[0]
    idx = idx_candidates[0] if len(idx_candidates) > 0 else 0
    session.manager.is_running = True
    logger.info("Simulation started: session=%s S=%.3f N=%.3f mu_max=%.3f",
                session.session_id,
                session.manager.S,
                session.engine.N[idx],
                session.engine.traits[idx, 0])


async def handle_control_message(msg: InboundMessage, session: SimulationSession):
    if isinstance(msg, ResetMessage):
        logger.info("RESET received: session=%s", session.session_id)
        initialize_simulation(session)
        await send_to_websocket(session.websocket, {"type": "RESET_COMPLETE"})
        return

    if isinstance(msg, ResumeMessage):
        session.manager.is_running = True
        return

    if isinstance(msg, PauseMessage):
        session.manager.is_running = False
        return

    if isinstance(msg, StepMessage):
        session.step_requested = True
        return

    if isinstance(msg, SetEnvMessage):
        if msg.temp is not None:
            session.manager.env_params[0] = float(msg.temp)
        if msg.rad is not None:
            session.manager.env_params[1] = float(msg.rad)
        return

    if isinstance(msg, SetFlowMessage):
        if msg.D is not None:
            session.manager.env_params[8] = max(0.0, float(msg.D))
        if msg.S_in is not None:
            session.manager.env_params[9] = max(0.0, float(msg.S_in))
        return

    if isinstance(msg, SetAdaptiveDtMessage):
        if msg.enabled is not None:
            session.manager.adaptive_dt_enabled = bool(msg.enabled)
        if msg.dt_min is not None:
            session.manager.dt_min = max(1e-5, float(msg.dt_min))
        if msg.dt_max is not None:
            session.manager.dt_max = max(session.manager.dt_min, float(msg.dt_max))
        return

    if isinstance(msg, SetFeedMessage):
        if msg.enabled is not None:
            session.manager.auto_feed_enabled = bool(msg.enabled)
        if msg.per_batch is not None:
            session.manager.feed_per_batch = max(0.0, float(msg.per_batch))
        if msg.max_s is not None:
            session.manager.feed_max_s = max(0.0, float(msg.max_s))
        return

    if isinstance(msg, SetBatchSizeMessage):
        session.manager.batch_size = max(1, int(msg.batch_size))
        return

    if isinstance(msg, SetDivisionMessage):
        session.manager.division_threshold = max(1.0, float(msg.threshold))
        return

    if isinstance(msg, SetRuntimeParamsMessage):
        apply_runtime_params(session, msg)
        return

    if isinstance(msg, GetLineageMessage):
        strain_id = int(msg.strain_id)
        max_depth = max(1, int(msg.max_depth))
        if strain_id < 0:
            await send_to_websocket(session.websocket, {
                "type": "LINEAGE_DATA",
                "ok": False,
                "error": "invalid_strain_id",
            })
            return

        lineage = session.engine.get_lineage(strain_id=strain_id, max_depth=max_depth)
        await send_to_websocket(session.websocket, {
            "type": "LINEAGE_DATA",
            "ok": True,
            "lineage": lineage,
        })
        return

    if isinstance(msg, AIIngestCaseMessage):
        result = await ai_vector_store.ingest_case(msg.before_snapshot, msg.after_snapshot, msg.action)
        await send_to_websocket(session.websocket, {
            "type": "AI_INGEST_ACK",
            **result,
        })
        return

    if isinstance(msg, AISupportRequestMessage):
        current_snapshot = msg.current_snapshot if isinstance(msg.current_snapshot, dict) else build_current_snapshot(session)

        result = await ai_vector_store.retrieve_similar(
            current_snapshot=current_snapshot,
            top_k=max(1, int(msg.top_k)),
        )
        await send_to_websocket(session.websocket, {
            "type": "AI_SUPPORT_RESULT",
            **result,
        })
        return


async def check_and_notify_extinction(session: SimulationSession):
    active_idx = np.where(session.engine.active_mask)[0]
    if len(active_idx) != 0:
        return

    logger.warning("Extinction detected - simulation stopped: session=%s", session.session_id)
    session.manager.is_running = False
    session.step_requested = False
    await send_to_websocket(session.websocket, {
        "type": "SIMULATION_ENDED",
        "reason": "extinction",
        "final_step": session.engine.total_steps
    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting API server...")
    yield


async def run_simulation_loop(session: SimulationSession):
    while True:
        try:
            if session.manager and (session.manager.is_running or session.step_requested):
                force_step = (not session.manager.is_running) and session.step_requested
                await session.manager.run_loop(
                    lambda data: send_to_websocket(session.websocket, data),
                    force_step=force_step,
                )
                if force_step:
                    session.step_requested = False
                await check_and_notify_extinction(session)
            else:
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Simulation loop error: session=%s", session.session_id)
            if session.manager:
                session.manager.is_running = False
            await asyncio.sleep(0.1)


async def send_to_websocket(websocket: WebSocket, data: Dict[str, Any]):
    try:
        await websocket.send_text(json.dumps(data))
    except Exception:
        logger.exception("Failed to send message to websocket")

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"])

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid4())
    session = SimulationSession(session_id=session_id, websocket=websocket)
    sessions[session_id] = session
    session.loop_task = asyncio.create_task(run_simulation_loop(session))
    logger.info("WebSocket connected: session=%s total=%s", session_id, len(sessions))

    try:
        while True:
            data = await websocket.receive_text()
            raw_msg = json.loads(data)
            try:
                msg = message_adapter.validate_python(raw_msg)
            except ValidationError as e:
                await send_to_websocket(websocket, {
                    "type": "VALIDATION_ERROR",
                    "ok": False,
                    "error": "invalid websocket payload",
                    "detail": e.errors(),
                })
                continue

            if isinstance(msg, StartMessage):
                await handle_start_message(msg, session)
            else:
                await handle_control_message(msg, session)

    except WebSocketDisconnect:
        pass
    finally:
        sessions.pop(session_id, None)
        if session.loop_task:
            session.loop_task.cancel()
            with suppress(Exception):
                await session.loop_task
        logger.info("WebSocket disconnected: session=%s remaining=%s", session_id, len(sessions))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)