#!/usr/bin/env python3
import itertools
from search_stable_presets import evaluate_combo

mu_grid = [0.30, 0.40, 0.50]
ks_grid = [0.5, 1.0, 2.0]
n0_grid = [300.0, 500.0]
s0_grid = [300.0, 500.0]
y_grid = [80.0, 100.0, 120.0]
feed_grid = [150.0, 200.0, 250.0]

results = []
for combo in itertools.product(mu_grid, ks_grid, n0_grid, s0_grid, y_grid, feed_grid):
    results.append(evaluate_combo(*combo))

results.sort(key=lambda r: (r["survival_rate"], r["score"]), reverse=True)

print("top by survival_rate then score")
for i, row in enumerate(results[:20], 1):
    print(
        f"#{i} sr={row['survival_rate']:.2f} "
        f"mu={row['mu_max']:.2f} Ks={row['Ks']:.2f} "
        f"N0={row['N0']:.0f} S0={row['S0']:.0f} Y={row['Y']:.0f} feed={row['feed_per_batch']:.0f} "
        f"avgN={row['avg_final_N']:.1f} avgS={row['avg_final_S']:.1f}"
    )
