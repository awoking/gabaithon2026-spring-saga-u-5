"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// --- 【調整用パラメータ】 ---
const SETTINGS = {
  BASE_SPEED: 2.0,           // 基本速度
  RANDOM_TURN_CHANCE: 0.02,  // 毎フレーム向きを変える確率
  RANDOM_TURN_ANGLE: 0.1,    // ランダム転回の強さ（ラジアン）
  BOUNCE_FACTOR: 1.0,        // 反発係数（等速維持のため1.0）
  SEPARATION_PX: 2,          // 衝突時の押し戻し距離
  ROTATION_SPEED_SEC: 540,   // ★死亡時の角速度（マイルド回転）
  DEATH_DURATION: 800,       // 消滅までの時間（ミリ秒）
  BACTERIA_RADIUS: 16,       // 衝突判定用の半径
};

interface BacteriaState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  size: number;
  spriteIndex: number;
  isDead: boolean;
  deathTime?: number;
}

interface ColosseumChamberProps {
  data: any; 
}

export function ColosseumChamber({ data }: ColosseumChamberProps) {
  const [bacteriaList, setBacteriaList] = useState<BacteriaState[]>([]);
  const requestRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevStateRef = useRef<BacteriaState[]>([]);
  

  // 1. データ更新時の同期ロジック
  useEffect(() => {
    if (!data?.scatter) return;

    setBacteriaList((prev) => {
      const nextList: BacteriaState[] = [];
      const currentIds = new Set();

      // 新しいデータからリストを作成 or 更新
      data.scatter.x.forEach((x: number, i: number) => {
        const id = `bacteria-${i}`;
        currentIds.add(id);
        const existing = prev.find((b) => b.id === id && !b.isDead);

        if (existing) {
          nextList.push({ ...existing, size: Math.max(24, Math.min(48, data.scatter.n[i] / 2)) });
        } else {
          // 新規登場
          const angle = Math.random() * Math.PI * 2;
          nextList.push({
            id,
            x: x * (containerRef.current?.clientWidth ?? 800),
            y: data.scatter.y[i] * (containerRef.current?.clientHeight ?? 450),
            vx: Math.cos(angle) * SETTINGS.BASE_SPEED,
            vy: Math.sin(angle) * SETTINGS.BASE_SPEED,
            angle,
            size: 32,
            spriteIndex: i % 5,
            isDead: false,
          });
        }
      });

      // 死亡判定：前のリストにいて新しいデータにいないものは死亡フラグを立てる
      prev.forEach((old) => {
        if (!currentIds.has(old.id) && !old.isDead) {
          nextList.push({ ...old, isDead: true, deathTime: Date.now() });
        } else if (old.isDead) {
          // 死亡アニメーション中のものは、時間内なら維持
          if (Date.now() - (old.deathTime || 0) < SETTINGS.DEATH_DURATION) {
            nextList.push(old);
          }
        }
      });

      return nextList;
    });
  }, [data]);

  // 2. 物理演算ループ
  const animate = (time: number) => {
    setBacteriaList((prev) => {
      const width = containerRef.current?.clientWidth ?? 800;
      const height = containerRef.current?.clientHeight ?? 450;

      return prev.map((b, i) => {
        if (b.isDead) return b; // 死亡中は位置計算停止

        let { x, y, vx, vy, angle } = b;

        // ランダム移動
        if (Math.random() < SETTINGS.RANDOM_TURN_CHANCE) {
          const turn = (Math.random() - 0.5) * SETTINGS.RANDOM_TURN_ANGLE;
          const newAngle = angle + turn;
          vx = Math.cos(newAngle) * SETTINGS.BASE_SPEED;
          vy = Math.sin(newAngle) * SETTINGS.BASE_SPEED;
          angle = newAngle;
        }

        // 位置更新
        x += vx;
        y += vy;

        // 画面端の反射
        if (x < 0 || x > width) { vx *= -1; x = x < 0 ? 0 : width; }
        if (y < 0 || y > height) { vy *= -1; y = y < 0 ? 0 : height; }

        // 進行方向の角度更新
        angle = Math.atan2(vy, vx);

        // 細菌同士の衝突
        prev.forEach((other, j) => {
          if (i === j || other.isDead) return;
          const dx = other.x - x;
          const dy = other.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (b.size + other.size) / 2;

          if (dist < minDist) {
            // 反射（速度交換）
            [vx, vy] = [other.vx, other.vy];
            // 押し戻し
            x -= (dx / dist) * SETTINGS.SEPARATION_PX;
            y -= (dy / dist) * SETTINGS.SEPARATION_PX;
          }
        });

        return { ...b, x, y, vx, vy, angle };
      });
    });
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, []);

  const sprites = ["1-green", "2-white", "3-yellow", "4-red", "5-twin"];

  return (
    <Card className="col-span-1 lg:col-span-3 bg-black/70 border-slate-800 shadow-2xl relative overflow-hidden backdrop-blur-sm">
      <CardHeader className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 relative z-10">
        <CardTitle className="text-white text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 font-mono">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          Observation Chamber: Step {data?.step ?? "---"}
        </CardTitle>
      </CardHeader>

      <CardContent ref={containerRef} className="p-0 relative h-[550px] w-full overflow-hidden bg-slate-950/20">
        <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        {bacteriaList.map((b) => {
          const isActuallyDead = b.isDead;
          const deathElapsed = isActuallyDead ? (Date.now() - (b.deathTime || 0)) : 0;
          const deathProgress = Math.min(1, deathElapsed / SETTINGS.DEATH_DURATION);

          // デススピン計算：元の向き + (経過時間 * 角速度)
          const deathRotation = isActuallyDead ? (deathElapsed / 1000) * SETTINGS.ROTATION_SPEED_SEC : 0;
          const currentRotation = (b.angle * 180 / Math.PI) + deathRotation;
          const currentScale = isActuallyDead ? 1 - deathProgress : 1;
          const currentOpacity = isActuallyDead ? 1 - deathProgress : 1;

          return (
            <div
              key={b.id}
              className="absolute transition-transform duration-0 ease-linear"
              style={{
                left: b.x,
                top: b.y,
                width: b.size,
                height: b.size,
                transform: `translate(-50%, -50%) rotate(${currentRotation}deg) scale(${currentScale})`,
                opacity: currentOpacity,
              }}
            >
              <Image 
                src={`/assets/sprite/sprite-${sprites[b.spriteIndex]}.gif`}
                alt="bacteria" 
                width={b.size} 
                height={b.size}
                unoptimized
                className={`object-contain ${b.id.includes("-0") ? 'drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]' : ''}`}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}