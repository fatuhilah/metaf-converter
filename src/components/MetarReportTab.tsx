"use client";
import { useState, useMemo } from "react";
import {
  parseSingleMetar,
  translateWxToMetReport,
  translateCldToMetReport,
} from "@/utils/parser";
import { getStationByIcao } from "@/utils/stations";
import { Copy, Check, AlertCircle, MapPin } from "lucide-react";

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

// Ekstrak kode ICAO 4 huruf secara eksplisit tanpa fallback default
const extractIcaoCode = (rawLine: string): string => {
  const clean = rawLine.replace(/=.*$/g, "").trim().toUpperCase();
  const tokens = clean.split(/\s+/);
  const ignoreTokens = new Set([
    "METAR",
    "SPECI",
    "COR",
    "AUTO",
    "AMD",
    "RTD",
    "NIL",
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d{6}Z$/.test(t) || /^(\d{3}|VRB)P?\d{2,3}/.test(t)) {
      break;
    }
    if (ignoreTokens.has(t)) continue;
    if (/^[A-Z]{4}$/.test(t)) {
      return t;
    }
  }
  return "";
};

// Ekstrak token Recent Weather (misal: RERA, RETS, RETSRA, RESHRA)
const extractRecentWeather = (rawLine: string): string[] => {
  const clean = rawLine.replace(/=.*$/g, "").trim().toUpperCase();
  const tokens = clean.split(/\s+/);
  const recentRegex =
    /^RE(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/;
  const found: string[] = [];

  for (const t of tokens) {
    if (t === "RMK") break;
    if (recentRegex.test(t)) {
      found.push(t);
    }
  }
  return found;
};

export default function MetarReportTab() {
  const [inputText, setInputText] = useState("");
  const [qfeText, setQfeText] = useState("");
  const [qnhText, setQnhText] = useState("");
  const [reportOutput, setReportOutput] = useState("");

  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Deteksi otomatis info bandara & stasiun dari teks input
  const detectedStation = useMemo(() => {
    if (!inputText.trim()) return null;
    const code = extractIcaoCode(inputText.trim());
    if (!code) {
      return {
        icao: "",
        bandara: "",
        stasiun: "",
        found: false,
        missingIcao: true,
      };
    }
    const info = getStationByIcao(code);
    const bandara = getAirportName(info);
    const stasiun = getStationName(info);
    return {
      icao: code,
      bandara,
      stasiun,
      found: Boolean(info && bandara),
      missingIcao: false,
    };
  }, [inputText]);

  const handleGenerate = () => {
    if (!inputText.trim() || !qfeText.trim()) {
      showToastMsg("⚠️ Lengkapin dulu data METAR/SPECI dan QFE-nya ya...");
      return;
    }

    const stationCode = extractIcaoCode(inputText.trim());
    if (!stationCode) {
      setReportOutput("");
      showToastMsg(
        "⚠️ Kode ICAO stasiun tidak ditemukan! Wajib cantumkan 4 huruf kode ICAO.",
      );
      return;
    }

    const stationInfo = getStationByIcao(stationCode);
    const airportName = getAirportName(stationInfo);

    if (!stationInfo || !airportName) {
      setReportOutput("");
      showToastMsg(
        `⚠️ Kode ICAO "${stationCode}" tidak terdaftar di database stations.ts!`,
      );
      return;
    }

    const data = parseSingleMetar(inputText.trim());
    const recentWxTokens = extractRecentWeather(inputText.trim());

    const formattedAirport = airportName.toUpperCase().startsWith("BANDARA ")
      ? airportName.toUpperCase()
      : `BANDARA ${airportName.toUpperCase()}`;

    const headerLocation = `${formattedAirport} (${stationCode})`;

    let dateNum = parseInt(data.day, 10),
      now = new Date(),
      month = now.getUTCMonth(),
      year = now.getUTCFullYear();

    if (dateNum > now.getUTCDate() + 5) {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }

    let dateStr = `${dateNum.toString().padStart(2, "0")}/${(month + 1).toString().padStart(2, "0")}/${year}`;
    let timeStr =
      data.waktuZ !== "-"
        ? `${data.waktuZ.slice(0, 2)}.${data.waktuZ.slice(2, 4)} UTC`
        : "NIL";

    let windStr =
      data.windDir && data.windSpd
        ? `${data.windDir}/${data.windSpd}${data.windUnit}`
        : "NIL";
    let visStr =
      data.visMetar === "CAVOK" || data.visAngka === 10000
        ? "10 KM"
        : data.visAngka >= 5000
          ? `${Math.round(data.visAngka / 1000)} KM`
          : `${data.visAngka} M`;

    let wxStr = "NIL",
      cldStr = "NIL";
    if (data.visMetar !== "CAVOK") {
      if (data.wxTokens.length > 0)
        wxStr = data.wxTokens.map(translateWxToMetReport).join(", ");
      if (data.cloudTokens.length > 0) {
        let cldArr = data.cloudTokens.map(translateCldToMetReport);
        if (!cldArr.includes("NIL")) cldStr = cldArr.join(", ");
      }
    }

    let finalQnhRaw = qnhText.trim() || data.qnh;
    let finalQnhStr = "NIL";
    if (finalQnhRaw) {
      let safeQnh = finalQnhRaw.replace(",", ".");
      let hPaQnh = safeQnh.split(".")[0];
      if (safeQnh.includes(".")) {
        let inch = (parseFloat(safeQnh) * 0.0295299).toFixed(2);
        finalQnhStr = `${hPaQnh} hPa / ${inch} inHg`;
      } else {
        finalQnhStr = `${hPaQnh} hPa`;
      }
    }

    let finalQfeStr = "NIL";
    if (qfeText.trim()) {
      let safeQfe = qfeText.replace(",", ".");
      let hPaQfe = safeQfe.split(".")[0];
      if (safeQfe.includes(".")) {
        let inch = (parseFloat(safeQfe) * 0.0295299).toFixed(2);
        finalQfeStr = `${hPaQfe} hPa / ${inch} inHg`;
      } else {
        finalQfeStr = `${hPaQfe} hPa`;
      }
    }

    let reportTitle = data.type === "SPECI" ? "SPECIAL REPORT" : "MET REPORT";

    const reportLines = [
      `${reportTitle}`,
      headerLocation,
      `DATE : ${dateStr}`,
      `TIME : ${timeStr}`,
      `=================`,
      `WIND : ${windStr}`,
      `VIS  : ${visStr}`,
      `WX   : ${wxStr}`,
      `CLD  : ${cldStr}`,
      `TT/TD: ${data.tt && data.td ? `${data.tt}/${data.td} °C` : "NIL"}`,
      `QNH  : ${finalQnhStr}`,
      `QFE  : ${finalQfeStr}`,
      ...(recentWxTokens.length > 0
        ? [`REWX : ${recentWxTokens.join(", ")}`]
        : []),
      `TREND: ${data.trendTokens.join(" ") || "NOSIG"}`,
      `RMK  : ${data.rmkTokens.join(" ") || "NIL"}`,
    ];

    setReportOutput(reportLines.join("\n"));
    setCopied(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(reportOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 relative animate-in fade-in zoom-in-95 duration-300">
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in slide-in-from-bottom-5">
          <AlertCircle size={18} className="text-rose-400" />
          <span className="text-sm font-semibold">{toast}</span>
        </div>
      )}

      <div className="bg-white/80 p-5 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Wajib Input QFE (hPa):
            </label>
            <input
              type="text"
              value={qfeText}
              onChange={(e) => setQfeText(e.target.value)}
              placeholder="Contoh: 1011 atau 1011.2 (5 digit jika mau data inHg)"
              className="p-2 border border-slate-300 rounded-md text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Override QNH (hPa){" "}
              <span className="text-slate-400 font-normal italic">
                *Opsional (tulis 5 digit untuk data inhg)
              </span>
              :
            </label>
            <input
              type="text"
              value={qnhText}
              onChange={(e) => setQnhText(e.target.value)}
              placeholder="Kosongkan jika ngikut METAR"
              className="p-2 border border-slate-300 rounded-md text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Paste Data METAR / SPECI (Khusus 1 Baris):
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Paste data METAR / SPECI disini..."
            className="w-full h-24 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {detectedStation && (
            <div
              className={`mt-2 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                detectedStation.found
                  ? "text-slate-600 bg-slate-50 border-slate-200"
                  : "text-rose-700 bg-rose-50 border-rose-200"
              }`}
            >
              <MapPin
                size={14}
                className={`shrink-0 ${
                  detectedStation.found ? "text-blue-600" : "text-rose-600"
                }`}
              />
              {detectedStation.missingIcao ? (
                <span>
                  <span className="font-bold">Error:</span> Kode ICAO bandara
                  belum ditemukan pada sandi METAR/SPECI.
                </span>
              ) : detectedStation.found ? (
                <span>
                  Terdeteksi:{" "}
                  <span className="font-bold text-slate-800">
                    Bandara {detectedStation.bandara} ({detectedStation.icao})
                  </span>
                  {detectedStation.stasiun
                    ? ` — Stamet ${detectedStation.stasiun}`
                    : ""}
                </span>
              ) : (
                <span>
                  <span className="font-bold">Error:</span> Kode ICAO{" "}
                  <span className="font-bold">{detectedStation.icao}</span>{" "}
                  tidak terdaftar di master stasiun (stations.ts).
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleGenerate}
          className="px-6 py-3 w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-all active:scale-95"
        >
          Generate MET REPORT
        </button>
      </div>

      {reportOutput && (
        <div className="relative bg-blue-50 border border-blue-200 p-6 rounded-xl shadow-inner animate-in slide-in-from-top-4">
          <div className="absolute top-4 right-4">
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-md shadow-sm transition-all active:scale-95"
            >
              {copied ? (
                <Check size={14} className="text-emerald-600" />
              ) : (
                <Copy size={14} />
              )}
              {copied ? "Tersalin!" : "Salin Teks"}
            </button>
          </div>

          <pre className="font-mono text-sm md:text-base text-slate-800 leading-relaxed whitespace-pre-wrap mt-2">
            {reportOutput}
          </pre>
        </div>
      )}
    </div>
  );
}
