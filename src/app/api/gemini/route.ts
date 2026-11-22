import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { getStationByIcao } from "@/utils/stations";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const getAirportName = (info: unknown): string => {
  if (!info || typeof info !== "object") return "";
  const record = info as Record<string, unknown>;

  const direct =
    record.nama_bandara ||
    record.namaBandara ||
    record.bandar_udara ||
    record.bandarUdara ||
    record.bandara ||
    record.airport ||
    record.airport_name ||
    record.airportName ||
    record.nama ||
    record.name;

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  for (const [key, val] of Object.entries(record)) {
    if (
      typeof val === "string" &&
      val.trim() &&
      !/^[A-Z]{4}$/.test(val.trim()) &&
      !key.toLowerCase().includes("stasiun") &&
      !key.toLowerCase().includes("station") &&
      !key.toLowerCase().includes("wmo")
    ) {
      return val.trim();
    }
  }

  return "";
};

const getStationName = (info: unknown): string => {
  if (!info || typeof info !== "object") return "";
  const record = info as Record<string, unknown>;

  const direct =
    record.nama_stasiun ||
    record.namaStasiun ||
    record.stasiun_meteorologi ||
    record.stasiunMeteorologi ||
    record.stasiun ||
    record.station ||
    record.station_name ||
    record.stationName;

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  for (const [key, val] of Object.entries(record)) {
    if (
      typeof val === "string" &&
      val.trim() &&
      (key.toLowerCase().includes("stasiun") ||
        key.toLowerCase().includes("station"))
    ) {
      return val.trim();
    }
  }

  return "";
};

const extractIcaoList = (dataMetar: unknown, period?: string): string[] => {
  const codes = new Set<string>();

  if (Array.isArray(dataMetar)) {
    for (const item of dataMetar) {
      if (item && typeof item === "object" && "station" in item) {
        const st = String((item as Record<string, unknown>).station || "")
          .trim()
          .toUpperCase();
        if (/^[A-Z]{4}$/.test(st)) {
          codes.add(st);
        }
      }
    }
  }

  // Fallback ekstraksi kode ICAO dari raw header TAF pada parameter period (misal: "TAF WALS 210500Z...")
  if (codes.size === 0 && typeof period === "string" && period.trim()) {
    const tafMatch = period
      .toUpperCase()
      .match(/\bTAF(?:\s+(?:AMD|COR))?\s+([A-Z]{4})\b/);
    if (tafMatch && tafMatch[1]) {
      codes.add(tafMatch[1]);
    }
  }

  return Array.from(codes);
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { dataMetar, timezone, period, reportType = "METAR" } = body;

    const isTaf = reportType === "TAF";
    const hasSpeci =
      Array.isArray(dataMetar) &&
      dataMetar.some(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "SPECI",
      );

    const reportName = isTaf
      ? "TAF (Aerodrome Forecast)"
      : hasSpeci
        ? "METAR dan SPECI"
        : "METAR";
    const paragraphLimit = isTaf ? "1 paragraf" : "2 paragraf";

    // Bangun konteks identitas bandara secara dinamis dari stations.ts
    const icaoList = extractIcaoList(dataMetar, period);
    const stationDescriptions = icaoList
      .map((code) => {
        const info = getStationByIcao(code);
        const bandara = getAirportName(info);
        const stasiun = getStationName(info);

        const formattedAirport = bandara.toLowerCase().startsWith("bandara ")
          ? bandara
          : `Bandara ${bandara}`;

        if (bandara && stasiun) {
          return `${code} adalah kode ICAO untuk ${formattedAirport} (Stasiun Meteorologi ${stasiun})`;
        }
        if (bandara) {
          return `${code} adalah kode ICAO untuk ${formattedAirport}`;
        }
        return `${code} adalah kode ICAO bandara terkait`;
      })
      .join("; ");

    const stationRule = stationDescriptions
      ? `${stationDescriptions}.`
      : "Sebutkan nama bandara sesuai kode ICAO yang tercantum pada data.";

    const systemPrompt = `
      Anda adalah seorang ahli meteorologi penerbangan. 
      Berikut adalah data hasil ekstraksi dari laporan ${reportName} untuk periode ${period}:
      ${JSON.stringify(dataMetar, null, 2)}
      
      Tugas Anda: Berikan interpretasi dan ringkasan kondisi cuaca secara keseluruhan berdasarkan data di atas. 
      Gunakan bahasa Indonesia yang profesional dan mudah dipahami.
      Aturan ketat: 
1. Maksimal buat dalam ${paragraphLimit} saja.
2. JANGAN gunakan format markdown, JANGAN gunakan simbol asterisk (*), dan JANGAN gunakan simbol dolar ($).
3. Gunakan bahasa yang formal dan profesional, hindari bahasa santai atau slang.
4. Tulis murni menggunakan plain text (teks biasa).
5. Untuk derajat celcius gunakan simbol °C dan untuk ketinggian awan gunakan feet.
6. WAKTU DAN TANGGAL: Pengguna saat ini melihat data dalam zona waktu ${timezone}. 
         Gunakan waktu tersebut dalam analisis Anda (jangan gunakan Z atau UTC jika zona waktunya bukan UTC, misalnya WIB, WITA, atau WIT).
         Saat menyebutkan tanggal di paragraf, WAJIB tuliskan LENGKAP dengan bulan dan tahun.
7. INFORMASI BANDARA: ${stationRule}
      
      Berikan jawaban atau analisis profesional Anda:
    `;

    const interaction = await (ai as any).interactions.create({
      model: "gemini-3.6-flash",
      input: systemPrompt,
    });

    return NextResponse.json({ reply: interaction.output_text });
  } catch (error: any) {
    console.error("Gemini API Error Detail:", error?.message || error);
    return NextResponse.json(
      { reply: `Gagal: ${error?.message || "Kesalahan Server."}` },
      { status: 500 },
    );
  }
}
