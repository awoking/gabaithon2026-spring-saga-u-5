import numpy as np

class SimulationEngine:
    def __init__(self, max_strains=100000):
        self.max_strains = max_strains
        self.N = np.zeros(max_strains)
        self.traits = np.zeros((max_strains, 7)) # [mu, Ks, p, r, T_opt, pH_opt, Rad]
        self.m_costs = np.zeros(max_strains)
        self.active_mask = np.zeros(max_strains, dtype=np.bool_)
        self.ids = np.zeros(max_strains, dtype=np.int64)
        self.free_indices = list(range(max_strains - 1, -1, -1))
        self.next_id = 1
        self.total_steps = 0

    def spawn(self, parent_idx=None, initial=False):
        if not self.free_indices: return None
        idx = self.free_indices.pop()
        
        if initial:
            new_traits = np.array([1.2, 0.5, 0.1, 0.1, 25.0, 7.0, 0.1])
        else:
            new_traits = self.traits[parent_idx] + np.random.normal(0, 0.02, 7)
        
        self.traits[idx] = np.maximum(0.01, new_traits)
        self.m_costs[idx] = 0.05 + 0.01 * self.traits[idx, 0] # コスト計算
        self.N[idx] = 100.0 if initial else 1.0
        self.ids[idx] = self.next_id
        self.active_mask[idx] = True
        self.next_id += 1
        return self.ids[idx]

    def reap(self):
        """絶滅株のメモリ解放（ティアリング）"""
        dead_indices = np.where((self.N < 1.0) & self.active_mask)[0]
        for idx in dead_indices:
            self.active_mask[idx] = False
            self.N[idx] = 0.0
            self.free_indices.append(idx)
        return len(dead_indices)