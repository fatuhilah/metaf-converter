import * as ort from "onnxruntime-web";
import { MetarDbRecord } from "./onnxTsCbPredictor";

export interface WindShearMetarRecord extends MetarDbRecord {
  wind_gust?: number | null;
}

export interface WindShearPredictionResult {
  icao: string;
  latestObsTime: string;
  latestRawMetar: string;
  probabilityPercent: number;
  riskLevel: "RENDAH" | "SEDANG" | "TINGGI";
  summary: string;
  indicators: {
    windDirLabel: string;
    windSpeed: number;
    windGust: number | null;
    dirShift1h: number;
    spdDiff1h: number;
  };
}

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

function calcAngularDiff(deg1: number, deg2: number): number {
  const diff = Math.abs(deg1 - deg2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export async function runWindShearPrediction(
  icao: string,
  recordsAsc: WindShearMetarRecord[],
  customModelUrl?: string,
): Promise<WindShearPredictionResult> {
  if (recordsAsc.length < 5) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 5 observasi terakhir (2 jam) untuk menghitung tren vektor angin.`,
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

  const calcUV = (r: WindShearMetarRecord) => {
    if (r.is_vrb || r.wind_dir === null || r.wind_speed === null) {
      return { u: 0, v: 0 };
    }
    const rad = (r.wind_dir * Math.PI) / 180.0;
    return {
      u: -r.wind_speed * Math.sin(rad),
      v: -r.wind_speed * Math.cos(rad),
    };
  };

  const currUV = calcUV(curr);
  const prev1hUV = calcUV(prev1h);

  const windDirNum = curr.wind_dir ?? 0;
  const prevDirNum = prev1h.wind_dir ?? windDirNum;
  const windSpeed = curr.wind_speed ?? 0;
  const prevSpeed = prev1h.wind_speed ?? windSpeed;
  const windGustVal = curr.wind_gust ?? windSpeed;

  const windUDiff1h = currUV.u - prev1hUV.u;
  const windVDiff1h = currUV.v - prev1hUV.v;
  const windSpdDiff1h = windSpeed - prevSpeed;
  const windDirShift1h = calcAngularDiff(windDirNum, prevDirNum);

  const tempC = Number(curr.temp_c ?? 28);
  const prevTempC = Number(prev1h.temp_c ?? tempC);
  const tempDiff1h = tempC - prevTempC;

  const qnhHpa = Number(curr.qnh_hpa ?? 1010);
  const prevQnhHpa = Number(prev1h.qnh_hpa ?? qnhHpa);
  const qnhDiff1h = qnhHpa - prevQnhHpa;
  const currentTsCb = curr.has_ts || curr.has_cb ? 1.0 : 0.0;

  // 16 fitur persis sesuai urutan FEATURE_COLS di Python
  const inputArray = Float32Array.from([
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    currUV.u,
    currUV.v,
    windSpeed,
    windGustVal,
    windUDiff1h,
    windVDiff1h,
    windSpdDiff1h,
    windDirShift1h,
    qnhHpa,
    qnhDiff1h,
    tempDiff1h,
    currentTsCb,
  ]);

  const modelUrl =
    customModelUrl || `/models/wind_shear_${icao.toLowerCase()}.onnx`;
  let session: ort.InferenceSession;

  try {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} saat mengunduh model Wind Shear.`,
      );
    }
    const modelBuffer = await response.arrayBuffer();
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal memuat model Wind Shear (${icao}): ${detail}`);
  }

  const tensor = new ort.Tensor("float32", inputArray, [1, 16]);
  const results = await session.run({ float_input: tensor });

  const probOutputName =
    session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
    session.outputNames[session.outputNames.length - 1];
  const rawData = results[probOutputName].data as Float32Array;
  const probEvent = rawData.length >= 2 ? rawData[1] : rawData[0];
  const probPercent = Math.min(
    100,
    Math.max(0, Number((probEvent * 100).toFixed(1))),
  );

  let riskLevel: "RENDAH" | "SEDANG" | "TINGGI" = "RENDAH";
  let summary =
    "Aliran angin permukaan diprakirakan relatif konsisten. Peluang lonjakan gust atau pergeseran arah angin signifikan (≥45°) rendah.";

  if (probPercent >= 65) {
    riskLevel = "TINGGI";
    summary =
      "Peringatan Pergeseran Angin / Gust: Terdeteksi gradien tekanan dan dinamika vektor angin yang berpotensi memicu gust kencang atau wind shift mendadak dalam 1–3 jam ke depan.";
  } else if (probPercent >= 35) {
    riskLevel = "SEDANG";
    summary =
      "Waspada Variasi Angin Permukaan: Berpotensi terjadi peningkatan kecepatan angin atau perubahan arah angin bertahap (sea-breeze front / outflow).";
  }

  const windDirLabel = curr.is_vrb
    ? "VRB"
    : curr.wind_dir !== null
      ? `${String(curr.wind_dir).padStart(3, "0")}°`
      : "---";

  return {
    icao,
    latestObsTime: curr.obs_time,
    latestRawMetar: curr.raw_metar,
    probabilityPercent: probPercent,
    riskLevel,
    summary,
    indicators: {
      windDirLabel,
      windSpeed,
      windGust: curr.wind_gust ?? null,
      dirShift1h: Math.round(windDirShift1h),
      spdDiff1h: Math.round(windSpdDiff1h),
    },
  };
}
