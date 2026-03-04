#!/usr/bin/env python3
"""既知プリセット候補の詳細検証"""
import numpy as np
from engine import SimulationEngine
from manager import SimulationManager
from core import compute_batch_kernel

candidates = [
    # (mu_max, Ks, N0, S0, Y, feed_per_batch, name)
    (0.40, 1.0, 500.0, 500.0, 100.0, 200.0, "current_default"),
    (0.35, 1.0, 500.0, 500.0, 100.0, 200.0, "mu_lower"),
    (0.40, 0.8, 500.0, 500.0, 100.0, 200.0, "Ks_lower"),
    (0.40, 1.2, 500.0, 500.0, 100.0, 200.0, "Ks_higher"),
    (0.40, 1.0, 400.0, 500.0, 100.0, 200.0, "N0_lower"),
    (0.40, 1.0, 600.0, 500.0, 100.0, 200.0, "N0_higher"),
    (0.40, 1.0, 500.0, 400.0, 100.0, 200.0, "S0_lower"),
    (0.40, 1.0, 500.0, 600.0, 100.0, 200.0, "S0_higher"),
    (0.40, 1.0, 500.0, 500.0, 80.0, 200.0, "Y_lower"),
    (0.40, 1.0, 500.0, 500.0, 120.0, 200.0, "Y_higher"),
]

def test_preset(mu_max, ks, n0, s0, y, feed_per_batch, name, steps=100000, batch_size=10000):
    """100k steps run"""
    np.random.seed(42)
    engine = SimulationEngine(max_strains=3000)
    manager = SimulationManager(engine)

    engine.spawn(initial=True)
    idx = np.where(engine.active_mask)[0][0]
    engine.traits[idx, 0] = mu_max
    engine.traits[idx, 1] = ks
    engine.N[idx] = n0
    engine.m_costs[idx] = engine.calculate_maintenance(engine.traits[idx])

    manager.S = s0
    manager.T = 0.0
    manager.pH = 7.0
    manager.env_params[0] = 25.0
    manager.env_params[1] = 0.0
    manager.env_params[5] = y
    manager.auto_feed_enabled = True
    manager.feed_per_batch = feed_per_batch
    manager.feed_max_s = 10000.0

    dt = 0.01
    batches = steps // batch_size
    dt_actual = 0.01

    print(f"\n{'='*70}")
    print(f"Testing: {name}")
    print(f"  mu_max={mu_max:.2f}, Ks={ks:.2f}, N0={n0:.0f}, S0={s0:.0f}, Y={y:.0f}, feed={feed_per_batch:.0f}")
    print(f"{'='*70}")

    for b in range(batches):
        res_N, res_S, res_T, res_pH, extinct = compute_batch_kernel(
            engine.N, engine.traits, engine.m_costs, engine.active_mask,
            manager.S, manager.T, manager.pH, manager.env_params,
            engine.plasmid_pool, engine.pool_conc, dt_actual, batch_size
        )

        engine.N, manager.S, manager.T, manager.pH = res_N, res_S, res_T, res_pH
        engine.total_steps += batch_size

        manager.apply_nutrient_feed()
        engine.reap()
        div_count = engine.division_trigger(threshold=50.0)
        manager.division_count += div_count
        engine.refresh_env_pool()
        hgt_count = manager.run_hgt_events(dt=dt_actual, batch_size=batch_size)

        if np.random.rand() < 0.3:
            active = np.where(engine.active_mask)[0]
            if len(active) > 0:
                parent_idx = np.random.choice(active)
                engine.spawn(parent_idx=parent_idx)

        active_idx = np.where(engine.active_mask)[0]
        if extinct or len(active_idx) == 0:
            print(f"  [EXTINCT] at step {engine.total_steps:,}")
            return False, 0.0, 0.0, 0

        if (b + 1) % 2 == 0:
            total_n = float(np.sum(engine.N[active_idx]))
            print(f"  B{b+1:2d} | Step {engine.total_steps:>7,} | N={total_n:>10.1f} | S={manager.S:>8.1f} | Strains={len(active_idx):3d} | Div={div_count} | HGT={hgt_count}")

    active_idx = np.where(engine.active_mask)[0]
    total_n = float(np.sum(engine.N[active_idx]))
    print(f"  [SUCCESS] Final: N={total_n:.1f}, S={manager.S:.1f}, Strains={len(active_idx)}, Divisions={manager.division_count}")
    return True, total_n, manager.S, len(active_idx)


print("EXTENDED PRESET VALIDATION (100k steps each)")
results = []

for mu, ks, n0, s0, y, feed, name in candidates:
    ok, final_n, final_s, final_strains = test_preset(mu, ks, n0, s0, y, feed, name)
    results.append({
        "name": name,
        "mu_max": mu,
        "Ks": ks,
        "N0": n0,
        "S0": s0,
        "Y": y,
        "feed": feed,
        "ok": ok,
        "final_N": final_n if ok else 0.0,
        "final_S": final_s if ok else 0.0,
        "final_strains": final_strains
    })

print("\n" + "="*70)
print("SUMMARY (sorted by success, then final_N)")
print("="*70)

results.sort(key=lambda r: (r["ok"], r["final_N"]), reverse=True)

for rank, res in enumerate(results, 1):
    status = "✓" if res["ok"] else "✗"
    print(
        f"{status} #{rank} {res['name']:20s} | "
        f"mu={res['mu_max']:.2f} Ks={res['Ks']:.2f} N0={res['N0']:.0f} S0={res['S0']:.0f} Y={res['Y']:.0f} feed={res['feed']:.0f} | "
        f"Final: N={res['final_N']:.1f}, S={res['final_S']:.1f}, Strains={res['final_strains']}"
    )

successful = [r for r in results if r["ok"]]
if successful:
    best = successful[0]
    print("\n" + "="*70)
    print(f"BEST PRESET: {best['name']}")
    print(f"  mu_max={best['mu_max']:.2f}")
    print(f"  Ks={best['Ks']:.2f}")
    print(f"  N0={best['N0']:.0f}")
    print(f"  S0={best['S0']:.0f}")
    print(f"  Y={best['Y']:.0f}")
    print(f"  feed_per_batch={best['feed']:.0f}")
    print("="*70)
