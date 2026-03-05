"use client";

import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// 型エラーを防ぐためのプロパティ定義
interface ColosseumChamberProps {
  data: {
    step: number;
    env: {
      S: number;
      temp: number;
    };
    // scatterがundefined（まだデータがない状態）でもエラーにならないよう「?」を付与
    scatter?: {
      x: number[];
      y: number[];
      n: number[];
    };
  } | null;
}

export function ColosseumChamber({ data }: ColosseumChamberProps) {
  return (
    <Card className="col-span-1 lg:col-span-2 bg-black/70 border-slate-800 shadow-2xl relative overflow-hidden backdrop-blur-sm">
      {/* チャンバーヘッダー (OSD風) */}
      <CardHeader className="p-2 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 relative z-10">
        <CardTitle className="text-white text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 font-mono">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          Observation Chamber: Step {data?.step.toLocaleString() ?? "---"}
        </CardTitle>
        <div className="flex items-center gap-4 text-[9px] font-mono text-slate-500 uppercase">
          <span>Scale: 0.1μm/px</span>
          <span>S: <span className="text-white">{data?.env.S.toFixed(0) ?? "--"}</span> U</span>
        </div>
      </CardHeader>

      {/* 観察エリア：高さを抑えてコンパクト化 */}
      <CardContent className="p-0 relative h-[380px] w-full bg-slate-950/20">
        {/* 背景：顕微鏡のグリッド目盛り */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-10" 
          style={{ 
            backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', 
            backgroundSize: '40px 40px' 
          }} 
        />

        {/* --- 微生物プロットエリア --- */}
        <div className="absolute inset-0 overflow-hidden">
          {data?.scatter ? (
            data.scatter.x.map((xVal, i) => {
              // 座標の正規化
              const left = (xVal / 1.0) * 100;
              const top = (data.scatter!.y[i] / 2.0) * 100;
              
              // 個体数(n)に応じてサイズを変化 (24px ~ 48px)
              const baseSize = Math.max(24, Math.min(48, data.scatter!.n[i] / 2));

              // public/assets/sprite/ 内のファイル名出し分け
              const sprites = ["file", "globe", "next", "vercel", "window"];
              const spriteName = sprites[i % sprites.length];

              return (
                <div
                  key={i}
                  className="absolute transition-all duration-1000 ease-out flex items-center justify-center"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${baseSize}px`,
                    height: `${baseSize}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <Image 
                    src={`/assets/sprite/${spriteName}.svg`}
                    alt="bacteria" 
                    width={baseSize} 
                    height={baseSize}
                    unoptimized // GIFアニメーションを再生するために必須
                    className={`object-contain ${i === 0 ? 'drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]' : ''}`}
                  />
                </div>
              );
            })
          ) : (
            <div className="h-full flex items-center justify-center text-slate-700 font-mono text-[10px] italic animate-pulse">
              AWAITING BACTERIA STREAM...
            </div>
          )}
        </div>

        {/* 四隅の装飾 */}
        <div className="absolute top-2 left-2 w-6 h-6 border-t border-l border-emerald-500/20" />
        <div className="absolute bottom-2 right-2 w-6 h-6 border-b border-r border-emerald-500/20" />
      </CardContent>
    </Card>
  );
}