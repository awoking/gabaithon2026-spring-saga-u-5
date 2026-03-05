"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type StrainConfig = {
  mu_max: number;
  Ks: number;
  N0: number;
  p: number;
  r: number;
  T_opt: number;
  pH_opt: number;
  Rad_res: number;
};

const DEFAULT_STRAIN: StrainConfig = {
  mu_max: 0.4,
  Ks: 1.0,
  N0: 500.0,
  p: 0.0,
  r: 0.0,
  T_opt: 25.0,
  pH_opt: 7.0,
  Rad_res: 0.0,
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

function randBetween(rnd: () => number, min: number, max: number) {
  return min + (max - min) * rnd();
}

function DottedBacteria({
  seed,
  width = 320,
  height = 260,
}: {
  seed: number;
  width?: number;
  height?: number;
}) {
  const { dots, stroke, fill } = useMemo(() => {
    const rnd = mulberry32(seed);

    const cx = width * randBetween(rnd, 0.42, 0.58);
    const cy = height * randBetween(rnd, 0.42, 0.58);
    const rx = width * randBetween(rnd, 0.26, 0.32);
    const ry = height * randBetween(rnd, 0.18, 0.24);
    const angle = randBetween(rnd, -0.9, 0.9);

    const baseHue = rnd() * 360;
    const fill = hsl(baseHue, 70, 55);
    const stroke = hsl((baseHue + 200) % 360, 50, 35);

    // 体内のドット（楕円内に一様に生成）
    const bodyDots: Array<{ x: number; y: number; r: number; o: number }> = [];
    const bodyCount = Math.floor(randBetween(rnd, 120, 180));

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    for (let i = 0; i < bodyCount; i++) {
      // 楕円内の一様分布（極座標で半径にsqrt）
      const t = rnd() * Math.PI * 2;
      const u = Math.sqrt(rnd());
      const ex = Math.cos(t) * rx * u;
      const ey = Math.sin(t) * ry * u;
      const x = cx + ex * cosA - ey * sinA;
      const y = cy + ex * sinA + ey * cosA;
      bodyDots.push({
        x,
        y,
        r: randBetween(rnd, 1.3, 2.4),
        o: randBetween(rnd, 0.55, 0.95),
      });
    }

    // 周辺の「毛」っぽいドット（周縁に少しだけ）
    const hairDots: Array<{ x: number; y: number; r: number; o: number }> = [];
    const hairCount = Math.floor(randBetween(rnd, 18, 32));
    for (let i = 0; i < hairCount; i++) {
      const t = rnd() * Math.PI * 2;
      const jitter = randBetween(rnd, 1.02, 1.18);
      const ex = Math.cos(t) * rx * jitter;
      const ey = Math.sin(t) * ry * jitter;
      const x = cx + ex * cosA - ey * sinA;
      const y = cy + ex * sinA + ey * cosA;
      hairDots.push({
        x,
        y,
        r: randBetween(rnd, 1.0, 1.8),
        o: randBetween(rnd, 0.25, 0.6),
      });
    }

    return {
      fill,
      stroke,
      dots: [...hairDots, ...bodyDots],
    };
  }, [seed, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-md"
      role="img"
      aria-label="細菌のドットイラスト"
    >
      <defs>
        <radialGradient id={`g-${seed}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="white" stopOpacity="0.35" />
          <stop offset="35%" stopColor={fill} stopOpacity="0.85" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.65" />
        </radialGradient>
        <filter id={`blur-${seed}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.35" />
        </filter>
      </defs>

      <rect x="0" y="0" width={width} height={height} rx="10" fill="white" />

      {/* ドット本体 */}
      <g filter={`url(#blur-${seed})`}>
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={fill}
            opacity={d.o}
          />
        ))}
      </g>
    </svg>
  );
}

export default function StartPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [strain, setStrain] = useState<StrainConfig>(DEFAULT_STRAIN);

  const canStart = name.trim().length > 0;

  const handleStart = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem("playerName", trimmed);
      localStorage.setItem("bacteriaSeed", String(seed));
      localStorage.setItem("initialStrainConfig", JSON.stringify(strain));
    } catch {
    }
    router.push("/");
  };

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-b from-green-500 via-orange-500 to-yellow-500 p-4">
      <div className="w-full max-w-2xl flex flex-col items-center">
        <Card className="w-full max-w-md bg-white border-slate-200 shadow-2xl">
          <CardContent className="p-8">
            <div className="w-full flex justify-center">
              <div
                className="w-[320px] h-[260px] rounded-md bg-white flex items-center justify-center shadow-inner overflow-hidden"
              >
                <div className="w-[320px] h-[260px] flex items-center justify-center p-2">
                  <DottedBacteria seed={seed} />
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="名前入力してください"
                className="max-w-sm bg-white/90 text-slate-900 placeholder:text-slate-500 rounded-full text-center"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleStart();
                }}
              />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-slate-800">μ_max</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={strain.mu_max}
                  onChange={(e) => setStrain((s) => ({ ...s, mu_max: Number(e.target.value) }))}
                  className="bg-white text-slate-900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-800">Ks</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={strain.Ks}
                  onChange={(e) => setStrain((s) => ({ ...s, Ks: Number(e.target.value) }))}
                  className="bg-white text-slate-900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-800">N0（初期個体数）</Label>
                <Input
                  type="number"
                  step="10"
                  value={strain.N0}
                  onChange={(e) => setStrain((s) => ({ ...s, N0: Number(e.target.value) }))}
                  className="bg-white text-slate-900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-800">T_opt（最適温度）</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={strain.T_opt}
                  onChange={(e) => setStrain((s) => ({ ...s, T_opt: Number(e.target.value) }))}
                  className="bg-white text-slate-900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-800">pH_opt</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={strain.pH_opt}
                  onChange={(e) => setStrain((s) => ({ ...s, pH_opt: Number(e.target.value) }))}
                  className="bg-white text-slate-900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-800">Rad_res（耐性）</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={strain.Rad_res}
                  onChange={(e) => setStrain((s) => ({ ...s, Rad_res: Number(e.target.value) }))}
                  className="bg-white text-slate-900"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-center gap-4">
              <Button
                onClick={handleStart}
                disabled={!canStart}
                className="bg-sky-500 hover:bg-sky-600 text-white px-10"
              >
                始める
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSeed((s) => s + 1)}
                className="border-slate-300 text-slate-800 hover:bg-slate-100 px-6"
              >
                もう一度誕生させる
              </Button>
            </div>

            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStrain(DEFAULT_STRAIN)}
                className="text-slate-600 hover:text-slate-900"
              >
                パラメータを初期値に戻す
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

