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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  runHybridModuleInference,
  EngineMode,
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
    algo: "XGBoost + PyTorch LSTM Regressor",
    filePrefix: "vis_nowcast",
    desc: "Memprediksi visibilitas minimum (meter) serta peluang kabut/asap 1–3 jam ke depan dari tren T, Td, angin, dan QNH.",
    icon: Eye,
  },
  {
    key: "TS_CB_PREDICTION",
    title: "Prediksi Thunderstorm / CB Lokal",
    algo: "XGBoost + PyTorch LSTM Classifier",
    filePrefix: "ts_cb",
    desc: "Mendeteksi peluang pertumbuhan awan CB dan kejadian TS/TSRA dalam 30–180 menit ke depan berdasarkan prekursor permukaan.",
    icon: CloudLightning,
  },
  {
    key: "FLIGHT_CATEGORY_TFT",
    title: "Prediksi Flight Category & Ceiling",
    algo: "XGBoost + PyTorch LSTM Multi-Class",
    filePrefix: "flight_cat",
    desc: "Klasifikasi probabilistik kategori penerbangan (VFR, MVFR, IFR, LIFR) dan ketinggian dasar awan rendah 1–3 jam ke depan.",
    icon: Plane,
  },
  {
    key: "WIND_SHEAR_BILSTM",
    title: "Prediksi Wind Shear & Pergeseran Angin",
    algo: "XGBoost + Bidirectional LSTM",
    filePrefix: "wind_shear",
    desc: "Memprediksi lonjakan gust dan perubahan arah angin mendadak (≥45°) di area approach dan take-off bandara.",
    icon: Wind,
  },
  {
    key: "WEATHER_CLUSTERING",
    title: "Klasterisasi Rezim Cuaca Bandara",
    algo: "K-Means + LSTM Sequence Clustering",
    filePrefix: "wx_cluster",
    desc: "Mengelompokkan observasi METAR ke dalam 4 rezim cuaca khas stasiun (angin laut, monsun, pemanasan terik, konvektif).",
    icon: Layers,
  },
  {
    key: "ANALOG_FORECASTING",
    title: "Analog Forecasting (Pola Historis)",
    algo: "PCA + LSTM Trajectory Encoder",
    filePrefix: "analog_enc",
    desc: "Mencari 5 kejadian historis di arsip Supabase yang pola perubahan METAR 3 jam terakhirnya paling mirip dengan hari ini.",
    icon: History,
  },
  {
    key: "ANOMALY_QC",
    title: "Deteksi Anomali Sensor & Audit QC",
    algo: "PCA Z-Score + LSTM Autoencoder",
    filePrefix: "anomaly_qc",
    desc: "Mendeteksi anomali pembacaan sensor AWOS (lompatan mendadak) atau kombinasi parameter cuaca yang menyimpang secara klimatologis.",
    icon: ShieldAlert,
  },
  {
    key: "WEATHER_PERSISTENCE",
    title: "Prediksi Durasi & Waktu Reda Cuaca",
    algo: "XGBoost + LSTM Clearing Regressor",
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
  const [engineMode, setEngineMode] = useState<EngineMode>("ENSEMBLE");

  const activeModelMeta =
    ML_MODELS.find((m) => m.key === selectedModel) || ML_MODELS[0];
  const ActiveModelIcon = activeModelMeta.icon;

  // State Cloud Model URLs (XGBoost & LSTM)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [xgbCloudUrl, setXgbCloudUrl] = useState<string | null>(null);
  const [lstmCloudUrl, setLstmCloudUrl] = useState<string | null>(null);
  const [isCheckingModel, setIsCheckingModel] = useState(false);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [modelUploadFeedback, setModelUploadFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // State Inferensi Hybrid
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [result, setResult] = useState<HybridPredictionOutput | null>(null);

  // Verifikasi langsung keberadaan file publik xgb_* dan lstm_* via HEAD request
  const checkCloudModels = useCallback(async () => {
    if (!supabase || selectedIcao === "ALL") {
      setXgbCloudUrl(null);
      setLstmCloudUrl(null);
      return;
    }

    setIsCheckingModel(true);
    const pfx = selectedIcao.toLowerCase();
    const ts = Date.now();

    const resolvePublicFile = async (candidates: string[]) => {
      for (const fileName of candidates) {
        const { data } = supabase!.storage
          .from("ml_models")
          .getPublicUrl(fileName);
        const urlWithCacheBust = `${data.publicUrl}?t=${ts}`;
        try {
          const res = await fetch(urlWithCacheBust, { method: "HEAD" });
          if (res.ok) return urlWithCacheBust;
        } catch {
          // lanjut cek kandidat berikutnya
        }
      }
      return null;
    };

    try {
      const [foundXgb, foundLstm] = await Promise.all([
        resolvePublicFile([
          `xgb_${activeModelMeta.filePrefix}_${pfx}.onnx`,
          `${activeModelMeta.filePrefix}_${pfx}.onnx`,
        ]),
        resolvePublicFile([`lstm_${activeModelMeta.filePrefix}_${pfx}.onnx`]),
      ]);

      setXgbCloudUrl(foundXgb);
      setLstmCloudUrl(foundLstm);
    } finally {
      setIsCheckingModel(false);
    }
  }, [selectedIcao, activeModelMeta]);

  useEffect(() => {
    checkCloudModels();
    setResult(null);
    setPredictionError(null);
    setModelUploadFeedback(null);
  }, [checkCloudModels, engineMode]);

  // Batch Upload file .onnx sekaligus ke Supabase Storage
  const handleBatchUploadOnnx = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !supabase) return;
    e.target.value = "";

    const onnxFiles = files.filter((f) =>
      f.name.toLowerCase().endsWith(".onnx"),
    );
    if (onnxFiles.length === 0) {
      setModelUploadFeedback({
        type: "error",
        text: "Tidak ada file .onnx yang dipilih.",
      });
      return;
    }

    setIsUploadingModel(true);
    setModelUploadFeedback(null);

    let uploadedCount = 0;
    let detectedIcao: string | null = null;

    try {
      for (const file of onnxFiles) {
        const lower = file.name.toLowerCase();
        const matchPrefixed = lower.match(
          /^(xgb|lstm)_[a-z_]+_([a-z]{4})\.onnx$/,
        );
        let storageName = lower;

        if (matchPrefixed) {
          detectedIcao = matchPrefixed[2].toUpperCase();
        } else {
          const matchIcao = lower.match(/_([a-z]{4})\.onnx$/);
          const targetIcao = matchIcao
            ? matchIcao[1].toUpperCase()
            : selectedIcao !== "ALL"
              ? selectedIcao
              : null;

          if (!targetIcao) continue;
          detectedIcao = targetIcao;
          const engPrefix = engineMode === "LSTM" ? "lstm" : "xgb";
          storageName = `${engPrefix}_${
            activeModelMeta.filePrefix
          }_${targetIcao.toLowerCase()}.onnx`;
        }

        const { error } = await supabase.storage
          .from("ml_models")
          .upload(storageName, file, {
            upsert: true,
            contentType: "application/octet-stream",
          });

        if (error) throw error;
        uploadedCount++;
      }

      if (uploadedCount === 0) {
        setModelUploadFeedback({
          type: "error",
          text: "Pilih stasiun spesifik terlebih dahulu atau pastikan nama file berformat xgb_<modul>_<icao>.onnx / lstm_<modul>_<icao>.onnx.",
        });
      } else {
        setModelUploadFeedback({
          type: "success",
          text: `Berhasil mengunggah ${uploadedCount} file model .onnx ke Cloud Registry!`,
        });
        if (detectedIcao && selectedIcao !== detectedIcao && onAutoSelectIcao) {
          onAutoSelectIcao(detectedIcao);
        } else {
          await checkCloudModels();
        }
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Gagal mengunggah file .onnx.";
      setModelUploadFeedback({
        type: "error",
        text: `Error Upload: ${msg}`,
      });
    } finally {
      setIsUploadingModel(false);
    }
  };

  // Eksekusi Inferensi sesuai Engine Pilihan (XGBoost / LSTM / Ensemble)
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

      const recordsAsc = ((data || []) as HybridMetarRecord[]).reverse();
      const output = await runHybridModuleInference({
        moduleKey: selectedModel,
        filePrefix: activeModelMeta.filePrefix,
        icao: selectedIcao,
        engine: engineMode,
        recordsAsc,
        xgbUrl: xgbCloudUrl,
        lstmUrl: lstmCloudUrl,
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
                      Hybrid ONNX
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

      {/* 2. WORKSPACE MODEL AKTIF + PEMILIH ENGINE (XGBOOST / LSTM / ENSEMBLE) */}
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

        {/* PILIHAN ENGINE ARSITEKTUR (XGBOOST / PYTORCH LSTM / ENSEMBLE) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-100/80 border border-slate-200">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <Cpu size={16} className="text-[#b84a39]" />
            <span>Pilih Arsitektur Mesin Inferensi:</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-xs">
            {(
              [
                { key: "XGBOOST", label: "XGBoost (Tabular)" },
                { key: "LSTM", label: "PyTorch LSTM" },
                { key: "ENSEMBLE", label: "Ensemble (XGB + LSTM)" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setEngineMode(item.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                  engineMode === item.key
                    ? "bg-[#b84a39] text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* PANEL MODEL REGISTRY (STATUS KEDUA FILE .ONNX & MULTI-UPLOAD) */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <FileCode2 size={16} className="text-[#b84a39]" />
                <span className="text-xs font-extrabold text-slate-800">
                  Cloud Model Registry ({selectedIcao})
                </span>
              </div>

              {selectedIcao !== "ALL" && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-bold ${
                      isCheckingModel
                        ? "bg-slate-200 text-slate-600"
                        : xgbCloudUrl
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {isCheckingModel ? "…" : xgbCloudUrl ? "●" : "○"} xgb_
                    {activeModelMeta.filePrefix}_{pfx}.onnx
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-bold ${
                      isCheckingModel
                        ? "bg-slate-200 text-slate-600"
                        : lstmCloudUrl
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {isCheckingModel ? "…" : lstmCloudUrl ? "●" : "○"} lstm_
                    {activeModelMeta.filePrefix}_{pfx}.onnx
                  </span>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Mendukung <strong>Batch Upload</strong>: kamu bisa memilih semua
                file <code className="font-mono">.onnx</code> hasil ekstrak ZIP
                Colab sekaligus dalam satu kali upload.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".onnx"
                multiple
                onChange={handleBatchUploadOnnx}
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
                  : "Upload File .onnx (Batch)"}
              </button>

              <button
                onClick={handleRunInference}
                disabled={isPredicting || dbStatus !== "CONNECTED"}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900 hover:bg-[#b84a39] disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
              >
                <Play size={15} />
                {isPredicting
                  ? "Menghitung..."
                  : `Jalankan ${
                      engineMode === "ENSEMBLE"
                        ? "Ensemble"
                        : engineMode === "LSTM"
                          ? "PyTorch LSTM"
                          : "XGBoost"
                    }`}
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

        {/* PESAN ERROR INFERENSI */}
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
                    Hasil Analisis {result.icao} • Engine: {result.engineUsed}
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

            {/* PERBANDINGAN ENGINE JIKA MODE ENSEMBLE DIPILIH */}
            {result.engineComparison && (
              <div className="grid grid-cols-3 gap-2.5 p-3 rounded-xl bg-slate-800 text-white">
                <div className="text-center border-r border-slate-700">
                  <div className="text-[10px] font-bold text-slate-400">
                    XGBoost (Tabular)
                  </div>
                  <div className="text-sm font-extrabold text-amber-200 mt-0.5">
                    {result.engineComparison.xgbValue}
                  </div>
                </div>
                <div className="text-center border-r border-slate-700">
                  <div className="text-[10px] font-bold text-slate-400">
                    PyTorch LSTM (Seq)
                  </div>
                  <div className="text-sm font-extrabold text-sky-300 mt-0.5">
                    {result.engineComparison.lstmValue}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-bold text-slate-400">
                    Gabungan Ensemble
                  </div>
                  <div className="text-sm font-black text-emerald-300 mt-0.5">
                    {result.engineComparison.ensembleValue}
                  </div>
                </div>
              </div>
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
      </section>
    </div>
  );
}
