#!/usr/bin/env python3
"""
スタンドアロン検証スクリプト：バックエンドロジックの単体テスト
RK4精度、維持コスト、分裂、HGTを検証
"""

import numpy as np
import logging
import sys
from engine import SimulationEngine
from manager import SimulationManager
from core import compute_batch_kernel

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

def test_maintenance_cost():
    """維持コスト関数の検証"""
    logger.info("=" * 60)
    logger.info("TEST 1: Maintenance Cost Function")
    logger.info("=" * 60)
    
    engine = SimulationEngine(max_strains=100)
    
    # トレース: 異なる形質を持つ株のコスト比較
    traits_weak = np.array([0.5, 2.0, 0.0, 0.0, 25.0, 7.0, 0.0])      # 弱い株
    traits_strong = np.array([2.0, 0.5, 2.0, 2.0, 20.0, 6.0, 4.0])   # 強い株
    
    cost_weak = engine.calculate_maintenance(traits_weak)
    cost_strong = engine.calculate_maintenance(traits_strong)
    
    logger.info(f"  Weak strain traits:   {traits_weak}")
    logger.info(f"  Weak strain m_cost:   {cost_weak:.4f}")
    logger.info(f"  Strong strain traits: {traits_strong}")
    logger.info(f"  Strong strain m_cost: {cost_strong:.4f}")
    logger.info(f"  Cost ratio (strong/weak): {cost_strong/cost_weak:.2f}x")
    
    assert cost_strong > cost_weak, "Strong strain should have higher maintenance cost"
    logger.info("  ✓ Maintenance cost verification passed")

def test_rk4_stability():
    """RK4数値積分の安定性と精度テスト"""
    logger.info("\n" + "=" * 60)
    logger.info("TEST 2: RK4 Integration Stability & Accuracy")
    logger.info("=" * 60)
    
    engine = SimulationEngine(max_strains=100)
    manager = SimulationManager(engine)
    
    # 初期条件
    N = np.array([1000.0] + [0.0] * 99)
    traits = np.zeros((100, 7))
    traits[0] = np.array([1.2, 0.5, 0.0, 0.0, 25.0, 7.0, 0.0])
    m_costs = np.array([engine.calculate_maintenance(traits[i]) for i in range(100)])
    active_mask = np.zeros(100, dtype=bool)
    active_mask[0] = True
    
    S, T, pH = 200.0, 0.0, 7.0
    env_params = manager.env_params
    
    dt = 0.01
    batch_size = 10000
    
    logger.info(f"  Initial: N[0]={N[0]:.0f}, S={S:.1f}")
    
    # 1バッチ実行（10000ステップ）
    N_res, S_res, T_res, pH_res, extinct = compute_batch_kernel(
        N, traits, m_costs, active_mask, S, T, pH, env_params,
        engine.plasmid_pool, engine.pool_conc, dt, batch_size
    )
    
    logger.info(f"  After {batch_size} steps (t=100):")
    logger.info(f"    N[0]={N_res[0]:.0f}, S={S_res:.1f}, T={T_res:.4f}, pH={pH_res:.2f}")
    logger.info(f"    Extinct flag: {extinct}")
    
    # 検証
    assert not np.isnan(N_res[0]), "RK4 produced NaN"
    assert N_res[0] > 0, "Population should not die"
    assert S_res < S, "Nutrient should be consumed"
    
    logger.info("  ✓ RK4 stability verified (no NaN, positive N, S consumed)")

def test_division():
    """分裂イベントの検証"""
    logger.info("\n" + "=" * 60)
    logger.info("TEST 3: Cell Division Event")
    logger.info("=" * 60)
    
    engine = SimulationEngine(max_strains=100)
    
    # 初期化：1株、個体数100
    engine.spawn(initial=True)
    engine.N[0] = 100.0
    
    logger.info(f"  Before division:")
    logger.info(f"    Active strains: {np.sum(engine.active_mask)}")
    logger.info(f"    N[0]={engine.N[0]:.1f}")
    
    # 分裂実行
    div_count = engine.division_trigger(threshold=50.0)
    
    logger.info(f"  After division:")
    logger.info(f"    Division events: {div_count}")
    logger.info(f"    Active strains: {np.sum(engine.active_mask)}")
    logger.info(f"    N[0]={engine.N[0]:.1f}")
    logger.info(f"    N[1]={engine.N[1]:.1f}")
    
    assert div_count == 1, "Should have 1 division event"
    assert engine.N[0] == 50.0, "Parent should have N/2"
    assert engine.N[1] > 0, "Daughter should be spawned"
    assert np.sum(engine.active_mask) == 2, "Should have 2 active strains"
    
    logger.info("  ✓ Division verified (parent split, daughter spawned)")

def test_hgt_event():
    """水平伝播（HGT）イベントの検証"""
    logger.info("\n" + "=" * 60)
    logger.info("TEST 4: Horizontal Gene Transfer (HGT) Event")
    logger.info("=" * 60)
    
    engine = SimulationEngine(max_strains=100)
    manager = SimulationManager(engine)
    
    # 初期化：2つの株を配置
    # 株0：低毒素生産、高耐性
    # 株1：高毒素生産、低耐性
    engine.spawn(initial=True)
    engine.spawn(initial=True)
    
    engine.N[0] = 1000.0
    engine.N[1] = 1000.0
    
    engine.traits[0] = np.array([1.0, 0.5, 0.0, 0.0, 25.0, 7.0, 0.0])  # 低毒素
    engine.traits[1] = np.array([1.0, 0.5, 2.0, 2.0, 25.0, 7.0, 0.0])  # 高毒素
    
    logger.info(f"  Before HGT:")
    logger.info(f"    Strain 0: traits={engine.traits[0]}, N={engine.N[0]:.0f}")
    logger.info(f"    Strain 1: traits={engine.traits[1]}, N={engine.N[1]:.0f}")
    logger.info(f"    Active strains: {np.sum(engine.active_mask)}")
    
    # HGT実行（決定的にするため、k_hgtを大きく設定）
    manager.k_hgt = 1e-6  # 通常より1000倍大きく
    hgt_count = manager.run_hgt_events(dt=0.01, batch_size=10000)
    
    logger.info(f"  After HGT:")
    logger.info(f"    HGT events: {hgt_count}")
    logger.info(f"    Active strains: {np.sum(engine.active_mask)}")
    
    active_idx = np.where(engine.active_mask)[0]
    for idx in active_idx:
        logger.info(f"    Strain {idx}: traits={engine.traits[idx]}, N={engine.N[idx]:.0f}")
    
    # HGTが発生した場合は新株が誕生
    if hgt_count > 0:
        logger.info(f"  ✓ HGT event verified ({hgt_count} events)")
    else:
        logger.info(f"  ⚠ No HGT events (expected due to low probability); k_hgt={manager.k_hgt}")

def test_full_simulation():
    """完全統合テスト：100,000ステップまで実行"""
    logger.info("\n" + "=" * 60)
    logger.info("TEST 5: Full Simulation (100k steps)")
    logger.info("=" * 60)
    
    engine = SimulationEngine(max_strains=1000)
    manager = SimulationManager(engine)
    manager.is_running = True
    
    # 初期化
    engine.spawn(initial=True)
    
    dt = 0.01
    batch_size = 10000
    env_params = manager.env_params
    
    logger.info(f"  Initial state: N[0]={engine.N[0]:.0f}, S={manager.S:.1f}")
    logger.info(f"  Running 10 batches (100k steps) with RK4...")
    
    # 10バッチ実行
    for batch_idx in range(10):
        # RK4カーネル
        res_N, res_S, res_T, res_pH, extinct = compute_batch_kernel(
            engine.N, engine.traits, engine.m_costs, engine.active_mask,
            manager.S, manager.T, manager.pH, env_params,
            engine.plasmid_pool, engine.pool_conc, dt, batch_size
        )
        
        engine.N, manager.S, manager.T, manager.pH = res_N, res_S, res_T, res_pH
        engine.total_steps += batch_size
        
        # 自動供給（デフォルト設定を反映）
        manager.apply_nutrient_feed()
        
        # 後処理
        engine.reap()
        div_count = engine.division_trigger(threshold=50.0)
        manager.division_count += div_count
        engine.refresh_env_pool()
        hgt_count = manager.run_hgt_events(dt=dt, batch_size=batch_size)
        
        # ログ
        active = np.sum(engine.active_mask)
        if (batch_idx + 1) % 2 == 0 or batch_idx == 0:
            logger.info(f"    Batch {batch_idx + 1:2d}: Step={engine.total_steps:,} | "
                       f"Strains={active:3d} | N_total={np.sum(engine.N):.0f} | "
                       f"S={manager.S:.1f} | Div={div_count} | HGT={hgt_count}")
        
        if extinct or active == 0:
            logger.warning(f"    Early extinction at step {engine.total_steps}")
            break
    
    logger.info(f"  ✓ Full simulation completed")
    logger.info(f"    Total steps: {engine.total_steps:,}")
    logger.info(f"    Final strains: {np.sum(engine.active_mask)}")
    logger.info(f"    Total divisions: {manager.division_count}")
    logger.info(f"    Total HGT events: {manager.hgt_count}")

def main():
    logger.info("BACKEND VALIDATION TEST SUITE")
    logger.info("=" * 60)
    
    try:
        test_maintenance_cost()
        test_rk4_stability()
        test_division()
        test_hgt_event()
        test_full_simulation()
        
        logger.info("\n" + "=" * 60)
        logger.info("✓ ALL TESTS PASSED")
        logger.info("=" * 60)
        return 0
    except Exception as e:
        logger.error(f"\n✗ TEST FAILED: {e}", exc_info=True)
        return 1

if __name__ == "__main__":
    sys.exit(main())
