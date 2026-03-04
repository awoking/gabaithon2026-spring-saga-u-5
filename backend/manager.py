import asyncio
import numpy as np
import logging
from core import compute_batch_kernel

logger = logging.getLogger(__name__)

class SimulationManager:
    def __init__(self, engine):
        self.engine = engine
        self.is_running = True
        # ========== 安定デモ用プリセット（実世界近似とは分離） ==========
        # 離散的自動供給（auto_feed）ベースで安定性を確保
        self.S, self.T, self.pH = 500.0, 0.0, 7.0
        # [temp, rad, k_tox, k_rad, k_acid, Y, d_T, hgt_prob, D, S_in]
        # D: 希釈率(連続供給), S_in: 流入基質濃度
        # 自動供給メインで使用、連続供給はオフ（D=0）
        self.env_params = np.array([25.0, 0.0, 1.0, 1.0, 0.0, 100.0, 0.1, 0.005, 0.0, 0.0])
        self.history_logs = []
        self.hgt_count = 0
        self.division_count = 0
        self.k_hgt = 1e-9  # HGT rate constant
        self.auto_feed_enabled = True  # 離散的自動供給を使用
        self.feed_per_batch = 200.0
        self.feed_max_s = 10000.0

        # adaptive dt settings
        self.adaptive_dt_enabled = True
        self.dt_min = 0.001
        self.dt_max = 0.02
        self.max_rel_change_per_step = 0.05
        self.max_abs_s_change_per_step = 0.05

    def apply_nutrient_feed(self):
        if not self.auto_feed_enabled:
            return
        self.S = min(self.S + self.feed_per_batch, self.feed_max_s)

    def choose_adaptive_dt(self):
        if not self.adaptive_dt_enabled:
            return self.dt_max

        active_idx = np.where(self.engine.active_mask)[0]
        if len(active_idx) == 0:
            return self.dt_max

        traits = self.engine.traits[active_idx]
        m_costs = self.engine.m_costs[active_idx]
        N = self.engine.N[active_idx]

        temp, rad, k_tox, k_rad, _, Y, _, _, D, S_in = self.env_params
        mu_max = traits[:, 0]
        Ks = traits[:, 1]
        p = traits[:, 2]
        r = traits[:, 3]
        t_opt = traits[:, 4]
        ph_opt = traits[:, 5]
        rad_res = traits[:, 6]

        safe_S = max(self.S, 0.0)
        base_growth = mu_max * (safe_S / np.maximum(Ks + safe_S, 1e-8))
        t_penalty = np.exp(-((temp - t_opt) ** 2) / 2.0)
        ph_penalty = np.exp(-((self.pH - ph_opt) ** 2) / 2.0)
        g = base_growth * t_penalty * ph_penalty

        d_tox = k_tox * np.maximum(0.0, self.T - r)
        d_rad = k_rad * np.maximum(0.0, rad - rad_res)
        net_rate = g - m_costs - d_tox - d_rad - D

        max_abs_net = np.max(np.abs(net_rate))
        uptake = np.sum(g * N) / max(Y, 1e-8)
        dS = -uptake + D * (S_in - self.S)

        dt_by_n = self.dt_max if max_abs_net < 1e-12 else self.max_rel_change_per_step / max_abs_net
        dt_by_s = self.dt_max if abs(dS) < 1e-12 else self.max_abs_s_change_per_step / abs(dS)
        dt = min(self.dt_max, dt_by_n, dt_by_s)
        return max(self.dt_min, dt)

    async def run_loop(self, broadcast_fn):
        batch_size = 100
        while True:
            if self.is_running:
                dt = self.choose_adaptive_dt()
                # JITカーネル実行（RK4）
                res_N, res_S, res_T, res_pH, extinct = compute_batch_kernel(
                    self.engine.N, self.engine.traits, self.engine.m_costs, self.engine.active_mask,
                    self.S, self.T, self.pH, self.env_params, 
                    self.engine.plasmid_pool, self.engine.pool_conc, dt, batch_size
                )
                
                self.engine.N, self.S, self.T, self.pH = res_N, res_S, res_T, res_pH
                self.engine.total_steps += batch_size

                # 旧来の離散補給（必要な場合のみ）
                self.apply_nutrient_feed()
                
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
                           f"S: {self.S:.3f} | dt: {dt:.4f} | D: {self.env_params[8]:.3f} | Div: {div_count} | HGT: {hgt_count}")
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
            "feed": {
                "enabled": self.auto_feed_enabled,
                "per_batch": float(self.feed_per_batch),
                "max_s": float(self.feed_max_s),
                "continuous": {
                    "D": float(self.env_params[8]),
                    "S_in": float(self.env_params[9])
                }
            },
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