import * as ort from "onnxruntime-web";

export interface MetarDbRecord {
  icao_code: string;
  obs_time: string;
  raw_metar: string;
  wind_dir: number | null;
  is_vrb: boolean | null;
  wind_speed: number | null;
  visibility_m: number | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  dewpoint_spread: number | null;
  qnh_hpa: number | null;
  has_ts: boolean | null;
  has_cb: boolean | null;
}

export interface TsCbPredictionResult {
  icao: string;
  latestObsTime: string;
  latestRawMetar: string;
  probabilityPercent: number;
  riskLevel: "RENDAH" | "SEDANG" | "TINGGI";
  summary: string;
  keyIndicators: {
    tempC: number;
    dewpointSpread: number;
    qnhHpa: number;
    qnhDiff1h: number;
    windSpeed: number;
  };
}

// Konfigurasi WASM CDN tanpa pin versi agar selalu cocok dengan onnxruntime-web terinstal
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

export async function runTsCbPrediction(
  icao: string,
  recordsAsc: MetarDbRecord[],
  customModelUrl?: string,
): Promise<TsCbPredictionResult> {
  if (recordsAsc.length < 7) {
    throw new Error(
      `Data ${icao} di database baru ${recordsAsc.length} baris. Minimal butuh 7 observasi terakhir (3 jam) untuk menghitung tren.`,
    );
  }

  // Ambil 7 observasi terbaru (index 0 = -3 jam, index 4 = -1 jam, index 6 = terkini)
  const seq = recordsAsc.slice(-7);
  const curr = seq[6];
  const prev1h = seq[4];
  const prev3h = seq[0];

  const obsDate = new Date(curr.obs_time);
  const hourFloat = obsDate.getUTCHours() + obsDate.getUTCMinutes() / 60.0;
  const monthNum = obsDate.getUTCMonth() + 1;

  const hourSin = Math.sin((2 * Math.PI * hourFloat) / 24.0);
  const hourCos = Math.cos((2 * Math.PI * hourFloat) / 24.0);
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12.0);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12.0);

  const calcWindUV = (r: MetarDbRecord) => {
    if (r.is_vrb || r.wind_dir === null || r.wind_speed === null) {
      return { u: 0, v: 0 };
    }
    const rad = (r.wind_dir * Math.PI) / 180.0;
    return {
      u: -r.wind_speed * Math.sin(rad),
      v: -r.wind_speed * Math.cos(rad),
    };
  };

  const currWind = calcWindUV(curr);
  const prev1hWind = calcWindUV(prev1h);

  const windSpeed = curr.wind_speed ?? 0;
  const visibilityM = curr.visibility_m ?? 9999;
  const tempC = Number(curr.temp_c ?? 28);
  const dewpointC = Number(curr.dewpoint_c ?? 24);
  const spread =
    curr.dewpoint_spread !== null
      ? Number(curr.dewpoint_spread)
      : Number((tempC - dewpointC).toFixed(1));
  const qnhHpa = Number(curr.qnh_hpa ?? 1010);

  const prev1hTemp = Number(prev1h.temp_c ?? tempC);
  const prev1hDew = Number(prev1h.dewpoint_c ?? dewpointC);
  const prev1hSpread =
    prev1h.dewpoint_spread !== null
      ? Number(prev1h.dewpoint_spread)
      : prev1hTemp - prev1hDew;
  const prev1hQnh = Number(prev1h.qnh_hpa ?? qnhHpa);
  const prev3hQnh = Number(prev3h.qnh_hpa ?? qnhHpa);

  const tempDiff1h = tempC - prev1hTemp;
  const spreadDiff1h = spread - prev1hSpread;
  const qnhDiff1h = qnhHpa - prev1hQnh;
  const qnhDiff3h = qnhHpa - prev3hQnh;
  const windUDiff1h = currWind.u - prev1hWind.u;
  const windVDiff1h = currWind.v - prev1hWind.v;
  const currentTsCb = curr.has_ts || curr.has_cb ? 1.0 : 0.0;

  // Susun 19 fitur numerik persis sesuai urutan FEATURE_COLS di script training Python
  const inputArray = Float32Array.from([
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    currWind.u,
    currWind.v,
    windSpeed,
    visibilityM,
    tempC,
    dewpointC,
    spread,
    qnhHpa,
    tempDiff1h,
    spreadDiff1h,
    qnhDiff1h,
    qnhDiff3h,
    windUDiff1h,
    windVDiff1h,
    currentTsCb,
  ]);

  const modelUrl = customModelUrl || `/models/ts_cb_${icao.toLowerCase()}.onnx`;
  let session: ort.InferenceSession;

  try {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} saat mengunduh file model.`);
    }
    const modelBuffer = await response.arrayBuffer();
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal memuat model AI (${icao}): ${detail}`);
  }

  const tensor = new ort.Tensor("float32", inputArray, [1, 19]);
  const results = await session.run({ float_input: tensor });

  // Ambil probabilitas kelas 1 (Potensi TS/CB) dari output XGBoost ONNX
  const probOutputName =
    session.outputNames.find((n) => n.toLowerCase().includes("prob")) ||
    session.outputNames[session.outputNames.length - 1];
  const probTensor = results[probOutputName];
  const rawData = probTensor.data as Float32Array;
  const probTsCb = rawData.length >= 2 ? rawData[1] : rawData[0];
  const probPercent = Math.min(
    100,
    Math.max(0, Number((probTsCb * 100).toFixed(1))),
  );

  let riskLevel: "RENDAH" | "SEDANG" | "TINGGI" = "RENDAH";
  let summary =
    "Atmosfer permukaan relatif stabil. Peluang pertumbuhan awan CB/TS lokal dalam 1–3 jam ke depan rendah.";

  if (probPercent >= 65) {
    riskLevel = "TINGGI";
    summary =
      "Peringatan Dini Konvektif: Indikator tren tekanan, angin permukaan, dan kelembapan menunjukkan potensi tinggi pertumbuhan CB / TS dalam 1–3 jam ke depan.";
  } else if (probPercent >= 35) {
    riskLevel = "SEDANG";
    summary =
      "Waspada Pertumbuhan Awan Konvektif: Terdeteksi peningkatan ketidakstabilan lokal. Pantau perkembangan awan TCU/CB dan radar cuaca.";
  }

  return {
    icao,
    latestObsTime: curr.obs_time,
    latestRawMetar: curr.raw_metar,
    probabilityPercent: probPercent,
    riskLevel,
    summary,
    keyIndicators: {
      tempC,
      dewpointSpread: spread,
      qnhHpa,
      qnhDiff1h: Number(qnhDiff1h.toFixed(1)),
      windSpeed,
    },
  };
}
