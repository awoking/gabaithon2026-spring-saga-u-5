#!/usr/bin/env python3
"""デフォルト値による最終動作確認"""
import numpy as np
from engine import SimulationEngine
from manager import SimulationManager
from core import compute_batch_kernel

print("="*80)
print("Verification with updated default parameters")
print("="*80)

engine = SimulationEngine(max_strains=3000)
manager = SimulationManager(engine)  # デフォルト値を使用

# デフォルト初期株を生成
engine.spawn(initial=True)

print("\nDefault configuration:")
print(f"  S0 = {manager.S}")
print(f"  N0 = {engine.N[np.where(engine.active_mask)[0][0]]}")
print(f"  k_acid = {manager.env_params[4]}")
print(f"  Y = {manager.env_params[5]}")
print(f"  auto_feed = {manager.auto_feed_enabled}")
print(f"  feed_per_batch = {manager.feed_per_batch}")
print(f"  feed_max_s = {manager.feed_max_s}")

idx = np.where(engine.active_mask)[0][0]
print(f"\nInitial strain traits:")
print(f"  μ_max = {engine.traits[idx][0]}")
print(f"  Ks = {engine.traits[idx][1]}")
print(f"  pH_opt = {engine.traits[idx][5]}")

print(f"\nRunning 50,000 steps test...")
print("-"*80)

dt, batch_size, max_batches = 0.01, 10000, 5

for batch_idx in range(max_batches):
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
    engine.refresh_env_pool()
    manager.run_hgt_events(dt=dt, batch_size=batch_size)
    
    if np.random.rand() < 0.3:
        active = np.where(engine.active_mask)[0]
        if len(active) > 0:
            engine.spawn(parent_idx=np.random.choice(active))
    
    active_idx = np.where(engine.active_mask)[0]
    if len(active_idx) == 0 or extinct:
        print(f"[FAILED] Extinct at {engine.total_steps:,}")
        exit(1)
    
    N_total = float(np.sum(engine.N[active_idx]))
    print(f"  B{batch_idx+1} | {engine.total_steps:>7,} | N {N_total:>10.1f} | "
          f"S {manager.S:>8.1f} | pH {manager.pH:.2f} | Div {div_count}")

active_idx = np.where(engine.active_mask)[0]
final_N = float(np.sum(engine.N[active_idx]))

print("\n" + "="*80)
print(f"[SUCCESS] with default parameters")
print(f"  Final N: {final_N:.1f}")
print(f"  Strains: {len(active_idx)}")
print(f"  S: {manager.S:.1f}")
print("="*80)
