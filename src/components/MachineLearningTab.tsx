"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Database,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  MapPin,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
// SESUAIKAN PATH INI dengan letak file stations.ts di project lu:
import * as stationsModule from "@/utils/stations";
import MlModulesWorkspace from "@/components/MlModulesWorkspace";

interface StationOption {
  icao: string;
  label: string;
}

interface ParsedMetarRow {
  icao_code: string;
  report_type: "METAR" | "SPECI";
  obs_time: string;
  raw_metar: string;
  wind_dir: number | null;
  is_vrb: boolean;
  wind_speed: number | null;
  wind_gust: number | null;
  visibility_m: number | null;
  is_cavok: boolean;
  temp_c: number | null;
  dewpoint_c: number | null;
  dewpoint_spread: number | null;
  qnh_hpa: number | null;
  weather_phenomena: string[];
  has_ts: boolean;
  has_cb: boolean;
  lowest_ceiling_ft: number | null;
  flight_category: string;
  source: string;
}

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function extractStationsFromModule(
  mod: Record<string, unknown>,
): StationOption[] {
  const raw =
    mod.default ||
    mod.stations ||
    mod.STATIONS ||
    Object.values(mod).find(
      (v) => Array.isArray(v) || (typeof v === "object" && v !== null),
    );

  const list: StationOption[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && /^[A-Z]{4}$/.test(item)) {
        list.push({ icao: item, label: item });
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const code = String(
          obj.icao || obj.code || obj.icao_code || obj.id || "",
        ).toUpperCase();
        const name = String(
          obj.name || obj.station || obj.airport || obj.city || "",
        );
        if (/^[A-Z]{4}$/.test(code)) {
          list.push({
            icao: code,
            label: name ? `${code} — ${name}` : code,
          });
        }
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const code = key.toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) continue;
      if (typeof val === "string") {
        list.push({ icao: code, label: `${code} — ${val}` });
      } else if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        const name = String(obj.name || obj.airport || obj.city || "");
        list.push({
          icao: code,
          label: name ? `${code} — ${name}` : code,
        });
      }
    }
  }

  return list.sort((a, b) => a.icao.localeCompare(b.icao));
}

function parseMetarLine(
  line: string,
  year: number,
  month: number,
): ParsedMetarRow | null {
  const clean = line.trim().replace(/=$/, "").replace(/\s+/g, " ");
  if (!clean) return null;

  const tokens = clean.split(" ");
  let idx = 0;

  let reportType: "METAR" | "SPECI" = "METAR";
  if (tokens[idx] === "METAR" || tokens[idx] === "SPECI") {
    reportType = tokens[idx] as "METAR" | "SPECI";
    idx++;
  }
  if (tokens[idx] === "COR") idx++;

  const icaoMatch = tokens[idx]?.match(/^[A-Z]{4}$/);
  if (!icaoMatch) return null;
  const icaoCode = tokens[idx];
  idx++;

  const timeMatch = tokens[idx]?.match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (!timeMatch) return null;
  const day = parseInt(timeMatch[1], 10);
  const hour = parseInt(timeMatch[2], 10);
  const minute = parseInt(timeMatch[3], 10);
  const obsDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (isNaN(obsDate.getTime())) return null;
  idx++;

  if (tokens[idx] === "AUTO" || tokens[idx] === "NIL") idx++;

  let windDir: number | null = null;
  let isVrb = false;
  let windSpeed: number | null = null;
  let windGust: number | null = null;

  const windMatch = tokens[idx]?.match(
    /^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/,
  );
  if (windMatch) {
    if (windMatch[1] === "VRB") {
      isVrb = true;
    } else {
      windDir = parseInt(windMatch[1], 10);
    }
    const rawSpd = parseInt(windMatch[2], 10);
    const rawGust = windMatch[3] ? parseInt(windMatch[3], 10) : null;
    const factor = windMatch[4] === "MPS" ? 1.94384 : 1;
    windSpeed = Math.round(rawSpd * factor);
    windGust = rawGust !== null ? Math.round(rawGust * factor) : null;
    idx++;
  }

  if (tokens[idx]?.match(/^\d{3}V\d{3}$/)) idx++;

  let visibilityM: number | null = null;
  let isCavok = false;

  if (tokens[idx] === "CAVOK") {
    isCavok = true;
    visibilityM = 9999;
    idx++;
  } else if (tokens[idx]?.match(/^\d{4}$/)) {
    visibilityM = parseInt(tokens[idx], 10);
    idx++;
  }

  const weatherPhenomena: string[] = [];
  let hasTs = false;
  let hasCb = false;
  let lowestCeilingFt: number | null = null;
  let tempC: number | null = null;
  let dewpointC: number | null = null;
  let qnhHpa: number | null = null;

  const wxRegex =
    /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/;
  const cloudRegex = /^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/;
  const tempRegex = /^(M?\d{2})\/(M?\d{2})$/;
  const qnhRegex = /^Q(\d{4})$/;

  for (let i = idx; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk === "NOSIG" || tk === "BECMG" || tk === "TEMPO" || tk === "RMK") {
      break;
    }

    if (wxRegex.test(tk)) {
      weatherPhenomena.push(tk);
      if (tk.includes("TS")) hasTs = true;
      continue;
    }

    const cld = tk.match(cloudRegex);
    if (cld) {
      const cover = cld[1];
      const heightFt = parseInt(cld[2], 10) * 100;
      if (cld[3] === "CB") hasCb = true;
      if (cover === "BKN" || cover === "OVC" || cover === "VV") {
        if (lowestCeilingFt === null || heightFt < lowestCeilingFt) {
          lowestCeilingFt = heightFt;
        }
      }
      continue;
    }

    const tmp = tk.match(tempRegex);
    if (tmp) {
      const parseSigned = (s: string) =>
        s.startsWith("M") ? -parseInt(s.slice(1), 10) : parseInt(s, 10);
      tempC = parseSigned(tmp[1]);
      dewpointC = parseSigned(tmp[2]);
      continue;
    }

    const qnh = tk.match(qnhRegex);
    if (qnh) {
      qnhHpa = parseInt(qnh[1], 10);
      continue;
    }
  }

  const dewpointSpread =
    tempC !== null && dewpointC !== null
      ? Number((tempC - dewpointC).toFixed(1))
      : null;

  let flightCategory = "VFR";
  const vis = visibilityM ?? 9999;
  const ceil = lowestCeilingFt ?? 99999;

  if (vis < 1500 || ceil < 500) {
    flightCategory = "LIFR";
  } else if (vis < 3000 || ceil < 1000) {
    flightCategory = "IFR";
  } else if (vis <= 5000 || ceil <= 3000) {
    flightCategory = "MVFR";
  }

  return {
    icao_code: icaoCode,
    report_type: reportType,
    obs_time: obsDate.toISOString(),
    raw_metar: clean,
    wind_dir: windDir,
    is_vrb: isVrb,
    wind_speed: windSpeed,
    wind_gust: windGust,
    visibility_m: visibilityM,
    is_cavok: isCavok,
    temp_c: tempC,
    dewpoint_c: dewpointC,
    dewpoint_spread: dewpointSpread,
    qnh_hpa: qnhHpa,
    weather_phenomena: weatherPhenomena,
    has_ts: hasTs,
    has_cb: hasCb,
    lowest_ceiling_ft: lowestCeilingFt,
    flight_category: flightCategory,
    source: "MANUAL_UPLOAD",
  };
}

export default function MachineLearningTab() {
  const stationOptions = useMemo(
    () => extractStationsFromModule(stationsModule as Record<string, unknown>),
    [],
  );

  const [selectedIcao, setSelectedIcao] = useState<string>("ALL");

  const [dbCount, setDbCount] = useState<number | null>(null);
  const [dbStatus, setDbStatus] = useState<"CHECKING" | "CONNECTED" | "ERROR">(
    "CHECKING",
  );
  const [dbErrorMsg, setDbErrorMsg] = useState("");

  // Switcher Mode: "DB_INGEST" (Input ke Supabase) vs "DB_EXPORT_CSV" (Download CSV dari Supabase untuk Colab)
  const [warehouseTab, setWarehouseTab] = useState<
    "DB_INGEST" | "DB_EXPORT_CSV"
  >("DB_INGEST");

  const now = new Date();

  // State Mode 1: Input Arsip ke Database Supabase
  const [archiveYear, setArchiveYear] = useState(now.getUTCFullYear());
  const [archiveMonth, setArchiveMonth] = useState(now.getUTCMonth() + 1);
  const [rawArchiveInput, setRawArchiveInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // State Mode 2: Download CSV Langsung dari Database Supabase (Multi-Tahun untuk Google Colab)
  const [exportIcao, setExportIcao] = useState<string>("ALL");
  const [exportStartYear, setExportStartYear] = useState(now.getUTCFullYear());
  const [exportStartMonth, setExportStartMonth] = useState(1);
  const [exportEndYear, setExportEndYear] = useState(now.getUTCFullYear());
  const [exportEndMonth, setExportEndMonth] = useState(now.getUTCMonth() + 1);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const [uploadFeedback, setUploadFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchDbStats = useCallback(async () => {
    if (!supabase) {
      setDbStatus("ERROR");
      setDbErrorMsg(
        "Env NEXT_PUBLIC_SUPABASE_URL / ANON_KEY belum diisi di .env.local",
      );
      return;
    }

    setDbStatus("CHECKING");
    let query = supabase
      .from("metar_observations")
      .select("*", { count: "exact", head: true });

    if (selectedIcao !== "ALL") {
      query = query.eq("icao_code", selectedIcao);
    }

    const { count, error } = await query;

    if (error) {
      setDbStatus("ERROR");
      setDbErrorMsg(error.message);
    } else {
      setDbStatus("CONNECTED");
      setDbCount(count ?? 0);
      setDbErrorMsg("");
    }
  }, [selectedIcao]);

  useEffect(() => {
    fetchDbStats();
  }, [fetchDbStats]);

  // Sinkronkan filter stasiun export saat user mengganti stasiun di header
  useEffect(() => {
    setExportIcao(selectedIcao);
  }, [selectedIcao]);

  // MODE 1: Parse & Simpan ke Database Supabase
  const handleIngestToSupabase = async () => {
    if (!supabase) return;
    setUploadFeedback(null);

    const lines = rawArchiveInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setUploadFeedback({
        type: "error",
        text: "Tempelkan minimal 1 baris data METAR/SPECI terlebih dahulu.",
      });
      return;
    }

    const parsedRows: ParsedMetarRow[] = [];
    let skipped = 0;
    const detectedIcaos = new Set<string>();

    for (const line of lines) {
      const row = parseMetarLine(line, archiveYear, archiveMonth);
      if (row) {
        parsedRows.push(row);
        detectedIcaos.add(row.icao_code);
      } else {
        skipped++;
      }
    }

    if (parsedRows.length === 0) {
      setUploadFeedback({
        type: "error",
        text: "Tidak ada baris yang valid. Pastikan tiap baris memuat kode ICAO (4 huruf) dan waktu DDHHMMZ.",
      });
      return;
    }

    const uniqueMap = new Map<string, ParsedMetarRow>();
    for (const r of parsedRows) {
      uniqueMap.set(`${r.icao_code}_${r.report_type}_${r.obs_time}`, r);
    }
    const dedupedRows = Array.from(uniqueMap.values());

    setIsUploading(true);
    try {
      const BATCH_SIZE = 500;
      for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
        const chunk = dedupedRows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("metar_observations")
          .upsert(chunk, {
            onConflict: "icao_code,report_type,obs_time",
          });

        if (error) throw error;
      }

      const icaoSummary = Array.from(detectedIcaos).join(", ");
      setUploadFeedback({
        type: "success",
        text: `Berhasil menyimpan ${dedupedRows.length} observasi (${icaoSummary}) ke Database${
          skipped > 0 ? ` (${skipped} baris non-METAR dilewati)` : ""
        }.`,
      });
      setRawArchiveInput("");

      if (detectedIcaos.size === 1) {
        const onlyIcao = Array.from(detectedIcaos)[0];
        if (stationOptions.some((s) => s.icao === onlyIcao)) {
          setSelectedIcao(onlyIcao);
        }
      }
      fetchDbStats();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Gagal menyimpan data ke Supabase.";
      setUploadFeedback({
        type: "error",
        text: `Error Supabase: ${msg}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  // MODE 2: Tarik Data dari Database Supabase & Download sebagai 1 File CSV (Untuk Google Colab)
  const handleExportDbToColabCsv = async () => {
    if (!supabase) return;
    setUploadFeedback(null);

    const startKey = exportStartYear * 100 + exportStartMonth;
    const endKey = exportEndYear * 100 + exportEndMonth;

    if (startKey > endKey) {
      setUploadFeedback({
        type: "error",
        text: "Rentang periode tidak valid: Tahun/Bulan Awal tidak boleh melebihi Tahun/Bulan Akhir.",
      });
      return;
    }

    const startIso = new Date(
      Date.UTC(exportStartYear, exportStartMonth - 1, 1, 0, 0, 0),
    ).toISOString();
    // Awal bulan berikutnya (exclusive upper bound) agar mencakup seluruh hari terakhir di bulan akhir
    const endIsoExclusive = new Date(
      Date.UTC(exportEndYear, exportEndMonth, 1, 0, 0, 0),
    ).toISOString();

    setIsExportingCsv(true);
    try {
      const allRecords: Record<string, unknown>[] = [];
      const BATCH_SIZE = 1000;
      let startIdx = 0;

      while (true) {
        let query = supabase
          .from("metar_observations")
          .select(
            "icao_code,obs_time,raw_metar,wind_dir,is_vrb,wind_speed,wind_gust,visibility_m,temp_c,dewpoint_c,dewpoint_spread,qnh_hpa,weather_phenomena,has_ts,has_cb,lowest_ceiling_ft,flight_category",
          )
          .gte("obs_time", startIso)
          .lt("obs_time", endIsoExclusive)
          .order("obs_time", { ascending: true })
          .range(startIdx, startIdx + BATCH_SIZE - 1);

        if (exportIcao !== "ALL") {
          query = query.eq("icao_code", exportIcao);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;

        allRecords.push(...data);
        if (data.length < BATCH_SIZE) break;
        startIdx += BATCH_SIZE;
      }

      if (allRecords.length === 0) {
        setUploadFeedback({
          type: "error",
          text: `Tidak ditemukan data di Database untuk ${
            exportIcao === "ALL" ? "Semua Stasiun" : exportIcao
          } pada rentang ${exportStartYear}-${String(exportStartMonth).padStart(2, "0")} s/d ${exportEndYear}-${String(exportEndMonth).padStart(2, "0")}.`,
        });
        return;
      }

      const csvHeader =
        "icao_code,obs_time,raw_metar,wind_dir,is_vrb,wind_speed,wind_gust,visibility_m,temp_c,dewpoint_c,dewpoint_spread,qnh_hpa,weather_phenomena,has_ts,has_cb,lowest_ceiling_ft,flight_category";

      const csvRows = [csvHeader];
      for (const r of allRecords) {
        const rawStr = String(r.raw_metar ?? "");
        const safeRaw = `"${rawStr.replace(/"/g, '""')}"`;

        const wxVal = Array.isArray(r.weather_phenomena)
          ? r.weather_phenomena.join(" ")
          : String(r.weather_phenomena ?? "");
        const safeWx = `"${wxVal.replace(/"/g, '""')}"`;

        csvRows.push(
          [
            r.icao_code ?? "",
            r.obs_time ?? "",
            safeRaw,
            r.wind_dir ?? "",
            r.is_vrb ?? false,
            r.wind_speed ?? "",
            r.wind_gust ?? "",
            r.visibility_m ?? "",
            r.temp_c ?? "",
            r.dewpoint_c ?? "",
            r.dewpoint_spread ?? "",
            r.qnh_hpa ?? "",
            safeWx,
            r.has_ts ?? false,
            r.has_cb ?? false,
            r.lowest_ceiling_ft ?? "",
            r.flight_category ?? "VFR",
          ].join(","),
        );
      }

      const csvContent = "\uFEFF" + csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const icaoTag =
        exportIcao === "ALL" ? "all_stations" : exportIcao.toLowerCase();
      const startTag = `${exportStartYear}${String(exportStartMonth).padStart(2, "0")}`;
      const endTag = `${exportEndYear}${String(exportEndMonth).padStart(2, "0")}`;
      const fileName =
        startTag === endTag
          ? `dataset_${icaoTag}_${startTag}.csv`
          : `dataset_${icaoTag}_${startTag}_to_${endTag}.csv`;

      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setUploadFeedback({
        type: "success",
        text: `Berhasil mengunduh ${allRecords.length.toLocaleString("id-ID")} baris observasi dari Database ke '${fileName}' (siap di-upload ke Google Colab).`,
      });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Gagal mengekspor data dari Supabase.";
      setUploadFeedback({
        type: "error",
        text: `Error Export CSV: ${msg}`,
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleAutoSelectIcao = (icao: string) => {
    if (stationOptions.some((s) => s.icao === icao)) {
      setSelectedIcao(icao);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. PANEL STATUS DATABASE SUPABASE & FILTER STASIUN */}
      <section className="bg-white/90 border border-slate-200/90 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-slate-800 text-white shrink-0">
              <Database size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base md:text-lg font-extrabold text-slate-800">
                  Dataset Warehouse
                </h2>
                {dbStatus === "CONNECTED" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Terhubung ({dbCount?.toLocaleString("id-ID")} baris{" "}
                    {selectedIcao === "ALL" ? "Total" : selectedIcao})
                  </span>
                )}
                {dbStatus === "CHECKING" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                    Mengecek koneksi...
                  </span>
                )}
                {dbStatus === "ERROR" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">
                    Belum Terhubung
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Dataset otomatis dipisahkan per kode ICAO stasiun agar setiap
                bandara memiliki karakteristik model ML/DL tersendiri.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5">
              <MapPin size={15} className="text-[#b84a39] shrink-0" />
              <select
                value={selectedIcao}
                onChange={(e) => setSelectedIcao(e.target.value)}
                aria-label="Pilih Stasiun ICAO"
                className="bg-transparent text-xs font-extrabold text-slate-800 focus:outline-none cursor-pointer max-w-[230px]"
              >
                <option value="ALL">Semua Stasiun (Global)</option>
                {stationOptions.map((st) => (
                  <option key={st.icao} value={st.icao}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={fetchDbStats}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {dbStatus === "ERROR" && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{dbErrorMsg}</span>
          </div>
        )}

        {/* SWITCHER TERPISAH: INPUT DATABASE VS EXPORT CSV COLAB */}
        <div className="mt-4">
          <div className="inline-flex flex-wrap p-1 rounded-xl bg-slate-100 border border-slate-200 mb-4 gap-1">
            <button
              type="button"
              onClick={() => {
                setWarehouseTab("DB_INGEST");
                setUploadFeedback(null);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                warehouseTab === "DB_INGEST"
                  ? "bg-gradient-to-r from-[#b84a39] to-[#c95644] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <UploadCloud size={15} />
              1. Input Arsip ke Database
            </button>

            <button
              type="button"
              onClick={() => {
                setWarehouseTab("DB_EXPORT_CSV");
                setUploadFeedback(null);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                warehouseTab === "DB_EXPORT_CSV"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileSpreadsheet size={15} />
              2. Download CSV untuk Google Colab
            </button>
          </div>

          {/* TAB 1: INPUT ARSIP KE DATABASE SUPABASE */}
          {warehouseTab === "DB_INGEST" && (
            <div className="space-y-3 p-4 rounded-2xl bg-rose-50/40 border border-rose-200/70">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">
                    Tahun Arsip:
                  </label>
                  <input
                    type="number"
                    min={2000}
                    max={2099}
                    value={archiveYear}
                    onChange={(e) => setArchiveYear(Number(e.target.value))}
                    className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-[#b84a39]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">
                    Bulan Arsip:
                  </label>
                  <select
                    value={archiveMonth}
                    onChange={(e) => setArchiveMonth(Number(e.target.value))}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-[#b84a39]"
                  >
                    {MONTHS_ID.map((nama, idx) => (
                      <option key={nama} value={idx + 1}>
                        {idx + 1} - {nama}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="text-[11px] text-slate-500">
                  *Kode ICAO terdeteksi otomatis dari masing-masing baris sandi
                  dan disimpan ke Database.
                </span>
              </div>

              <textarea
                rows={4}
                value={rawArchiveInput}
                onChange={(e) => setRawArchiveInput(e.target.value)}
                placeholder="Paste arsip data METAR / SPECI bulanan di sini (1 baris per sandi, contoh: METAR XXXX 260000Z 14006KT 9999 FEW020 28/23 Q1011=)..."
                className="w-full p-3.5 rounded-xl border border-slate-300 bg-white font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#b84a39]/30 focus:border-[#b84a39]"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={handleIngestToSupabase}
                  disabled={isUploading || dbStatus !== "CONNECTED"}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#b84a39] to-[#c95644] hover:from-[#a33e2e] hover:to-[#b84a39] disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
                >
                  <UploadCloud size={16} />
                  {isUploading
                    ? "Menyimpan ke Supabase..."
                    : "Parse & Simpan ke Database"}
                </button>

                {uploadFeedback && (
                  <div
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold ${
                      uploadFeedback.type === "success"
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : "bg-rose-50 text-rose-800 border border-rose-200"
                    }`}
                  >
                    {uploadFeedback.type === "success" ? (
                      <CheckCircle2 size={15} className="shrink-0" />
                    ) : (
                      <AlertTriangle size={15} className="shrink-0" />
                    )}
                    <span>{uploadFeedback.text}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: DOWNLOAD CSV DARI DATABASE (MULTI-TAHUN UNTUK GOOGLE COLAB) */}
          {warehouseTab === "DB_EXPORT_CSV" && (
            <div className="space-y-3.5 p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/80">
              <p className="text-xs text-emerald-900 font-medium">
                Tarik langsung data observasi yang sudah tersimpan di Database
                menjadi <b>1 file CSV gabungan</b> (mendukung rentang
                multi-bulan &amp; bertahun-tahun) untuk di-upload ke Google
                Colab.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                {/* Filter Stasiun ICAO */}
                <div className="flex items-center gap-2 bg-white border border-emerald-200 px-2.5 py-1.5 rounded-xl">
                  <span className="text-xs font-bold text-emerald-900">
                    Stasiun:
                  </span>
                  <select
                    value={exportIcao}
                    onChange={(e) => setExportIcao(e.target.value)}
                    aria-label="Stasiun Export CSV"
                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600 max-w-[200px]"
                  >
                    <option value="ALL">Semua Stasiun</option>
                    {stationOptions.map((st) => (
                      <option key={st.icao} value={st.icao}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Rentang Awal */}
                <div className="flex items-center gap-2 bg-white border border-emerald-200 px-2.5 py-1.5 rounded-xl">
                  <span className="text-xs font-bold text-emerald-900">
                    Dari:
                  </span>
                  <input
                    type="number"
                    min={2000}
                    max={2099}
                    value={exportStartYear}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      setExportStartYear(y);
                      if (y > exportEndYear) setExportEndYear(y);
                    }}
                    aria-label="Tahun Awal Export"
                    className="w-20 px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                  />
                  <select
                    value={exportStartMonth}
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      setExportStartMonth(m);
                      if (
                        exportStartYear === exportEndYear &&
                        m > exportEndMonth
                      ) {
                        setExportEndMonth(m);
                      }
                    }}
                    aria-label="Bulan Awal Export"
                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                  >
                    {MONTHS_ID.map((nama, idx) => (
                      <option key={nama} value={idx + 1}>
                        {idx + 1} - {nama}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Rentang Akhir */}
                <div className="flex items-center gap-2 bg-white border border-emerald-200 px-2.5 py-1.5 rounded-xl">
                  <span className="text-xs font-bold text-emerald-900">
                    Sampai:
                  </span>
                  <input
                    type="number"
                    min={2000}
                    max={2099}
                    value={exportEndYear}
                    onChange={(e) => setExportEndYear(Number(e.target.value))}
                    aria-label="Tahun Akhir Export"
                    className="w-20 px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                  />
                  <select
                    value={exportEndMonth}
                    onChange={(e) => setExportEndMonth(Number(e.target.value))}
                    aria-label="Bulan Akhir Export"
                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                  >
                    {MONTHS_ID.map((nama, idx) => (
                      <option key={nama} value={idx + 1}>
                        {idx + 1} - {nama}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleExportDbToColabCsv}
                  disabled={isExportingCsv || dbStatus !== "CONNECTED"}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
                >
                  <Download size={16} />
                  {isExportingCsv
                    ? "Mengambil Data dari Database..."
                    : "Download 1 CSV Gabungan (Untuk Google Colab)"}
                </button>

                {uploadFeedback && (
                  <div
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold ${
                      uploadFeedback.type === "success"
                        ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                        : "bg-rose-50 text-rose-800 border border-rose-200"
                    }`}
                  >
                    {uploadFeedback.type === "success" ? (
                      <CheckCircle2 size={15} className="shrink-0" />
                    ) : (
                      <AlertTriangle size={15} className="shrink-0" />
                    )}
                    <span>{uploadFeedback.text}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. KOMPONEN TERPISAH KHUSUS 8 MODUL ML/DL & MODEL REGISTRY */}
      <MlModulesWorkspace
        selectedIcao={selectedIcao}
        dbStatus={dbStatus}
        onAutoSelectIcao={handleAutoSelectIcao}
      />
    </div>
  );
}
