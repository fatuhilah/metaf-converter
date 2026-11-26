import * as ort from "onnxruntime-web";
import { MetarDbRecord } from "./onnxTsCbPredictor";

export interface VisibilityMetarRecord extends MetarDbRecord {
  weather_phenomena?: string[] | null;
}

export interface VisibilityPredictionResult {
  icao: string;
  latestObsTime: string;
  latestRawMetar: string;
  predictedMinVisM: number;
  currentVisM: number;
  statusLevel: "VFR (>5 KM)" | "WASPADA (1.5–5 KM)" | "POOR VIS (<1.5 KM)";
  summary: string;
  indicators: {
    currentVisM: number;
    visDiff1h: number;
    dewpointSpread: number;
    spreadDiff1h: number;
    windSpeed: number;
  };
}

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

export async function runVisibilityPrediction(
  icao: string,
  recordsAsc: VisibilityMetarRecord[],
  customModelUrl?: string,
): Promise<VisibilityPredictionResult> {
  if (recordsAsc.length < 5) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 5 observasi terakhir (2 jam) untuk menghitung tren visibilitas.`,
    );
  }

  const seq = recordsAsc.slice(-5);
  const curr = seq[seq.length - 1];
  const prev1h = seq[seq.length - 3];

  const obsDate = new Date(curr.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const monthNum = obsDate.getUTCMonth() + 1;

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12.0);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12.0);

  let windU = 0;
  let windV = 0;
  if (!curr.is_vrb && curr.wind_dir !== null && curr.wind_speed !== null) {
    const rad = (curr.wind_dir * Math.PI) / 180.0;
    windU = -curr.wind_speed * Math.sin(rad);
    windV = -curr.wind_speed * Math.cos(rad);
  }

  const windSpeed = curr.wind_speed ?? 0;
  const currentVisM = curr.visibility_m ?? 9999;
  const prev1hVisM = prev1h.visibility_m ?? currentVisM;
  const visDiff1h = currentVisM - prev1hVisM;

  const tempC = Number(curr.temp_c ?? 28);
  const dewpointC = Number(curr.dewpoint_c ?? 24);
  const spread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((tempC - dewpointC).toFixed(1));

  const prev1hTemp = Number(prev1h.temp_c ?? tempC);
  const prev1hDew = Number(prev1h.dewpoint_c ?? dewpointC);
  const prev1hSpread =
    prev1h.dewpoint_spread !== null
      ? Number(prev1h.dewpoint_spread)
      : prev1hTemp - prev1hDew;
  const spreadDiff1h = spread - prev1hSpread;

  const qnhHpa = Number(curr.qnh_hpa ?? 1010);
  const prev1hQnh = Number(prev1h.qnh_hpa ?? qnhHpa);
  const qnhDiff1h = qnhHpa - prev1hQnh;

  const wxList = Array.isArray(curr.weather_phenomena)
    ? curr.weather_phenomena.join(" ")
    : "";
  const isHazeFogBr = /(FG|BR|HZ|FU|RA)/.test(wxList) ? 1.0 : 0.0;

  // 16 fitur persis sesuai urutan FEATURE_COLS di Python
  const inputArray = Float32Array.from([
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    windU,
    windV,
    windSpeed,
    currentVisM,
    visDiff1h,
    tempC,
    dewpointC,
    spread,
    spreadDiff1h,
    qnhHpa,
    qnhDiff1h,
    isHazeFogBr,
  ]);

  const modelUrl =
    customModelUrl || `/models/vis_nowcast_${icao.toLowerCase()}.onnx`;
  let session: ort.InferenceSession;

  try {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} saat mengunduh model visibilitas.`,
      );
    }
    const modelBuffer = await response.arrayBuffer();
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal memuat model Visibilitas (${icao}): ${detail}`);
  }

  const tensor = new ort.Tensor("float32", inputArray, [1, 16]);
  const results = await session.run({ float_input: tensor });

  const outName = session.outputNames[0];
  const rawPred = (results[outName].data as Float32Array)[0];
  const predictedMinVisM = Math.round(Math.min(9999, Math.max(100, rawPred)));

  let statusLevel: VisibilityPredictionResult["statusLevel"] = "VFR (>5 KM)";
  let summary =
    "Jarak pandang diprakirakan tetap baik (>5.000 meter) dalam 1–3 jam ke depan. Tidak terdeteksi indikasi kabut atau kabut asap tebal.";

  if (predictedMinVisM < 1500) {
    statusLevel = "POOR VIS (<1.5 KM)";
    summary =
      "Peringatan Jarak Pandang Rendah (IFR/LIFR): Kombinasi spread suhu-titik embun dan kelembapan permukaan berpotensi menurunkan visibilitas di bawah 1.500m dalam 1–3 jam ke depan.";
  } else if (predictedMinVisM <= 5000) {
    statusLevel = "WASPADA (1.5–5 KM)";
    summary =
      "Waspada Penurunan Visibilitas (MVFR): Terdeteksi potensi mist (BR), haze (HZ), atau hujan yang dapat menurunkan jarak pandang ke kisaran 1.500–5.000 meter.";
  }

  return {
    icao,
    latestObsTime: curr.obs_time,
    latestRawMetar: curr.raw_metar,
    predictedMinVisM,
    currentVisM,
    statusLevel,
    summary,
    indicators: {
      currentVisM,
      visDiff1h,
      dewpointSpread: spread,
      spreadDiff1h: Number(spreadDiff1h.toFixed(1)),
      windSpeed,
    },
  };
}
