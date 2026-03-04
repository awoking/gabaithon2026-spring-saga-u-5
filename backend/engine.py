import numpy as np

class SimulationEngine:
    def __init__(self, max_strains=100000):
        self.max_strains = max_strains
        self.N = np.zeros(max_strains)
        self.traits = np.zeros((max_strains, 7))
        self.m_costs = np.zeros(max_strains)
        self.active_mask = np.zeros(max_strains, dtype=np.bool_)
        self.ids = np.zeros(max_strains, dtype=np.int64)
        self.free_indices = list(range(max_strains - 1, -1, -1))
        self.next_id = 1
        self.total_steps = 0

        # 環境プラスミドプール [p, r, rad_res]
        self.pool_size = 10
        self.plasmid_pool = np.zeros((self.pool_size, 3))
        self.pool_conc = np.zeros(self.pool_size)

    def calculate_maintenance(self, traits):
        """
        7項目加重和による維持コスト計算
        m_i = m_base + w1*mu + w2/Ks + w3*p + w4*r + w5*|T_opt - 25| + w6*|pH_opt - 7| + w7*Rad_res
        """
        mu_max = traits[0]
        Ks = traits[1]
        p = traits[2]
        r = traits[3]
        T_opt = traits[4]
        pH_opt = traits[5]
        Rad_res = traits[6]
        
        m_base = 0.05
        w1, w2, w3, w4, w5, w6, w7 = 0.05, 0.01, 0.02, 0.02, 0.005, 0.005, 0.08
        
        return (m_base + 
                w1 * mu_max + 
                w2 * (1.0 / (Ks + 0.01)) +  # avoid division by zero
                w3 * p + 
                w4 * r + 
                w5 * np.abs(T_opt - 25.0) + 
                w6 * np.abs(pH_opt - 7.0) + 
                w7 * Rad_res)

    def spawn(self, parent_idx=None, initial=False):
        if not self.free_indices: return None
        idx = self.free_indices.pop()
        
        if initial:
            # 初期株: バランス型
            new_traits = np.array([1.2, 0.5, 0.0, 0.0, 25.0, 7.0, 0.0])
        else:
            new_traits = self.traits[parent_idx].copy()
            # 突然変異
            new_traits += np.random.normal(0, 0.03, 7)
            new_traits = np.maximum(0.01, new_traits)
            new_traits[4] = np.clip(new_traits[4], 10, 50) # T_opt制限
            new_traits[5] = np.clip(new_traits[5], 3, 11)  # pH_opt制限
        
        self.traits[idx] = new_traits
        self.m_costs[idx] = self.calculate_maintenance(new_traits)
        self.N[idx] = 1000.0 if initial else 1.0
        self.ids[idx] = self.next_id
        self.active_mask[idx] = True
        self.next_id += 1
        return self.ids[idx]

    def refresh_env_pool(self):
        """1万ステップごとのプール更新"""
        self.pool_conc *= 0.7 # 減衰
        active_idx = np.where(self.active_mask)[0]
        if len(active_idx) > 0:
            # 上位株のプラスミドを放出
            top_idx = active_idx[np.argsort(self.N[active_idx])][-1]
            slot = np.argmin(self.pool_conc)
            self.plasmid_pool[slot] = self.traits[top_idx, [2, 3, 6]]
            self.pool_conc[slot] = 1.0

    def reap(self):
        dead_indices = np.where((self.N < 1.0) & self.active_mask)[0]
        for idx in dead_indices:
            self.active_mask[idx] = False
            self.N[idx] = 0.0
            self.free_indices.append(idx)
        return len(dead_indices)

    def division_trigger(self, threshold=50.0):
        """
        ========== LAYER 2a: 離散的な新株生成（分裂イベント）==========
        
        個体数 N_i がしきい値を超えた「成長」に応じて、**親と同じ形質を持つ娘株**を生成します。
        これは生物学的な「二分裂」に近い現象です。
        
        メカニズム:
          1. 全活動株をチェック
          2. N_i >= threshold の株について
          3. 親の個体数を N -> N/2 に減分
          4. 親と**同じ形質**の新株を1つ誕生させる（遺伝子コピー）
          5. 空きスロット（free_indices）を再利用
        
        重要：
          - spawn(parent_idx=i) は親と同じトレイトを継承
          - ここでは「新種の出現」ではなく、「個体群のサイズ制御」の役割
          - 突然変異（形質変更）は、manager.py の別プロセスで独立管理
        
        返値: 分裂イベント発生数
        """
        active_idx = np.where((self.N >= threshold) & self.active_mask)[0]
        division_count = 0
        for idx in active_idx:
            # Parent: N -> N/2
            self.N[idx] /= 2.0
            # Spawn daughter cell (親と同じ形質)
            daughter_id = self.spawn(parent_idx=idx)
            if daughter_id is not None:
                division_count += 1
        return division_count