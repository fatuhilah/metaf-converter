import * as ort from "onnxruntime-web";

export type EngineMode = "XGBOOST" | "LSTM" | "ENSEMBLE";

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

export interface HybridPredictionOutput {
  moduleKey: string;
  icao: string;
  engineUsed: EngineMode;
  latestRawMetar: string;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  badgeText: string;
  badgeVariant: "emerald" | "amber" | "rose" | "fuchsia" | "slate";
  summary: string;
  engineComparison?: {
    xgbValue: string;
    lstmValue: string;
    ensembleValue: string;
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

// Ekstraksi 16 fitur dasar per satu titik observasi (urutan persis sama dengan BASE_FEATURES di Colab)
function extractBase16Features(r: HybridMetarRecord): number[] {
  const obsDate = new Date(r.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const monthNum = obsDate.getUTCMonth() + 1;

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12.0);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12.0);

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
  const qnhHpa = Number(r.qnh_hpa ?? 1010);
  const hasTsCb = r.has_ts || r.has_cb ? 1.0 : 0.0;

  const fcat = (r.flight_category || "VFR").toUpperCase();
  const wxStr = Array.isArray(r.weather_phenomena)
    ? r.weather_phenomena.join(" ")
    : "";
  const isWxAdverse =
    fcat !== "VFR" || hasTsCb === 1.0 || /(RA|TS|FG|BR|HZ)/.test(wxStr)
      ? 1.0
      : 0.0;

  return [
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    windU,
    windV,
    windSpeed,
    windGust,
    visM,
    ceilFt,
    tempC,
    dewC,
    spread,
    qnhHpa,
    hasTsCb,
    isWxAdverse,
  ];
}

// Susun Tensor [1, 24] untuk XGBoost / Sklearn (urutan persis TABULAR_FEATURES di Colab)
function buildTabular24Tensor(seq7: HybridMetarRecord[]): ort.Tensor {
  const curr = seq7[seq7.length - 1];
  const prev1h = seq7[seq7.length - 3];
  const prev3h = seq7[0];

  const base16 = extractBase16Features(curr);
  const currTemp = base16[10];
  const currSpread = base16[12];
  const currQnh = base16[13];
  const currVis = base16[8];
  const currSpd = base16[6];

  const p1Temp = Number(prev1h.temp_c ?? currTemp);
  const p1Dew = Number(prev1h.dewpoint_c ?? base16[11]);
  const p1Spread =
    prev1h.dewpoint_spread !== null
      ? Number(prev1h.dewpoint_spread)
      : p1Temp - p1Dew;
  const p1Qnh = Number(prev1h.qnh_hpa ?? currQnh);
  const p3Qnh = Number(prev3h.qnh_hpa ?? currQnh);
  const p1Vis = prev1h.visibility_m ?? currVis;
  const p1Spd = prev1h.wind_speed ?? currSpd;

  const dirShift1h = calcAngularDiff(
    curr.wind_dir ?? 0,
    prev1h.wind_dir ?? curr.wind_dir ?? 0,
  );
  const catIdx = CAT_TO_IDX[(curr.flight_category || "VFR").toUpperCase()] ?? 0;

  const full24 = Float32Array.from([
    ...base16,
    currTemp - p1Temp,
    currSpread - p1Spread,
    currQnh - p1Qnh,
    currQnh - p3Qnh,
    currVis - p1Vis,
    currSpd - p1Spd,
    dirShift1h,
    catIdx,
  ]);

  return new ort.Tensor("float32", full24, [1, 24]);
}

// Susun Tensor Sekuensial [1, 6, 16] untuk PyTorch LSTM
function buildSequence6x16Tensor(seq6: HybridMetarRecord[]): ort.Tensor {
  const flat = new Float32Array(6 * 16);
  for (let t = 0; t < 6; t++) {
    const row16 = extractBase16Features(seq6[t]);
    flat.set(row16, t * 16);
  }
  return new ort.Tensor("float32", flat, [1, 6, 16]);
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

export async function runHybridModuleInference(params: {
  moduleKey: string;
  filePrefix: string;
  icao: string;
  engine: EngineMode;
  recordsAsc: HybridMetarRecord[];
  xgbUrl?: string | null;
  lstmUrl?: string | null;
}): Promise<HybridPredictionOutput> {
  const { moduleKey, filePrefix, icao, engine, recordsAsc, xgbUrl, lstmUrl } =
    params;

  if (recordsAsc.length < 7) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 7 observasi terakhir (3 jam) untuk menjalankan model sekuensial & tabular.`,
    );
  }

  const pfx = icao.toLowerCase();
  const resolvedXgbUrl = xgbUrl || `/models/xgb_${filePrefix}_${pfx}.onnx`;
  const resolvedLstmUrl = lstmUrl || `/models/lstm_${filePrefix}_${pfx}.onnx`;

  const seq7 = recordsAsc.slice(-7);
  const seq6 = recordsAsc.slice(-6);
  const curr = seq7[seq7.length - 1];
  const prev1h = seq7[seq7.length - 3];

  const tabTensor = buildTabular24Tensor(seq7);
  const seqTensor = buildSequence6x16Tensor(seq6);

  const currTemp = Number(curr.temp_c ?? 28);
  const currDew = Number(curr.dewpoint_c ?? 24);
  const currSpread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((currTemp - currDew).toFixed(1));
  const currQnh = Number(curr.qnh_hpa ?? 1010);
  const qnhDiff1h = Number(
    (currQnh - Number(prev1h.qnh_hpa ?? currQnh)).toFixed(1),
  );
  const currVis = curr.visibility_m ?? 9999;
  const currSpd = curr.wind_speed ?? 0;

  const baseIndicators = [
    { label: "Suhu / Dewpoint", value: `${currTemp}°C / ${currDew}°C` },
    { label: "T - Td Spread", value: `${currSpread}°C` },
    {
      label: "QNH (Tren 1j)",
      value: `${currQnh} hPa (${qnhDiff1h >= 0 ? "+" : ""}${qnhDiff1h})`,
    },
    { label: "Visibilitas", value: `${currVis.toLocaleString("id-ID")} m` },
    { label: "Angin", value: `${currSpd} kt` },
  ];

  // Helper eksekusi XGBoost & LSTM sesuai engine terpilih
  const runXgbRaw = async () => {
    const s = await fetchSession(
      resolvedXgbUrl,
      `xgb_${filePrefix}_${pfx}.onnx`,
    );
    const out = await s.run({ float_input: tabTensor });
    return { session: s, outputs: out };
  };

  const runLstmRaw = async () => {
    const s = await fetchSession(
      resolvedLstmUrl,
      `lstm_${filePrefix}_${pfx}.onnx`,
    );
    const out = await s.run({ seq_input: seqTensor });
    return { session: s, outputs: out };
  };

  // =======================================================================
  // 1. VISIBILITY NOWCASTING (Regression: meter)
  // =======================================================================
  if (moduleKey === "VISIBILITY_NOWCAST") {
    let xgbVal = 0;
    let lstmVal = 0;

    if (engine === "XGBOOST" || engine === "ENSEMBLE") {
      const { session, outputs } = await runXgbRaw();
      const raw = (outputs[session.outputNames[0]].data as Float32Array)[0];
      xgbVal = Math.round(Math.min(9999, Math.max(100, raw)));
    }
    if (engine === "LSTM" || engine === "ENSEMBLE") {
      const { session, outputs } = await runLstmRaw();
      const raw = (outputs[session.outputNames[0]].data as Float32Array)[0];
      lstmVal = Math.round(Math.min(9999, Math.max(100, raw)));
    }

    const finalVis =
      engine === "XGBOOST"
        ? xgbVal
        : engine === "LSTM"
          ? lstmVal
          : Math.round((xgbVal + lstmVal) / 2);

    const isPoor = finalVis < 1500;
    const isWarn = finalVis <= 5000;

    return {
      moduleKey,
      icao,
      engineUsed: engine,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Estimasi Visibilitas Min (1–3 Jam)",
      primaryMetricValue: `${finalVis.toLocaleString("id-ID")} m`,
      badgeText: isPoor
        ? "POOR VIS (<1.5 KM)"
        : isWarn
          ? "WASPADA (1.5–5 KM)"
          : "VFR (>5 KM)",
      badgeVariant: isPoor ? "rose" : isWarn ? "amber" : "emerald",
      summary: isPoor
        ? "Peringatan Jarak Pandang Rendah (IFR/LIFR): Berpotensi terjadi penurunan jarak pandang di bawah 1.500m akibat kabut, asap, atau hujan lebat."
        : isWarn
          ? "Waspada Marginal Visibility (MVFR): Terdeteksi potensi mist (BR), haze (HZ), atau hujan yang menurunkan jarak pandang ke 1.500–5.000m."
          : "Jarak pandang diprakirakan tetap kondusif (>5.000 meter) dalam 1–3 jam ke depan.",
      engineComparison:
        engine === "ENSEMBLE"
          ? {
              xgbValue: `${xgbVal.toLocaleString("id-ID")} m`,
              lstmValue: `${lstmVal.toLocaleString("id-ID")} m`,
              ensembleValue: `${finalVis.toLocaleString("id-ID")} m`,
            }
          : undefined,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 2. THUNDERSTORM / CB & 4. WIND SHEAR (Binary Probability: %)
  // =======================================================================
  if (moduleKey === "TS_CB_PREDICTION" || moduleKey === "WIND_SHEAR_BILSTM") {
    let xgbProb = 0;
    let lstmProb = 0;

    if (engine === "XGBOOST" || engine === "ENSEMBLE") {
      const { session, outputs } = await runXgbRaw();
      const probName =
        session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
        session.outputNames[session.outputNames.length - 1];
      const arr = outputs[probName].data as Float32Array;
      const p = arr.length >= 2 ? arr[1] : arr[0];
      xgbProb = Math.min(100, Math.max(0, Number((p * 100).toFixed(1))));
    }
    if (engine === "LSTM" || engine === "ENSEMBLE") {
      const { session, outputs } = await runLstmRaw();
      const p = (outputs[session.outputNames[0]].data as Float32Array)[0];
      lstmProb = Math.min(100, Math.max(0, Number((p * 100).toFixed(1))));
    }

    const finalProb =
      engine === "XGBOOST"
        ? xgbProb
        : engine === "LSTM"
          ? lstmProb
          : Number(((xgbProb + lstmProb) / 2).toFixed(1));

    const isHigh = finalProb >= 65;
    const isMed = finalProb >= 35;
    const isTs = moduleKey === "TS_CB_PREDICTION";

    return {
      moduleKey,
      icao,
      engineUsed: engine,
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
      summary: isTs
        ? isHigh
          ? "Peringatan Dini Konvektif: Indikator tren tekanan, angin permukaan, dan kelembapan menunjukkan potensi tinggi pertumbuhan CB / TS dalam 1–3 jam ke depan."
          : isMed
            ? "Waspada Pertumbuhan Awan Konvektif: Terdeteksi peningkatan ketidakstabilan lokal. Pantau perkembangan awan TCU/CB."
            : "Atmosfer permukaan relatif stabil. Peluang pertumbuhan awan CB/TS lokal dalam 1–3 jam ke depan rendah."
        : isHigh
          ? "Peringatan Pergeseran Angin / Gust: Terdeteksi dinamika vektor angin yang berpotensi memicu gust kencang atau pergeseran arah ≥45°."
          : isMed
            ? "Waspada Variasi Angin Permukaan: Berpotensi terjadi peningkatan kecepatan angin atau perubahan arah bertahap."
            : "Aliran angin permukaan diprakirakan relatif stabil tanpa lonjakan gust signifikan.",
      engineComparison:
        engine === "ENSEMBLE"
          ? {
              xgbValue: `${xgbProb}%`,
              lstmValue: `${lstmProb}%`,
              ensembleValue: `${finalProb}%`,
            }
          : undefined,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 3. FLIGHT CATEGORY & CEILING (Multi-Class 4 Kategori)
  // =======================================================================
  if (moduleKey === "FLIGHT_CATEGORY_TFT") {
    let xgbProbs = [0, 0, 0, 0];
    let lstmProbs = [0, 0, 0, 0];

    if (engine === "XGBOOST" || engine === "ENSEMBLE") {
      const { session, outputs } = await runXgbRaw();
      const probName =
        session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
        session.outputNames[session.outputNames.length - 1];
      const arr = Array.from(outputs[probName].data as Float32Array);
      xgbProbs = [0, 1, 2, 3].map((i) => (arr[i] ?? 0) * 100);
    }
    if (engine === "LSTM" || engine === "ENSEMBLE") {
      const { session, outputs } = await runLstmRaw();
      const arr = Array.from(
        outputs[session.outputNames[0]].data as Float32Array,
      );
      lstmProbs = [0, 1, 2, 3].map((i) => (arr[i] ?? 0) * 100);
    }

    const finalProbs = [0, 1, 2, 3].map((i) =>
      Number(
        (engine === "XGBOOST"
          ? xgbProbs[i]
          : engine === "LSTM"
            ? lstmProbs[i]
            : (xgbProbs[i] + lstmProbs[i]) / 2
        ).toFixed(1),
      ),
    );

    let bestIdx = 0;
    for (let i = 1; i < 4; i++) {
      if (finalProbs[i] > finalProbs[bestIdx]) bestIdx = i;
    }
    const bestCat = IDX_TO_CAT[bestIdx];

    const getCatLabel = (arr: number[]) => {
      let bi = 0;
      for (let i = 1; i < 4; i++) if (arr[i] > arr[bi]) bi = i;
      return `${IDX_TO_CAT[bi]} (${arr[bi].toFixed(0)}%)`;
    };

    return {
      moduleKey,
      icao,
      engineUsed: engine,
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
        bestCat === "VFR"
          ? "Operasi penerbangan diprakirakan tetap dalam kondisi Visual Flight Rules (VFR) tanpa penurunan ceiling signifikan."
          : `Waspada Penurunan Kategori ke ${bestCat}: Terdeteksi potensi penurunan ceiling awan rendah atau jarak pandang dalam 1–3 jam ke depan.`,
      classProbabilities: {
        VFR: finalProbs[0],
        MVFR: finalProbs[1],
        IFR: finalProbs[2],
        LIFR: finalProbs[3],
      },
      engineComparison:
        engine === "ENSEMBLE"
          ? {
              xgbValue: getCatLabel(xgbProbs),
              lstmValue: getCatLabel(lstmProbs),
              ensembleValue: `${bestCat} (${finalProbs[bestIdx]}%)`,
            }
          : undefined,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 5. KLASTERISASI REZIM CUACA BANDARA
  // =======================================================================
  if (moduleKey === "WEATHER_CLUSTERING") {
    let clusterId = 0;
    let xgbId = 0;
    let lstmId = 0;

    if (engine === "XGBOOST" || engine === "ENSEMBLE") {
      const { session, outputs } = await runXgbRaw();
      xgbId = Number(outputs[session.outputNames[0]].data[0].toString());
    }
    if (engine === "LSTM" || engine === "ENSEMBLE") {
      const { session, outputs } = await runLstmRaw();
      const probs = Array.from(
        outputs[session.outputNames[0]].data as Float32Array,
      );
      let bi = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bi]) bi = i;
      lstmId = bi;
    }

    clusterId = engine === "XGBOOST" ? xgbId : lstmId;
    const hasTsCb = curr.has_ts || curr.has_cb;
    let regimeName = `Rezim Klimatologis #${clusterId}`;
    let desc =
      "Pola sirkulasi atmosfer rutin stasiun dengan keseimbangan suhu dan kelembapan normal.";

    if (hasTsCb || currSpread <= 2.0) {
      regimeName = `Rezim Konvektif / Lembap (#${clusterId})`;
      desc =
        "Massa udara sangat jenuh (spread T-Td sempit) atau aktif secara konvektif, tipikal fase hujan/TSRA.";
    } else if (currTemp >= 31 && currSpread >= 6.0) {
      regimeName = `Rezim Pemanasan Siang / Terik (#${clusterId})`;
      desc =
        "Pemanasan permukaan maksimal dengan udara relatif kering dan pencampuran termal kuat.";
    } else if (currSpd >= 10) {
      regimeName = `Rezim Angin Monsun / Sea-Breeze (#${clusterId})`;
      desc =
        "Dominasi adveksi angin permukaan konstan dengan ventilasi atmosfer lapisan batas yang kuat.";
    }

    return {
      moduleKey,
      icao,
      engineUsed: engine,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Klaster Rezim Atmosfer",
      primaryMetricValue: `Cluster #${clusterId}`,
      badgeText: regimeName,
      badgeVariant: "slate",
      summary: desc,
      engineComparison:
        engine === "ENSEMBLE"
          ? {
              xgbValue: `Cluster #${xgbId}`,
              lstmValue: `Cluster #${lstmId}`,
              ensembleValue: `Cluster #${lstmId} (LSTM Seq)`,
            }
          : undefined,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 6. ANALOG FORECASTING (TOP-5 POLA HISTORIS)
  // =======================================================================
  if (moduleKey === "ANALOG_FORECASTING") {
    if (recordsAsc.length < 30) {
      throw new Error(
        `Arsip ${icao} baru ${recordsAsc.length} baris. Minimal butuh 30 observasi untuk pencarian analog historis.`,
      );
    }

    const useLstm = engine === "LSTM" || engine === "ENSEMBLE";
    const { session, outputs } = useLstm
      ? await runLstmRaw()
      : await runXgbRaw();
    const outName = session.outputNames[0];
    const targetEmb = outputs[outName].data as Float32Array;

    const n = recordsAsc.length;
    const cutoff = n - 24;
    const matches: {
      obsTime: string;
      rawMetar: string;
      similarityPercent: number;
      next3hOutcome: string;
    }[] = [];

    for (let i = 7; i < cutoff; i += 2) {
      const candOut = useLstm
        ? await session.run({
            seq_input: buildSequence6x16Tensor(recordsAsc.slice(i - 5, i + 1)),
          })
        : await session.run({
            float_input: buildTabular24Tensor(recordsAsc.slice(i - 6, i + 1)),
          });

      const candEmb = candOut[outName].data as Float32Array;
      const sim = cosineSim(targetEmb, candEmb);
      const simPct = Math.min(
        99.9,
        Math.max(0, Number(((sim + 1) * 50).toFixed(1))),
      );

      const futureSlice = recordsAsc.slice(i + 1, Math.min(n, i + 7));
      const hadTsCb = futureSlice.some((r) => r.has_ts || r.has_cb);
      const minVis = Math.min(
        ...futureSlice.map((r) => r.visibility_m ?? 9999),
      );
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
      engineUsed: engine,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Kemiripan Analog Terdekat",
      primaryMetricValue: top5[0] ? `${top5[0].similarityPercent}%` : "N/A",
      badgeText: `${adverseCnt}/5 HISTORIS ADVERSE`,
      badgeVariant: adverseCnt >= 3 ? "amber" : "emerald",
      summary:
        adverseCnt >= 3
          ? `Dari 5 pola historis paling mirip (${
              useLstm ? "LSTM Trajectory" : "PCA Tabular"
            }), ${adverseCnt} di antaranya berkembang menjadi cuaca signifikan dalam 3 jam berikutnya.`
          : `Dari 5 pola historis paling mirip (${
              useLstm ? "LSTM Trajectory" : "PCA Tabular"
            }), mayoritas (${5 - adverseCnt}/5) bertahan kondusif dalam 3 jam berikutnya.`,
      analogMatches: top5,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 7. DETEKSI ANOMALI SENSOR & AUDIT QC
  // =======================================================================
  if (moduleKey === "ANOMALY_QC") {
    let xgbScore = 0;
    let lstmMse = 0;

    if (engine === "XGBOOST" || engine === "ENSEMBLE") {
      const { session, outputs } = await runXgbRaw();
      const vec = Array.from(
        outputs[session.outputNames[0]].data as Float32Array,
      );
      xgbScore = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    }
    if (engine === "LSTM" || engine === "ENSEMBLE") {
      const { session, outputs } = await runLstmRaw();
      lstmMse = (outputs[session.outputNames[0]].data as Float32Array)[0];
    }

    const prev = seq7[seq7.length - 2];
    const tempJump = Math.abs(currTemp - Number(prev.temp_c ?? currTemp));
    const qnhJump = Math.abs(currQnh - Number(prev.qnh_hpa ?? currQnh));
    const physicalError =
      currDew > currTemp ||
      currQnh < 960 ||
      currQnh > 1045 ||
      tempJump >= 6.0 ||
      qnhJump >= 4.0;

    const xgbAnom = xgbScore > 4.5;
    const lstmAnom = lstmMse > 2.5;
    const isAnomaly =
      physicalError ||
      (engine === "XGBOOST"
        ? xgbAnom
        : engine === "LSTM"
          ? lstmAnom
          : xgbAnom || lstmAnom);

    const scoreDisplay =
      engine === "XGBOOST"
        ? `${xgbScore.toFixed(2)}σ`
        : engine === "LSTM"
          ? `MSE ${lstmMse.toFixed(2)}`
          : `${xgbScore.toFixed(2)}σ / MSE ${lstmMse.toFixed(2)}`;

    return {
      moduleKey,
      icao,
      engineUsed: engine,
      latestRawMetar: curr.raw_metar,
      primaryMetricLabel: "Skor Deviasi Sensor",
      primaryMetricValue: scoreDisplay,
      badgeText: isAnomaly ? "ANOMALI TERDETEKSI" : "NORMAL (LOLOS QC)",
      badgeVariant: isAnomaly ? "rose" : "emerald",
      summary: isAnomaly
        ? "Peringatan Quality Control: Pembacaan parameter METAR terakhir menyimpang dari pola klimatologis atau terdapat lompatan nilai sensor mendadak. Harap verifikasi sensor AWOS."
        : "Seluruh parameter meteorologi permukaan konsisten secara fisik dan berada dalam rentang klimatologis normal stasiun.",
      engineComparison:
        engine === "ENSEMBLE"
          ? {
              xgbValue: `${xgbScore.toFixed(2)}σ (${xgbAnom ? "Anomali" : "Normal"})`,
              lstmValue: `MSE ${lstmMse.toFixed(2)} (${lstmAnom ? "Anomali" : "Normal"})`,
              ensembleValue: isAnomaly ? "ANOMALI" : "LOLOS QC",
            }
          : undefined,
      indicators: baseIndicators,
    };
  }

  // =======================================================================
  // 8. PREDIKSI DURASI & WAKTU REDA CUACA (CLEARING TIME)
  // =======================================================================
  let xgbMins = 0;
  let lstmMins = 0;

  if (engine === "XGBOOST" || engine === "ENSEMBLE") {
    const { session, outputs } = await runXgbRaw();
    const raw = (outputs[session.outputNames[0]].data as Float32Array)[0];
    xgbMins = Math.round(Math.min(360, Math.max(15, raw)));
  }
  if (engine === "LSTM" || engine === "ENSEMBLE") {
    const { session, outputs } = await runLstmRaw();
    const raw = (outputs[session.outputNames[0]].data as Float32Array)[0];
    lstmMins = Math.round(Math.min(360, Math.max(15, raw)));
  }

  const fcat = (curr.flight_category || "VFR").toUpperCase();
  const wxStr = Array.isArray(curr.weather_phenomena)
    ? curr.weather_phenomena.join(" ")
    : "";
  const isAdverseNow =
    fcat !== "VFR" ||
    Boolean(curr.has_ts || curr.has_cb) ||
    /(RA|TS|FG|BR|HZ)/.test(wxStr);

  const finalMins = !isAdverseNow
    ? 0
    : engine === "XGBOOST"
      ? xgbMins
      : engine === "LSTM"
        ? lstmMins
        : Math.round((xgbMins + lstmMins) / 2);

  return {
    moduleKey,
    icao,
    engineUsed: engine,
    latestRawMetar: curr.raw_metar,
    primaryMetricLabel: "Estimasi Waktu Pemulihan ke VFR",
    primaryMetricValue: isAdverseNow ? `±${finalMins} Menit` : "0 Menit (VFR)",
    badgeText: isAdverseNow
      ? `REDA ±${finalMins} MENIT`
      : "KONDISI SUDAH CERAH",
    badgeVariant: isAdverseNow ? "amber" : "emerald",
    summary: isAdverseNow
      ? `Cuaca signifikan diprakirakan berangsur reda menuju kondisi VFR dalam ±${finalMins} menit (${(
          finalMins / 60
        ).toFixed(1)} jam).`
      : "Saat ini tidak terdeteksi cuaca buruk signifikan (hujan/TS/kabut/IFR) pada observasi terakhir stasiun.",
    engineComparison:
      engine === "ENSEMBLE" && isAdverseNow
        ? {
            xgbValue: `±${xgbMins} mnt`,
            lstmValue: `±${lstmMins} mnt`,
            ensembleValue: `±${finalMins} mnt`,
          }
        : undefined,
    indicators: baseIndicators,
  };
}
