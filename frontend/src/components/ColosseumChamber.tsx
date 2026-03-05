"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Image from "next/image"; // GIF表示用

// 親から受け取るデータの型定義
interface ColosseumChamberProps {
  data: {
    step: number;
    env: { S: number; temp: number };
    scatter?: {
      x: number[];
      y: number[];
      n: number[];
    };
  } | null;
}

export function ColosseumChamber({ data }: ColosseumChamberProps) {
  
  const bacteriaGifUrl = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // 透明GIF

  return (
    <Card className="col-span-1 lg:col-span-3 bg-black/70 border-slate-800 shadow-2xl relative overflow-hidden backdrop-blur-sm">
      {/* チャンバーヘッダー (OSD風) */}
      <CardHeader className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 relative z-10">
        <CardTitle className="text-white text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 font-mono">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          Observation Chamber: Step {data?.step.toLocaleString() ?? "---"}
        </CardTitle>
        <div className="flex items-center gap-4 text-[9px] font-mono text-slate-500 uppercase">
          <span>Scale: 0.1μm/px</span>
          <span>S: <span className="text-white">{data?.env.S.toFixed(0) ?? "--"}</span> U</span>
        </div>
      </CardHeader>

      <CardContent className="p-0 relative aspect-video min-h-[550px]">
        {/* 背景：顕微鏡のグリッド目盛り */}
        <div className="absolute inset-0 pointer-events-none opacity-10" 
             style={{ backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        {/* --- 微生物プロットエリア --- */}
        <div className="absolute inset-0 overflow-hidden">
          {data?.scatter ? (
            data.scatter.x.map((xVal, i) => {
              // 座標の正規化 (0-1.0 -> 0-100%)
              const left = (xVal / 1.0) * 100;
              const top = (data.scatter!.y[i] / 2.0) * 100;
              
              // 個体数(n)に応じてサイズを変化させる (16px ~ 48px)
              const baseSize = Math.max(16, Math.min(48, data.scatter!.n[i] / 2));
              
              // 1位の株は特別なエフェクト
              const isFirst = i === 0;

              return (
                <div
                  key={i}
                  className="absolute transition-all duration-1000 ease-out flex items-center justify-center group"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${baseSize}px`,
                    height: `${baseSize}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {/* --- 細菌のGIF本体 --- */}
                  <div className={`relative w-full h-full rounded-full transition-transform duration-500 ${isFirst ? 'scale-110' : 'scale-100'}`}>
                    
                    {/* 本物のGIF画像を使う場合 */}
                    {/* <Image src="/bacteria.gif" alt="cell" layout="fill" className="object-contain" /> */}

                    {/* CSSでGIF風にウネウネさせるプレースホルダー (本物のGIFがない場合) */}
                    <div className={`absolute inset-0 rounded-full ${isFirst ? 'bg-emerald-500/80 shadow-[0_0_20px_#10b981]' : 'bg-blue-600/70'} 
                      animate-[pulse_2s_ease-in-out_infinite]`} style={{ animationDelay: `${i*100}ms` }}>
                      {/* ウネウネさせるためのオーバーレイ */}
                      <div className="absolute inset-1 bg-black/20 rounded-full animate-[wobble_3s_ease-in-out_infinite]" style={{ animationDelay: `${i*150}ms` }} />
                    </div>

                    {/* ID表示 (ホバー時) */}
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-white/50 opacity-0 group-hover:opacity-100 transition-opacity">
                      #{i}
                    </span>
                  </div>
                  
                  {/* 1位の株のオーラ */}
                  {isFirst && (
                    <div className="absolute -inset-2 rounded-full border border-emerald-500/30 animate-pulse-slow" />
                  )}
                </div>
              );
            })
          ) : (
            <div className="h-full flex items-center justify-center text-slate-700 font-mono italic animate-pulse">
              AWAITING BACTERIA STREAM...
            </div>
          )}
        </div>
        {/* --------------------------- */}

        {/* 四隅のサイバー装飾 */}
        <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-emerald-500/20" />
        <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-emerald-500/20" />
      </CardContent>
    </Card>
  );
}