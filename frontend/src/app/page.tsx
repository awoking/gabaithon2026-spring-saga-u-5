"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Thermometer, Droplets, Zap, FlaskConical, Play } from "lucide-react";
import { ColosseumChamber } from "@/components/ColosseumChamber";
import Image from "next/image";

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
  scatter?: {
    x: number[];
    y: number[];
    n: number[];
  };
  feed: {
    enabled: boolean;
    per_batch: number;
    max_s: number;
  };
  pool?: {
    plasmids: number[];
    concentrations: number[];
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

type AIChatMessage = {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
};

type AIParamMap = Record<string, number>;

const AI_PARAM_KEY_ALIASES: Record<string, string> = {
  s: "S",
  substrate: "S",
  toxin: "T",
  t: "T",
  ph: "pH",
  p_h: "pH",
  ph_value: "pH",
  k_tox: "k_tox",
  k_rad: "k_rad",
  k_acid: "k_acid",
  d_t: "d_T",
  hgt_prob: "hgt_prob",
  d: "D",
  dilution: "D",
  s_in: "S_in",
  inflow_s: "S_in",
  max_rel_change_per_step: "max_rel_change_per_step",
  max_abs_s_change_per_step: "max_abs_s_change_per_step",
  k_hgt: "k_hgt",
  division_threshold: "division_threshold",
  batch_size: "batch_size",
};

type RuntimeEnvConfig = {
  S: number;
  T: number;
  pH: number;
  temp: number;
  rad: number;
  D: number;
  S_in: number;
};

type LastStrainSummary = SimulationData["ranking"][number] | null;

type LastEnvSummary = {
  S: number;
  T: number;
  pH: number;
  temp: number;
  rad: number;
} | null;

type LineageNode = {
  id: number;
  parent_id: number;
  birth_step: number;
  birth_event: string;
  alive?: boolean;
};

type LineagePayload = {
  target_id: number;
  nodes: LineageNode[];
  depth: number;
  truncated: boolean;
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
  k_tox: 1.0,
  k_rad: 1.0,
  k_acid: 0.0,
  Y: 100.0,
  d_T: 0.1,
  hgt_prob: 0.005,
  D: 0.0,
  S_in: 0.0,
  auto_feed_enabled: true,
  feed_per_batch: 200.0,
  feed_max_s: 10000.0,
  batch_size: 100,
  max_rel_change_per_step: 0.05,
  max_abs_s_change_per_step: 0.05,
  k_hgt: 1e-9,
  division_threshold: 5000.0,
};

export default function Home() {
  const [state, setState] = useState<SimulationState>('setup');
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [data, setData] = useState<SimulationData | null>(null);
  const [aiMessages, setAiMessages] = useState<AIChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lastAiParams, setLastAiParams] = useState<AIParamMap>({});
  const [lastAiRecommendation, setLastAiRecommendation] = useState<Record<string, unknown> | null>(null);
  const [leftPanelTab, setLeftPanelTab] = useState<"ranking" | "env">("ranking");
  const [runtimeEnvConfig, setRuntimeEnvConfig] = useState<RuntimeEnvConfig | null>(null);
  const [runtimeEnvInitialized, setRuntimeEnvInitialized] = useState(false);
  const [finalStep, setFinalStep] = useState(0);
  const [peakTotalN, setPeakTotalN] = useState<{ value: number; step: number } | null>(null);
  const [lastSurvivor, setLastSurvivor] = useState<LastStrainSummary>(null);
  const [lastPreExtinctionEnv, setLastPreExtinctionEnv] = useState<LastEnvSummary>(null);
  const [lineageData, setLineageData] = useState<LineagePayload | null>(null);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [isLineageLoading, setIsLineageLoading] = useState(false);
  const [selectedLineageId, setSelectedLineageId] = useState<number | null>(null);
  const [showLineagePanel, setShowLineagePanel] = useState(false);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const isRunningRef = useRef(false);
  const lineageContainerRef = useRef<HTMLDivElement | null>(null);

  // 設定フォーム
  const [strainConfig, setStrainConfig] = useState(DEFAULT_STRAIN);
  const [envConfig, setEnvConfig] = useState(DEFAULT_ENV);

  const formatAiValue = (value: unknown): string => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const buildLineageMermaid = (lineage: LineagePayload): string => {
    const ordered = [...lineage.nodes].reverse();
    const lines: string[] = ["flowchart TD"];

    for (const node of ordered) {
      const status = node.alive ? "alive" : "dead";
      lines.push(`n${node.id}[\"#${node.id} | step:${node.birth_step} | ${node.birth_event} | ${status}\"]`);
    }

    for (let index = 0; index < ordered.length - 1; index += 1) {
      lines.push(`n${ordered[index].id} --> n${ordered[index + 1].id}`);
    }

    return lines.join("\n");
  };

  const requestLineage = (strainId: number) => {
    setShowLineagePanel(true);
    setSelectedLineageId(strainId);
    setLineageError(null);
    setIsLineageLoading(true);
    sendMessage({ type: "GET_LINEAGE", strain_id: strainId, max_depth: 200 });
  };

  useEffect(() => {
    if (!lineageData || !lineageContainerRef.current) return;

    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark" });
        const diagramId = `lineage-${Date.now()}-${lineageData.target_id}`;
        const { svg } = await mermaid.render(diagramId, buildLineageMermaid(lineageData));
        if (lineageContainerRef.current) {
          lineageContainerRef.current.innerHTML = svg;
        }
      } catch (error) {
        setLineageError(`系統図の描画に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    render();
  }, [lineageData]);

  const extractApplicableParams = (raw: unknown): AIParamMap => {
    if (!raw) return {};

    const allowedKeys = new Set([
      "S", "T", "pH", "k_tox", "k_rad", "k_acid", "d_T", "hgt_prob",
      "D", "S_in", "max_rel_change_per_step", "max_abs_s_change_per_step",
      "k_hgt", "division_threshold", "batch_size",
    ]);

    const normalizeKey = (key: string): string | null => {
      const canonical = AI_PARAM_KEY_ALIASES[key.trim().toLowerCase()] ?? key;
      return allowedKeys.has(canonical) ? canonical : null;
    };

    const toNumeric = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const num = Number(value.trim());
        return Number.isFinite(num) ? num : null;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const num = toNumeric(item);
          if (num !== null) return num;
        }
        return null;
      }
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const candidateKeys = ["value", "new_value", "new", "to", "recommended", "set_to", "next", "after"];
        for (const candidateKey of candidateKeys) {
          if (candidateKey in obj) {
            const num = toNumeric(obj[candidateKey]);
            if (num !== null) return num;
          }
        }
      }
      return null;
    };

    const parsed: AIParamMap = {};

    const consumeEntry = (sourceKey: string, sourceValue: unknown) => {
      const normalized = normalizeKey(sourceKey);
      if (normalized) {
        const num = toNumeric(sourceValue);
        if (num !== null) parsed[normalized] = num;
      }

      if (sourceValue && typeof sourceValue === "object") {
        collectFromUnknown(sourceValue);
      }
    };

    const collectFromUnknown = (value: unknown) => {
      if (!value) return;

      if (Array.isArray(value)) {
        for (const item of value) {
          collectFromUnknown(item);
        }
        return;
      }

      if (typeof value !== "object") return;

      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        consumeEntry(nestedKey, nestedValue);
      }
    };

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const sourceKey = String(obj.param ?? obj.key ?? obj.name ?? obj.field ?? "");
        const normalized = sourceKey ? normalizeKey(sourceKey) : null;
        if (!normalized) continue;
        const num = toNumeric(obj.value ?? obj.new_value ?? obj.new ?? obj.to ?? obj.recommended ?? obj.set_to ?? obj);
        if (num !== null) parsed[normalized] = num;
      }
      collectFromUnknown(raw);
      return parsed;
    }

    if (typeof raw === "object") {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        consumeEntry(key, value);
      }
    }

    return parsed;
  };

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

        const totalN = Number(message?.stats?.total_N ?? 0);
        const step = Number(message?.step ?? 0);
        if (Number.isFinite(totalN)) {
          setPeakTotalN((prev) => {
            if (!prev || totalN > prev.value) {
              return { value: totalN, step };
            }
            return prev;
          });
        }

        const activeStrains = Number(message?.stats?.active_strains ?? 0);
        if (Number.isFinite(activeStrains) && activeStrains > 0) {
          const top = Array.isArray(message?.ranking) && message.ranking.length > 0 ? message.ranking[0] : null;
          if (top) {
            setLastSurvivor(top);
          }
          if (message?.env) {
            setLastPreExtinctionEnv({
              S: Number(message.env.S),
              T: Number(message.env.T),
              pH: Number(message.env.pH),
              temp: Number(message.env.temp),
              rad: Number(message.env.rad),
            });
          }
        }
      } else if (message.type === "LINEAGE_DATA") {
        setIsLineageLoading(false);
        if (!message.ok) {
          setLineageError(message.error ?? "lineage取得に失敗しました");
          setLineageData(null);
          return;
        }
        setLineageError(null);
        setLineageData(message.lineage as LineagePayload);
      } else if (message.type === "AI_SUPPORT_RESULT") {
        setIsAiLoading(false);
        if (!message.ok) {
          setAiMessages((prev) => ([
            ...prev,
            {
              role: "system",
              text: `AIサポートの取得に失敗しました: ${message.error ?? "unknown error"}`,
              at: new Date().toLocaleTimeString(),
            },
          ]));
          return;
        }

        const recommendation = message.recommendation ?? {};
        setLastAiRecommendation(recommendation);
        const rawParamUpdates =
          recommendation.param_updates
          ?? recommendation.parameters
          ?? recommendation.suggested_params
          ?? recommendation.updates
          ?? {};
        const applicableParams = extractApplicableParams(rawParamUpdates);
        setLastAiParams(applicableParams);
        const summary = recommendation.summary ?? "提案を受信しました。";
        const reasoning = recommendation.reasoning ? `\n\n根拠:\n${recommendation.reasoning}` : "";
        const updates = recommendation.param_updates && Object.keys(recommendation.param_updates).length > 0
          ? `\n\n推奨パラメータ:\n${Object.entries(recommendation.param_updates).map(([k, v]) => `- ${k}: ${formatAiValue(v)}`).join("\n")}`
          : "";

        setAiMessages((prev) => ([
          ...prev,
          {
            role: "assistant",
            text: `${summary}${updates}${reasoning}`,
            at: new Date().toLocaleTimeString(),
          },
        ]));
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
    setAiMessages([]);
    setIsAiLoading(false);
    setLastAiParams({});
    setLastAiRecommendation(null);
    setLeftPanelTab("ranking");
    setRuntimeEnvConfig(null);
    setRuntimeEnvInitialized(false);
    setPeakTotalN(null);
    setLastSurvivor(null);
    setLastPreExtinctionEnv(null);
    setLineageData(null);
    setLineageError(null);
    setIsLineageLoading(false);
    setSelectedLineageId(null);
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
    setShowAdvancedSetup(false);
    setStrainConfig(DEFAULT_STRAIN);
    setEnvConfig(DEFAULT_ENV);
    setAiMessages([]);
    setIsAiLoading(false);
    setLastAiParams({});
    setLastAiRecommendation(null);
    setLeftPanelTab("ranking");
    setRuntimeEnvConfig(null);
    setRuntimeEnvInitialized(false);
    setPeakTotalN(null);
    setLastSurvivor(null);
    setLastPreExtinctionEnv(null);
    setLineageData(null);
    setLineageError(null);
    setIsLineageLoading(false);
    setSelectedLineageId(null);
  };

  const handleAskAI = () => {
    if (!data || isAiLoading) return;

    setAiMessages((prev) => ([
      ...prev,
      {
        role: "user",
        text: "AIに聞いてみる: 現在の状態から次の打ち手を提案して。",
        at: new Date().toLocaleTimeString(),
      },
    ]));

    setIsAiLoading(true);
    sendMessage({
      type: "AI_SUPPORT_REQUEST",
      current_snapshot: data,
      top_k: 8,
    });
  };

  const handleApplyAiSuggestion = () => {
    const fallbackFromRecommendation = extractApplicableParams(
      lastAiRecommendation?.param_updates
      ?? lastAiRecommendation?.parameters
      ?? lastAiRecommendation?.suggested_params
      ?? lastAiRecommendation?.updates
      ?? lastAiRecommendation
      ?? {}
    );

    const fallbackFromMessageText: AIParamMap = {};
    const latestAssistantMessage = [...aiMessages].reverse().find((msg) => msg.role === "assistant");
    if (latestAssistantMessage?.text) {
      const dMatch = latestAssistantMessage.text.match(/\bD\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
      const sInMatch = latestAssistantMessage.text.match(/\bS_in\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
      if (dMatch) fallbackFromMessageText.D = Number(dMatch[1]);
      if (sInMatch) fallbackFromMessageText.S_in = Number(sInMatch[1]);
    }

    const effectiveParams: AIParamMap =
      Object.keys(lastAiParams).length > 0
        ? lastAiParams
        : Object.keys(fallbackFromRecommendation).length > 0
          ? fallbackFromRecommendation
          : fallbackFromMessageText;

    if (Object.keys(effectiveParams).length === 0) {
      setAiMessages((prev) => ([
        ...prev,
        {
          role: "system",
          text: "適用可能な提案パラメータがありません。",
          at: new Date().toLocaleTimeString(),
        },
      ]));
      return;
    }

    setLastAiParams(effectiveParams);

    const { batch_size, ...runtimeParams } = effectiveParams;
    if (Object.keys(runtimeParams).length > 0) {
      sendMessage({ type: "SET_RUNTIME_PARAMS", ...runtimeParams });
    }

    if (batch_size !== undefined) {
      const sanitizedBatch = Math.max(1, Math.floor(batch_size));
      sendMessage({ type: "SET_BATCH_SIZE", batch_size: sanitizedBatch });
      setEnvConfig((prev) => ({ ...prev, batch_size: sanitizedBatch }));
    }

    setAiMessages((prev) => ([
      ...prev,
      {
        role: "system",
        text: `AI提案を適用しました（${Object.keys(effectiveParams).join(", ")}）。`,
        at: new Date().toLocaleTimeString(),
      },
    ]));
  };

  const handleApplyRuntimeEnv = () => {
    if (!runtimeEnvConfig) return;

    sendMessage({
      type: "SET_RUNTIME_PARAMS",
      S: runtimeEnvConfig.S,
      T: runtimeEnvConfig.T,
      pH: runtimeEnvConfig.pH,
      D: runtimeEnvConfig.D,
      S_in: runtimeEnvConfig.S_in,
    });
    sendMessage({
      type: "SET_ENV",
      temp: runtimeEnvConfig.temp,
      rad: runtimeEnvConfig.rad,
    });

    setAiMessages((prev) => ([
      ...prev,
      {
        role: "system",
        text: "実行中の環境パラメータを反映しました。",
        at: new Date().toLocaleTimeString(),
      },
    ]));
  };

  const handleNudgePH = () => {
    if (!data) return;
    const delta = (Math.random() - 0.5) * 0.1;
    const nextPH = Number((data.env.pH + delta).toFixed(2));
    sendMessage({ type: "SET_RUNTIME_PARAMS", pH: nextPH });
    setRuntimeEnvConfig((prev) => (prev ? { ...prev, pH: nextPH } : prev));
  };

  const handleNudgeRad = () => {
    if (!data) return;
    const delta = (Math.random() - 0.5) * 0.2;
    const nextRad = Math.max(0, Number((data.env.rad + delta).toFixed(2)));
    sendMessage({ type: "SET_ENV", rad: nextRad });
    setRuntimeEnvConfig((prev) => (prev ? { ...prev, rad: nextRad } : prev));
  };

  useEffect(() => {
    if (state !== "running" || !data || runtimeEnvInitialized) return;
    setRuntimeEnvConfig({
      S: Number(data.env.S),
      T: Number(data.env.T),
      pH: Number(data.env.pH),
      temp: Number(data.env.temp),
      rad: Number(data.env.rad),
      D: Number(envConfig.D),
      S_in: Number(envConfig.S_in),
    });
    setRuntimeEnvInitialized(true);
  }, [state, data, runtimeEnvInitialized, envConfig.D, envConfig.S_in]);

  // 設定画面
  if (state === 'setup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                Microverse
              </h1>
              <p className="text-slate-400">初期設定</p>
              <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {isConnected ? '● サーバー接続中' : '○ サーバー未接続'}
              </span>
            </div>
            <div className="shrink-0">
              <Button
                type="button"
                onClick={() => setShowAdvancedSetup((prev) => !prev)}
                className="bg-indigo-600 text-white hover:bg-indigo-500 border border-indigo-400/40 shadow-md shadow-indigo-900/30"
              >
                {showAdvancedSetup ? '▲ 上級者向け項目を閉じる' : '▼ 上級者向け項目を表示'}
              </Button>
            </div>
          </div>

          {showAdvancedSetup && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* 初期株設定 */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">初期株設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!showAdvancedSetup && (
                  <div className="rounded-md border border-slate-700 bg-slate-900/30 px-3 py-2 text-sm text-slate-400">
                    右上の「上級者向け項目を表示」を押すと、設定項目が表示されます。
                  </div>
                )}
                {showAdvancedSetup && (
                  <>
                    <div>
                      <Label className="text-slate-300">最大成長速度 (μ_max)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={strainConfig.mu_max}
                        onChange={(e) => setStrainConfig({...strainConfig, mu_max: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">モノド定数 (Ks)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={strainConfig.Ks}
                        onChange={(e) => setStrainConfig({...strainConfig, Ks: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">毒素生産能 (p)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={strainConfig.p}
                        onChange={(e) => setStrainConfig({...strainConfig, p: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">初期個体数 (N0)</Label>
                      <Input
                        type="number"
                        step="10"
                        value={strainConfig.N0}
                        onChange={(e) => setStrainConfig({...strainConfig, N0: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">最適温度 (T_opt, °C)</Label>
                      <Input
                        type="number"
                        step="1"
                        value={strainConfig.T_opt}
                        onChange={(e) => setStrainConfig({...strainConfig, T_opt: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">最適pH (pH_opt)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={strainConfig.pH_opt}
                        onChange={(e) => setStrainConfig({...strainConfig, pH_opt: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">毒素耐性 (r)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={strainConfig.r}
                        onChange={(e) => setStrainConfig({...strainConfig, r: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">放射線耐性 (Rad_res)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={strainConfig.Rad_res}
                        onChange={(e) => setStrainConfig({...strainConfig, Rad_res: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* 環境設定 */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">環境設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!showAdvancedSetup && (
                  <div className="rounded-md border border-slate-700 bg-slate-900/30 px-3 py-2 text-sm text-slate-400">
                    右上の「上級者向け項目を表示」を押すと、設定項目が表示されます。
                  </div>
                )}
                {showAdvancedSetup && (
                  <>
                    <div>
                      <Label className="text-slate-300">初期基質濃度 (S0)</Label>
                      <Input
                        type="number"
                        step="10"
                        value={envConfig.S0}
                        onChange={(e) => setEnvConfig({...envConfig, S0: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">環境温度 (temp, °C)</Label>
                      <Input
                        type="number"
                        step="1"
                        value={envConfig.temp}
                        onChange={(e) => setEnvConfig({...envConfig, temp: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">放射線レベル (rad)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={envConfig.rad}
                        onChange={(e) => setEnvConfig({...envConfig, rad: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">収率 (Y)</Label>
                      <Input
                        type="number"
                        step="10"
                        value={envConfig.Y}
                        onChange={(e) => setEnvConfig({...envConfig, Y: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">自動供給量/バッチ (feed_per_batch)</Label>
                      <Input
                        type="number"
                        step="10"
                        value={envConfig.feed_per_batch}
                        onChange={(e) => setEnvConfig({...envConfig, feed_per_batch: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">バッチ数 (batch_size, 1ループあたり)</Label>
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        value={envConfig.batch_size}
                        onChange={(e) => setEnvConfig({...envConfig, batch_size: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">初期毒素濃度 (T0)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={envConfig.T0}
                        onChange={(e) => setEnvConfig({...envConfig, T0: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">初期pH (pH0)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={envConfig.pH0}
                        onChange={(e) => setEnvConfig({...envConfig, pH0: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">毒素ストレス係数 (k_tox)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={envConfig.k_tox}
                        onChange={(e) => setEnvConfig({...envConfig, k_tox: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">放射線ストレス係数 (k_rad)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={envConfig.k_rad}
                        onChange={(e) => setEnvConfig({...envConfig, k_rad: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">酸性化係数 (k_acid)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={envConfig.k_acid}
                        onChange={(e) => setEnvConfig({...envConfig, k_acid: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">毒素減衰率 (d_T)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={envConfig.d_T}
                        onChange={(e) => setEnvConfig({...envConfig, d_T: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">HGT取り込み確率 (hgt_prob)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={envConfig.hgt_prob}
                        onChange={(e) => setEnvConfig({...envConfig, hgt_prob: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">希釈率 (D)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={envConfig.D}
                        onChange={(e) => setEnvConfig({...envConfig, D: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">流入基質濃度 (S_in)</Label>
                      <Input
                        type="number"
                        step="1"
                        value={envConfig.S_in}
                        onChange={(e) => setEnvConfig({...envConfig, S_in: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">自動供給上限S (feed_max_s)</Label>
                      <Input
                        type="number"
                        step="10"
                        value={envConfig.feed_max_s}
                        onChange={(e) => setEnvConfig({...envConfig, feed_max_s: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-slate-600 bg-slate-700 px-3 py-2">
                      <Label className="text-slate-300">自動供給ON/OFF (auto_feed_enabled)</Label>
                      <input
                        type="checkbox"
                        checked={envConfig.auto_feed_enabled}
                        onChange={(e) => setEnvConfig({...envConfig, auto_feed_enabled: e.target.checked})}
                        className="h-4 w-4"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">最大相対変化率/step (max_rel_change_per_step)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={envConfig.max_rel_change_per_step}
                        onChange={(e) => setEnvConfig({...envConfig, max_rel_change_per_step: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">S最大絶対変化量/step (max_abs_s_change_per_step)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={envConfig.max_abs_s_change_per_step}
                        onChange={(e) => setEnvConfig({...envConfig, max_abs_s_change_per_step: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">株間HGT率係数 (k_hgt)</Label>
                      <Input
                        type="number"
                        step="1e-9"
                        value={envConfig.k_hgt}
                        onChange={(e) => setEnvConfig({...envConfig, k_hgt: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-300">分裂しきい値 (division_threshold)</Label>
                      <Input
                        type="number"
                        step="1"
                        value={envConfig.division_threshold}
                        onChange={(e) => setEnvConfig({...envConfig, division_threshold: Number(e.target.value)})}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          )}
          <div className="flex flex-col items-center mt-12 mb-20">
            <div className="relative w-80 h-80 mb-10 animate-bounce-slow z-10 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">
                <Image
                  src="/assets/sprite/sprite-5-twin.gif"
                  alt="bacteria mascot"
                  fill
                  className="object-contain"
                  unoptimized
                />
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="bg-slate-900/50 p-4 rounded">
                    <div className="text-slate-400 mb-1">最終統計</div>
                    <div className="space-y-1">
                      <div className="text-slate-400">分裂回数: <span className="font-mono text-purple-400">{data.stats.division_count}</span></div>
                      <div className="text-slate-400">HGT回数: <span className="font-mono text-orange-400">{data.stats.hgt_count}</span></div>
                      <div className="text-slate-400">最高総個体数: <span className="font-mono text-green-300">{peakTotalN ? peakTotalN.value.toFixed(1) : "-"}</span></div>
                      <div className="text-slate-400">最高到達STEP: <span className="font-mono text-white">{peakTotalN ? peakTotalN.step.toLocaleString() : "-"}</span></div>
                    </div>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded">
                    <div className="text-slate-400 mb-1">直前の環境パラメーター</div>
                    <div className="space-y-1">
                      <div className="text-slate-400">基質 S: <span className="font-mono text-yellow-400">{lastPreExtinctionEnv ? lastPreExtinctionEnv.S.toFixed(1) : "-"}</span></div>
                      <div className="text-slate-400">毒素 T: <span className="font-mono text-white">{lastPreExtinctionEnv ? lastPreExtinctionEnv.T.toFixed(2) : "-"}</span></div>
                      <div className="text-slate-400">環境 pH: <span className="font-mono text-cyan-400">{lastPreExtinctionEnv ? lastPreExtinctionEnv.pH.toFixed(2) : "-"}</span></div>
                      <div className="text-slate-400">温度 temp: <span className="font-mono text-orange-300">{lastPreExtinctionEnv ? lastPreExtinctionEnv.temp.toFixed(1) : "-"}</span></div>
                      <div className="text-slate-400">放射線 rad: <span className="font-mono text-pink-300">{lastPreExtinctionEnv ? lastPreExtinctionEnv.rad.toFixed(2) : "-"}</span></div>
                    </div>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded md:col-span-2">
                    <div className="text-slate-400 mb-1">最後に残った株の詳細データ</div>
                    {lastSurvivor ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="text-slate-400">ID: <span className="font-mono text-blue-400">#{lastSurvivor.id}</span></div>
                        <div className="text-slate-400">個体数 N: <span className="font-mono text-green-300">{lastSurvivor.N.toFixed(2)}</span></div>
                        <div className="text-slate-400">μ_max: <span className="font-mono text-purple-300">{lastSurvivor.mu_max.toFixed(3)}</span></div>
                        <div className="text-slate-400">Ks: <span className="font-mono text-cyan-300">{lastSurvivor.Ks.toFixed(3)}</span></div>
                        <div className="text-slate-400">p: <span className="font-mono text-white">{lastSurvivor.p.toFixed(3)}</span></div>
                        <div className="text-slate-400">r: <span className="font-mono text-white">{lastSurvivor.r.toFixed(3)}</span></div>
                        <div className="text-slate-400">T_opt: <span className="font-mono text-orange-300">{lastSurvivor.T_opt.toFixed(2)}</span></div>
                        <div className="text-slate-400">pH_opt: <span className="font-mono text-cyan-300">{lastSurvivor.pH_opt.toFixed(2)}</span></div>
                        <div className="text-slate-400">Rad_res: <span className="font-mono text-pink-300">{lastSurvivor.Rad_res.toFixed(3)}</span></div>
                      </div>
                    ) : (
                      <div className="text-slate-500 text-xs">生存株データが取得できませんでした。</div>
                    )}
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
      <div className="max-w-full">
        
        {/* ヘッダー & インラインコントロール・ツールバー */}
        <header className="flex flex-wrap items-center gap-6 bg-slate-900/60 p-4 border border-slate-800 rounded-2xl backdrop-blur-md mb-8">
          <div className="flex items-center gap-6">
            <h1 className="text-3xl font-black tracking-tighter text-emerald-400 italic shrink-0">
              Microverse
            </h1>
            
            <div className="flex items-center gap-4 border-l border-slate-700 pl-6">
              {/* 実行ステータスとステップ数 */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  実行中
                </span>
                {data && (
                  <span className="text-xs font-mono text-slate-500">
                    STEP: <span className="text-white">{data.step.toLocaleString()}</span>
                  </span>
                )}
              </div>

              {/* インライン・アクションボタン群 */}
              <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg">
              <Button 
                  onClick={handlePauseResume}
                  className={`h-8 w-auto px-4 gap-2 transition-all shadow-md font-bold text-[15px] ${
                    isPaused 
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                      : 'bg-slate-100 hover:bg-white text-black'
                  }`}
                >
                  {isPaused ? (
                    <>
                      <Play size={14} fill="currentColor" />
                      <span>再開</span>
                    </>
                  ) : (
                    <>
                      <div className="flex gap-0.5">
                        <div className="w-1 h-3.5 bg-current rounded-full"></div>
                        <div className="w-1 h-3.5 bg-current rounded-full"></div>
                      </div>
                      <span>一時停止</span>
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleStep}
                  disabled={!isPaused}
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-[15px] text-slate-300 hover:bg-slate-700 disabled:opacity-20"
                >
                  1ステップ
                </Button>
                <Button
                  onClick={handleReset}
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-[15px] text-slate-500 hover:text-red-400"
                >
                  リセット
                </Button>
              </div>
            </div>
          </div>
          {/* 右側：バッチ設定エリア */}
          <div className="flex items-center gap-3 bg-black/30 p-1 pl-4 mr-[10%] rounded-full border border-slate-800">
            <Label className="text-[15px] text-slate-500 uppercase tracking-tighter">Batch Size</Label>
            <Input
              type="number"
              min="1"
              value={envConfig.batch_size}
              onChange={(e) => setEnvConfig({...envConfig, batch_size: Number(e.target.value)})}
              className="w-16 bg-transparent border-none text-white text-xs font-mono focus-visible:ring-0 h-8 text-center"
            />
            <Button
              onClick={handleSetBatchSize}
              className="h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-[15px] rounded-full"
            >
              反映
            </Button>
          </div>
          <div className="flex items-center gap-6 px-6 border-slate-800 ml-4">
            {[
              { label: "基質濃度(S)", val: data?.env.S.toFixed(1), icon: <Droplets className="text-yellow-400" size={18} /> },
              { label: "現在温度", val: `${data?.env.temp.toFixed(1)}°C`, icon: <Thermometer className="text-orange-400" size={18} /> },
              { label: "放射線レベル", val: data?.env.rad.toFixed(1), icon: <Zap className="text-pink-400" size={18} />, onIconClick: handleNudgeRad },
              { label: "環境pH", val: data?.env.pH.toFixed(1), icon: <FlaskConical className="text-cyan-400" size={18} />, onIconClick: handleNudgePH },
              { label: "総個体数", val: data?.stats.total_N.toFixed(1), icon: <Activity className="text-green-400" size={18} /> },
              { label: "アクティブ株数", val: data?.stats.active_strains, icon: <Activity className="text-blue-400" size={18} /> }
            ].map((env) => (
              <div key={env.label} className="flex flex-col items-start min-w-[60px]">
                <div className="flex flex-column items-center gap-1 text-[9px] text-slate-500 font-bold uppercase tracking-tighter">
                  {env.onIconClick ? (
                    <button
                      type="button"
                      onClick={env.onIconClick}
                      disabled={!data}
                      title="クリックで微調整"
                      className="rounded p-0.5 hover:bg-slate-700/70 disabled:opacity-40"
                    >
                      {env.icon}
                    </button>
                  ) : (
                    env.icon
                  )}
                  <span className="text-[10px]">{env.label}</span>
                </div>
                <div className="font-mono text-xs font-bold text-white leading-none mt-0.5">
                  {env.val ?? "--"}
                </div>
              </div>
            ))}
          </div>

        </header>
            {showLineagePanel ? (
              <div className="fixed top-6 right-6 z-50 w-[420px] max-h-[88vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl">
                <div className="border-b border-slate-700 px-4 py-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">系統図（Mermaid）</div>
                    <div className="text-[11px] text-slate-400">ランキングの株IDを押すと、古い祖先が上になる順で表示</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLineagePanel(false)}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-700 hover:bg-slate-800"
                    title="閉じる"
                  >
                    ×
                  </button>
                </div>
                <div className="p-3 h-[74vh] overflow-auto">
                  {isLineageLoading ? (
                    <div className="text-xs text-slate-400">系統図を取得中...</div>
                  ) : lineageError ? (
                    <div className="text-xs text-red-400">{lineageError}</div>
                  ) : lineageData ? (
                    <>
                      <div className="text-[11px] text-slate-400 mb-2">
                        target: #{lineageData.target_id} / depth: {lineageData.depth}
                        {lineageData.truncated ? " (truncated)" : ""}
                      </div>
                      <div ref={lineageContainerRef} className="min-h-[320px] bg-slate-950/70 rounded border border-slate-700 p-2" />
                    </>
                  ) : (
                    <div className="text-xs text-slate-500">左のランキングでIDをクリックしてください。</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="fixed top-6 right-6 z-50">
                <Button
                  size="sm"
                  onClick={() => setShowLineagePanel(true)}
                  className="bg-slate-800 border border-slate-700 text-cyan-300 hover:bg-slate-700"
                >
                  系統図を表示
                </Button>
              </div>
            )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 px-6">
            <div className="lg:col-span-1">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-md border border-slate-800 w-full">
                  {/* ランキングボタン */}
                  <Button
                    size="sm"
                    variant={leftPanelTab === "ranking" ? "default" : "outline"}
                    onClick={() => setLeftPanelTab("ranking")}
                    className={
                      leftPanelTab === "ranking" 
                        ? "h-8 w-full bg-white text-black font-bold hover:bg-white" // w-fullを追加
                        : "h-8 w-full bg-transparent text-slate-400 border-none hover:text-white hover:bg-slate-800"
                    }
                  >
                    ランキング
                  </Button>

                  {/* 変更と監視ボタン */}
                  <Button
                    size="sm"
                    variant={leftPanelTab === "env" ? "default" : "outline"}
                    onClick={() => setLeftPanelTab("env")}
                    className={
                      leftPanelTab === "env" 
                        ? "h-8 w-full bg-white text-black font-bold hover:bg-white" // w-fullを追加
                        : "h-8 w-full bg-transparent text-slate-400 border-none hover:text-white hover:bg-slate-800"
                    }
                  >
                    変更と監視
                  </Button>
                </div>
                    
                </CardHeader>
                <CardContent>
                  {leftPanelTab === "ranking" ? (
                    data && data.ranking.length > 0 ? (
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
                                <td className="p-2 font-mono text-blue-400">
                                  <button
                                    type="button"
                                    onClick={() => requestLineage(strain.id)}
                                    className={`underline underline-offset-2 hover:text-cyan-300 ${selectedLineageId === strain.id ? "text-cyan-300" : "text-blue-400"}`}
                                  >
                                    #{strain.id}
                                  </button>
                                </td>
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
                    ) : (
                      <div className="text-sm text-slate-400">ランキングデータ待機中です。</div>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-2">
                        <div className="text-xs text-slate-300 font-semibold">監視（現在値の意味）</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-slate-400">基質濃度 S</div><div className="text-white font-mono text-right">{data?.env.S.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">毒素濃度 T</div><div className="text-white font-mono text-right">{data?.env.T.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">環境pH</div><div className="text-white font-mono text-right">{data?.env.pH.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">環境温度 temp</div><div className="text-white font-mono text-right">{data?.env.temp.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">放射線レベル rad</div><div className="text-white font-mono text-right">{data?.env.rad.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">総個体数 total_N</div><div className="text-green-300 font-mono text-right">{data?.stats.total_N.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">アクティブ株数 active_strains</div><div className="text-blue-300 font-mono text-right">{data?.stats.active_strains ?? "-"}</div>
                          <div className="text-slate-400">自動供給 enabled</div><div className="text-white font-mono text-right">{data?.feed.enabled ? "ON" : "OFF"}</div>
                          <div className="text-slate-400">供給量/バッチ per_batch</div><div className="text-white font-mono text-right">{data?.feed.per_batch?.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">供給上限 max_s</div><div className="text-white font-mono text-right">{data?.feed.max_s?.toFixed(2) ?? "-"}</div>
                          <div className="text-slate-400">プラスミド種数</div><div className="text-white font-mono text-right">{data?.pool?.plasmids?.length ?? 0}</div>
                          <div className="text-slate-400">プール濃度合計</div><div className="text-white font-mono text-right">{(data?.pool?.concentrations?.reduce((sum, value) => sum + value, 0) ?? 0).toFixed(3)}</div>
                          <div className="text-slate-400">プール濃度最大</div><div className="text-white font-mono text-right">{(data?.pool?.concentrations?.length ? Math.max(...data.pool.concentrations) : 0).toFixed(3)}</div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-2">
                        <div className="text-xs text-slate-300 font-semibold">実行中の環境変更（入力欄→送信先）</div>
                        <div className="grid grid-cols-1 gap-2">
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">基質濃度 <span className="text-slate-500">(SET_RUNTIME_PARAMS.S)</span></div>
                            <Input type="number" step="1" value={runtimeEnvConfig?.S ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, S: Number(e.target.value) } : prev)} placeholder="例: 500" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">毒素濃度 <span className="text-slate-500">(SET_RUNTIME_PARAMS.T)</span></div>
                            <Input type="number" step="0.1" value={runtimeEnvConfig?.T ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, T: Number(e.target.value) } : prev)} placeholder="例: 0.0" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">環境pH <span className="text-slate-500">(SET_RUNTIME_PARAMS.pH)</span></div>
                            <Input type="number" step="0.1" value={runtimeEnvConfig?.pH ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, pH: Number(e.target.value) } : prev)} placeholder="例: 7.0" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">環境温度(℃) <span className="text-slate-500">(SET_ENV.temp)</span></div>
                            <Input type="number" step="0.1" value={runtimeEnvConfig?.temp ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, temp: Number(e.target.value) } : prev)} placeholder="例: 25.0" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">放射線レベル <span className="text-slate-500">(SET_ENV.rad)</span></div>
                            <Input type="number" step="0.1" value={runtimeEnvConfig?.rad ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, rad: Number(e.target.value) } : prev)} placeholder="例: 0.0" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">希釈率 <span className="text-slate-500">(SET_RUNTIME_PARAMS.D)</span></div>
                            <Input type="number" step="0.01" value={runtimeEnvConfig?.D ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, D: Number(e.target.value) } : prev)} placeholder="例: 0.01" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                          <div className="rounded border border-slate-700 p-2 space-y-1">
                            <div className="text-[11px] text-slate-300">流入基質濃度 <span className="text-slate-500">(SET_RUNTIME_PARAMS.S_in)</span></div>
                            <Input type="number" step="1" value={runtimeEnvConfig?.S_in ?? ""} onChange={(e) => setRuntimeEnvConfig((prev) => prev ? { ...prev, S_in: Number(e.target.value) } : prev)} placeholder="例: 120" className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-400" />
                          </div>
                        </div>
                        <Button size="sm" onClick={handleApplyRuntimeEnv} disabled={!runtimeEnvConfig} className="h-7 px-2 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 w-full">
                          環境値を反映
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-3">
              <ColosseumChamber data={data} />
            </div>
            <div className="lg:col-span-1">
              <Card className="bg-slate-800/50 border-slate-700 h-full">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-white text-base">AI提案コメント</CardTitle>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handleAskAI}
                        disabled={!data || isAiLoading}
                        size="sm"
                        className="h-7 px-2 text-xs bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
                      >
                        {isAiLoading ? "問い合わせ中..." : "AIに聞いてみる"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleApplyAiSuggestion}
                        disabled={isAiLoading || aiMessages.length === 0}
                        className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
                      >
                        提案を適用
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-[520px] overflow-y-auto space-y-3 pr-1">
                    {aiMessages.length === 0 ? (
                      <div className="text-sm text-slate-400">「AIに聞いてみる」を押すと、ここに提案が表示されます。</div>
                    ) : (
                      aiMessages.map((msg, idx) => (
                        <div
                          key={`${msg.at}-${idx}`}
                          className={`rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap ${
                            msg.role === "user"
                              ? "border-blue-500/40 bg-blue-500/10 text-blue-200"
                              : msg.role === "assistant"
                                ? "border-violet-500/40 bg-violet-500/10 text-violet-100"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-100"
                          }`}
                        >
                          <div className="text-[10px] opacity-70 mb-1">{msg.role.toUpperCase()} • {msg.at}</div>
                          <div>{msg.text}</div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

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
  );
}
