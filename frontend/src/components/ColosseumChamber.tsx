"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChamberLog, LogEntry } from "./ChamberLog";

const SETTINGS = {
  BASE_SPEED: 2.0,
  ROTATION_SPEED_SEC: 540,   // マイルド回転
  DEATH_DURATION: 800,       // 0.8秒で消滅
  MAX_LOGS: 30,              // ログ保持件数
};

interface BacteriaState {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  size: number;
  spriteIndex: number;
  isDead: boolean;
  deathTime?: number;
}

export function ColosseumChamber({ data }: { data: any }) {
  const [bacteriaList, setBacteriaList] = useState<BacteriaState[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);

  // 1. ログ追加関数
  const addLog = (type: "birth" | "death", message: string) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const newEntry: LogEntry = { id: Math.random().toString(36), time: timeStr, type, message };
    
    setLogs(prev => [...prev, newEntry].slice(-SETTINGS.MAX_LOGS));
  };

  // 2. データ同期 & 誕生・死滅検知
  useEffect(() => {
    if (!data?.scatter) return;

    const width = containerRef.current?.clientWidth ?? 800;
    const height = containerRef.current?.clientHeight ?? 450;

    setBacteriaList((prev) => {
      const nextList: BacteriaState[] = [];
      const currentIds = new Set();

      data.scatter.x.forEach((rawX: number, i: number) => {
        const id = `bacteria-${i}`;
        const count = Math.round(data.scatter.n[i]);
        if (count < 1) return; // 個体数0は無視（死滅へ）

        currentIds.add(id);
        const existing = prev.find(b => b.id === id && !b.isDead);

        if (existing) {
          nextList.push({ ...existing, size: Math.max(24, Math.min(48, count / 2)) });
        } else {
          // 【誕生】ピクセル変換してログ出力
          const pxX = Math.round(rawX * width);
          const pxY = Math.round(data.scatter.y[i] * height);
          addLog("birth", `[誕生] ID:${id} (個体数:${count}) が座標(${pxX}, ${pxY})に出現しました`);

          const angle = Math.random() * Math.PI * 2;
          nextList.push({
            id, x: pxX, y: pxY,
            vx: Math.cos(angle) * SETTINGS.BASE_SPEED,
            vy: Math.sin(angle) * SETTINGS.BASE_SPEED,
            angle, size: 32, spriteIndex: i % 5, isDead: false
          });
        }
      });

      // 【死滅】検知
      prev.forEach(old => {
        if (!currentIds.has(old.id) && !old.isDead) {
          addLog("death", `[死滅] ID:${old.id} が死亡しました`);
          nextList.push({ ...old, isDead: true, deathTime: Date.now() });
        } else if (old.isDead && Date.now() - (old.deathTime || 0) < SETTINGS.DEATH_DURATION) {
          nextList.push(old);
        }
      });

      return nextList;
    });
  }, [data]);

  // 3. 物理演算ループ (簡略化版)
  const animate = () => {
    setBacteriaList(prev => prev.map(b => {
      if (b.isDead) return b;
      let { x, y, vx, vy } = b;
      x += vx; y += vy;
      const w = containerRef.current?.clientWidth ?? 800;
      const h = containerRef.current?.clientHeight ?? 450;
      if (x < 0 || x > w) vx *= -1;
      if (y < 0 || y > h) vy *= -1;
      return { ...b, x, y, vx, vy, angle: Math.atan2(vy, vx) };
    }));
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, []);

  const sprites = ["1-green", "2-white", "3-yellow", "4-red", "5-twin"];

  return (
    <Card className="col-span-1 lg:col-span-3 bg-black/70 border-slate-800 shadow-2xl overflow-hidden backdrop-blur-sm flex flex-col">
      <CardHeader className="p-3 border-b border-slate-800 bg-slate-900/50">
        <CardTitle className="text-white text-[10px] uppercase tracking-[0.3em] font-mono">
          Observation Chamber: Step {data?.step ?? "---"}
        </CardTitle>
      </CardHeader>

      <CardContent ref={containerRef} className="p-0 relative h-[450px] w-full overflow-hidden bg-slate-950/20">
        {bacteriaList.map((b) => {
          const deathElapsed = b.isDead ? (Date.now() - (b.deathTime || 0)) : 0;
          const progress = Math.min(1, deathElapsed / SETTINGS.DEATH_DURATION);
          const rotation = (b.angle * 180 / Math.PI) + (b.isDead ? (deathElapsed / 1000) * SETTINGS.ROTATION_SPEED_SEC : 0);

          return (
            <div key={b.id} className="absolute" style={{
              left: b.x, top: b.y, width: b.size, height: b.size,
              transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${b.isDead ? 1 - progress : 1})`,
              opacity: b.isDead ? 1 - progress : 1,
            }}>
              <Image 
                src={`/assets/sprite/sprite-${sprites[b.spriteIndex]}.gif`}
                alt="bacteria" width={b.size} height={b.size} unoptimized
              />
            </div>
          );
        })}
      </CardContent>

      {/* 子コンポーネントにログを渡す */}
      <ChamberLog logs={logs} />
    </Card>
  );
}