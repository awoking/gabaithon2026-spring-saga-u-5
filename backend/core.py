import numpy as np
from numba import njit

@njit
def get_growth_rate(S, mu_max, Ks, temp, t_opt, ph, ph_opt):
    safe_S = np.maximum(S, 0.0)
    denom = np.maximum(Ks + safe_S, 1e-8)
    base_growth = mu_max * (safe_S / denom)
    t_penalty = np.exp(-((temp - t_opt)**2) / 2.0)
    ph_penalty = np.exp(-((ph - ph_opt)**2) / 2.0)
    return base_growth * t_penalty * ph_penalty

@njit
def calculate_single_m_cost(traits):
    # traits: [mu_max, Ks, p, r, T_opt, pH_opt, Rad_res]
    # m_i = m_base + w1*mu + w2/Ks + w3*p + w4*r + w5*|T_opt - 25| + w6*|pH_opt - 7| + w7*Rad_res
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

@njit
def f_system(N, S, T, pH, traits, m_costs, env_params):
    """
    ========== LAYER 1: 連続的な増殖（Nの増加）==========
    このカーネルは、各株の個体数 N_i の時間変化を微分方程式で计算します。
    ここでは「新しい株」は生まれず、既存の株の「量（ボリューム）」が増減するだけです。
    
    微分方程式: dN_i/dt = (g_i - m_i - d_tox_i - d_rad_i) * N_i
    
    機構:
      - g_i: 増殖速度（モノド方程式 + 温度・pH依存性）
      - m_i: 維持コスト（能力に応じたペナルティ）
      - d_tox: 毒素ストレスによる死滅
      - d_rad: 放射線ストレスによる死滅
    
    env_params:
      - 旧形式: [temp, rad, k_tox, k_rad, k_acid, Y, d_T, hgt_prob]
      - 新形式: [temp, rad, k_tox, k_rad, k_acid, Y, d_T, hgt_prob, D, S_in]
    """
    temp, rad, k_tox, k_rad, k_acid, Y, d_T, _ = env_params[:8]
    if len(env_params) >= 10:
        D = env_params[8]
        S_in = env_params[9]
    else:
        D = 0.0
        S_in = S
    
    mu_max = traits[:, 0]; Ks = traits[:, 1]; p = traits[:, 2]
    r = traits[:, 3]; t_opt = traits[:, 4]; ph_opt = traits[:, 5]
    rad_res = traits[:, 6]
    
    # 成長率計算
    g = get_growth_rate(S, mu_max, Ks, temp, t_opt, pH, ph_opt)
    d_tox = k_tox * np.maximum(0.0, T - r)
    d_rad = k_rad * np.maximum(0.0, rad - rad_res)
    
    # 微分方程式
    # dN/dt: 増殖 - 維持コスト - ストレス - 希釈流出
    dN = (g - m_costs - d_tox - d_rad - D) * N
    # dS/dt: 消費 + 連続供給（chemostat型）
    dS = -np.sum(g * N) / Y + D * (S_in - S)
    dT = np.sum(p * N) - d_T * T
    dpH = -k_acid * np.sum(g * N)
    
    return dN, dS, dT, dpH

@njit
def compute_batch_kernel(N, traits, m_costs, active_mask, S, T, pH, env_params, 
                         plasmid_pool, pool_conc, dt, steps):
    """
    ========== COMPUTATION KERNEL: RK4数値積分エンジン ==========
    
    このカーネルは、常微分方程式系を4次ルンゲ＝クッタ法(RK4)で数値積分します。
    dt=0.01、steps=10,000の場合、論理時間 t=100 分進みます。
    
    プロセス:
      1. RK4の4段階(k1～k4)で f_system() を順次呼び出し
      2. 全変数(N, S, T, pH)を 6次精度で更新
      3. HGT（水平伝播）による既存株のゲノム書き換え
    
    引継ぎ重要ポイント:
      - ここでは「新しい株」は生まれない
      - あくまで「既存の株の量（N）の増減」を計算
      - 離散的な「新系統の誕生」は manager.py で管理
    """
    hgt_prob = env_params[7]
    pool_size = len(pool_conc)

    for _ in range(steps):
        # --- RK4 Integration ---
        # Stage 1: k1
        k1_N, k1_S, k1_T, k1_pH = f_system(N, S, T, pH, traits, m_costs, env_params)
        
        # Stage 2: k2 (at t + dt/2)
        N_mid2 = np.maximum(0.0, N + 0.5 * dt * k1_N)
        S_mid2 = np.maximum(0.0, S + 0.5 * dt * k1_S)
        T_mid2 = T + 0.5 * dt * k1_T
        pH_mid2 = pH + 0.5 * dt * k1_pH
        k2_N, k2_S, k2_T, k2_pH = f_system(N_mid2, S_mid2, T_mid2, pH_mid2, traits, m_costs, env_params)
        
        # Stage 3: k3 (at t + dt/2)
        N_mid3 = np.maximum(0.0, N + 0.5 * dt * k2_N)
        S_mid3 = np.maximum(0.0, S + 0.5 * dt * k2_S)
        T_mid3 = T + 0.5 * dt * k2_T
        pH_mid3 = pH + 0.5 * dt * k2_pH
        k3_N, k3_S, k3_T, k3_pH = f_system(N_mid3, S_mid3, T_mid3, pH_mid3, traits, m_costs, env_params)
        
        # Stage 4: k4 (at t + dt)
        N_final = np.maximum(0.0, N + dt * k3_N)
        S_final = np.maximum(0.0, S + dt * k3_S)
        T_final = T + dt * k3_T
        pH_final = pH + dt * k3_pH
        k4_N, k4_S, k4_T, k4_pH = f_system(N_final, S_final, T_final, pH_final, traits, m_costs, env_params)
        
        # RK4 weighted sum: y_{n+1} = y_n + (dt/6)(k1 + 2*k2 + 2*k3 + k4)
        N = N + (dt / 6.0) * (k1_N + 2.0 * k2_N + 2.0 * k3_N + k4_N)
        S = S + (dt / 6.0) * (k1_S + 2.0 * k2_S + 2.0 * k3_S + k4_S)
        T = T + (dt / 6.0) * (k1_T + 2.0 * k2_T + 2.0 * k3_T + k4_T)
        pH = pH + (dt / 6.0) * (k1_pH + 2.0 * k2_pH + 2.0 * k3_pH + k4_pH)

        if not np.isfinite(S):
            S = 0.0
        if not np.isfinite(T):
            T = 0.0
        if not np.isfinite(pH):
            pH = 7.0
        for i in range(len(N)):
            if not np.isfinite(N[i]):
                N[i] = 0.0
        
        # --- HGT Uptake (水平伝播) ---
        # 毎ステップ全個体判定は重いため、確率的に実行
        if np.random.rand() < 0.01: # HGTチェック頻度自体を絞る
            for i in range(len(N)):
                if active_mask[i] and np.random.rand() < hgt_prob:
                    # プールからランダムにスロット選択
                    slot = np.random.randint(0, pool_size)
                    if pool_conc[slot] > 0.1: # 濃度がある場合のみ
                        # プラスミド形質を上書き [p, r, rad_res]
                        traits[i, 2] = plasmid_pool[slot, 0]
                        traits[i, 3] = plasmid_pool[slot, 1]
                        traits[i, 6] = plasmid_pool[slot, 2]
                        # 獲得に伴うコストの再計算
                        m_costs[i] = calculate_single_m_cost(traits[i])

        N = np.maximum(0.0, N)
        S = np.maximum(0.0, S)
        if np.sum(N) <= 0: return N, S, T, pH, True
            
    return N, S, T, pH, False