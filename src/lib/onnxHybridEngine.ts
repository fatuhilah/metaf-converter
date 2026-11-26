import * as ort from "onnxruntime-web";

export type EngineKey = "XGBOOST" | "RF" | "LSTM" | "CNN";

export interface HybridMetarRecord {
  icao_code: string;
  obs_time: string;
  raw_metar: string;
  wind_dir: number | null;
  is_vrb: boolean | null;
  wind_speed: number | null;
  wind_gust: number | null;
  visibility_m: number | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  dewpoint_spread: number | null;
  qnh_hpa: number | null;
  weather_phenomena?: string[] | null;
  has_ts: boolean | null;
  has_cb: boolean | null;
  lowest_ceiling_ft?: number | null;
  flight_category?: string | null;
}

export interface ChartSeriesPoint {
  timeLabel: string;
  observed: number | null;
  xgbPred: number | null;
  rfPred: number | null;
  lstmPred: number | null;
  cnnPred: number | null;
  ensemblePred: number | null;
}

export interface HybridPredictionOutput {
  moduleKey: string;
  icao: string;
  activeEngines: EngineKey[];
  combinationLabel: string;
  latestRawMetar: string;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  badgeText: string;
  badgeVariant: "emerald" | "amber" | "rose" | "fuchsia" | "slate";
  summary: string;
  engineBreakdown: {
    engine: EngineKey;
    label: string;
    valueDisplay: string;
  }[];
  chartData?: {
    title: string;
    unit: string;
    yMin: number;
    yMax: number;
    points: ChartSeriesPoint[];
  };
  classProbabilities?: {
    VFR: number;
    MVFR: number;
    IFR: number;
    LIFR: number;
  };
  analogMatches?: {
    obsTime: string;
    rawMetar: string;
    similarityPercent: number;
    next3hOutcome: string;
  }[];
  indicators: { label: string; value: string }[];
}

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
ort.env.wasm.numThreads = 1;

const ENGINE_LABELS: Record<EngineKey, string> = {
  XGBOOST: "XGBoost (Boosting)",
  RF: "Random Forest (Bagging)",
  LSTM: "PyTorch LSTM (Seq)",
  CNN: "1D-CNN (Conv)",
};

const CAT_TO_IDX: Record<string, number> = {
  VFR: 0,
  MVFR: 1,
  IFR: 2,
  LIFR: 3,
};
const IDX_TO_CAT = ["VFR", "MVFR", "IFR", "LIFR"] as const;

function calcAngularDiff(deg1: number, deg2: number): number {
  const diff = Math.abs(deg1 - deg2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function getDayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / (1000 * 60 * 60 * 24));
}

function isSpeciReport(rawMetar: string): boolean {
  return (rawMetar || "").trim().toUpperCase().startsWith("SPECI");
}

// Rumus Magnus-Tetens WMO untuk menghitung Relative Humidity (%) dari T dan Td (°C)
function calcRelativeHumidity(tempC: number, dewC: number): number {
  const es = Math.exp((17.625 * tempC) / (243.04 + tempC));
  const e = Math.exp((17.625 * dewC) / (243.04 + dewC));
  const rh = 100.0 * (e / (es === 0 ? 1e-6 : es));
  return Math.min(100.0, Math.max(5.0, rh));
}

// Pencarian observasi berdasarkan selisih menit aktual (tahan sisipan SPECI di antara jam rutin)
function findRecordNearMinutesAgo(
  recordsAsc: HybridMetarRecord[],
  endIdx: number,
  minutesAgo: number,
): HybridMetarRecord {
  const anchorMs = new Date(recordsAsc[endIdx].obs_time).getTime();
  const targetMs = anchorMs - minutesAgo * 60_000;

  let bestIdx = Math.max(0, endIdx - Math.max(1, Math.round(minutesAgo / 30)));
  let bestDiff = Infinity;

  // Telusuri mundur hingga maksimal 16 observasi ke belakang
  const minScan = Math.max(0, endIdx - 16);
  for (let i = endIdx; i >= minScan; i--) {
    const tMs = new Date(recordsAsc[i].obs_time).getTime();
    if (Number.isNaN(tMs)) continue;
    const diff = Math.abs(tMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
    if (tMs < targetMs && diff > bestDiff) break;
  }

  return recordsAsc[bestIdx];
}

// Membentuk 6 langkah sekuensial seragam setiap 30 menit (t-150m .. t0) meski disisipi SPECI
function buildTimeAlignedSequence6(
  recordsAsc: HybridMetarRecord[],
  endIdx: number,
): HybridMetarRecord[] {
  const stepOffsetsMin = [150, 120, 90, 60, 30, 0];
  return stepOffsetsMin.map((minAgo) =>
    minAgo === 0
      ? recordsAsc[endIdx]
      : findRecordNearMinutesAgo(recordsAsc, endIdx, minAgo),
  );
}

// 17 fitur dasar (urutan persis sama dengan BASE_FEATURES di Google Colab)
function extractBase17Features(r: HybridMetarRecord): number[] {
  const obsDate = new Date(r.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const doyFloat = getDayOfYear(obsDate);

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const doySin = Math.sin((2 * Math.PI * doyFloat) / 365.25);
  const doyCos = Math.cos((2 * Math.PI * doyFloat) / 365.25);

  let windU = 0;
  let windV = 0;
  if (!r.is_vrb && r.wind_dir !== null && r.wind_speed !== null) {
    const rad = (r.wind_dir * Math.PI) / 180.0;
    windU = -r.wind_speed * Math.sin(rad);
    windV = -r.wind_speed * Math.cos(rad);
  }

  const windSpeed = r.wind_speed ?? 0;
  const windGust = r.wind_gust ?? windSpeed;
  const visM = r.visibility_m ?? 9999;
  const ceilFt = r.lowest_ceiling_ft ?? 10000;
  const tempC = Number(r.temp_c ?? 28);
  const dewC = Number(r.dewpoint_c ?? 24);
  const spread =
    r.dewpoint_spread !== null
      ? Number(r.dewpoint_spread)
      : Number((tempC - dewC).toFixed(1));
  const relHum = calcRelativeHumidity(tempC, dewC);
  const fsiIndex = 4.0 * spread + windSpeed;
  const qnhHpa = Number(r.qnh_hpa ?? 1010);
  const hasTsCb = r.has_ts || r.has_cb ? 1.0 : 0.0;

  return [
    hourSin,
    hourCos,
    doySin,
    doyCos,
    windU,
    windV,
    windSpeed,
    windGust,
    visM,
    ceilFt,
    tempC,
    dewC,
    spread,
    relHum,
    fsiIndex,
    qnhHpa,
    hasTsCb,
  ];
}

// Susun Tensor [1, 27] berbasis stempel waktu aktual (tahan sisipan SPECI)
function buildTabular27TensorAt(
  recordsAsc: HybridMetarRecord[],
  endIdx: number,
): ort.Tensor {
  const curr = recordsAsc[endIdx];
  const prev1h = findRecordNearMinutesAgo(recordsAsc, endIdx, 60);
  const prev3h = findRecordNearMinutesAgo(recordsAsc, endIdx, 180);

  const base17 = extractBase17Features(curr);
  const currTemp = base17[10];
  const currSpread = base17[12];
  const currRh = base17[13];
  const currQnh = base17[15];
  const currVis = base17[8];
  const currSpd = base17[6];

  const p1Temp = Number(prev1h.temp_c ?? currTemp);
  const p3Temp = Number(prev3h.temp_c ?? currTemp);
  const p1Dew = Number(prev1h.dewpoint_c ?? base17[11]);
  const p1Spread =
    prev1h.dewpoint_spread !== null
      ? Number(prev1h.dewpoint_spread)
      : p1Temp - p1Dew;
  const p1Rh = calcRelativeHumidity(p1Temp, p1Dew);
  const p1Qnh = Number(prev1h.qnh_hpa ?? currQnh);
  const p3Qnh = Number(prev3h.qnh_hpa ?? currQnh);
  const p1Vis = prev1h.visibility_m ?? currVis;
  const p1Spd = prev1h.wind_speed ?? currSpd;

  const dirShift1h = calcAngularDiff(
    curr.wind_dir ?? 0,
    prev1h.wind_dir ?? curr.wind_dir ?? 0,
  );
  const catIdx = CAT_TO_IDX[(curr.flight_category || "VFR").toUpperCase()] ?? 0;

  const full27 = Float32Array.from([
    ...base17,
    currTemp - p1Temp,
    currTemp - p3Temp,
    currSpread - p1Spread,
    currRh - p1Rh,
    currQnh - p1Qnh,
    currQnh - p3Qnh,
    currVis - p1Vis,
    currSpd - p1Spd,
    dirShift1h,
    catIdx,
  ]);

  return new ort.Tensor("float32", full27, [1, 27]);
}

// Susun Tensor Sekuensial [1, 6, 17] dengan grid 30-menit selaras waktu (SPECI-proof)
function buildSequence6x17TensorAt(
  recordsAsc: HybridMetarRecord[],
  endIdx: number,
): ort.Tensor {
  const aligned6 = buildTimeAlignedSequence6(recordsAsc, endIdx);
  const flat = new Float32Array(6 * 17);
  for (let t = 0; t < 6; t++) {
    const row17 = extractBase17Features(aligned6[t]);
    flat.set(row17, t * 17);
  }
  return new ort.Tensor("float32", flat, [1, 6, 17]);
}

async function fetchSession(
  url: string,
  label: string,
): Promise<ort.InferenceSession> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `File model ${label} belum tersedia di Cloud Registry (HTTP ${res.status}). Silakan upload terlebih dahulu.`,
    );
  }
  const buf = await res.arrayBuffer();
  return await ort.InferenceSession.create(buf, {
    executionProviders: ["wasm"],
  });
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    nA = 0,
    nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d === 0 ? 0 : dot / d;
}

function formatCombinationTitle(engines: EngineKey[]): string {
  if (engines.length === 1) return `Single Model (${engines[0]})`;
  if (engines.length === 4) return "Grand 4-Model Super Ensemble";
  return `${engines.length}-Model Ensemble (${engines.join(" + ")})`;
}

export async function runMultiEngineInference(params: {
  moduleKey: string;
  filePrefix: string;
  icao: string;
  activeEngines: EngineKey[];
  recordsAsc: HybridMetarRecord[];
  modelUrls: Record<EngineKey, string | null>;
}): Promise<HybridPredictionOutput> {
  const { moduleKey, filePrefix, icao, activeEngines, recordsAsc, modelUrls } =
    params;

  if (activeEngines.length === 0) {
    throw new Error("Pilih minimal 1 arsitektur model untuk dijalankan.");
  }

  if (recordsAsc.length < 7) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 7 observasi terakhir untuk inferensi.`,
    );
  }

  const pfx = icao.toLowerCase();
  const comboLabel = formatCombinationTitle(activeEngines);

  const endIdx = recordsAsc.length - 1;
  const curr = recordsAsc[endIdx];
  const prev1h = findRecordNearMinutesAgo(recordsAsc, endIdx, 60);
  const prevObs = recordsAsc[Math.max(0, endIdx - 1)];

  const tabTensor = buildTabular27TensorAt(recordsAsc, endIdx);
  const seqTensor = buildSequence6x17TensorAt(recordsAsc, endIdx);

  const isSpeciNow = isSpeciReport(curr.raw_metar);
  const currTemp = Number(curr.temp_c ?? 28);
  const currDew = Number(curr.dewpoint_c ?? 24);
  const currSpread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((currTemp - currDew).toFixed(1));
  const currRh = Number(calcRelativeHumidity(currTemp, currDew).toFixed(0));
  const currQnh = Number(curr.qnh_hpa ?? 1010);
  const qnhDiff1h = Number(
    (currQnh - Number(prev1h.qnh_hpa ?? currQnh)).toFixed(1),
  );
  const currVis = curr.visibility_m ?? 9999;
  const currSpd = curr.wind_speed ?? 0;
  const fsiVal = Number((4.0 * currSpread + currSpd).toFixed(1));

  const baseIndicators = [
    {
      label: "Tipe Laporan",
      value: isSpeciNow ? "SPECI (Special)" : "METAR (Rutin)",
    },
    { label: "Rel. Humidity (RH)", value: `${currRh}%` },
    { label: "Fog Stability (FSI)", value: `${fsiVal}` },
    {
      label: "QNH (Tren 1j)",
      value: `${currQnh} hPa (${qnhDiff1h >= 0 ? "+" : ""}${qnhDiff1h})`,
    },
    { label: "Angin / Vis", value: `${currSpd} kt / ${currVis}m` },
  ];

  const speciPrefixNote = isSpeciNow
    ? "[Sandi SPECI Terdeteksi — Perubahan Cuaca Mendadak] "
    : "";

  const runEngineRaw = async (eng: EngineKey) => {
    const filePrefixMap: Record<EngineKey, string> = {
      XGBOOST: "xgb",
      RF: "rf",
      LSTM: "lstm",
      CNN: "cnn",
    };
    const fileName = `${filePrefixMap[eng]}_${filePrefix}_${pfx}.onnx`;
    const url = modelUrls[eng] || `/models/${fileName}`;
    const session = await fetchSession(url, fileName);
    const isSeq = eng === "LSTM" || eng === "CNN";
    const outputs = await session.run(
      isSeq ? { seq_input: seqTensor } : { float_input: tabTensor },
    );
    return { session, outputs };
  };

  const buildSeriesPoints = (
    extractor: (r: HybridMetarRecord) => number,
    preds: Partial<Record<EngineKey, number>>,
    ensVal: number | null,
  ): ChartSeriesPoint[] => {
    const recent = recordsAsc.slice(-10);
    const pts: ChartSeriesPoint[] = recent.map((r, idx) => {
      const d = new Date(r.obs_time);
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const val = extractor(r);
      const isLast = idx === recent.length - 1;
      const speciTag = isSpeciReport(r.raw_metar) ? "*" : "";
      return {
        timeLabel: `${hh}:${mm}Z${speciTag}`,
        observed: val,
        xgbPred: isLast && preds.XGBOOST !== undefined ? val : null,
        rfPred: isLast && preds.RF !== undefined ? val : null,
        lstmPred: isLast && preds.LSTM !== undefined ? val : null,
        cnnPred: isLast && preds.CNN !== undefined ? val : null,
        ensemblePred: isLast && ensVal !== null ? val : null,
      };
    });

    pts.push({
      timeLabel: "+1–3j",
      observed: null,
      xgbPred: preds.XGBOOST ?? null,
      rfPred: preds.RF ?? null,
      lstmPred: preds.LSTM ?? null,
      cnnPred: preds.CNN ?? null,
      ensemblePred: ensVal,
    });
    return pts;
  };

  // =======================================================================
  // 1. VISIBILITY NOWCASTING (Regression: meter)
  // =======================================================================
  if (moduleKey === "VISIBILITY_NOWCAST") {
    const vals: Partial<Record<EngineKey, number>> = {};
    const breakdown: HybridPredictionOutput["engineBreakdown"] = [];

    for (const eng of activeEngines) {
      const { session, outputs } = await runEngineRaw(eng);
      const raw = (outputs[session.outputNames[0]].data as Float32Array)[0];
      const v = Math.round(Math.min(9999, Math.max(100, raw)));
      vals[eng] = v;
      breakdown.push({
        engine: eng,
        label: ENGINE_LABELS[eng],
        valueDisplay: `${v.toLocaleString("id-ID")} m`,
      });
    }

    const numList = Object.values(vals) as number[];
    const finalVis = Math.round(
      numList.reduce((a, b) => a + b, 0) / numList.length,
    );

    const isPoor = finalVis < 1500;
    const isWarn = finalVis <= 5000;

    return {
      moduleKey,
      icao,
      activeEngines,
      combinationLabel: comboLabel,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Estimasi Visibilitas Min (1–3 Jam)",
      primaryMetricValue: `${finalVis.toLocaleString("id-ID")} m`,
      badgeText: isPoor
        ? "POOR VIS (<1.5 KM)"
        : isWarn
          ? "WASPADA (1.5–5 KM)"
          : "VFR (>5 KM)",
      badgeVariant: isPoor ? "rose" : isWarn ? "amber" : "emerald",
      summary:
        speciPrefixNote +
        (isPoor
          ? "Peringatan Jarak Pandang Rendah (IFR/LIFR): Berpotensi terjadi penurunan jarak pandang di bawah 1.500m akibat kabut, asap, atau hujan lebat."
          : isWarn
            ? "Waspada Marginal Visibility (MVFR): Terdeteksi potensi mist (BR), haze (HZ), atau hujan yang menurunkan jarak pandang ke 1.500–5.000m."
            : "Jarak pandang diprakirakan tetap kondusif (>5.000 meter) dalam 1–3 jam ke depan."),
      engineBreakdown: breakdown,
      chartData: {
        title: `Observed and Estimated Visibility — ${icao} (${comboLabel})`,
        unit: "m",
        yMin: 0,
        yMax: 10000,
        points: buildSeriesPoints(
          (r) => r.visibility_m ?? 9999,
          vals,
          activeEngines.length > 1 ? finalVis : null,
        ),
      },
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 2. THUNDERSTORM / CB & 4. WIND SHEAR (Binary Probability: %)
  // =======================================================================
  if (moduleKey === "TS_CB_PREDICTION" || moduleKey === "WIND_SHEAR_BILSTM") {
    const probs: Partial<Record<EngineKey, number>> = {};
    const breakdown: HybridPredictionOutput["engineBreakdown"] = [];

    for (const eng of activeEngines) {
      const { session, outputs } = await runEngineRaw(eng);
      let rawP = 0;
      if (eng === "XGBOOST" || eng === "RF") {
        const probName =
          session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
          session.outputNames[session.outputNames.length - 1];
        const arr = outputs[probName].data as Float32Array;
        rawP = arr.length >= 2 ? arr[1] : arr[0];
      } else {
        rawP = (outputs[session.outputNames[0]].data as Float32Array)[0];
      }
      const pct = Math.min(100, Math.max(0, Number((rawP * 100).toFixed(1))));
      probs[eng] = pct;
      breakdown.push({
        engine: eng,
        label: ENGINE_LABELS[eng],
        valueDisplay: `${pct}%`,
      });
    }

    const numList = Object.values(probs) as number[];
    const finalProb = Number(
      (numList.reduce((a, b) => a + b, 0) / numList.length).toFixed(1),
    );

    const isHigh = finalProb >= 65;
    const isMed = finalProb >= 35;
    const isTs = moduleKey === "TS_CB_PREDICTION";

    const chartProjMap: Partial<Record<EngineKey, number>> = {};
    for (const [k, v] of Object.entries(probs)) {
      chartProjMap[k as EngineKey] = isTs
        ? (v as number)
        : Math.round(((v as number) / 100) * 30);
    }

    return {
      moduleKey,
      icao,
      activeEngines,
      combinationLabel: comboLabel,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: isTs
        ? "Probabilitas TS / CB (1–3 Jam)"
        : "Probabilitas Gust / Wind Shift",
      primaryMetricValue: `${finalProb}%`,
      badgeText: isHigh
        ? "RISIKO TINGGI"
        : isMed
          ? "RISIKO SEDANG"
          : "RISIKO RENDAH",
      badgeVariant: isHigh ? "rose" : isMed ? "amber" : "emerald",
      summary:
        speciPrefixNote +
        (isTs
          ? isHigh
            ? "Peringatan Dini Konvektif: Indikator tren tekanan, angin permukaan, dan kelembapan menunjukkan potensi tinggi pertumbuhan CB / TS."
            : isMed
              ? "Waspada Pertumbuhan Awan Konvektif: Terdeteksi peningkatan ketidakstabilan lokal. Pantau perkembangan awan TCU/CB."
              : "Atmosfer permukaan relatif stabil. Peluang pertumbuhan awan CB/TS lokal dalam 1–3 jam ke depan rendah."
          : isHigh
            ? "Peringatan Pergeseran Angin / Gust: Terdeteksi dinamika vektor angin yang berpotensi memicu gust kencang atau pergeseran arah ≥45°."
            : isMed
              ? "Waspada Variasi Angin Permukaan: Berpotensi terjadi peningkatan kecepatan angin atau perubahan arah bertahap."
              : "Aliran angin permukaan diprakirakan relatif stabil tanpa lonjakan gust signifikan."),
      engineBreakdown: breakdown,
      chartData: {
        title: isTs
          ? `Observed TS/CB & Forecast Probability — ${icao}`
          : `Observed Wind Speed (kt) & Gust Risk — ${icao}`,
        unit: isTs ? "%" : "kt",
        yMin: 0,
        yMax: isTs ? 100 : 40,
        points: buildSeriesPoints(
          (r) =>
            isTs ? (r.has_ts || r.has_cb ? 100 : 0) : (r.wind_speed ?? 0),
          chartProjMap,
          activeEngines.length > 1
            ? isTs
              ? finalProb
              : Math.round((finalProb / 100) * 30)
            : null,
        ),
      },
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 3. FLIGHT CATEGORY & CEILING (Multi-Class 4 Kategori)
  // =======================================================================
  if (moduleKey === "FLIGHT_CATEGORY_TFT") {
    const perEngineProbs: Partial<Record<EngineKey, number[]>> = {};
    const breakdown: HybridPredictionOutput["engineBreakdown"] = [];

    for (const eng of activeEngines) {
      const { session, outputs } = await runEngineRaw(eng);
      let arr: number[] = [0, 0, 0, 0];
      if (eng === "XGBOOST" || eng === "RF") {
        const probName =
          session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
          session.outputNames[session.outputNames.length - 1];
        const raw = Array.from(outputs[probName].data as Float32Array);
        arr = [0, 1, 2, 3].map((i) => (raw[i] ?? 0) * 100);
      } else {
        const raw = Array.from(
          outputs[session.outputNames[0]].data as Float32Array,
        );
        arr = [0, 1, 2, 3].map((i) => (raw[i] ?? 0) * 100);
      }
      perEngineProbs[eng] = arr;

      let bi = 0;
      for (let i = 1; i < 4; i++) if (arr[i] > arr[bi]) bi = i;
      breakdown.push({
        engine: eng,
        label: ENGINE_LABELS[eng],
        valueDisplay: `${IDX_TO_CAT[bi]} (${arr[bi].toFixed(0)}%)`,
      });
    }

    const activeArrays = Object.values(perEngineProbs) as number[][];
    const finalProbs = [0, 1, 2, 3].map((clsIdx) =>
      Number(
        (
          activeArrays.reduce((sum, a) => sum + a[clsIdx], 0) /
          activeArrays.length
        ).toFixed(1),
      ),
    );

    let bestIdx = 0;
    for (let i = 1; i < 4; i++) {
      if (finalProbs[i] > finalProbs[bestIdx]) bestIdx = i;
    }
    const bestCat = IDX_TO_CAT[bestIdx];

    return {
      moduleKey,
      icao,
      activeEngines,
      combinationLabel: comboLabel,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Prediksi Kategori Terburuk (1–3 Jam)",
      primaryMetricValue: `${bestCat} (${finalProbs[bestIdx]}%)`,
      badgeText: bestCat,
      badgeVariant:
        bestCat === "LIFR"
          ? "fuchsia"
          : bestCat === "IFR"
            ? "rose"
            : bestCat === "MVFR"
              ? "amber"
              : "emerald",
      summary:
        speciPrefixNote +
        (bestCat === "VFR"
          ? "Operasi penerbangan diprakirakan tetap dalam kondisi Visual Flight Rules (VFR) tanpa penurunan ceiling signifikan."
          : `Waspada Penurunan Kategori ke ${bestCat}: Terdeteksi potensi penurunan ceiling awan rendah atau jarak pandang dalam 1–3 jam ke depan.`),
      engineBreakdown: breakdown,
      classProbabilities: {
        VFR: finalProbs[0],
        MVFR: finalProbs[1],
        IFR: finalProbs[2],
        LIFR: finalProbs[3],
      },
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 5. KLASTERISASI REZIM CUACA BANDARA
  // =======================================================================
  if (moduleKey === "WEATHER_CLUSTERING") {
    const votes: Record<number, number> = {};
    const breakdown: HybridPredictionOutput["engineBreakdown"] = [];

    for (const eng of activeEngines) {
      const { session, outputs } = await runEngineRaw(eng);
      let cid = 0;
      if (eng === "XGBOOST" || eng === "RF") {
        cid = Number(outputs[session.outputNames[0]].data[0].toString());
      } else {
        const probs = Array.from(
          outputs[session.outputNames[0]].data as Float32Array,
        );
        for (let i = 1; i < probs.length; i++)
          if (probs[i] > probs[cid]) cid = i;
      }
      votes[cid] = (votes[cid] || 0) + 1;
      breakdown.push({
        engine: eng,
        label: ENGINE_LABELS[eng],
        valueDisplay: `Cluster #${cid}`,
      });
    }

    const winningCluster = Number(
      Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0],
    );

    const hasTsCb = curr.has_ts || curr.has_cb;
    let regimeName = `Rezim Klimatologis #${winningCluster}`;
    let desc =
      "Pola sirkulasi atmosfer rutin stasiun dengan keseimbangan suhu dan kelembapan normal.";

    if (hasTsCb || currSpread <= 2.0) {
      regimeName = `Rezim Konvektif / Lembap (#${winningCluster})`;
      desc =
        "Massa udara sangat jenuh (spread T-Td sempit) atau aktif secara konvektif, tipikal fase hujan/TSRA.";
    } else if (currTemp >= 31 && currSpread >= 6.0) {
      regimeName = `Rezim Pemanasan Siang / Terik (#${winningCluster})`;
      desc =
        "Pemanasan permukaan maksimal dengan udara relatif kering dan pencampuran termal kuat.";
    } else if (currSpd >= 10) {
      regimeName = `Rezim Angin Monsun / Sea-Breeze (#${winningCluster})`;
      desc =
        "Dominasi adveksi angin permukaan konstan dengan ventilasi atmosfer lapisan batas yang kuat.";
    }

    return {
      moduleKey,
      icao,
      activeEngines,
      combinationLabel: comboLabel,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Klaster Rezim Atmosfer",
      primaryMetricValue: `Cluster #${winningCluster}`,
      badgeText: regimeName,
      badgeVariant: "slate",
      summary: speciPrefixNote + desc,
      engineBreakdown: breakdown,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 6. ANALOG FORECASTING (TOP-5 POLA HISTORIS — TIME-ALIGNED BATCH TENSOR)
  // =======================================================================
  if (moduleKey === "ANALOG_FORECASTING") {
    if (recordsAsc.length < 30) {
      throw new Error(
        `Arsip ${icao} baru ${recordsAsc.length} baris. Minimal butuh 30 observasi untuk pencarian analog historis.`,
      );
    }

    const n = recordsAsc.length;
    const cutoff = n - 24;
    const candIndices: number[] = [];
    for (let i = 7; i < cutoff; i += 2) {
      candIndices.push(i);
    }
    const batchSize = candIndices.length;
    if (batchSize === 0) {
      throw new Error(
        "Rentang data historis belum mencukupi untuk pencarian analog.",
      );
    }

    const batchTabData = new Float32Array(batchSize * 27);
    const batchSeqData = new Float32Array(batchSize * 6 * 17);

    for (let b = 0; b < batchSize; b++) {
      const idx = candIndices[b];
      const t27 = buildTabular27TensorAt(recordsAsc, idx).data as Float32Array;
      const s102 = buildSequence6x17TensorAt(recordsAsc, idx)
        .data as Float32Array;
      batchTabData.set(t27, b * 27);
      batchSeqData.set(s102, b * 102);
    }

    const batchTabTensor = new ort.Tensor("float32", batchTabData, [
      batchSize,
      27,
    ]);
    const batchSeqTensor = new ort.Tensor("float32", batchSeqData, [
      batchSize,
      6,
      17,
    ]);

    const totalSims = new Float64Array(batchSize);
    const breakdown: HybridPredictionOutput["engineBreakdown"] = [];
    let activeCount = 0;

    for (const eng of activeEngines) {
      try {
        const { session, outputs } = await runEngineRaw(eng);
        const outName = session.outputNames[0];
        const targetEmb = outputs[outName].data as Float32Array;
        const embDim = targetEmb.length;

        const isSeq = eng === "LSTM" || eng === "CNN";
        const batchOut = await session.run(
          isSeq
            ? { seq_input: batchSeqTensor }
            : { float_input: batchTabTensor },
        );
        const batchFlat = batchOut[outName].data as Float32Array;

        for (let b = 0; b < batchSize; b++) {
          const candSlice = batchFlat.subarray(b * embDim, (b + 1) * embDim);
          totalSims[b] += cosineSim(targetEmb, candSlice);
        }

        activeCount++;
        breakdown.push({
          engine: eng,
          label: ENGINE_LABELS[eng],
          valueDisplay: `${embDim}D Vector`,
        });
      } catch (e) {
        if (activeEngines.length === 1) throw e;
        breakdown.push({
          engine: eng,
          label: ENGINE_LABELS[eng],
          valueDisplay: "Skip (Perlu Patch)",
        });
      }
    }

    if (activeCount === 0) {
      throw new Error("Semua engine analog gagal dijalankan.");
    }

    const matches: {
      obsTime: string;
      rawMetar: string;
      similarityPercent: number;
      next3hOutcome: string;
    }[] = [];

    for (let b = 0; b < batchSize; b++) {
      const i = candIndices[b];
      const avgSim = totalSims[b] / activeCount;
      const simPct = Math.min(
        99.9,
        Math.max(0, Number(((avgSim + 1) * 50).toFixed(1))),
      );

      // Evaluasi kejadian 3 jam ke depan (180 menit aktual) agar tetap akurat meski ada SPECI
      const baseMs = new Date(recordsAsc[i].obs_time).getTime();
      const futureSlice = recordsAsc.slice(i + 1).filter((r) => {
        const dtMin = (new Date(r.obs_time).getTime() - baseMs) / 60_000;
        return dtMin > 0 && dtMin <= 185;
      });

      const hadTsCb = futureSlice.some((r) => r.has_ts || r.has_cb);
      const minVis =
        futureSlice.length > 0
          ? Math.min(...futureSlice.map((r) => r.visibility_m ?? 9999))
          : 9999;
      const worstCat =
        futureSlice.find(
          (r) => r.flight_category && r.flight_category !== "VFR",
        )?.flight_category || "VFR";

      let outcome = "Tetap Cerah / VFR";
      if (hadTsCb) outcome = `Terjadi TS/CB (Vis ${minVis}m)`;
      else if (worstCat !== "VFR" || minVis < 5000)
        outcome = `${worstCat} (Vis ${minVis}m)`;

      matches.push({
        obsTime: recordsAsc[i].obs_time,
        rawMetar: recordsAsc[i].raw_metar,
        similarityPercent: simPct,
        next3hOutcome: outcome,
      });
    }

    matches.sort((a, b) => b.similarityPercent - a.similarityPercent);
    const top5 = matches.slice(0, 5);
    const adverseCnt = top5.filter(
      (m) => !m.next3hOutcome.startsWith("Tetap"),
    ).length;

    return {
      moduleKey,
      icao,
      activeEngines,
      combinationLabel: comboLabel,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Kemiripan Analog Terdekat",
      primaryMetricValue: top5[0] ? `${top5[0].similarityPercent}%` : "N/A",
      badgeText: `${adverseCnt}/5 HISTORIS ADVERSE`,
      badgeVariant: adverseCnt >= 3 ? "amber" : "emerald",
      summary:
        speciPrefixNote +
        (adverseCnt >= 3
          ? `Dari 5 pola historis paling mirip (${comboLabel}), ${adverseCnt} di antaranya berkembang menjadi cuaca signifikan dalam 3 jam berikutnya.`
          : `Dari 5 pola historis paling mirip (${comboLabel}), mayoritas (${
              5 - adverseCnt
            }/5) bertahan kondusif dalam 3 jam berikutnya.`),
      engineBreakdown: breakdown,
      analogMatches: top5,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 7. DETEKSI ANOMALI SENSOR & AUDIT QC
  // =======================================================================
  if (moduleKey === "ANOMALY_QC") {
    const breakdown: HybridPredictionOutput["engineBreakdown"] = [];
    let anyAnom = false;

    for (const eng of activeEngines) {
      const { session, outputs } = await runEngineRaw(eng);
      if (eng === "XGBOOST") {
        const vec = Array.from(
          outputs[session.outputNames[0]].data as Float32Array,
        );
        const z = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
        if (z > 4.5) anyAnom = true;
        breakdown.push({
          engine: eng,
          label: ENGINE_LABELS[eng],
          valueDisplay: `${z.toFixed(2)}σ`,
        });
      } else if (eng === "RF") {
        const rfNorm = (
          outputs[session.outputNames[0]].data as Float32Array
        )[0];
        if (rfNorm > 4.5) anyAnom = true;
        breakdown.push({
          engine: eng,
          label: ENGINE_LABELS[eng],
          valueDisplay: `${rfNorm.toFixed(2)}σ`,
        });
      } else {
        const mse = (outputs[session.outputNames[0]].data as Float32Array)[0];
        if (mse > 2.5) anyAnom = true;
        breakdown.push({
          engine: eng,
          label: ENGINE_LABELS[eng],
          valueDisplay: `MSE ${mse.toFixed(2)}`,
        });
      }
    }

    const tempJump = Math.abs(currTemp - Number(prevObs.temp_c ?? currTemp));
    const qnhJump = Math.abs(currQnh - Number(prevObs.qnh_hpa ?? currQnh));
    const physicalError =
      currDew > currTemp ||
      currQnh < 960 ||
      currQnh > 1045 ||
      tempJump >= 6.0 ||
      qnhJump >= 4.0;

    const isAnomaly = physicalError || anyAnom;

    return {
      moduleKey,
      icao,
      activeEngines,
      combinationLabel: comboLabel,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Status Audit Quality Control",
      primaryMetricValue: isAnomaly ? "ANOMALI" : "LOLOS QC",
      badgeText: isAnomaly ? "ANOMALI TERDETEKSI" : "NORMAL (LOLOS QC)",
      badgeVariant: isAnomaly ? "rose" : "emerald",
      summary:
        speciPrefixNote +
        (isAnomaly
          ? "Peringatan Quality Control: Pembacaan parameter METAR/SPECI terakhir menyimpang dari pola klimatologis atau terdapat lompatan nilai sensor mendadak. Harap verifikasi sensor AWOS."
          : "Seluruh parameter meteorologi permukaan konsisten secara fisik dan berada dalam rentang klimatologis normal stasiun."),
      engineBreakdown: breakdown,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 8. PREDIKSI DURASI & WAKTU REDA CUACA (CLEARING TIME)
  // =======================================================================
  const minsMap: Partial<Record<EngineKey, number>> = {};
  const breakdown: HybridPredictionOutput["engineBreakdown"] = [];

  for (const eng of activeEngines) {
    const { session, outputs } = await runEngineRaw(eng);
    const raw = (outputs[session.outputNames[0]].data as Float32Array)[0];
    const m = Math.round(Math.min(360, Math.max(15, raw)));
    minsMap[eng] = m;
    breakdown.push({
      engine: eng,
      label: ENGINE_LABELS[eng],
      valueDisplay: `±${m} mnt`,
    });
  }

  const fcat = (curr.flight_category || "VFR").toUpperCase();
  const wxStr = Array.isArray(curr.weather_phenomena)
    ? curr.weather_phenomena.join(" ")
    : "";
  const isAdverseNow =
    fcat !== "VFR" ||
    Boolean(curr.has_ts || curr.has_cb) ||
    /(RA|TS|FG|BR|HZ)/.test(wxStr);

  const mList = Object.values(minsMap) as number[];
  const finalMins = !isAdverseNow
    ? 0
    : Math.round(mList.reduce((a, b) => a + b, 0) / mList.length);

  return {
    moduleKey,
    icao,
    activeEngines,
    combinationLabel: comboLabel,
    latestRawMetar: curr.raw_metar,
    primaryMetricLabel: "Estimasi Waktu Pemulihan ke VFR",
    primaryMetricValue: isAdverseNow ? `±${finalMins} Menit` : "0 Menit (VFR)",
    badgeText: isAdverseNow
      ? `REDA ±${finalMins} MENIT`
      : "KONDISI SUDAH CERAH",
    badgeVariant: isAdverseNow ? "amber" : "emerald",
    summary:
      speciPrefixNote +
      (isAdverseNow
        ? `Cuaca signifikan diprakirakan berangsur reda menuju kondisi VFR dalam ±${finalMins} menit (${(
            finalMins / 60
          ).toFixed(1)} jam).`
        : "Saat ini tidak terdeteksi cuaca buruk signifikan (hujan/TS/kabut/IFR) pada observasi terakhir stasiun."),
    engineBreakdown: breakdown,
    indicators: baseIndicators,
  };
}
