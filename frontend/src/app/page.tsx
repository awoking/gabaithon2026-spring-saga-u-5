"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SimulationState = 'setup' | 'running' | 'finished';

type Strain = SimulationData["ranking"][number];

type TrackedPoint = {
  step: number;
  N: number;
  mu_max: number;
  Ks: number;
  p: number;
  r: number;
  T_opt: number;
  pH_opt: number;
  Rad_res: number;
};

type SimulationData = {
  step: number;
  env: {
    S: number;
    T: number;
    pH: number;
    temp: number;
    rad: number;
  };
  feed: {
    enabled: boolean;
    per_batch: number;
    max_s: number;
  };
  ranking: Array<{
    id: number;
    N: number;
    mu_max: number;
    Ks: number;
    p: number;
    r: number;
    T_opt: number;
    pH_opt: number;
    Rad_res: number;
  }>;
  stats: {
    total_N: number;
    active_strains: number;
    division_count: number;
    hgt_count: number;
  };
};

// デフォルト値（検証済みの安定プリセット）
const DEFAULT_STRAIN = {
  mu_max: 0.4,
  Ks: 1.0,
  N0: 500.0,
  p: 0.0,
  r: 0.0,
  T_opt: 25.0,
  pH_opt: 7.0,
  Rad_res: 0.0,
};

function loadInitialStrainConfig() {
  if (typeof window === "undefined") return DEFAULT_STRAIN;
  try {
    const raw = localStorage.getItem("initialStrainConfig");
    if (!raw) return DEFAULT_STRAIN;
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_STRAIN>;
    return {
      ...DEFAULT_STRAIN,
      mu_max: Number(parsed.mu_max ?? DEFAULT_STRAIN.mu_max),
      Ks: Number(parsed.Ks ?? DEFAULT_STRAIN.Ks),
      N0: Number(parsed.N0 ?? DEFAULT_STRAIN.N0),
      p: Number(parsed.p ?? DEFAULT_STRAIN.p),
      r: Number(parsed.r ?? DEFAULT_STRAIN.r),
      T_opt: Number(parsed.T_opt ?? DEFAULT_STRAIN.T_opt),
      pH_opt: Number(parsed.pH_opt ?? DEFAULT_STRAIN.pH_opt),
      Rad_res: Number(parsed.Rad_res ?? DEFAULT_STRAIN.Rad_res),
    };
  } catch {
    return DEFAULT_STRAIN;
  }
}

const DEFAULT_ENV = {
  S0: 500.0,
  T0: 0.0,
  pH0: 7.0,
  temp: 25.0,
  rad: 0.0,
  Y: 100.0,
  auto_feed_enabled: true,
  feed_per_batch: 200.0,
  feed_max_s: 10000.0,
};

const STRAIN_COLORS = [
  "bg-emerald-400",
  "bg-blue-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-cyan-400",
  "bg-orange-400",
  "bg-pink-400",
  "bg-lime-400",
  "bg-indigo-400",
];

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function formatMaybe(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function SimulationVisualization({
  data,
  trackedStrainId,
}: {
  data: SimulationData;
  trackedStrainId: number | null;
}) {
  type Particle = {
    id: string;
    strainId: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    color: string;
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);

  const totalN = data.stats.total_N;
  const ranking = data.ranking;
  const divisionCount = data.stats.division_count;

  const tracked =
    trackedStrainId == null ? null : ranking.find((s) => s.id === trackedStrainId) ?? null;

  // 粒子をデータから生成
  useEffect(() => {
    const maxParticles = 24;
    if (!ranking.length || totalN <= 0) {
      setParticles([]);
      return;
    }

    const topStrains = ranking.slice(0, 6);
    const weights = topStrains.map((s) => Math.max(0, s.N));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;

    const counts = topStrains.map((_, i) =>
      Math.max(1, Math.round((weights[i] / sum) * maxParticles))
    );
    const currentTotal = counts.reduce((a, b) => a + b, 0);
    if (currentTotal > maxParticles) {
      let diff = currentTotal - maxParticles;
      for (let i = counts.length - 1; i >= 0 && diff > 0; i--) {
        const reduce = Math.min(diff, counts[i] - 1);
        counts[i] -= reduce;
        diff -= reduce;
      }
    }

    const nextParticles: Particle[] = [];
    let pIndex = 0;
    topStrains.forEach((s, idx) => {
      const baseColor = STRAIN_COLORS[idx % STRAIN_COLORS.length];
      for (let i = 0; i < counts[idx]; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 22 + Math.random() * 6;
        const offsetR = 0.15 + Math.random() * 0.35;
        nextParticles.push({
          id: `p-${s.id}-${pIndex++}`,
          strainId: s.id,
          x: 0.5 + Math.cos(angle) * offsetR,
          y: 0.45 + Math.sin(angle) * offsetR,
          vx: (Math.random() - 0.5) * 0.002,
          vy: (Math.random() - 0.5) * 0.002,
          radius,
          color: baseColor,
        });
      }
    });

    setParticles(nextParticles);
  }, [ranking, totalN]);

  // 粒子をゆっくり動かす
  useEffect(() => {
    let frameId: number;
    const tick = () => {
      setParticles((prev) =>
        prev.map((p) => {
          let { x, y, vx, vy } = p;
          x += vx;
          y += vy;

          if (x < 0.1 || x > 0.9) vx *= -1;
          if (y < 0.1 || y > 0.9) vy *= -1;

          return {
            ...p,
            x: clamp01(x),
            y: clamp01(y),
            vx,
            vy,
          };
        })
      );
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[300px] rounded-lg bg-slate-700 border border-slate-600 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[rgba(148,163,184,0.5)]" />

      {particles.map((p) => {
        const left = `${p.x * 100}%`;
        const top = `${p.y * 100}%`;
        const size = p.radius * 2;
        const isTracked = tracked && tracked.id === p.strainId;

        return (
          <div
            key={p.id}
            className="absolute"
            style={{
              left,
              top,
              width: size,
              height: size,
              marginLeft: -p.radius,
              marginTop: -p.radius,
            }}
          >
            <div
              className={`w-full h-full rounded-full flex items-center justify-center shadow-md transition-transform duration-500 ${
                isTracked ? "scale-110" : "scale-100"
              }`}
              style={{
                background:
                  "radial-gradient(circle at center, #f97373 0, #f97373 40%, #ffffff 45%, #ffffff 100%)",
                opacity: isTracked ? 1 : 0.75,
              }}
            />
          </div>
        );
      })}

      <div className="absolute bottom-2 left-2 right-2 flex justify-between text-xs text-slate-100 drop-shadow">
        <span>
          {tracked ? (
            <>
              追跡: #{tracked.id} / N={tracked.N.toFixed(1)}（全体={totalN.toFixed(0)}）
            </>
          ) : (
            <>総個体数: {totalN.toFixed(0)}（粒子数: {particles.length}）</>
          )}
        </span>
        <span>分裂回数: {divisionCount}</span>
      </div>
    </div>
  );
}

function MiniBarSeries({
  values,
  maxBars = 36,
}: {
  values: Array<{ step: number; value: number }>;
  maxBars?: number;
}) {
  const sliced = values.slice(Math.max(0, values.length - maxBars));
  const maxV = sliced.reduce((m, v) => Math.max(m, v.value), 0);
  return (
    <div className="flex items-end gap-0.5 h-12 bg-slate-900/50 border border-slate-700 rounded px-2 py-1">
      {sliced.map((v) => {
        const h = maxV > 0 ? Math.max(2, Math.round((v.value / maxV) * 44)) : 2;
        return (
          <div
            key={v.step}
            title={`step ${v.step}: ${v.value.toFixed(1)}`}
            className="w-1 rounded-sm bg-emerald-400/80"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState<SimulationState>('setup');
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [data, setData] = useState<SimulationData | null>(null);
  const [finalStep, setFinalStep] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const isRunningRef = useRef(false);

  // 設定フォーム
  const [strainConfig, setStrainConfig] = useState(DEFAULT_STRAIN);
  const [envConfig, setEnvConfig] = useState(DEFAULT_ENV);

  // 追跡する株（1つにフォーカス）
  const [trackedStrainId, setTrackedStrainId] = useState<number | null>(null);
  const [trackedHistory, setTrackedHistory] = useState<Record<number, TrackedPoint[]>>({});

  // /start で保存した初期株設定を反映
  useEffect(() => {
    setStrainConfig(loadInitialStrainConfig());
  }, []);

  // WebSocket接続
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws");
    
    ws.onopen = () => {
      console.log("WebSocket connected");
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === "BATCH_UPDATE") {
        if (!isRunningRef.current) return;
        const batch: SimulationData = message;
        setData(batch);

        // trackedStrainIdが未選択なら、まずはトップ株を追跡対象にする
        setTrackedStrainId((prev) => {
          if (prev != null) return prev;
          return batch.ranking?.[0]?.id ?? null;
        });

        // 履歴を追記（追跡株は固定だが、全株分持っておくと切替時にすぐ見られる）
        setTrackedHistory((prev) => {
          const next = { ...prev };
          for (const s of batch.ranking) {
            const arr = next[s.id] ? [...next[s.id]] : [];
            const last = arr[arr.length - 1];
            if (!last || last.step !== batch.step) {
              arr.push({
                step: batch.step,
                N: s.N,
                mu_max: s.mu_max,
                Ks: s.Ks,
                p: s.p,
                r: s.r,
                T_opt: s.T_opt,
                pH_opt: s.pH_opt,
                Rad_res: s.Rad_res,
              });
              // メモリ上限（最近の200点だけ保持）
              if (arr.length > 200) arr.splice(0, arr.length - 200);
              next[s.id] = arr;
            } else {
              next[s.id] = arr;
            }
          }
          return next;
        });
      } else if (message.type === "SIMULATION_ENDED") {
        if (!isRunningRef.current) return;
        console.log("Simulation ended:", message.reason);
        isRunningRef.current = false;
        setFinalStep(message.final_step);
        setState('finished');
      } else if (message.type === "RESET_COMPLETE") {
        console.log("Reset complete");
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      setIsConnected(false);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  const sendMessage = (message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const handleStart = () => {
    isRunningRef.current = true;
    sendMessage({
      type: "START",
      initial_strain: strainConfig,
      environment: envConfig
    });
    setState('running');
    setIsPaused(false);
    setData(null);
    setTrackedStrainId(null);
    setTrackedHistory({});
  };

  const handlePauseResume = () => {
    if (isPaused) {
      sendMessage({ type: "RESUME" });
      setIsPaused(false);
    } else {
      sendMessage({ type: "PAUSE" });
      setIsPaused(true);
    }
  };

  const handleReset = () => {
    isRunningRef.current = false;
    sendMessage({ type: "RESET" });
    setState('setup');
    setIsPaused(false);
    setData(null);
    setFinalStep(0);
    setStrainConfig(loadInitialStrainConfig());
    setEnvConfig(DEFAULT_ENV);
    setTrackedStrainId(null);
    setTrackedHistory({});
  };

  // 設定画面
  if (state === 'setup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              SAGA-U 微生物進化シミュレーター
            </h1>
            <p className="text-slate-400">初期設定</p>
            <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {isConnected ? '● サーバー接続中' : '○ サーバー未接続'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* 初期株設定 */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">初期株設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-slate-300">μ_max (最大成長速度)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={strainConfig.mu_max}
                    onChange={(e) => setStrainConfig({...strainConfig, mu_max: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Ks (モノド定数)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={strainConfig.Ks}
                    onChange={(e) => setStrainConfig({...strainConfig, Ks: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">N0 (初期個体数)</Label>
                  <Input
                    type="number"
                    step="10"
                    value={strainConfig.N0}
                    onChange={(e) => setStrainConfig({...strainConfig, N0: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">T_opt (最適温度 °C)</Label>
                  <Input
                    type="number"
                    step="1"
                    value={strainConfig.T_opt}
                    onChange={(e) => setStrainConfig({...strainConfig, T_opt: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">pH_opt (最適pH)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={strainConfig.pH_opt}
                    onChange={(e) => setStrainConfig({...strainConfig, pH_opt: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              </CardContent>
            </Card>

            {/* 環境設定 */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">環境設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-slate-300">S0 (初期基質濃度)</Label>
                  <Input
                    type="number"
                    step="10"
                    value={envConfig.S0}
                    onChange={(e) => setEnvConfig({...envConfig, S0: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">温度 (°C)</Label>
                  <Input
                    type="number"
                    step="1"
                    value={envConfig.temp}
                    onChange={(e) => setEnvConfig({...envConfig, temp: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">放射線レベル</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={envConfig.rad}
                    onChange={(e) => setEnvConfig({...envConfig, rad: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Y (収率)</Label>
                  <Input
                    type="number"
                    step="10"
                    value={envConfig.Y}
                    onChange={(e) => setEnvConfig({...envConfig, Y: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">自動供給量/バッチ</Label>
                  <Input
                    type="number"
                    step="10"
                    value={envConfig.feed_per_batch}
                    onChange={(e) => setEnvConfig({...envConfig, feed_per_batch: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-center">
            <Button
              onClick={handleStart}
              disabled={!isConnected}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-12 py-6 text-lg font-bold"
            >
              🚀 シミュレーション開始
            </Button>
          </div>

          {!isConnected && (
            <Card className="bg-slate-800/50 border-slate-700 mt-6">
              <CardContent className="p-6 text-center">
                <div className="text-red-400 mb-2">⚠ バックエンドサーバーが起動していません</div>
                <code className="text-sm text-slate-400 block bg-slate-900 p-3 rounded">
                  cd backend && python main.py
                </code>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // 終了画面
  if (state === 'finished') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-2xl">シミュレーション終了</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center py-8">
                <div className="text-6xl mb-4">💀</div>
                <div className="text-2xl font-bold text-red-400 mb-2">全個体が絶滅しました</div>
                <div className="text-slate-400">
                  最終ステップ: <span className="font-mono text-white">{finalStep.toLocaleString()}</span>
                </div>
              </div>

              {data && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-slate-900/50 p-4 rounded">
                    <div className="text-slate-400 mb-1">最終統計</div>
                    <div className="space-y-1">
                      <div>分裂回数: <span className="font-mono text-purple-400">{data.stats.division_count}</span></div>
                      <div>HGT回数: <span className="font-mono text-orange-400">{data.stats.hgt_count}</span></div>
                    </div>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded">
                    <div className="text-slate-400 mb-1">最終環境</div>
                    <div className="space-y-1">
                      <div>基質: <span className="font-mono text-yellow-400">{data.env.S.toFixed(1)}</span></div>
                      <div>pH: <span className="font-mono text-cyan-400">{data.env.pH.toFixed(2)}</span></div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-center pt-4">
                <Button
                  onClick={handleReset}
                  className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 px-8 py-4 text-lg"
                >
                  ↻ 設定に戻る
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 実行画面（既存の表示）
  const trackedStrain: Strain | null =
    data && trackedStrainId != null ? data.ranking.find((s) => s.id === trackedStrainId) ?? null : null;
  const trackedPoints: TrackedPoint[] =
    trackedStrainId != null ? trackedHistory[trackedStrainId] ?? [] : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー + 環境コントロール */}
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-slate-800/80 px-3 py-1 text-xs">
                <span className="mr-1">🌧</span>
                <span className="text-slate-300 mr-1">S0</span>
                <input
                  type="number"
                  step={10}
                  value={envConfig.S0}
                  onChange={(e) =>
                    setEnvConfig((prev) => ({ ...prev, S0: Number(e.target.value) }))
                  }
                  className="w-20 rounded bg-slate-900 border border-slate-700 px-1 py-0.5 text-right text-[11px]"
                />
              </div>
              <div className="flex items-center gap-1 rounded-full bg-slate-800/80 px-3 py-1 text-xs">
                <span className="mr-1">🌡</span>
                <span className="text-slate-300 mr-1">温度</span>
                <input
                  type="number"
                  step={1}
                  value={envConfig.temp}
                  onChange={(e) =>
                    setEnvConfig((prev) => ({ ...prev, temp: Number(e.target.value) }))
                  }
                  className="w-16 rounded bg-slate-900 border border-slate-700 px-1 py-0.5 text-right text-[11px]"
                />
              </div>
              <div className="flex items-center gap-1 rounded-full bg-slate-800/80 px-3 py-1 text-xs">
                <span className="mr-1">☢</span>
                <span className="text-slate-300 mr-1">放射線</span>
                <input
                  type="number"
                  step={0.1}
                  value={envConfig.rad}
                  onChange={(e) =>
                    setEnvConfig((prev) => ({ ...prev, rad: Number(e.target.value) }))
                  }
                  className="w-16 rounded bg-slate-900 border border-slate-700 px-1 py-0.5 text-right text-[11px]"
                />
              </div>
            </div>

            <div className="text-center">
              <h1 className="text-3xl font-bold mb-1 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                SAGA-U 微生物進化シミュレーター
              </h1>
              <div className="flex items-center justify-center gap-3 text-sm">
                <span className="px-3 py-0.5 rounded-full bg-green-500/20 text-green-400">
                  ● 実行中
                </span>
                {data && (
                  <span className="text-slate-300">
                    Step: {data.step.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <div className="hidden md:block text-right text-[11px] text-slate-400 max-w-[160px]">
              上の環境パラメータは<br />
              次回シミュレーション開始時に反映されます
            </div>
          </div>

          {/* 世代タブ（株タブ） */}
          {data && data.ranking.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {data.ranking.slice(0, 8).map((strain, index) => (
                <button
                  key={strain.id}
                  type="button"
                  onClick={() => setTrackedStrainId(strain.id)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs border ${
                    trackedStrainId === strain.id
                      ? "bg-slate-100 text-slate-900 border-slate-300"
                      : "bg-slate-800/80 text-slate-100 border-slate-600 hover:bg-slate-700"
                  }`}
                >
                  第{index + 1}世代
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 左: 個体ビジュアル（大きく表示） */}
          <div className="lg:col-span-3 min-h-[420px]">
            <Card className="bg-slate-800/50 border-slate-700 h-full min-h-[420px]">
              <CardHeader>
                <CardTitle className="text-white">個体の様子</CardTitle>
                <p className="text-slate-400 text-sm">
                  {trackedStrain ? (
                    <>追跡中: <span className="font-mono text-emerald-300">#{trackedStrain.id}</span>（他は薄く表示）</>
                  ) : (
                    <>分裂・増殖の様子を可視化</>
                  )}
                </p>
              </CardHeader>
              <CardContent className="h-[calc(100%-4rem)] min-h-[320px] p-4">
                {!data ? (
                  <div className="h-full flex items-center justify-center rounded-lg bg-slate-900/50 border border-slate-700 border-dashed">
                    <div className="text-slate-500 text-center">
                      <div className="text-lg mb-1">シミュレーション初期化中...</div>
                      <div className="text-sm">データを受信しています</div>
                    </div>
                  </div>
                ) : (
                  <SimulationVisualization data={data} trackedStrainId={trackedStrainId} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* 右: コントロール・統計・環境・ランキングをまとめて表示 */}
          <div className="lg:col-span-2 space-y-4 overflow-y-auto max-h-[calc(100vh-12rem)]">
            {/* コントロール */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="py-3">
                <CardTitle className="text-white text-base">コントロール</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 py-3">
                <Button
                  onClick={handlePauseResume}
                  className={`w-full ${isPaused ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
                >
                  {isPaused ? '▶ 再開' : '⏸ 一時停止'}
                </Button>
                <Button
                  onClick={handleReset}
                  variant="outline"
                  className="w-full border-slate-600 text-slate-300 hover:bg-slate-700 text-sm"
                >
                  ↻ 中止して設定に戻る
                </Button>
              </CardContent>
            </Card>

            {/* 追跡中の株 */}
            {data && data.ranking.length > 0 && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="py-3">
                  <CardTitle className="text-white text-base">追跡中の株</CardTitle>
                </CardHeader>
                <CardContent className="py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-sm whitespace-nowrap">追跡ID</span>
                    <select
                      value={trackedStrainId ?? ""}
                      onChange={(e) => setTrackedStrainId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-sm"
                    >
                      {data.ranking.slice(0, 20).map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id}（N={s.N.toFixed(1)} / μ={s.mu_max.toFixed(2)}）
                        </option>
                      ))}
                    </select>
                  </div>

                  {trackedStrain ? (
                    <>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400">個体数 N</span>
                          <span className="font-mono text-emerald-300">{trackedStrain.N.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">μ_max</span>
                          <span className="font-mono text-purple-300">{formatMaybe(trackedStrain.mu_max)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Ks</span>
                          <span className="font-mono text-cyan-300">{formatMaybe(trackedStrain.Ks)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">T_opt / pH_opt</span>
                          <span className="font-mono text-orange-300">
                            {formatMaybe(trackedStrain.T_opt, 1)} / {formatMaybe(trackedStrain.pH_opt, 1)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="text-slate-400 text-xs mb-1">N の推移（直近）</div>
                        <MiniBarSeries values={trackedPoints.map((p) => ({ step: p.step, value: p.N }))} />
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-500 text-sm">追跡対象が見つかりません（株が更新された可能性）</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 統計・環境（コンパクトに2列） */}
            {data && (
              <>
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="py-3">
                    <CardTitle className="text-white text-base">統計</CardTitle>
                  </CardHeader>
                  <CardContent className="py-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">総個体数:</span>
                      <span className="font-mono text-green-400">{data.stats.total_N.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">株数:</span>
                      <span className="font-mono text-blue-400">{data.stats.active_strains}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">分裂回数:</span>
                      <span className="font-mono text-purple-400">{data.stats.division_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">HGT回数:</span>
                      <span className="font-mono text-orange-400">{data.stats.hgt_count}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="py-3">
                    <CardTitle className="text-white text-base">環境状態</CardTitle>
                  </CardHeader>
                  <CardContent className="py-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">基質 (S):</span>
                      <span className="font-mono text-yellow-400">{data.env.S.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">毒素 (T):</span>
                      <span className="font-mono text-red-400">{data.env.T.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">pH / 温度 / 放射線:</span>
                      <span className="font-mono text-cyan-400">{data.env.pH.toFixed(2)} / {data.env.temp.toFixed(1)}°C / {data.env.rad.toFixed(1)}</span>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* 株ランキング */}
            {data && data.ranking.length > 0 && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="py-3">
                  <CardTitle className="text-white text-base">株ランキング (Top 10)</CardTitle>
                </CardHeader>
                <CardContent className="py-3">
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                      <thead className="border-b border-slate-700">
                        <tr className="text-slate-400">
                          <th className="text-left p-1">ID</th>
                          <th className="text-right p-1">個体数</th>
                          <th className="text-right p-1">μ_max</th>
                          <th className="text-right p-1">Ks</th>
                          <th className="text-right p-1">T_opt</th>
                          <th className="text-right p-1">pH_opt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ranking.slice(0, 10).map((strain) => (
                          <tr
                            key={strain.id}
                            className={`border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer ${
                              trackedStrainId === strain.id ? "bg-emerald-500/10" : ""
                            }`}
                            onClick={() => setTrackedStrainId(strain.id)}
                          >
                            <td className={`p-1 font-mono ${trackedStrainId === strain.id ? "text-emerald-300" : "text-blue-400"}`}>
                              #{strain.id}
                            </td>
                            <td className="p-1 text-right font-mono text-green-400">{strain.N.toFixed(1)}</td>
                            <td className="p-1 text-right font-mono text-purple-400">{strain.mu_max.toFixed(2)}</td>
                            <td className="p-1 text-right font-mono text-cyan-400">{strain.Ks.toFixed(2)}</td>
                            <td className="p-1 text-right font-mono text-orange-400">{strain.T_opt.toFixed(1)}</td>
                            <td className="p-1 text-right font-mono text-pink-400">{strain.pH_opt.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
