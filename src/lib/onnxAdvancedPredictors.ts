import * as ort from "onnxruntime-web";
import { MetarDbRecord } from "./onnxTsCbPredictor";

export interface AdvancedMetarRecord extends MetarDbRecord {
  wind_gust?: number | null;
  weather_phenomena?: string[] | null;
  lowest_ceiling_ft?: number | null;
  flight_category?: string | null;
}

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
ort.env.wasm.numThreads = 1;

async function loadOnnxSession(
  modelUrl: string,
  label: string,
): Promise<ort.InferenceSession> {
  try {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} saat mengunduh model.`);
    }
    const buffer = await response.arrayBuffer();
    return await ort.InferenceSession.create(buffer, {
      executionProviders: ["wasm"],
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal memuat model ${label}: ${detail}`);
  }
}

function calcWindUV(r: AdvancedMetarRecord) {
  if (r.is_vrb || r.wind_dir === null || r.wind_speed === null) {
    return { u: 0, v: 0 };
  }
  const rad = (r.wind_dir * Math.PI) / 180.0;
  return {
    u: -r.wind_speed * Math.sin(rad),
    v: -r.wind_speed * Math.cos(rad),
  };
}

// =========================================================================
// 5. KLASTERISASI REZIM CUACA BANDARA (wx_cluster_<icao>.onnx — 13 fitur)
// =========================================================================
export interface WeatherClusterResult {
  icao: string;
  latestRawMetar: string;
  clusterId: number;
  regimeName: string;
  description: string;
  indicators: {
    tempC: number;
    dewpointSpread: number;
    windSpeed: number;
    qnhHpa: number;
  };
}

export async function runWeatherClustering(
  icao: string,
  recordsAsc: AdvancedMetarRecord[],
  customModelUrl?: string,
): Promise<WeatherClusterResult> {
  if (recordsAsc.length === 0) {
    throw new Error(`Data observasi ${icao} belum tersedia di database.`);
  }

  const curr = recordsAsc[recordsAsc.length - 1];
  const obsDate = new Date(curr.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const monthNum = obsDate.getUTCMonth() + 1;

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12.0);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12.0);

  const uv = calcWindUV(curr);
  const windSpeed = curr.wind_speed ?? 0;
  const visM = curr.visibility_m ?? 9999;
  const tempC = Number(curr.temp_c ?? 28);
  const dewC = Number(curr.dewpoint_c ?? 24);
  const spread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((tempC - dewC).toFixed(1));
  const qnhHpa = Number(curr.qnh_hpa ?? 1010);
  const hasTsCb = curr.has_ts || curr.has_cb ? 1.0 : 0.0;

  const inputArray = Float32Array.from([
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    uv.u,
    uv.v,
    windSpeed,
    visM,
    tempC,
    dewC,
    spread,
    qnhHpa,
    hasTsCb,
  ]);

  const modelUrl =
    customModelUrl || `/models/wx_cluster_${icao.toLowerCase()}.onnx`;
  const session = await loadOnnxSession(
    modelUrl,
    `Weather Clustering (${icao})`,
  );

  const tensor = new ort.Tensor("float32", inputArray, [1, 13]);
  const results = await session.run({ float_input: tensor });

  const labelName = session.outputNames[0];
  const rawLabel = results[labelName].data[0];
  const clusterId = Number(rawLabel);

  // Interpretasi profil meteorologis berdasarkan parameter aktual pada rezim tersebut
  let regimeName = `Rezim Klimatologis #${clusterId}`;
  let description =
    "Pola sirkulasi atmosfer rutin stasiun dengan keseimbangan suhu dan kelembapan normal.";

  if (hasTsCb === 1 || spread <= 2.0) {
    regimeName = `Rezim Konvektif / Lembap (Cluster #${clusterId})`;
    description =
      "Massa udara sangat jenuh (spread T-Td sempit) atau aktif secara konvektif, tipikal fase hujan/TSRA atau kelembapan tinggi.";
  } else if (tempC >= 31 && spread >= 6.0) {
    regimeName = `Rezim Pemanasan Siang / Terik (Cluster #${clusterId})`;
    description =
      "Pemanasan permukaan maksimal dengan udara relatif kering dan pencampuran termal kuat.";
  } else if (windSpeed >= 10) {
    regimeName = `Rezim Angin Monsun / Sea-Breeze (Cluster #${clusterId})`;
    description =
      "Dominasi adveksi angin permukaan konstan dengan ventilasi atmosfer lapisan batas yang kuat.";
  }

  return {
    icao,
    latestRawMetar: curr.raw_metar,
    clusterId,
    regimeName,
    description,
    indicators: {
      tempC,
      dewpointSpread: spread,
      windSpeed,
      qnhHpa,
    },
  };
}

// =========================================================================
// 6. ANALOG FORECASTING — POLA HISTORIS (analog_enc_<icao>.onnx — 18 fitur)
// =========================================================================
export interface AnalogMatchItem {
  obsTime: string;
  rawMetar: string;
  similarityPercent: number;
  next3hOutcome: string;
}

export interface AnalogForecastResult {
  icao: string;
  latestRawMetar: string;
  summary: string;
  matches: AnalogMatchItem[];
}

function buildAnalogFeatureVector(
  curr: AdvancedMetarRecord,
  prev1h: AdvancedMetarRecord,
  prev3h: AdvancedMetarRecord,
): Float32Array {
  const obsDate = new Date(curr.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const monthNum = obsDate.getUTCMonth() + 1;

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12.0);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12.0);

  const currUV = calcWindUV(curr);
  const prev1hUV = calcWindUV(prev1h);

  const windSpeed = curr.wind_speed ?? 0;
  const visM = curr.visibility_m ?? 9999;
  const tempC = Number(curr.temp_c ?? 28);
  const dewC = Number(curr.dewpoint_c ?? 24);
  const spread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((tempC - dewC).toFixed(1));
  const qnhHpa = Number(curr.qnh_hpa ?? 1010);

  const prev1hTemp = Number(prev1h.temp_c ?? tempC);
  const prev3hTemp = Number(prev3h.temp_c ?? tempC);
  const prev1hDew = Number(prev1h.dewpoint_c ?? dewC);
  const prev1hSpread =
    prev1h.dewpoint_spread !== null
      ? Number(prev1h.dewpoint_spread)
      : prev1hTemp - prev1hDew;
  const prev1hQnh = Number(prev1h.qnh_hpa ?? qnhHpa);
  const prev3hQnh = Number(prev3h.qnh_hpa ?? qnhHpa);

  return Float32Array.from([
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    currUV.u,
    currUV.v,
    windSpeed,
    visM,
    tempC,
    spread,
    qnhHpa,
    tempC - prev1hTemp,
    tempC - prev3hTemp,
    spread - prev1hSpread,
    qnhHpa - prev1hQnh,
    qnhHpa - prev3hQnh,
    currUV.u - prev1hUV.u,
    currUV.v - prev1hUV.v,
  ]);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function runAnalogForecasting(
  icao: string,
  historyAsc: AdvancedMetarRecord[],
  customModelUrl?: string,
): Promise<AnalogForecastResult> {
  if (historyAsc.length < 30) {
    throw new Error(
      `Arsip ${icao} baru ${historyAsc.length} baris. Minimal butuh 30 observasi untuk pencarian analog historis.`,
    );
  }

  const modelUrl =
    customModelUrl || `/models/analog_enc_${icao.toLowerCase()}.onnx`;
  const session = await loadOnnxSession(modelUrl, `Analog Encoder (${icao})`);
  const outName = session.outputNames[0];

  // Encode kondisi terkini (index terakhir)
  const n = historyAsc.length;
  const targetVec = buildAnalogFeatureVector(
    historyAsc[n - 1],
    historyAsc[n - 3],
    historyAsc[n - 7],
  );
  const targetRes = await session.run({
    float_input: new ort.Tensor("float32", targetVec, [1, 18]),
  });
  const targetEmb = targetRes[outName].data as Float32Array;

  // Bandingkan dengan kandidat historis (kecuali 24 observasi terakhir agar tidak match dengan hari yang sama)
  const candidates: AnalogMatchItem[] = [];
  const cutoff = n - 24;

  for (let i = 6; i < cutoff; i += 2) {
    const candVec = buildAnalogFeatureVector(
      historyAsc[i],
      historyAsc[i - 2],
      historyAsc[i - 6],
    );
    const candRes = await session.run({
      float_input: new ort.Tensor("float32", candVec, [1, 18]),
    });
    const candEmb = candRes[outName].data as Float32Array;
    const sim = cosineSimilarity(targetEmb, candEmb);
    const simPct = Math.min(
      99.9,
      Math.max(0, Number(((sim + 1) * 50).toFixed(1))),
    );

    // Lihat apa yang terjadi 1–3 jam setelah kandidat historis tersebut
    const futureSlice = historyAsc.slice(i + 1, Math.min(n, i + 7));
    const hadTsCb = futureSlice.some((r) => r.has_ts || r.has_cb);
    const minVis = Math.min(...futureSlice.map((r) => r.visibility_m ?? 9999));
    const worstCat =
      futureSlice.find((r) => r.flight_category && r.flight_category !== "VFR")
        ?.flight_category || "VFR";

    let outcome = "Tetap Cerah / VFR (Vis >5 km)";
    if (hadTsCb) {
      outcome = `Terjadi TS / CB (Vis min ${minVis}m)`;
    } else if (worstCat !== "VFR" || minVis < 5000) {
      outcome = `Penurunan ke ${worstCat} (Vis min ${minVis}m)`;
    }

    candidates.push({
      obsTime: historyAsc[i].obs_time,
      rawMetar: historyAsc[i].raw_metar,
      similarityPercent: simPct,
      next3hOutcome: outcome,
    });
  }

  candidates.sort((a, b) => b.similarityPercent - a.similarityPercent);
  const top5 = candidates.slice(0, 5);
  const adverseMatches = top5.filter(
    (m) => !m.next3hOutcome.startsWith("Tetap"),
  );

  const summary =
    adverseMatches.length >= 3
      ? `Dari 5 kejadian historis paling mirip, ${adverseMatches.length} di antaranya berkembang menjadi cuaca signifikan (TS/CB atau penurunan visibilitas) dalam 3 jam berikutnya.`
      : `Dari 5 kejadian historis paling mirip, mayoritas (${
          5 - adverseMatches.length
        }/5) bertahan kondusif dalam 3 jam berikutnya.`;

  return {
    icao,
    latestRawMetar: historyAsc[n - 1].raw_metar,
    summary,
    matches: top5,
  };
}

// =========================================================================
// 7. DETEKSI ANOMALI SENSOR & AUDIT QC (anomaly_qc_<icao>.onnx — 11 fitur)
// =========================================================================
export interface AnomalyQcResult {
  icao: string;
  latestRawMetar: string;
  isAnomaly: boolean;
  anomalyScore: number;
  statusLabel: "NORMAL (LOLOS QC)" | "ANOMALI TERDETEKSI";
  summary: string;
  indicators: {
    tempJump30m: number;
    qnhJump30m: number;
    windJump30m: number;
    dewpointSpread: number;
  };
}

export async function runAnomalyQcCheck(
  icao: string,
  recordsAsc: AdvancedMetarRecord[],
  customModelUrl?: string,
): Promise<AnomalyQcResult> {
  if (recordsAsc.length < 2) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 2 observasi berurutan untuk audit lompatan parameter QC.`,
    );
  }

  const curr = recordsAsc[recordsAsc.length - 1];
  const prev = recordsAsc[recordsAsc.length - 2];

  const obsDate = new Date(curr.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);

  const windSpeed = curr.wind_speed ?? 0;
  const prevWind = prev.wind_speed ?? windSpeed;
  const visM = curr.visibility_m ?? 9999;
  const tempC = Number(curr.temp_c ?? 28);
  const prevTemp = Number(prev.temp_c ?? tempC);
  const dewC = Number(curr.dewpoint_c ?? 24);
  const spread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((tempC - dewC).toFixed(1));
  const qnhHpa = Number(curr.qnh_hpa ?? 1010);
  const prevQnh = Number(prev.qnh_hpa ?? qnhHpa);

  const tempJump = Math.abs(tempC - prevTemp);
  const qnhJump = Math.abs(qnhHpa - prevQnh);
  const windJump = Math.abs(windSpeed - prevWind);

  const inputArray = Float32Array.from([
    hourSin,
    hourCos,
    windSpeed,
    visM,
    tempC,
    dewC,
    spread,
    qnhHpa,
    tempJump,
    qnhJump,
    windJump,
  ]);

  const modelUrl =
    customModelUrl || `/models/anomaly_qc_${icao.toLowerCase()}.onnx`;
  const session = await loadOnnxSession(modelUrl, `Anomaly QC (${icao})`);

  const tensor = new ort.Tensor("float32", inputArray, [1, 11]);
  const results = await session.run({ float_input: tensor });

  // Hitung norma jarak dari vektor komponen utama terstandarisasi (Z-score multivariat)
  const latentVec = Array.from(
    results[session.outputNames[0]].data as Float32Array,
  );
  const normDistance = Math.sqrt(latentVec.reduce((acc, v) => acc + v * v, 0));

  // Deteksi anomali jika jarak multivariat > 4.5 sigma ATAU melanggar batas fisik sensor
  const physicalError =
    dewC > tempC ||
    qnhHpa < 960 ||
    qnhHpa > 1045 ||
    tempJump >= 6.0 ||
    qnhJump >= 4.0;
  const isAnomaly = normDistance > 4.5 || physicalError;

  return {
    icao,
    latestRawMetar: curr.raw_metar,
    isAnomaly,
    anomalyScore: Number(normDistance.toFixed(2)),
    statusLabel: isAnomaly ? "ANOMALI TERDETEKSI" : "NORMAL (LOLOS QC)",
    summary: isAnomaly
      ? `Peringatan Quality Control (Skor Deviasi: ${normDistance.toFixed(
          2,
        )}σ): Pembacaan parameter METAR terakhir menyimpang dari pola klimatologis stasiun atau terdapat lompatan sensor mendadak. Harap verifikasi manual sensor AWOS.`
      : `Seluruh parameter meteorologi permukaan konsisten secara fisik dan berada dalam rentang klimatologis normal stasiun (Skor Deviasi: ${normDistance.toFixed(
          2,
        )}σ).`,
    indicators: {
      tempJump30m: Number(tempJump.toFixed(1)),
      qnhJump30m: Number(qnhJump.toFixed(1)),
      windJump30m: Math.round(windJump),
      dewpointSpread: spread,
    },
  };
}

// =========================================================================
// 8. PREDIKSI DURASI & WAKTU REDA CUACA (clearing_time_<icao>.onnx — 14 fitur)
// =========================================================================
export interface ClearingTimeResult {
  icao: string;
  latestRawMetar: string;
  isAdverseNow: boolean;
  estimatedMinutes: number;
  statusLabel: string;
  summary: string;
  indicators: {
    currentCategory: string;
    currentVisM: number;
    dewpointSpread: number;
    qnhDiff1h: number;
  };
}

export async function runClearingTimePrediction(
  icao: string,
  recordsAsc: AdvancedMetarRecord[],
  customModelUrl?: string,
): Promise<ClearingTimeResult> {
  if (recordsAsc.length < 3) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 3 observasi terakhir untuk menghitung estimasi waktu reda.`,
    );
  }

  const curr = recordsAsc[recordsAsc.length - 1];
  const prev1h = recordsAsc[recordsAsc.length - 3];

  const obsDate = new Date(curr.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const monthNum = obsDate.getUTCMonth() + 1;

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12.0);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12.0);

  const windSpeed = curr.wind_speed ?? 0;
  const visM = curr.visibility_m ?? 9999;
  const prevVisM = prev1h.visibility_m ?? visM;
  const visDiff1h = visM - prevVisM;

  const tempC = Number(curr.temp_c ?? 28);
  const dewC = Number(curr.dewpoint_c ?? 24);
  const spread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((tempC - dewC).toFixed(1));

  const prevTemp = Number(prev1h.temp_c ?? tempC);
  const prevDew = Number(prev1h.dewpoint_c ?? dewC);
  const prevSpread =
    prev1h.dewpoint_spread !== null
      ? Number(prev1h.dewpoint_spread)
      : prevTemp - prevDew;
  const spreadDiff1h = spread - prevSpread;

  const qnhHpa = Number(curr.qnh_hpa ?? 1010);
  const prevQnh = Number(prev1h.qnh_hpa ?? qnhHpa);
  const qnhDiff1h = qnhHpa - prevQnh;

  const hasTsCb = curr.has_ts || curr.has_cb ? 1.0 : 0.0;
  const fcat = (curr.flight_category || "VFR").toUpperCase();
  const wxStr = Array.isArray(curr.weather_phenomena)
    ? curr.weather_phenomena.join(" ")
    : "";
  const isAdverseNow =
    fcat !== "VFR" || hasTsCb === 1.0 || /(RA|TS|FG|BR|HZ)/.test(wxStr);

  const inputArray = Float32Array.from([
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    windSpeed,
    visM,
    visDiff1h,
    tempC,
    spread,
    spreadDiff1h,
    qnhHpa,
    qnhDiff1h,
    hasTsCb,
    isAdverseNow ? 1.0 : 0.0,
  ]);

  const modelUrl =
    customModelUrl || `/models/clearing_time_${icao.toLowerCase()}.onnx`;
  const session = await loadOnnxSession(modelUrl, `Clearing Time (${icao})`);

  const tensor = new ort.Tensor("float32", inputArray, [1, 14]);
  const results = await session.run({ float_input: tensor });

  const rawMins = (results[session.outputNames[0]].data as Float32Array)[0];
  const estimatedMinutes = isAdverseNow
    ? Math.round(Math.min(360, Math.max(15, rawMins)))
    : 0;

  return {
    icao,
    latestRawMetar: curr.raw_metar,
    isAdverseNow,
    estimatedMinutes,
    statusLabel: isAdverseNow
      ? `ESTIMASI REDA ±${estimatedMinutes} MENIT`
      : "KONDISI SUDAH CERAH (VFR)",
    summary: isAdverseNow
      ? `Berdasarkan tren pemulihan visibilitas, tekanan QNH, dan kelembapan permukaan, cuaca signifikan diprakirakan berangsur reda menuju VFR dalam ±${estimatedMinutes} menit (${(
          estimatedMinutes / 60
        ).toFixed(1)} jam).`
      : "Saat ini tidak terdeteksi cuaca buruk signifikan (hujan/TS/kabut/IFR) pada observasi terakhir stasiun.",
    indicators: {
      currentCategory: fcat,
      currentVisM: visM,
      dewpointSpread: spread,
      qnhDiff1h: Number(qnhDiff1h.toFixed(1)),
    },
  };
}
