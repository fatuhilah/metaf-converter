"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  BrainCircuit,
  Eye,
  CloudLightning,
  Wind,
  Layers,
  History,
  ShieldAlert,
  Plane,
  Timer,
  CheckCircle2,
  AlertTriangle,
  Play,
  Activity,
  FileCode2,
  ExternalLink,
  UploadCloud,
  Cpu,
  LineChart,
  BarChart3,
  Table2,
  Image as ImageIcon,
  Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  runMultiEngineInference,
  EngineKey,
  HybridPredictionOutput,
  HybridMetarRecord,
} from "@/lib/onnxHybridEngine";

const COLAB_TRAINING_URL =
  "https://colab.research.google.com/drive/166eaIIxLMo8-vtMvHGiON5Lu0I_1nxVw#scrollTo=4Sb6xun7RW8z";

export type MlModelKey =
  | "VISIBILITY_NOWCAST"
  | "TS_CB_PREDICTION"
  | "WIND_SHEAR_BILSTM"
  | "FLIGHT_CATEGORY_TFT"
  | "WEATHER_CLUSTERING"
  | "ANALOG_FORECASTING"
  | "ANOMALY_QC"
  | "WEATHER_PERSISTENCE";

interface MlModuleMeta {
  key: MlModelKey;
  title: string;
  algo: string;
  filePrefix: string;
  desc: string;
  icon: React.ElementType;
}

const ML_MODELS: MlModuleMeta[] = [
  {
    key: "VISIBILITY_NOWCAST",
    title: "Nowcasting Visibilitas & Kabut/Asap",
    algo: "XGB + RF + LSTM + 1D-CNN",
    filePrefix: "vis_nowcast",
    desc: "Memprediksi visibilitas minimum (meter) serta peluang kabut/asap 1–3 jam ke depan dari tren FSI, T-Td, angin, dan QNH.",
    icon: Eye,
  },
  {
    key: "TS_CB_PREDICTION",
    title: "Prediksi Thunderstorm / CB Lokal",
    algo: "XGB + RF + LSTM + 1D-CNN",
    filePrefix: "ts_cb",
    desc: "Mendeteksi peluang pertumbuhan awan CB dan kejadian TS/TSRA dalam 30–180 menit ke depan berdasarkan prekursor permukaan.",
    icon: CloudLightning,
  },
  {
    key: "FLIGHT_CATEGORY_TFT",
    title: "Prediksi Flight Category & Ceiling",
    algo: "XGB + RF + LSTM + 1D-CNN",
    filePrefix: "flight_cat",
    desc: "Klasifikasi probabilistik kategori penerbangan (VFR, MVFR, IFR, LIFR) dan ketinggian dasar awan rendah 1–3 jam ke depan.",
    icon: Plane,
  },
  {
    key: "WIND_SHEAR_BILSTM",
    title: "Prediksi Wind Shear & Pergeseran Angin",
    algo: "XGB + RF + Bi-LSTM + 1D-CNN",
    filePrefix: "wind_shear",
    desc: "Memprediksi lonjakan gust dan perubahan arah angin mendadak (≥45°) di area approach dan take-off bandara.",
    icon: Wind,
  },
  {
    key: "WEATHER_CLUSTERING",
    title: "Klasterisasi Rezim Cuaca Bandara",
    algo: "K-Means + RF + LSTM + 1D-CNN",
    filePrefix: "wx_cluster",
    desc: "Mengelompokkan observasi METAR ke dalam 4 rezim cuaca khas stasiun (angin laut, monsun, pemanasan terik, konvektif).",
    icon: Layers,
  },
  {
    key: "ANALOG_FORECASTING",
    title: "Analog Forecasting (Pola Historis)",
    algo: "PCA + RF + LSTM + 1D-CNN",
    filePrefix: "analog_enc",
    desc: "Mencari 5 kejadian historis di arsip Supabase yang pola perubahan METAR 3 jam terakhirnya paling mirip dengan hari ini.",
    icon: History,
  },
  {
    key: "ANOMALY_QC",
    title: "Deteksi Anomali Sensor & Audit QC",
    algo: "PCA + RF + LSTM-AE + CNN-AE",
    filePrefix: "anomaly_qc",
    desc: "Mendeteksi anomali pembacaan sensor AWOS (lompatan mendadak) atau kombinasi parameter cuaca yang menyimpang secara klimatologis.",
    icon: ShieldAlert,
  },
  {
    key: "WEATHER_PERSISTENCE",
    title: "Prediksi Durasi & Waktu Reda Cuaca",
    algo: "XGB + RF + LSTM + 1D-CNN",
    filePrefix: "clearing_time",
    desc: "Memprediksi estimasi waktu pemulihan (menit/jam hingga kembali VFR) saat hujan lebat, TSRA, atau kabut sedang berlangsung.",
    icon: Timer,
  },
];

const ENGINE_CHIPS: {
  key: EngineKey;
  label: string;
  tag: string;
  prefix: string;
  activeBg: string;
}[] = [
  {
    key: "XGBOOST",
    label: "XGBoost",
    tag: "Boosting",
    prefix: "xgb",
    activeBg: "bg-blue-600 text-white border-blue-700",
  },
  {
    key: "RF",
    label: "Random Forest",
    tag: "Bagging",
    prefix: "rf",
    activeBg: "bg-violet-600 text-white border-violet-700",
  },
  {
    key: "LSTM",
    label: "PyTorch LSTM",
    tag: "Recurrent",
    prefix: "lstm",
    activeBg: "bg-rose-600 text-white border-rose-700",
  },
  {
    key: "CNN",
    label: "1D-CNN",
    tag: "Conv1D",
    prefix: "cnn",
    activeBg: "bg-emerald-600 text-white border-emerald-700",
  },
];

interface StationScientificMetrics {
  icao: string;
  totalSamples: number;
  trainSamples: number;
  testSamples: number;
  modules: Record<
    string,
    {
      regression?: Record<string, { r2: number; mae: number; rmse: number }>;
      verification?: {
        eventLabel: string;
        [modelName: string]:
          | string
          | { pod: number; far: number; csi: number; tss: number };
      };
      featureImportance?: { name: string; importance: number }[];
    }
  >;
}

function TimeSeriesForecastChart({
  chartData,
}: {
  chartData: NonNullable<HybridPredictionOutput["chartData"]>;
}) {
  const { title, unit, yMin, yMax, points } = chartData;
  const W = 720;
  const H = 225;
  const padL = 54;
  const padR = 24;
  const padT = 22;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const spanY = Math.max(1, yMax - yMin);
  const getX = (idx: number) =>
    padL + (idx / Math.max(1, points.length - 1)) * plotW;
  const getY = (val: number) => padT + plotH - ((val - yMin) / spanY) * plotH;

  const buildPolyline = (
    selector: (p: (typeof points)[0]) => number | null,
  ) => {
    const coords: string[] = [];
    points.forEach((p, idx) => {
      const v = selector(p);
      if (v !== null && !Number.isNaN(v)) {
        coords.push(`${getX(idx).toFixed(1)},${getY(v).toFixed(1)}`);
      }
    });
    return coords.join(" ");
  };

  const obsLine = buildPolyline((p) => p.observed);
  const xgbLine = buildPolyline((p) => p.xgbPred);
  const rfLine = buildPolyline((p) => p.rfPred);
  const lstmLine = buildPolyline((p) => p.lstmPred);
  const cnnLine = buildPolyline((p) => p.cnnPred);
  const ensLine = buildPolyline((p) => p.ensemblePred);

  const lastIdx = points.length - 1;
  const lastPt = points[lastIdx];
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    Math.round(yMin + t * spanY),
  );

  return (
    <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
          <LineChart size={16} className="text-[#b84a39]" />
          <span>{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
          <span className="inline-flex items-center gap-1.5 text-amber-600">
            <span className="w-3 h-0.5 bg-amber-500 inline-block" /> Observation
          </span>
          {lastPt?.xgbPred !== null && (
            <span className="inline-flex items-center gap-1.5 text-blue-600">
              <span className="w-3 h-0.5 bg-blue-600 inline-block" /> XGB
            </span>
          )}
          {lastPt?.rfPred !== null && (
            <span className="inline-flex items-center gap-1.5 text-violet-600">
              <span className="w-3 h-0.5 bg-violet-600 inline-block" /> RF
            </span>
          )}
          {lastPt?.lstmPred !== null && (
            <span className="inline-flex items-center gap-1.5 text-rose-600">
              <span className="w-3 h-0.5 bg-rose-600 inline-block" /> LSTM
            </span>
          )}
          {lastPt?.cnnPred !== null && (
            <span className="inline-flex items-center gap-1.5 text-teal-600">
              <span className="w-3 h-0.5 bg-teal-600 inline-block" /> 1D-CNN
            </span>
          )}
          {lastPt?.ensemblePred !== null && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <span className="w-3 h-1 bg-emerald-600 inline-block" /> Ensemble
            </span>
          )}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto min-w-[540px] select-none"
        >
          <rect
            x={getX(lastIdx - 1)}
            y={padT}
            width={getX(lastIdx) - getX(lastIdx - 1)}
            height={plotH}
            fill="#fef3c7"
            opacity={0.45}
          />
          {yTicks.map((tick) => {
            const y = getY(tick);
            return (
              <g key={tick}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                  fontFamily="monospace"
                >
                  {tick}
                </text>
              </g>
            );
          })}
          {points.map((p, idx) => {
            if (idx % 2 !== 0 && idx !== lastIdx) return null;
            return (
              <text
                key={`${p.timeLabel}-${idx}`}
                x={getX(idx)}
                y={H - 10}
                textAnchor="middle"
                fontSize="10"
                fontWeight={idx === lastIdx ? "bold" : "normal"}
                fill={idx === lastIdx ? "#b84a39" : "#64748b"}
                fontFamily="monospace"
              >
                {p.timeLabel}
              </text>
            );
          })}
          {obsLine && (
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.4"
              points={obsLine}
            />
          )}
          {points.map(
            (p, idx) =>
              p.observed !== null && (
                <circle
                  key={`obs-${idx}`}
                  cx={getX(idx)}
                  cy={getY(p.observed)}
                  r="3"
                  fill="#f59e0b"
                />
              ),
          )}
          {xgbLine && (
            <polyline
              fill="none"
              stroke="#2563eb"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              points={xgbLine}
            />
          )}
          {lastPt?.xgbPred !== null && (
            <circle
              cx={getX(lastIdx)}
              cy={getY(lastPt.xgbPred)}
              r="4"
              fill="#2563eb"
            />
          )}
          {rfLine && (
            <polyline
              fill="none"
              stroke="#7c3aed"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              points={rfLine}
            />
          )}
          {lastPt?.rfPred !== null && (
            <circle
              cx={getX(lastIdx)}
              cy={getY(lastPt.rfPred)}
              r="4"
              fill="#7c3aed"
            />
          )}
          {lstmLine && (
            <polyline
              fill="none"
              stroke="#e11d48"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              points={lstmLine}
            />
          )}
          {lastPt?.lstmPred !== null && (
            <circle
              cx={getX(lastIdx)}
              cy={getY(lastPt.lstmPred)}
              r="4"
              fill="#e11d48"
            />
          )}
          {cnnLine && (
            <polyline
              fill="none"
              stroke="#0d9488"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              points={cnnLine}
            />
          )}
          {lastPt?.cnnPred !== null && (
            <circle
              cx={getX(lastIdx)}
              cy={getY(lastPt.cnnPred)}
              r="4"
              fill="#0d9488"
            />
          )}
          {ensLine && (
            <polyline
              fill="none"
              stroke="#059669"
              strokeWidth="2.8"
              points={ensLine}
            />
          )}
          {lastPt?.ensemblePred !== null && (
            <g>
              <circle
                cx={getX(lastIdx)}
                cy={getY(lastPt.ensemblePred)}
                r="5.5"
                fill="#059669"
              />
              <text
                x={getX(lastIdx) - 6}
                y={getY(lastPt.ensemblePred) - 9}
                textAnchor="end"
                fontSize="10"
                fontWeight="bold"
                fill="#065f46"
              >
                {lastPt.ensemblePred} {unit}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

interface MlModulesWorkspaceProps {
  selectedIcao: string;
  dbStatus: "CHECKING" | "CONNECTED" | "ERROR";
  onAutoSelectIcao?: (icao: string) => void;
}

export default function MlModulesWorkspace({
  selectedIcao,
  dbStatus,
  onAutoSelectIcao,
}: MlModulesWorkspaceProps) {
  const [selectedModel, setSelectedModel] =
    useState<MlModelKey>("VISIBILITY_NOWCAST");

  const [selectedEngines, setSelectedEngines] = useState<EngineKey[]>([
    "XGBOOST",
    "RF",
    "LSTM",
    "CNN",
  ]);

  const activeModelMeta =
    ML_MODELS.find((m) => m.key === selectedModel) || ML_MODELS[0];
  const ActiveModelIcon = activeModelMeta.icon;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modelUrls, setModelUrls] = useState<Record<EngineKey, string | null>>({
    XGBOOST: null,
    RF: null,
    LSTM: null,
    CNN: null,
  });
  const [evalChartUrl, setEvalChartUrl] = useState<string | null>(null);
  const [tscbChartUrl, setTscbChartUrl] = useState<string | null>(null);
  const [corrChartUrl, setCorrChartUrl] = useState<string | null>(null);
  const [stationMetrics, setStationMetrics] =
    useState<StationScientificMetrics | null>(null);
  const [isCheckingModel, setIsCheckingModel] = useState(false);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [modelUploadFeedback, setModelUploadFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [result, setResult] = useState<HybridPredictionOutput | null>(null);

  const toggleEngineChip = (eng: EngineKey) => {
    setSelectedEngines((prev) => {
      if (prev.includes(eng)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== eng);
      }
      const order: EngineKey[] = ["XGBOOST", "RF", "LSTM", "CNN"];
      return order.filter((k) => prev.includes(k) || k === eng);
    });
  };

  const getCombinationBadge = () => {
    const n = selectedEngines.length;
    if (n === 1) return `Mode Single (${selectedEngines[0]})`;
    if (n === 4) return "Grand 4-Model Super Ensemble (15/15)";
    return `Kombinasi ${n}-Model Ensemble (${selectedEngines.join(" + ")})`;
  };

  const checkCloudAssets = useCallback(async () => {
    if (!supabase || selectedIcao === "ALL") {
      setModelUrls({ XGBOOST: null, RF: null, LSTM: null, CNN: null });
      setEvalChartUrl(null);
      setTscbChartUrl(null);
      setCorrChartUrl(null);
      setStationMetrics(null);
      return;
    }

    setIsCheckingModel(true);
    const pfx = selectedIcao.toLowerCase();
    const ts = Date.now();

    const resolvePublicUrl = async (candidates: string[]) => {
      for (const fileName of candidates) {
        const { data } = supabase!.storage
          .from("ml_models")
          .getPublicUrl(fileName);
        const urlWithTs = `${data.publicUrl}?t=${ts}`;
        try {
          const res = await fetch(urlWithTs, { method: "HEAD" });
          if (res.ok) return urlWithTs;
        } catch {
          // lanjut
        }
      }
      return null;
    };

    try {
      const [
        uXgb,
        uRf,
        uLstm,
        uCnn,
        foundPng,
        foundTscbPng,
        foundCorrPng,
        foundJsonUrl,
      ] = await Promise.all([
        resolvePublicUrl([
          `xgb_${activeModelMeta.filePrefix}_${pfx}.onnx`,
          `${activeModelMeta.filePrefix}_${pfx}.onnx`,
        ]),
        resolvePublicUrl([`rf_${activeModelMeta.filePrefix}_${pfx}.onnx`]),
        resolvePublicUrl([`lstm_${activeModelMeta.filePrefix}_${pfx}.onnx`]),
        resolvePublicUrl([`cnn_${activeModelMeta.filePrefix}_${pfx}.onnx`]),
        resolvePublicUrl([`eval_chart_${pfx}.png`]),
        resolvePublicUrl([`eval_tscb_${pfx}.png`]),
        resolvePublicUrl([`eval_corr_${pfx}.png`]),
        resolvePublicUrl([`metrics_${pfx}.json`]),
      ]);

      setModelUrls({
        XGBOOST: uXgb,
        RF: uRf,
        LSTM: uLstm,
        CNN: uCnn,
      });
      setEvalChartUrl(foundPng);
      setTscbChartUrl(foundTscbPng);
      setCorrChartUrl(foundCorrPng);

      if (foundJsonUrl) {
        const jRes = await fetch(foundJsonUrl);
        if (jRes.ok) {
          setStationMetrics((await jRes.json()) as StationScientificMetrics);
        } else {
          setStationMetrics(null);
        }
      } else {
        setStationMetrics(null);
      }
    } finally {
      setIsCheckingModel(false);
    }
  }, [selectedIcao, activeModelMeta]);

  useEffect(() => {
    checkCloudAssets();
    setResult(null);
    setPredictionError(null);
    setModelUploadFeedback(null);
  }, [checkCloudAssets]);

  const handleBatchUploadAssets = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !supabase) return;
    e.target.value = "";

    const validFiles = files.filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith(".onnx") || n.endsWith(".json") || n.endsWith(".png");
    });

    if (validFiles.length === 0) {
      setModelUploadFeedback({
        type: "error",
        text: "Pilih file .onnx, metrics_<icao>.json, atau eval_*.png hasil ekstrak ZIP Colab.",
      });
      return;
    }

    setIsUploadingModel(true);
    setModelUploadFeedback(null);

    let uploadedCount = 0;
    let detectedIcao: string | null = null;

    try {
      for (const file of validFiles) {
        const lower = file.name.toLowerCase();
        const matchIcao = lower.match(/_([a-z]{4})\.(onnx|json|png)$/);
        if (matchIcao) {
          detectedIcao = matchIcao[1].toUpperCase();
        }

        const contentType = lower.endsWith(".json")
          ? "application/json"
          : lower.endsWith(".png")
            ? "image/png"
            : "application/octet-stream";

        const { error } = await supabase.storage
          .from("ml_models")
          .upload(lower, file, {
            upsert: true,
            contentType,
          });

        if (error) throw error;
        uploadedCount++;
      }

      setModelUploadFeedback({
        type: "success",
        text: `Berhasil mengunggah ${uploadedCount} file model & plot evaluasi ke Cloud Registry!`,
      });

      if (detectedIcao && selectedIcao !== detectedIcao && onAutoSelectIcao) {
        onAutoSelectIcao(detectedIcao);
      } else {
        await checkCloudAssets();
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Gagal mengunggah file ke Supabase Storage.";
      setModelUploadFeedback({
        type: "error",
        text: `Error Upload: ${msg}`,
      });
    } finally {
      setIsUploadingModel(false);
    }
  };

  const handleRunInference = async () => {
    if (!supabase) return;
    if (selectedIcao === "ALL") {
      setPredictionError(
        "Pilih stasiun ICAO spesifik terlebih dahulu pada dropdown di atas (bukan Semua Stasiun).",
      );
      return;
    }

    setIsPredicting(true);
    setPredictionError(null);
    setResult(null);

    try {
      const fetchLimit = selectedModel === "ANALOG_FORECASTING" ? 600 : 14;

      const { data, error } = await supabase
        .from("metar_observations")
        .select(
          "icao_code, obs_time, raw_metar, wind_dir, is_vrb, wind_speed, wind_gust, visibility_m, temp_c, dewpoint_c, dewpoint_spread, qnh_hpa, weather_phenomena, has_ts, has_cb, lowest_ceiling_ft, flight_category",
        )
        .eq("icao_code", selectedIcao)
        .order("obs_time", { ascending: false })
        .limit(fetchLimit);

      if (error) throw new Error(error.message);

      const recordsAsc = ((data || []) as HybridMetarRecord[]).reverse();
      const output = await runMultiEngineInference({
        moduleKey: selectedModel,
        filePrefix: activeModelMeta.filePrefix,
        icao: selectedIcao,
        activeEngines: selectedEngines,
        recordsAsc,
        modelUrls,
      });

      setResult(output);
    } catch (err: unknown) {
      setPredictionError(
        err instanceof Error
          ? err.message
          : "Gagal menjalankan inferensi model.",
      );
    } finally {
      setIsPredicting(false);
    }
  };

  const getBadgeColor = (variant: HybridPredictionOutput["badgeVariant"]) => {
    switch (variant) {
      case "fuchsia":
        return "bg-fuchsia-700 text-white";
      case "rose":
        return "bg-rose-600 text-white";
      case "amber":
        return "bg-amber-500 text-white";
      case "emerald":
        return "bg-emerald-600 text-white";
      default:
        return "bg-slate-800 text-amber-200";
    }
  };

  const pfx = selectedIcao === "ALL" ? "<icao>" : selectedIcao.toLowerCase();
  const activeModEval = stationMetrics?.modules?.[selectedModel];

  return (
    <div className="space-y-6">
      {/* 1. GRID 8 MODUL ML / DL */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BrainCircuit size={20} className="text-[#b84a39]" />
            <h3 className="text-sm md:text-base font-extrabold text-slate-800">
              Pilih Modul Model Machine Learning / Deep Learning
            </h3>
          </div>
          <span className="text-xs font-bold text-slate-600 bg-white/80 px-3 py-1 rounded-full border border-slate-200">
            Target Stasiun:{" "}
            <span className="text-[#b84a39]">
              {selectedIcao === "ALL" ? "Semua Stasiun" : selectedIcao}
            </span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ML_MODELS.map((model) => {
            const Icon = model.icon;
            const isSelected = selectedModel === model.key;
            return (
              <button
                key={model.key}
                onClick={() => setSelectedModel(model.key)}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "bg-slate-800 text-white border-slate-900 shadow-lg ring-2 ring-[#b84a39]"
                    : "bg-white/90 hover:bg-white text-slate-800 border-slate-200/90 shadow-sm"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div
                      className={`p-2 rounded-lg ${
                        isSelected
                          ? "bg-[#b84a39] text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isSelected
                          ? "bg-white/15 text-amber-200"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      4-Engine ONNX
                    </span>
                  </div>
                  <h4 className="font-extrabold text-xs md:text-sm leading-snug">
                    {model.title}
                  </h4>
                </div>
                <p
                  className={`text-[11px] font-mono mt-2.5 ${
                    isSelected ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  {model.algo}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. WORKSPACE MODEL AKTIF */}
      <section className="bg-white/95 border border-slate-200 rounded-2xl p-5 md:p-6 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-xl bg-[#b84a39]/10 text-[#b84a39]">
              <ActiveModelIcon size={22} />
            </div>
            <div>
              <h4 className="text-base md:text-lg font-extrabold text-slate-800">
                {activeModelMeta.title}
              </h4>
              <p className="text-xs text-slate-600 mt-1">
                {activeModelMeta.desc}
              </p>
            </div>
          </div>

          <a
            href={COLAB_TRAINING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold text-xs transition-colors shrink-0"
          >
            <ExternalLink size={14} />
            Buka Colab Training
          </a>
        </div>

        {/* 4 MULTI-SELECT TOGGLE CHIPS (15 KOMBINASI DINAMIS) */}
        <div className="p-4 rounded-xl bg-slate-100/80 border border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
              <Cpu size={16} className="text-[#b84a39]" />
              <span>
                Pilih Kombinasi Mesin (Klik untuk Single, 2-Model, 3-Model, atau
                4-Model Ensemble):
              </span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-slate-800 text-amber-200">
              {getCombinationBadge()}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ENGINE_CHIPS.map((chip) => {
              const isOn = selectedEngines.includes(chip.key);
              return (
                <button
                  key={chip.key}
                  onClick={() => toggleEngineChip(chip.key)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-extrabold transition-all cursor-pointer ${
                    isOn
                      ? `${chip.activeBg} shadow-sm`
                      : "bg-white hover:bg-slate-50 text-slate-600 border-slate-300"
                  }`}
                >
                  <div className="text-left">
                    <div>{chip.label}</div>
                    <div
                      className={`text-[10px] font-mono ${
                        isOn ? "text-white/80" : "text-slate-400"
                      }`}
                    >
                      {chip.tag}
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center border ${
                      isOn
                        ? "bg-white/20 border-white/40 text-white"
                        : "border-slate-300 bg-slate-100 text-transparent"
                    }`}
                  >
                    <Check size={13} strokeWidth={3} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* PANEL CLOUD REGISTRY & BATCH UPLOAD */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <FileCode2 size={16} className="text-[#b84a39]" />
                <span className="text-xs font-extrabold text-slate-800">
                  Cloud 4-Engine Registry ({selectedIcao})
                </span>
              </div>

              {selectedIcao !== "ALL" && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {ENGINE_CHIPS.map((chip) => {
                    const urlReady = Boolean(modelUrls[chip.key]);
                    return (
                      <span
                        key={chip.key}
                        className={`px-2.5 py-0.5 rounded-full font-bold ${
                          isCheckingModel
                            ? "bg-slate-200 text-slate-600"
                            : urlReady
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {isCheckingModel ? "…" : urlReady ? "●" : "○"}{" "}
                        {chip.prefix}_{activeModelMeta.filePrefix}_{pfx}.onnx
                      </span>
                    );
                  })}
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-bold ${
                      stationMetrics
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {stationMetrics ? "●" : "○"} metrics_{pfx}.json
                  </span>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Upload seluruh isi folder ekstrak ZIP Colab (32 file{" "}
                <code className="font-mono">.onnx</code>,{" "}
                <code className="font-mono">metrics_{pfx}.json</code>, &amp;
                gambar <code className="font-mono">eval_*.png</code>) sekaligus
                lewat Batch Upload.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".onnx,.json,.png"
                multiple
                onChange={handleBatchUploadAssets}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingModel || dbStatus !== "CONNECTED"}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <UploadCloud size={15} className="text-[#b84a39]" />
                {isUploadingModel
                  ? "Mengunggah..."
                  : "Batch Upload (.onnx / .json / .png)"}
              </button>

              <button
                onClick={handleRunInference}
                disabled={isPredicting || dbStatus !== "CONNECTED"}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900 hover:bg-[#b84a39] disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
              >
                <Play size={15} />
                {isPredicting
                  ? "Menghitung..."
                  : `Jalankan (${selectedEngines.length} Model)`}
              </button>
            </div>
          </div>

          {modelUploadFeedback && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                modelUploadFeedback.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200"
              }`}
            >
              {modelUploadFeedback.type === "success" ? (
                <CheckCircle2 size={14} className="shrink-0" />
              ) : (
                <AlertTriangle size={14} className="shrink-0" />
              )}
              <span>{modelUploadFeedback.text}</span>
            </div>
          )}
        </div>

        {/* PESAN ERROR */}
        {predictionError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{predictionError}</span>
          </div>
        )}

        {/* PANEL HASIL INFERENSI */}
        {result && (
          <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-[#b84a39]" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    Hasil {result.icao} • {result.combinationLabel}
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                  Basis Data: {result.latestRawMetar}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-2xl md:text-3xl font-black text-slate-900">
                    {result.primaryMetricValue}
                  </div>
                  <div className="text-[11px] font-bold text-slate-500">
                    {result.primaryMetricLabel}
                  </div>
                </div>
                <span
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold ${getBadgeColor(
                    result.badgeVariant,
                  )}`}
                >
                  {result.badgeText}
                </span>
              </div>
            </div>

            <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
              {result.summary}
            </p>

            {/* BREAKDOWN PER ENGINE YANG DIPILIH */}
            {result.engineBreakdown.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-800 text-white">
                {result.engineBreakdown.map((item) => (
                  <div
                    key={item.engine}
                    className="text-center px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700"
                  >
                    <div className="text-[10px] font-bold text-slate-400">
                      {item.label}
                    </div>
                    <div className="text-sm font-extrabold text-amber-200 mt-0.5">
                      {item.valueDisplay}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* GRAFIK TIME-SERIES OBSERVED VS ESTIMATED */}
            {result.chartData && (
              <TimeSeriesForecastChart chartData={result.chartData} />
            )}

            {/* BREAKDOWN PROBABILITAS FLIGHT CATEGORY */}
            {result.classProbabilities && (
              <div className="grid grid-cols-4 gap-2">
                {(["VFR", "MVFR", "IFR", "LIFR"] as const).map((cat) => (
                  <div
                    key={cat}
                    className="p-2.5 rounded-xl bg-white border border-slate-200 text-center"
                  >
                    <div className="text-[10px] font-extrabold text-slate-500">
                      {cat}
                    </div>
                    <div className="text-sm font-black text-slate-800 mt-0.5">
                      {result.classProbabilities![cat]}%
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* DAFTAR TOP-5 ANALOG HISTORIS */}
            {result.analogMatches && (
              <div className="space-y-2">
                {result.analogMatches.map((m, idx) => (
                  <div
                    key={`${m.obsTime}-${idx}`}
                    className="p-3 rounded-xl bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-extrabold text-slate-700">
                        #{idx + 1} •{" "}
                        {new Date(m.obsTime)
                          .toUTCString()
                          .replace("GMT", "UTC")}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {m.rawMetar}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] font-bold">
                        {m.next3hOutcome}
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-black">
                        {m.similarityPercent}% Mirip
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* INDIKATOR METEOROLOGI TERKINI */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
              {result.indicators.map((ind) => (
                <div
                  key={ind.label}
                  className="p-2.5 rounded-xl bg-white border border-slate-200"
                >
                  <div className="text-[10px] font-bold text-slate-400">
                    {ind.label}
                  </div>
                  <div className="text-xs md:text-sm font-extrabold text-slate-800 mt-0.5">
                    {ind.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PANEL VALIDASI ILMIAH (4 ENGINE METRICS, CORRELATION MATRIX & GRAFIK) */}
        {stationMetrics && activeModEval && (
          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-xs md:text-sm font-extrabold text-slate-800">
                <Table2 size={17} className="text-[#b84a39]" />
                <span>
                  Evaluasi 4-Engine &amp; Verifikasi Meteorologi —{" "}
                  {stationMetrics.icao} (70% Train:{" "}
                  {stationMetrics.trainSamples} | 30% Test:{" "}
                  {stationMetrics.testSamples} sampel)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {activeModEval.regression && (
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-800">
                    Tabel Evaluasi Regresi (Test Set 30%)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-bold">
                          <th className="py-2 pr-2">Model</th>
                          <th className="py-2 px-2 text-right">R²</th>
                          <th className="py-2 px-2 text-right">MAE</th>
                          <th className="py-2 pl-2 text-right">RMSE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {Object.entries(activeModEval.regression).map(
                          ([mName, vals]) => (
                            <tr key={mName} className="text-slate-800">
                              <td className="py-2 pr-2 font-sans font-bold">
                                {mName}
                              </td>
                              <td className="py-2 px-2 text-right font-bold text-emerald-700">
                                {vals.r2.toFixed(3)}
                              </td>
                              <td className="py-2 px-2 text-right">
                                {vals.mae.toFixed(1)}
                              </td>
                              <td className="py-2 pl-2 text-right">
                                {vals.rmse.toFixed(1)}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeModEval.verification && (
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-800">
                    Tabel Verifikasi ({activeModEval.verification.eventLabel})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-bold">
                          <th className="py-2 pr-2">Model</th>
                          <th className="py-2 px-2 text-right">POD</th>
                          <th className="py-2 px-2 text-right">FAR</th>
                          <th className="py-2 px-2 text-right">CSI</th>
                          <th className="py-2 pl-2 text-right">TSS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {[
                          "XGBoost",
                          "Random Forest",
                          "PyTorch LSTM",
                          "1D-CNN",
                          "Grand Ensemble",
                        ].map((mName) => {
                          const row = activeModEval.verification![mName];
                          if (!row || typeof row === "string") return null;
                          return (
                            <tr key={mName} className="text-slate-800">
                              <td className="py-2 pr-2 font-sans font-bold">
                                {mName}
                              </td>
                              <td className="py-2 px-2 text-right">
                                {row.pod.toFixed(1)}%
                              </td>
                              <td className="py-2 px-2 text-right">
                                {row.far.toFixed(1)}%
                              </td>
                              <td className="py-2 px-2 text-right font-bold text-blue-700">
                                {row.csi.toFixed(1)}%
                              </td>
                              <td className="py-2 pl-2 text-right font-bold text-emerald-700">
                                {row.tss.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {activeModEval.featureImportance && (
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                  <BarChart3 size={16} className="text-[#b84a39]" />
                  <span>
                    Top-8 Feature Importance (Hasil Training{" "}
                    {stationMetrics.icao})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {activeModEval.featureImportance.map((feat) => (
                    <div
                      key={feat.name}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-bold text-slate-700 truncate">
                          {feat.name}
                        </span>
                        <span className="font-mono font-extrabold text-[#b84a39]">
                          {feat.importance.toFixed(3)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#b84a39] rounded-full"
                          style={{
                            width: `${Math.min(100, feat.importance * 300)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GRAFIK VALIDASI VISIBILITAS 3-PANEL */}
            {evalChartUrl && selectedModel === "VISIBILITY_NOWCAST" && (
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                  <ImageIcon size={16} className="text-[#b84a39]" />
                  <span>
                    Grafik Validasi Empiris 4-Engine Test Set 30% — (a)
                    Time-Series, (b) Scatter 1:1, (c) Probability Density (
                    {stationMetrics.icao})
                  </span>
                </div>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={evalChartUrl}
                    alt={`Grafik Evaluasi 4-Engine ${stationMetrics.icao}`}
                    className="w-full max-w-3xl mx-auto h-auto"
                  />
                </div>
              </div>
            )}

            {/* GRAFIK VALIDASI DETEKSI TS/CB (TIMELINE SPIKE, CONFUSION MATRIX, ROC-AUC) */}
            {tscbChartUrl && selectedModel === "TS_CB_PREDICTION" && (
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                  <ImageIcon size={16} className="text-[#b84a39]" />
                  <span>
                    Grafik Validasi Deteksi TS/CB Test Set 30% — (a) Event
                    Timeline, (b) Confusion Matrix, (c) ROC-AUC (
                    {stationMetrics.icao})
                  </span>
                </div>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tscbChartUrl}
                    alt={`Grafik Evaluasi TS/CB ${stationMetrics.icao}`}
                    className="w-full max-w-3xl mx-auto h-auto"
                  />
                </div>
              </div>
            )}

            {/* PEARSON CORRELATION MATRIX HEATMAP */}
            {corrChartUrl && (
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                  <ImageIcon size={16} className="text-[#b84a39]" />
                  <span>
                    Pearson Correlation Matrix Antar-Variabel Meteorologi (
                    {stationMetrics.icao})
                  </span>
                </div>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={corrChartUrl}
                    alt={`Correlation Matrix ${stationMetrics.icao}`}
                    className="w-full max-w-2xl mx-auto h-auto"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
