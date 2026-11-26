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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  runTsCbPrediction,
  TsCbPredictionResult,
  MetarDbRecord,
} from "@/lib/onnxTsCbPredictor";
import {
  runVisibilityPrediction,
  VisibilityPredictionResult,
  VisibilityMetarRecord,
} from "@/lib/onnxVisibilityPredictor";
import {
  runFlightCategoryPrediction,
  FlightCatPredictionResult,
  FlightCatMetarRecord,
} from "@/lib/onnxFlightCategoryPredictor";
import {
  runWindShearPrediction,
  WindShearPredictionResult,
  WindShearMetarRecord,
} from "@/lib/onnxWindShearPredictor";
import {
  runWeatherClustering,
  WeatherClusterResult,
  runAnalogForecasting,
  AnalogForecastResult,
  runAnomalyQcCheck,
  AnomalyQcResult,
  runClearingTimePrediction,
  ClearingTimeResult,
  AdvancedMetarRecord,
} from "@/lib/onnxAdvancedPredictors";

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
  badge: string;
  isActive: boolean;
  filePrefix: string;
  desc: string;
  icon: React.ElementType;
}

const ML_MODELS: MlModuleMeta[] = [
  {
    key: "VISIBILITY_NOWCAST",
    title: "Nowcasting Visibilitas & Kabut/Asap",
    algo: "XGBoost Regressor / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "vis_nowcast",
    desc: "Memprediksi visibilitas minimum (meter) serta peluang kabut/asap 1–3 jam ke depan dari tren T, Td, angin, dan QNH.",
    icon: Eye,
  },
  {
    key: "TS_CB_PREDICTION",
    title: "Prediksi Thunderstorm / CB Lokal",
    algo: "XGBoost Classifier / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "ts_cb",
    desc: "Mendeteksi peluang pertumbuhan awan CB dan kejadian TS/TSRA dalam 30–180 menit ke depan berdasarkan prekursor permukaan.",
    icon: CloudLightning,
  },
  {
    key: "FLIGHT_CATEGORY_TFT",
    title: "Prediksi Flight Category & Ceiling",
    algo: "XGBoost Multi-Class / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "flight_cat",
    desc: "Klasifikasi probabilistik kategori penerbangan (VFR, MVFR, IFR, LIFR) dan ketinggian dasar awan rendah 1–3 jam ke depan.",
    icon: Plane,
  },
  {
    key: "WIND_SHEAR_BILSTM",
    title: "Prediksi Wind Shear & Pergeseran Angin",
    algo: "XGBoost Vector Classifier / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "wind_shear",
    desc: "Memprediksi lonjakan gust dan perubahan arah angin mendadak (≥45°) di area approach dan take-off bandara.",
    icon: Wind,
  },
  {
    key: "WEATHER_CLUSTERING",
    title: "Klasterisasi Rezim Cuaca Bandara",
    algo: "K-Means Clustering / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "wx_cluster",
    desc: "Mengelompokkan observasi METAR ke dalam 4 rezim cuaca khas stasiun (angin laut, monsun, pemanasan terik, konvektif).",
    icon: Layers,
  },
  {
    key: "ANALOG_FORECASTING",
    title: "Analog Forecasting (Pola Historis)",
    algo: "PCA Feature Encoder / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "analog_enc",
    desc: "Mencari 5 kejadian historis di arsip Supabase yang pola perubahan METAR 3 jam terakhirnya paling mirip dengan hari ini.",
    icon: History,
  },
  {
    key: "ANOMALY_QC",
    title: "Deteksi Anomali Sensor & Audit QC",
    algo: "Isolation Forest / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "anomaly_qc",
    desc: "Mendeteksi anomali pembacaan sensor AWOS (lompatan mendadak) atau kombinasi parameter cuaca yang menyimpang secara klimatologis.",
    icon: ShieldAlert,
  },
  {
    key: "WEATHER_PERSISTENCE",
    title: "Prediksi Durasi & Waktu Reda Cuaca",
    algo: "XGBoost Clearing Regressor / ONNX",
    badge: "Aktif (ONNX)",
    isActive: true,
    filePrefix: "clearing_time",
    desc: "Memprediksi estimasi waktu pemulihan (menit/jam hingga kembali VFR) saat hujan lebat, TSRA, atau kabut sedang berlangsung.",
    icon: Timer,
  },
];

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
    useState<MlModelKey>("TS_CB_PREDICTION");

  const activeModelMeta =
    ML_MODELS.find((m) => m.key === selectedModel) || ML_MODELS[0];
  const ActiveModelIcon = activeModelMeta.icon;

  // State Model Registry (.onnx di Supabase Storage)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cloudModelUrl, setCloudModelUrl] = useState<string | null>(null);
  const [isCheckingModel, setIsCheckingModel] = useState(false);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [modelUploadFeedback, setModelUploadFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // State Inferensi ke-8 Modul
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [tsCbResult, setTsCbResult] = useState<TsCbPredictionResult | null>(
    null,
  );
  const [visResult, setVisResult] = useState<VisibilityPredictionResult | null>(
    null,
  );
  const [fcatResult, setFcatResult] =
    useState<FlightCatPredictionResult | null>(null);
  const [wshearResult, setWshearResult] =
    useState<WindShearPredictionResult | null>(null);
  const [clusterResult, setClusterResult] =
    useState<WeatherClusterResult | null>(null);
  const [analogResult, setAnalogResult] = useState<AnalogForecastResult | null>(
    null,
  );
  const [qcResult, setQcResult] = useState<AnomalyQcResult | null>(null);
  const [clearingResult, setClearingResult] =
    useState<ClearingTimeResult | null>(null);

  const resetAllResults = () => {
    setTsCbResult(null);
    setVisResult(null);
    setFcatResult(null);
    setWshearResult(null);
    setClusterResult(null);
    setAnalogResult(null);
    setQcResult(null);
    setClearingResult(null);
  };

  // Cek apakah file <prefix>_<icao>.onnx sudah ada di bucket 'ml_models'
  const checkCloudOnnxModel = useCallback(async () => {
    if (!supabase || selectedIcao === "ALL") {
      setCloudModelUrl(null);
      return;
    }

    setIsCheckingModel(true);
    const targetFileName = `${activeModelMeta.filePrefix}_${selectedIcao.toLowerCase()}.onnx`;

    try {
      const { data, error } = await supabase.storage
        .from("ml_models")
        .list("", {
          search: targetFileName,
        });

      if (!error && data && data.some((f) => f.name === targetFileName)) {
        const { data: pubData } = supabase.storage
          .from("ml_models")
          .getPublicUrl(targetFileName);
        setCloudModelUrl(`${pubData.publicUrl}?t=${Date.now()}`);
      } else {
        setCloudModelUrl(null);
      }
    } catch {
      setCloudModelUrl(null);
    } finally {
      setIsCheckingModel(false);
    }
  }, [selectedIcao, activeModelMeta]);

  useEffect(() => {
    checkCloudOnnxModel();
    resetAllResults();
    setPredictionError(null);
    setModelUploadFeedback(null);
  }, [checkCloudOnnxModel]);

  // Upload File .onnx ke Supabase Storage
  const handleUploadOnnxFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;
    e.target.value = "";

    if (!file.name.toLowerCase().endsWith(".onnx")) {
      setModelUploadFeedback({
        type: "error",
        text: `Format file tidak valid. Pilih file .onnx (contoh: ${activeModelMeta.filePrefix}_wals.onnx).`,
      });
      return;
    }

    const matchName = file.name.toLowerCase().match(/_([a-z]{4})\.onnx$/);
    const targetIcao = matchName
      ? matchName[1].toUpperCase()
      : selectedIcao !== "ALL"
        ? selectedIcao
        : null;

    if (!targetIcao) {
      setModelUploadFeedback({
        type: "error",
        text: `Pilih stasiun spesifik di dropdown atas terlebih dahulu atau pastikan nama file berformat ${activeModelMeta.filePrefix}_<icao>.onnx.`,
      });
      return;
    }

    const storageFileName = `${activeModelMeta.filePrefix}_${targetIcao.toLowerCase()}.onnx`;
    setIsUploadingModel(true);
    setModelUploadFeedback(null);

    try {
      const { error } = await supabase.storage
        .from("ml_models")
        .upload(storageFileName, file, {
          upsert: true,
          contentType: "application/octet-stream",
        });

      if (error) throw error;

      setModelUploadFeedback({
        type: "success",
        text: `Model ${storageFileName} berhasil diunggah ke Cloud Registry dan siap digunakan!`,
      });

      if (selectedIcao !== targetIcao && onAutoSelectIcao) {
        onAutoSelectIcao(targetIcao);
      } else {
        await checkCloudOnnxModel();
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Gagal mengunggah model .onnx ke Supabase Storage.";
      setModelUploadFeedback({
        type: "error",
        text: `Error Upload Model: ${msg}`,
      });
    } finally {
      setIsUploadingModel(false);
    }
  };

  // Jalankan Inferensi sesuai Modul Aktif
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
    resetAllResults();

    try {
      const fetchLimit = selectedModel === "ANALOG_FORECASTING" ? 600 : 12;

      const { data, error } = await supabase
        .from("metar_observations")
        .select(
          "icao_code, obs_time, raw_metar, wind_dir, is_vrb, wind_speed, wind_gust, visibility_m, temp_c, dewpoint_c, dewpoint_spread, qnh_hpa, weather_phenomena, has_ts, has_cb, lowest_ceiling_ft, flight_category",
        )
        .eq("icao_code", selectedIcao)
        .order("obs_time", { ascending: false })
        .limit(fetchLimit);

      if (error) throw new Error(error.message);
      const recordsAsc = ((data || []) as AdvancedMetarRecord[]).reverse();
      const urlArg = cloudModelUrl || undefined;

      switch (selectedModel) {
        case "TS_CB_PREDICTION":
          setTsCbResult(
            await runTsCbPrediction(
              selectedIcao,
              recordsAsc as MetarDbRecord[],
              urlArg,
            ),
          );
          break;
        case "VISIBILITY_NOWCAST":
          setVisResult(
            await runVisibilityPrediction(
              selectedIcao,
              recordsAsc as VisibilityMetarRecord[],
              urlArg,
            ),
          );
          break;
        case "FLIGHT_CATEGORY_TFT":
          setFcatResult(
            await runFlightCategoryPrediction(
              selectedIcao,
              recordsAsc as FlightCatMetarRecord[],
              urlArg,
            ),
          );
          break;
        case "WIND_SHEAR_BILSTM":
          setWshearResult(
            await runWindShearPrediction(
              selectedIcao,
              recordsAsc as WindShearMetarRecord[],
              urlArg,
            ),
          );
          break;
        case "WEATHER_CLUSTERING":
          setClusterResult(
            await runWeatherClustering(selectedIcao, recordsAsc, urlArg),
          );
          break;
        case "ANALOG_FORECASTING":
          setAnalogResult(
            await runAnalogForecasting(selectedIcao, recordsAsc, urlArg),
          );
          break;
        case "ANOMALY_QC":
          setQcResult(
            await runAnomalyQcCheck(selectedIcao, recordsAsc, urlArg),
          );
          break;
        case "WEATHER_PERSISTENCE":
          setClearingResult(
            await runClearingTimePrediction(selectedIcao, recordsAsc, urlArg),
          );
          break;
      }
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

  const expectedFileName =
    selectedIcao === "ALL"
      ? `${activeModelMeta.filePrefix}_<icao>.onnx`
      : `${activeModelMeta.filePrefix}_${selectedIcao.toLowerCase()}.onnx`;

  const getFlightCatBadgeStyle = (cat: string) => {
    switch (cat) {
      case "LIFR":
        return "bg-fuchsia-700 text-white";
      case "IFR":
        return "bg-rose-600 text-white";
      case "MVFR":
        return "bg-amber-500 text-white";
      default:
        return "bg-emerald-600 text-white";
    }
  };

  return (
    <div className="space-y-6">
      {/* GRID 8 MODUL ML / DL (4x2 SIMETRIS) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BrainCircuit size={20} className="text-[#b84a39]" />
            <h3 className="text-sm md:text-base font-extrabold text-slate-800">
              Pilih Modul Model Machine Learning / Deep Learning (8 Modul Aktif)
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
                      {model.badge}
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

      {/* WORKSPACE MODEL AKTIF */}
      <section className="bg-white/95 border border-slate-200 rounded-2xl p-5 md:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-xl bg-[#b84a39]/10 text-[#b84a39]">
              <ActiveModelIcon size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base md:text-lg font-extrabold text-slate-800">
                  {activeModelMeta.title}
                </h4>
                <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-slate-800 text-white">
                  {activeModelMeta.algo}
                </span>
              </div>
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

        <div className="mt-5 space-y-4">
          {/* PANEL MODEL REGISTRY DINAMIS */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileCode2 size={16} className="text-[#b84a39]" />
                  <span className="text-xs font-extrabold text-slate-800">
                    Model Registry (Cloud Storage) — {expectedFileName}
                  </span>

                  {selectedIcao !== "ALL" && !isCheckingModel && (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        cloudModelUrl
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {cloudModelUrl
                        ? "● Model Terpasang di Cloud"
                        : "○ Belum Diunggah"}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Latih model via notebook{" "}
                  <a
                    href={COLAB_TRAINING_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-[#b84a39] underline hover:text-slate-900"
                  >
                    Google Colab METAF_AI
                  </a>
                  , lalu unggah file{" "}
                  <code className="font-mono">{expectedFileName}</code> di sini.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".onnx"
                  onChange={handleUploadOnnxFile}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingModel || dbStatus !== "CONNECTED"}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  <UploadCloud size={15} className="text-[#b84a39]" />
                  {isUploadingModel
                    ? "Mengunggah .onnx..."
                    : "Upload File .onnx"}
                </button>

                <button
                  onClick={handleRunInference}
                  disabled={isPredicting || dbStatus !== "CONNECTED"}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900 hover:bg-[#b84a39] disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
                >
                  <Play size={15} />
                  {isPredicting ? "Menghitung..." : "Jalankan Prediksi AI"}
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

          {predictionError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{predictionError}</span>
            </div>
          )}

          {/* 1. HASIL THUNDERSTORM / CB */}
          {tsCbResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Activity size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Prediksi TS / CB 1–3 Jam ke Depan ({tsCbResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {tsCbResult.latestRawMetar}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-3xl font-black text-slate-900">
                      {tsCbResult.probabilityPercent}%
                    </div>
                    <div className="text-[11px] font-bold text-slate-500">
                      Probabilitas TS / CB
                    </div>
                  </div>
                  <span
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold ${
                      tsCbResult.riskLevel === "TINGGI"
                        ? "bg-rose-600 text-white"
                        : tsCbResult.riskLevel === "SEDANG"
                          ? "bg-amber-500 text-white"
                          : "bg-emerald-600 text-white"
                    }`}
                  >
                    RISIKO {tsCbResult.riskLevel}
                  </span>
                </div>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {tsCbResult.summary}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Suhu Udara
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {tsCbResult.keyIndicators.tempC}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    T - Td Spread
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {tsCbResult.keyIndicators.dewpointSpread}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    QNH Terkini
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {tsCbResult.keyIndicators.qnhHpa} hPa
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Tren QNH (1 Jam)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {tsCbResult.keyIndicators.qnhDiff1h > 0 ? "+" : ""}
                    {tsCbResult.keyIndicators.qnhDiff1h} hPa
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Kecepatan Angin
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {tsCbResult.keyIndicators.windSpeed} kt
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. HASIL NOWCASTING VISIBILITAS */}
          {visResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Eye size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Prediksi Visibilitas Min 1–3 Jam ({visResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {visResult.latestRawMetar}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-3xl font-black text-slate-900">
                      {visResult.predictedMinVisM.toLocaleString("id-ID")} m
                    </div>
                    <div className="text-[11px] font-bold text-slate-500">
                      Estimasi Visibilitas Min
                    </div>
                  </div>
                  <span
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold ${
                      visResult.statusLevel === "POOR VIS (<1.5 KM)"
                        ? "bg-rose-600 text-white"
                        : visResult.statusLevel === "WASPADA (1.5–5 KM)"
                          ? "bg-amber-500 text-white"
                          : "bg-emerald-600 text-white"
                    }`}
                  >
                    {visResult.statusLevel}
                  </span>
                </div>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {visResult.summary}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Visibilitas Terkini
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {visResult.indicators.currentVisM.toLocaleString("id-ID")} m
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Tren Vis (1 Jam)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {visResult.indicators.visDiff1h > 0 ? "+" : ""}
                    {visResult.indicators.visDiff1h.toLocaleString("id-ID")} m
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    T - Td Spread
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {visResult.indicators.dewpointSpread}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Tren Spread (1 Jam)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {visResult.indicators.spreadDiff1h > 0 ? "+" : ""}
                    {visResult.indicators.spreadDiff1h}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Kecepatan Angin
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {visResult.indicators.windSpeed} kt
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. HASIL FLIGHT CATEGORY & CEILING */}
          {fcatResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Plane size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Prediksi Flight Category 1–3 Jam ({fcatResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {fcatResult.latestRawMetar}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-900">
                      {fcatResult.confidencePercent}%
                    </div>
                    <div className="text-[11px] font-bold text-slate-500">
                      Keyakinan Model
                    </div>
                  </div>
                  <span
                    className={`px-4 py-2 rounded-xl text-sm font-black tracking-wide ${getFlightCatBadgeStyle(
                      fcatResult.predictedWorstCategory,
                    )}`}
                  >
                    {fcatResult.predictedWorstCategory}
                  </span>
                </div>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {fcatResult.summary}
              </p>
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
                      {fcatResult.classProbabilities[cat]}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. HASIL WIND SHEAR & PERGESERAN ANGIN */}
          {wshearResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Wind size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Prediksi Wind Shift / Gust 1–3 Jam ({wshearResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {wshearResult.latestRawMetar}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-3xl font-black text-slate-900">
                      {wshearResult.probabilityPercent}%
                    </div>
                    <div className="text-[11px] font-bold text-slate-500">
                      Probabilitas Gust / Shift
                    </div>
                  </div>
                  <span
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold ${
                      wshearResult.riskLevel === "TINGGI"
                        ? "bg-rose-600 text-white"
                        : wshearResult.riskLevel === "SEDANG"
                          ? "bg-amber-500 text-white"
                          : "bg-emerald-600 text-white"
                    }`}
                  >
                    RISIKO {wshearResult.riskLevel}
                  </span>
                </div>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {wshearResult.summary}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Arah &amp; Kec. Angin
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {wshearResult.indicators.windDirLabel} /{" "}
                    {wshearResult.indicators.windSpeed} kt
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Wind Gust
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {wshearResult.indicators.windGust !== null
                      ? `${wshearResult.indicators.windGust} kt`
                      : "Tidak Ada"}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Pergeseran (1 Jam)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {wshearResult.indicators.dirShift1h}°
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Tren Kec. (1 Jam)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {wshearResult.indicators.spdDiff1h > 0 ? "+" : ""}
                    {wshearResult.indicators.spdDiff1h} kt
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. HASIL KLASTERISASI REZIM CUACA */}
          {clusterResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Layers size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Identifikasi Rezim Cuaca ({clusterResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {clusterResult.latestRawMetar}
                  </p>
                </div>
                <span className="px-4 py-2 rounded-xl text-xs font-black bg-slate-800 text-amber-200">
                  {clusterResult.regimeName}
                </span>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {clusterResult.description}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Suhu Udara
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clusterResult.indicators.tempC}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    T - Td Spread
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clusterResult.indicators.dewpointSpread}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Angin Permukaan
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clusterResult.indicators.windSpeed} kt
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Tekanan QNH
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clusterResult.indicators.qnhHpa} hPa
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. HASIL ANALOG FORECASTING */}
          {analogResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <History size={18} className="text-[#b84a39]" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    Top-5 Pola Historis Paling Mirip ({analogResult.icao})
                  </span>
                </div>
                <p className="text-xs md:text-sm font-medium text-slate-700 mt-2">
                  {analogResult.summary}
                </p>
              </div>
              <div className="space-y-2">
                {analogResult.matches.map((m, idx) => (
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
            </div>
          )}

          {/* 7. HASIL DETEKSI ANOMALI SENSOR & AUDIT QC */}
          {qcResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Audit Quality Control &amp; Sensor ({qcResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {qcResult.latestRawMetar}
                  </p>
                </div>
                <span
                  className={`px-4 py-2 rounded-xl text-xs font-black ${
                    qcResult.isAnomaly
                      ? "bg-rose-600 text-white"
                      : "bg-emerald-600 text-white"
                  }`}
                >
                  {qcResult.statusLabel}
                </span>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {qcResult.summary}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Delta Suhu (30m)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {qcResult.indicators.tempJump30m}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Delta QNH (30m)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {qcResult.indicators.qnhJump30m} hPa
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Delta Angin (30m)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {qcResult.indicators.windJump30m} kt
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    T - Td Spread
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {qcResult.indicators.dewpointSpread}°C
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 8. HASIL PREDIKSI DURASI & WAKTU REDA CUACA */}
          {clearingResult && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Timer size={18} className="text-[#b84a39]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      Estimasi Waktu Reda Menuju VFR ({clearingResult.icao})
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-1.5 bg-slate-100 px-2.5 py-1 rounded-lg inline-block">
                    Basis Data: {clearingResult.latestRawMetar}
                  </p>
                </div>
                <span
                  className={`px-4 py-2 rounded-xl text-xs font-black ${
                    clearingResult.isAdverseNow
                      ? "bg-amber-500 text-white"
                      : "bg-emerald-600 text-white"
                  }`}
                >
                  {clearingResult.statusLabel}
                </span>
              </div>
              <p className="text-xs md:text-sm font-medium text-slate-700 leading-relaxed">
                {clearingResult.summary}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Flight Cat Saat Ini
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clearingResult.indicators.currentCategory}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Visibilitas Terkini
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clearingResult.indicators.currentVisM.toLocaleString(
                      "id-ID",
                    )}{" "}
                    m
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    T - Td Spread
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clearingResult.indicators.dewpointSpread}°C
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400">
                    Tren QNH (1 Jam)
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">
                    {clearingResult.indicators.qnhDiff1h > 0 ? "+" : ""}
                    {clearingResult.indicators.qnhDiff1h} hPa
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
