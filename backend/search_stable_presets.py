#!/usr/bin/env python3
import itertools
import numpy as np

from engine import SimulationEngine
from manager import SimulationManager
from core import compute_batch_kernel


def run_once(mu_max, ks, n0, s0, y, feed_per_batch, seed, steps=50000, batch_size=100):
    np.random.seed(seed)
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

    for _ in range(batches):
        res_N, res_S, res_T, res_pH, extinct = compute_batch_kernel(
            engine.N, engine.traits, engine.m_costs, engine.active_mask,
            manager.S, manager.T, manager.pH, manager.env_params,
            engine.plasmid_pool, engine.pool_conc, dt, batch_size
        )

        engine.N, manager.S, manager.T, manager.pH = res_N, res_S, res_T, res_pH
        engine.total_steps += batch_size

        manager.apply_nutrient_feed()
        engine.reap()
        div_count = engine.division_trigger(threshold=50.0)
        manager.division_count += div_count
        engine.refresh_env_pool()
        manager.run_hgt_events(dt=dt, batch_size=batch_size)

        if np.random.rand() < 0.3:
            active = np.where(engine.active_mask)[0]
            if len(active) > 0:
                parent_idx = np.random.choice(active)
                engine.spawn(parent_idx=parent_idx)

        active_idx = np.where(engine.active_mask)[0]
        if extinct or len(active_idx) == 0:
            return False, 0.0, manager.S, int(engine.total_steps)

    active_idx = np.where(engine.active_mask)[0]
    total_n = float(np.sum(engine.N[active_idx])) if len(active_idx) > 0 else 0.0
    return True, total_n, manager.S, int(engine.total_steps)


def evaluate_combo(mu_max, ks, n0, s0, y, feed_per_batch, seeds=(0, 1, 2)):
    survives = 0
    final_ns = []
    final_ss = []

    for seed in seeds:
        ok, final_n, final_s, _ = run_once(mu_max, ks, n0, s0, y, feed_per_batch, seed)
        if ok:
            survives += 1
            final_ns.append(final_n)
            final_ss.append(final_s)

    survival_rate = survives / len(seeds)
    avg_n = float(np.mean(final_ns)) if final_ns else 0.0
    avg_s = float(np.mean(final_ss)) if final_ss else 0.0

    # スコア: 生存率を最優先、次に最終N（上限をかけて暴走を抑制）
    capped_n = min(avg_n, 5000.0)
    score = survival_rate * 1000.0 + capped_n

    return {
        "mu_max": mu_max,
        "Ks": ks,
        "N0": n0,
        "S0": s0,
        "Y": y,
        "feed_per_batch": feed_per_batch,
        "survival_rate": survival_rate,
        "avg_final_N": avg_n,
        "avg_final_S": avg_s,
        "score": score,
    }


def main():
    mu_grid = [0.30, 0.40, 0.50]
    ks_grid = [0.5, 1.0, 2.0]
    n0_grid = [300.0, 500.0]
    s0_grid = [300.0, 500.0]
    y_grid = [80.0, 100.0, 120.0]
    feed_grid = [150.0, 200.0, 250.0]

    combos = list(itertools.product(mu_grid, ks_grid, n0_grid, s0_grid, y_grid, feed_grid))
    print(f"Searching {len(combos)} combinations...")

    results = []
    for i, (mu, ks, n0, s0, y, feed) in enumerate(combos, 1):
        res = evaluate_combo(mu, ks, n0, s0, y, feed)
        results.append(res)
        if i % 20 == 0:
            print(f"  progress: {i}/{len(combos)}")

    stable = [r for r in results if r["survival_rate"] >= 1.0]
    stable_sorted = sorted(stable, key=lambda x: x["score"], reverse=True)

    print("\n=== TOP STABLE PRESETS (survival_rate=1.0) ===")
    for rank, row in enumerate(stable_sorted[:10], 1):
        print(
            f"#{rank} mu={row['mu_max']:.2f}, Ks={row['Ks']:.2f}, N0={row['N0']:.0f}, S0={row['S0']:.0f}, "
            f"Y={row['Y']:.0f}, feed={row['feed_per_batch']:.0f} | "
            f"avgN={row['avg_final_N']:.1f}, avgS={row['avg_final_S']:.1f}, score={row['score']:.1f}"
        )

    if not stable_sorted:
        print("No fully stable presets found in this grid.")


if __name__ == "__main__":
    main()
