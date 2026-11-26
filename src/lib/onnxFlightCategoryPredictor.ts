import * as ort from "onnxruntime-web";
import { MetarDbRecord } from "./onnxTsCbPredictor";

export type FlightCategoryCode = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface FlightCatMetarRecord extends MetarDbRecord {
  lowest_ceiling_ft?: number | null;
  flight_category?: string | null;
}

export interface FlightCatPredictionResult {
  icao: string;
  latestObsTime: string;
  latestRawMetar: string;
  currentCategory: FlightCategoryCode;
  predictedWorstCategory: FlightCategoryCode;
  confidencePercent: number;
  classProbabilities: {
    VFR: number;
    MVFR: number;
    IFR: number;
    LIFR: number;
  };
  summary: string;
  indicators: {
    currentVisM: number;
    lowestCeilingFt: number | null;
    ceilDiff1h: number;
    dewpointSpread: number;
    windSpeed: number;
  };
}

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

const CAT_TO_IDX: Record<FlightCategoryCode, number> = {
  VFR: 0,
  MVFR: 1,
  IFR: 2,
  LIFR: 3,
};

const IDX_TO_CAT: FlightCategoryCode[] = ["VFR", "MVFR", "IFR", "LIFR"];

export async function runFlightCategoryPrediction(
  icao: string,
  recordsAsc: FlightCatMetarRecord[],
  customModelUrl?: string,
): Promise<FlightCatPredictionResult> {
  if (recordsAsc.length < 5) {
    throw new Error(
      `Data ${icao} baru ${recordsAsc.length} baris. Minimal butuh 5 observasi terakhir (2 jam) untuk menghitung tren ceiling dan visibilitas.`,
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

  const currCeil = curr.lowest_ceiling_ft ?? 10000;
  const prev1hCeil = prev1h.lowest_ceiling_ft ?? currCeil;
  const ceilDiff1h = currCeil - prev1hCeil;

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

  const rawCat = (
    curr.flight_category || "VFR"
  ).toUpperCase() as FlightCategoryCode;
  const currentCategory: FlightCategoryCode =
    rawCat in CAT_TO_IDX ? rawCat : "VFR";
  const currentCatIdx = CAT_TO_IDX[currentCategory];

  // 18 fitur persis sesuai FEATURE_COLS di script training Python
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
    currCeil,
    ceilDiff1h,
    tempC,
    dewpointC,
    spread,
    spreadDiff1h,
    qnhHpa,
    qnhDiff1h,
    currentCatIdx,
  ]);

  const modelUrl =
    customModelUrl || `/models/flight_cat_${icao.toLowerCase()}.onnx`;
  let session: ort.InferenceSession;

  try {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} saat mengunduh model Flight Category.`,
      );
    }
    const modelBuffer = await response.arrayBuffer();
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal memuat model Flight Category (${icao}): ${detail}`);
  }

  const tensor = new ort.Tensor("float32", inputArray, [1, 18]);
  const results = await session.run({ float_input: tensor });

  const probOutputName =
    session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
    session.outputNames[session.outputNames.length - 1];
  const rawProbs = Array.from(results[probOutputName].data as Float32Array);

  // Susun probabilitas untuk 4 kategori (VFR, MVFR, IFR, LIFR)
  const probs = {
    VFR: Number(((rawProbs[0] ?? 0) * 100).toFixed(1)),
    MVFR: Number(((rawProbs[1] ?? 0) * 100).toFixed(1)),
    IFR: Number(((rawProbs[2] ?? 0) * 100).toFixed(1)),
    LIFR: Number(((rawProbs[3] ?? 0) * 100).toFixed(1)),
  };

  let bestIdx = 0;
  let bestVal = rawProbs[0] ?? 0;
  for (let i = 1; i < Math.min(4, rawProbs.length); i++) {
    if (rawProbs[i] > bestVal) {
      bestVal = rawProbs[i];
      bestIdx = i;
    }
  }

  const predictedWorstCategory = IDX_TO_CAT[bestIdx] || "VFR";
  const confidencePercent = Math.min(
    100,
    Math.max(0, Number((bestVal * 100).toFixed(1))),
  );

  let summary =
    "Operasi penerbangan diprakirakan tetap dalam kondisi Visual Flight Rules (VFR) dalam 1–3 jam ke depan tanpa penurunan ceiling signifikan.";

  if (predictedWorstCategory === "LIFR" || predictedWorstCategory === "IFR") {
    summary = `Peringatan Minimum Aerodrome (${predictedWorstCategory}): Terdeteksi peluang tinggi penurunan ceiling awan rendah (<1.000 ft) atau jarak pandang (<3.000 m) dalam 1–3 jam ke depan.`;
  } else if (predictedWorstCategory === "MVFR") {
    summary =
      "Waspada Marginal VFR (MVFR): Berpotensi terjadi pembentukan awan BKN/OVC di bawah 3.000 ft atau penurunan visibilitas ke kisaran 3.000–5.000 m.";
  }

  return {
    icao,
    latestObsTime: curr.obs_time,
    latestRawMetar: curr.raw_metar,
    currentCategory,
    predictedWorstCategory,
    confidencePercent,
    classProbabilities: probs,
    summary,
    indicators: {
      currentVisM,
      lowestCeilingFt: curr.lowest_ceiling_ft ?? null,
      ceilDiff1h,
      dewpointSpread: spread,
      windSpeed,
    },
  };
}
