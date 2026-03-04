import asyncio
from core import compute_batch_kernel
import numpy as np

class SimulationManager:
    def __init__(self, engine):
        self.engine = engine
        self.is_running = False
        self.S, self.T, self.pH = 100.0, 0.0, 7.0
        self.env_params = np.array([25.0, 0.0, 1.0, 1.0, 0.1, 10.0, 0.1])
        self.history_logs = []

    async def run_loop(self, broadcast_fn):
        dt = 0.01
        batch_size = 10000
        while True:
            if self.is_running:
                # 高速計算ブロック実行
                res_N, res_S, res_T, res_pH, extinct = compute_batch_kernel(
                    self.engine.N, self.engine.traits, self.engine.m_costs,
                    self.S, self.T, self.pH, self.env_params, dt, batch_size
                )
                
                self.engine.N, self.S, self.T, self.pH = res_N, res_S, res_T, res_pH
                self.engine.total_steps += batch_size
                
                # 絶滅処理とログ生成
                reaped_count = self.engine.reap()
                if reaped_count > 0:
                    self.history_logs.append(f"Step {self.engine.total_steps}: {reaped_count} strains went extinct.")

                # 突然変異（検証用: 1万ステップごとに一定確率で1株発生）
                if np.random.rand() < 0.3:
                    active = np.where(self.engine.active_mask)[0]
                    if len(active) > 0:
                        parent = np.random.choice(active)
                        new_id = self.engine.spawn(parent)
                        self.history_logs.append(f"Step {self.engine.total_steps}: New Strain #{new_id} appeared!")

                # データ送出
                await broadcast_fn(self.get_snapshot())
                
                if extinct:
                    self.is_running = False
                    self.history_logs.append("FATAL: All organisms have perished.")
            
            await asyncio.sleep(0.01)

    def get_snapshot(self):
        active_idx = np.where(self.engine.active_mask)[0]
        # 個体数順ランキング
        sorted_idx = active_idx[np.argsort(self.engine.N[active_idx])[::-1]]
        ranking = [{"id": int(self.engine.ids[i]), "n": float(self.engine.N[i])} for i in sorted_idx[:10]]
        
        return {
            "type": "BATCH_UPDATE",
            "step": self.engine.total_steps,
            "env": {"S": self.S, "T": self.T, "pH": self.pH},
            "ranking": ranking,
            "logs": self.history_logs[-5:] # 直近5件
        }