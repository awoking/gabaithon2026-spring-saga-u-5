import asyncio
import numpy as np
import logging
from core import compute_batch_kernel

logger = logging.getLogger(__name__)

class SimulationManager:
    def __init__(self, engine):
        self.engine = engine
        self.is_running = True
        self.S, self.T, self.pH = 200.0, 0.0, 7.0
        # [temp, rad, k_tox, k_rad, k_acid, Y, d_T, hgt_prob]
        self.env_params = np.array([25.0, 0.0, 1.0, 1.0, 0.05, 10.0, 0.1, 0.005])
        self.history_logs = []
        self.hgt_count = 0
        self.division_count = 0
        self.k_hgt = 1e-9  # HGT rate constant

    async def run_loop(self, broadcast_fn):
        dt = 0.01
        batch_size = 10000
        while True:
            if self.is_running:
                # JITカーネル実行（RK4）
                res_N, res_S, res_T, res_pH, extinct = compute_batch_kernel(
                    self.engine.N, self.engine.traits, self.engine.m_costs, self.engine.active_mask,
                    self.S, self.T, self.pH, self.env_params, 
                    self.engine.plasmid_pool, self.engine.pool_conc, dt, batch_size
                )
                
                self.engine.N, self.S, self.T, self.pH = res_N, res_S, res_T, res_pH
                self.engine.total_steps += batch_size
                
                # 絶滅処理
                reaped = self.engine.reap()
                
                # 分裂処理
                div_count = self.engine.division_trigger(threshold=50.0)
                self.division_count += div_count
                
                # プール更新
                self.engine.refresh_env_pool()
                
                # 水平伝播（HGT）処理
                hgt_count = self.run_hgt_events(dt=dt, batch_size=batch_size)
                
                # ========== LAYER 2b: 離散的な新系統誕生（突然変異ガチャ）==========
                # 1万ステップごとに、確率的に「新しい形質」を持つ新株を生成
                # これが「種としての分岐」であり、進化シミュレーションの本質
                if np.random.rand() < 0.3:
                    active = np.where(self.engine.active_mask)[0]
                    if len(active) > 0:
                        parent_idx = np.random.choice(active)
                        self.engine.spawn(parent_idx=parent_idx)  # spawn() は自動的に突然変異を加える

                logger.info(f"Step: {self.engine.total_steps:,} | Strains: {np.sum(self.engine.active_mask)} | "
                           f"S: {self.S:.1f} | Div: {div_count} | HGT: {hgt_count}")
                await broadcast_fn(self.get_snapshot())

                if extinct:
                    self.is_running = False
                    logger.warning("All extinct.")
            
            await asyncio.sleep(0.01)

    def get_snapshot(self):
        active_idx = np.where(self.engine.active_mask)[0]
        sorted_idx = active_idx[np.argsort(self.engine.N[active_idx])[::-1]]
        return {
            "type": "BATCH_UPDATE",
            "step": self.engine.total_steps,
            "env": {"S": float(self.S), "T": float(self.T), "pH": float(self.pH)},
            "ranking": [{"id": int(self.engine.ids[i]), "n": float(self.engine.N[i])} for i in sorted_idx[:5]],
            "pool": self.engine.pool_conc.tolist(),
            "scatter": {
                "x": self.engine.traits[active_idx, 0].tolist(),
                "y": self.engine.traits[active_idx, 1].tolist(),
                "n": self.engine.N[active_idx].tolist()
            },
            "stats": {
                "hgt_events": self.hgt_count,
                "division_events": self.division_count
            }
        }

    def run_hgt_events(self, dt=0.01, batch_size=10000):
        """
        水平伝播（HGT）イベント実行：両株間でプラスミド交換
        P_HGT = k_HGT * N_i * N_j * dt
        """
        active_idx = np.where(self.engine.active_mask)[0]
        hgt_threshold = 10.0  # HGT対象外の低個体数
        major_strains = active_idx[self.engine.N[active_idx] > hgt_threshold]
        
        hgt_events = 0
        dt_batch = dt * batch_size  # 1バッチの経過時間
        
        # メジャー株のペアのみでHGT判定（計算負荷軽減）
        for i_idx in range(len(major_strains)):
            for j_idx in range(i_idx + 1, len(major_strains)):
                i = major_strains[i_idx]
                j = major_strains[j_idx]
                
                # HGT確率: P = k_HGT * N_i * N_j * dt_batch
                p_hgt = self.k_hgt * self.engine.N[i] * self.engine.N[j] * dt_batch
                
                if np.random.rand() < p_hgt:
                    # 新株k: 受け手iの染色体 + max(i,j)のプラスミド
                    new_traits = self.engine.traits[i].copy()
                    
                    # プラスミド形質（p, r, Rad_res）を優秀な方から選択
                    if self.engine.traits[j, 2] > new_traits[2]:  # p (毒素生産)
                        new_traits[2] = self.engine.traits[j, 2]
                    if self.engine.traits[j, 3] > new_traits[3]:  # r (毒素耐性)
                        new_traits[3] = self.engine.traits[j, 3]
                    if self.engine.traits[j, 6] > new_traits[6]:  # Rad_res (放射線耐性)
                        new_traits[6] = self.engine.traits[j, 6]
                    
                    # 新株をspawn
                    idx_new = self.engine.spawn(parent_idx=i)
                    if idx_new is not None:
                        self.engine.traits[self.engine.free_indices[-1]] = new_traits if self.engine.free_indices else None
                        hgt_events += 1
        
        self.hgt_count += hgt_events
        return hgt_events