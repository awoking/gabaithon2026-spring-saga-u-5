"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Microscope, Zap, Thermometer, Droplets, FlaskConical } from "lucide-react";

// --- ユーティリティ関数 (マルチベリー32等) ---
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randBetween(rnd: () => number, min: number, max: number) {
  return min + (max - min) * rnd();
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

// --- 細菌ビジュアルコンポーネント ---
function DottedBacteria({
  seed,
  temp,
  rad,
  width = 400,
  height = 300,
}: {
  seed: number;
  temp: number;
  rad: number;
  width?: number;
  height?: number;
}) {
  const { dots, stroke, fill, angle } = useMemo(() => {
    const rnd = mulberry32(seed);
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * randBetween(rnd, 0.25, 0.3);
    const ry = height * randBetween(rnd, 0.15, 0.2);
    const baseAngle = randBetween(rnd, -0.5, 0.5);

    // 放射線(rad)で色を毒々しくする
    const baseHue = (rnd() * 360 + rad * 100) % 360;
    const fill = hsl(baseHue, 60 + rad * 20, 50 - rad * 10);
    const stroke = hsl((baseHue + 180) % 360, 40, 30);

    const allDots = [];
    const bodyCount = Math.floor(randBetween(rnd, 100, 150));
    
    const cosA = Math.cos(baseAngle);
    const sinA = Math.sin(baseAngle);

    for (let i = 0; i < bodyCount; i++) {
      const t = rnd() * Math.PI * 2;
      const u = Math.sqrt(rnd());
      const ex = Math.cos(t) * rx * u;
      const ey = Math.sin(t) * ry * u;
      allDots.push({
        x: cx + ex * cosA - ey * sinA,
        y: cy + ex * sinA + ey * cosA,
        r: randBetween(rnd, 1.5, 3),
        o: randBetween(rnd, 0.6, 1),
      });
    }

    return { fill, stroke, dots: allDots, angle: baseAngle };
  }, [seed, rad, width, height]);

  // 温度(temp)による「震え」エフェクト
  const shake = temp > 35 ? (temp - 35) / 2 : 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="drop-shadow-2xl">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g style={{ 
        transform: `translate(${Math.random() * shake}px, ${Math.random() * shake}px)`,
        transition: 'transform 0.05s linear' 
      }}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={fill} opacity={d.o} filter="url(#glow)" />
        ))}
      </g>
    </svg>
  );
}

// --- メイン画面 ---
export default function ObservationPage() {
  const [seed, setSeed] = useState(12345);
  const [env, setEnv] = useState({ temp: 25, rad: 0, ph: 7.0 });
  const [logs, setLogs] = useState<string[]>(["[System] 観察開始。個体識別番号: #12345"]);

  const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20));

  const handleMutate = () => {
    const newSeed = Math.floor(Math.random() * 100000);
    setSeed(newSeed);
    addLog(`突然変異を検知: 新しい遺伝子配列 #${newSeed}`);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-mono">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* 左側：メインモニター */}
        <div className="lg:col-span-8 space-y-6">
          <Card className="bg-zinc-900 border-zinc-800 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
            <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <Microscope className="text-emerald-400 w-5 h-5" />
                <CardTitle className="text-sm tracking-widest text-zinc-400 uppercase">Microscope View</CardTitle>
              </div>
              <Badge variant="outline" className="font-mono text-emerald-500 border-emerald-500/30">
                SEED: {seed}
              </Badge>
            </CardHeader>
            <CardContent className="flex items-center justify-center p-12 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-800/20 via-zinc-900 to-zinc-950 h-[500px]">
              {/* 細菌のビジュアル */}
              <DottedBacteria seed={seed} temp={env.temp} rad={env.rad} />
              
              {/* オーバーレイUI */}
              <div className="absolute bottom-6 left-6 space-y-1 text-[10px] text-zinc-500">
                <p>SCANNING DATA...</p>
                <p>PROTEIN STRUCTURE: STABLE</p>
                <p>GENETIC DRIFT: {((seed % 100) / 10).toFixed(2)}%</p>
              </div>
            </CardContent>
          </Card>

          {/* 下部：操作ログ */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="py-3 border-b border-zinc-800">
              <CardTitle className="text-xs text-zinc-500 uppercase">Analysis Logs</CardTitle>
            </CardHeader>
            <ScrollArea className="h-32 p-4">
              <div className="space-y-1 text-xs font-mono">
                {logs.map((log, i) => (
                  <div key={i} className={i === 0 ? "text-emerald-400" : "text-zinc-500"}>
                    {log}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        </div>

        {/* 右側：環境コントロール */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-sm flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-zinc-400" />
                Environment Control
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-8">
              
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="flex items-center gap-2 text-zinc-400">
                    <Thermometer className="w-4 h-4" /> 温度 (℃)
                  </Label>
                  <span className="text-emerald-400 font-bold">{env.temp}</span>
                </div>
                <Slider 
                  value={[env.temp]} 
                  max={100} 
                  onValueChange={([v]) => setEnv(prev => ({ ...prev, temp: v }))}
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="flex items-center gap-2 text-zinc-400">
                    <Zap className="w-4 h-4" /> 放射線レベル
                  </Label>
                  <span className="text-red-400 font-bold">{env.rad.toFixed(2)}</span>
                </div>
                <Slider 
                  value={[env.rad * 100]} 
                  max={100} 
                  onValueChange={([v]) => setEnv(prev => ({ ...prev, rad: v / 100 }))}
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="flex items-center gap-2 text-zinc-400">
                    <Droplets className="w-4 h-4" /> pH値
                  </Label>
                  <span className="text-blue-400 font-bold">{env.ph.toFixed(1)}</span>
                </div>
                <Slider 
                  value={[env.ph * 10]} 
                  min={0} max={140} 
                  onValueChange={([v]) => setEnv(prev => ({ ...prev, ph: v / 10 }))}
                />
              </div>

              <div className="pt-6">
                <Button 
                  onClick={handleMutate}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-6 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                >
                  強制突然変異を実行
                </Button>
              </div>

            </CardContent>
          </Card>

          {/* ステータス要約 */}
          <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 space-y-2">
            <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest">Strain Potential</h4>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">生存率</span>
              <span className="text-emerald-400">{(100 - env.rad * 50).toFixed(1)}%</span>
            </div>
            <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${100 - env.rad * 50}%` }} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}