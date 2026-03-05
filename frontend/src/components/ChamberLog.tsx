"use client";

import { useEffect, useRef } from "react";

export interface LogEntry {
  id: string;
  time: string;
  type: "birth" | "death";
  message: string;
}

interface ChamberLogProps {
  logs: LogEntry[];
}

export function ChamberLog({ logs }: ChamberLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // ログが追加されたら一番下まで自動スライド（スクロール）
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [logs]);

  return (
    <div className="w-full bg-slate-950 border-t border-slate-800 p-3 font-mono text-xs h-40 overflow-hidden flex flex-col">
      <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 flex justify-between">
        <span>System Observation Log</span>
        <span className="animate-pulse">● Live</span>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-1 custom-scrollbar"
      >
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 leading-relaxed">
            <span className="text-slate-600 shrink-0">[{log.time}]</span>
            <span className={log.type === "birth" ? "text-emerald-400" : "text-rose-400"}>
              {log.message}
            </span>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-slate-700 italic">No activity detected...</div>
        )}
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
      `}</style>
    </div>
  );
}