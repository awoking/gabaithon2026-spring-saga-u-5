"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SimulationState = 'setup' | 'running' | 'finished';

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
  batch_size: 100,
};

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
        setData(message);
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

  const handleStep = () => {
    sendMessage({ type: "STEP" });
  };

  const handleSetBatchSize = () => {
    sendMessage({
      type: "SET_BATCH_SIZE",
      batch_size: Math.max(1, Math.floor(envConfig.batch_size)),
    });
  };

  const handleReset = () => {
    isRunningRef.current = false;
    sendMessage({ type: "RESET" });
    setState('setup');
    setIsPaused(false);
    setData(null);
    setFinalStep(0);
    setStrainConfig(DEFAULT_STRAIN);
    setEnvConfig(DEFAULT_ENV);
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
                  <Label className="text-slate-300">p (毒素生産能)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={strainConfig.p}
                    onChange={(e) => setStrainConfig({...strainConfig, p: Number(e.target.value)})}
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
                <div>
                  <Label className="text-slate-300">バッチ数 (1ループあたり)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={envConfig.batch_size}
                    onChange={(e) => setEnvConfig({...envConfig, batch_size: Number(e.target.value)})}
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
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            SAGA-U 微生物進化シミュレーター
          </h1>
          <div className="flex items-center gap-4">
            <span className="px-3 py-1 rounded-full text-sm bg-green-500/20 text-green-400">
              ● 実行中
            </span>
            {data && (
              <span className="text-slate-400">
                Step: {data.step.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左カラム: コントロールパネル */}
          <div className="lg:col-span-1 space-y-6">
            {/* 基本コントロール */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">コントロール</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button 
                  onClick={handlePauseResume}
                  className={`w-full ${isPaused ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
                >
                  {isPaused ? '▶ 再開' : '⏸ 一時停止'}
                </Button>
                <Button
                  onClick={handleStep}
                  disabled={!isPaused}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-400"
                >
                  ⏭ 1ステップ実行
                </Button>
                <Button
                  onClick={handleReset}
                  variant="outline"
                  className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  ↻ 中止して設定に戻る
                </Button>
                <div className="pt-2 border-t border-slate-700 space-y-2">
                  <Label className="text-slate-300">実行中バッチ数</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={envConfig.batch_size}
                    onChange={(e) => setEnvConfig({...envConfig, batch_size: Number(e.target.value)})}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <Button
                    onClick={handleSetBatchSize}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                  >
                    バッチ数を反映
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 統計情報 */}
            {data && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">統計</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
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
            )}

            {/* 環境状態 */}
            {data && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">環境状態</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">基質 (S):</span>
                    <span className="font-mono text-yellow-400">{data.env.S.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">毒素 (T):</span>
                    <span className="font-mono text-red-400">{data.env.T.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">pH:</span>
                    <span className="font-mono text-cyan-400">{data.env.pH.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">温度:</span>
                    <span className="font-mono text-orange-400">{data.env.temp.toFixed(1)}°C</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">放射線:</span>
                    <span className="font-mono text-pink-400">{data.env.rad.toFixed(1)}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* 右カラム: データ表示 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 株ランキング */}
            {data && data.ranking.length > 0 && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">株ランキング (Top 10)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-700">
                        <tr className="text-slate-400">
                          <th className="text-left p-2">ID</th>
                          <th className="text-right p-2">個体数</th>
                          <th className="text-right p-2">μ_max</th>
                          <th className="text-right p-2">Ks</th>
                          <th className="text-right p-2">T_opt</th>
                          <th className="text-right p-2">pH_opt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ranking.slice(0, 10).map((strain) => (
                          <tr key={strain.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                            <td className="p-2 font-mono text-blue-400">#{strain.id}</td>
                            <td className="p-2 text-right font-mono text-green-400">{strain.N.toFixed(1)}</td>
                            <td className="p-2 text-right font-mono text-purple-400">{strain.mu_max.toFixed(2)}</td>
                            <td className="p-2 text-right font-mono text-cyan-400">{strain.Ks.toFixed(2)}</td>
                            <td className="p-2 text-right font-mono text-orange-400">{strain.T_opt.toFixed(1)}</td>
                            <td className="p-2 text-right font-mono text-pink-400">{strain.pH_opt.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* データ待機 */}
            {!data && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <div className="text-slate-400 text-lg">
                    シミュレーション初期化中...
                  </div>
                  <div className="text-slate-500 text-sm mt-2">
                    データを受信しています
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
