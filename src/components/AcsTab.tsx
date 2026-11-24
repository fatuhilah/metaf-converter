"use client";
import { useState, useRef, useMemo } from "react";
import {
  downloadAcsTemplate,
  processAcsWorkbooks,
  exportAcsExcelWorkbook,
  resolveAcsDivisor,
  AcsDivisorMode,
  AcsMetadata,
  AcsMonthlyAggregated,
  FullAcsWorkbookResult,
  MODEL_A_VIS_HEADERS,
  MODEL_A_CLOUD_HEADERS,
  MODEL_B_HEADERS,
  MODEL_C_HEADERS,
  MODEL_D_DIR_ROWS,
  MODEL_D_SPEED_COLS,
  MODEL_E_TEMP_COLS,
} from "@/utils/acsHelper";
import { MONTH_SHEETS } from "@/utils/tafExcelHelper";
import { getStationByIcao } from "@/utils/stations";
import {
  FileSpreadsheet,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  SlidersHorizontal,
  Building2,
  Layers,
  Presentation,
  Wind,
  Thermometer,
  Eye,
  Cloud,
} from "lucide-react";
import { toJpeg } from "html-to-image";

type AcsModelTab = "A" | "B" | "C" | "D" | "E";
type DisplayValueMode = "percent" | "frequency" | "infographic";
type InfographicSlideType = "combined" | "vis_cloud" | "wind" | "temp";

const extractAirportLabel = (info: unknown): string => {
  if (!info || typeof info !== "object") return "";
  const rec = info as Record<string, unknown>;
  const val =
    rec.nama_bandara ||
    rec.namaBandara ||
    rec.bandar_udara ||
    rec.bandarUdara ||
    rec.bandara ||
    rec.airport ||
    rec.airport_name ||
    rec.airportName ||
    rec.nama ||
    rec.name;
  return typeof val === "string" && val.trim() ? val.trim() : "";
};

const WIND_DIRECTION_NAMES: {
  short: string;
  full: string;
  degRange: string;
}[] = [
  { short: "N (Utara)", full: "Utara", degRange: "345°–015°" },
  { short: "NNE", full: "Utara Timur Laut", degRange: "015°–045°" },
  { short: "ENE", full: "Timur Laut", degRange: "045°–075°" },
  { short: "E (Timur)", full: "Timur", degRange: "075°–105°" },
  { short: "ESE", full: "Timur Tenggara", degRange: "105°–135°" },
  { short: "SSE", full: "Tenggara", degRange: "135°–165°" },
  { short: "S (Selatan)", full: "Selatan", degRange: "165°–195°" },
  { short: "SSW", full: "Selatan Barat Daya", degRange: "195°–225°" },
  { short: "WSW", full: "Barat Daya", degRange: "225°–255°" },
  { short: "W (Barat)", full: "Barat", degRange: "255°–285°" },
  { short: "WNW", full: "Barat Barat Laut", degRange: "285°–315°" },
  { short: "NNW", full: "Barat Laut", degRange: "315°–345°" },
];

export default function AcsTab() {
  const currentYear = new Date().getUTCFullYear();
  const [templateYear, setTemplateYear] = useState<string>(String(currentYear));
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [acsResult, setAcsResult] = useState<FullAcsWorkbookResult | null>(
    null,
  );

  // Pengaturan & Filter Tampilan
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(0);
  const [hasRvr, setHasRvr] = useState<boolean>(false);
  const [activeModel, setActiveModel] = useState<AcsModelTab>("B");
  const [displayMode, setDisplayMode] = useState<DisplayValueMode>("percent");
  const [activeSlide, setActiveSlide] =
    useState<InfographicSlideType>("combined");
  const [divisorMode, setDivisorMode] = useState<AcsDivisorMode>("auto");
  const [showGuide, setShowGuide] = useState<boolean>(true);

  // Input Manual Metadata Kop Stasiun (Lampiran III)
  const [meta, setMeta] = useState<AcsMetadata>({
    aerodrome: "",
    icao: "",
    latitude: "",
    longitude: "",
    elevationM: "",
    observationTime: "",
  });

  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableExportRef = useRef<HTMLDivElement>(null);

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const handleDownloadTemplate = () => {
    const parsedYear = parseInt(templateYear.trim(), 10);
    if (!parsedYear || parsedYear < 2000 || parsedYear > 2100) {
      showToastMsg("⚠️ Masukkan tahun yang valid (4 digit, contoh: 2026)!");
      return;
    }
    downloadAcsTemplate(parsedYear);
    showToastMsg(
      `✅ Template Excel ACS 12 Bulan Tahun ${parsedYear} berhasil diunduh!`,
    );
  };

  const handleMultiFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      const filesPayload: { name: string; buffer: ArrayBuffer }[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const buffer = await file.arrayBuffer();
        filesPayload.push({ name: file.name, buffer });
      }

      const processed = processAcsWorkbooks(filesPayload);
      if (processed.totalHourlyObsCount === 0) {
        showToastMsg(
          "⚠️ Tidak ditemukan data METAR jam penuh (:00 UTC) pada file yang diunggah!",
        );
        return;
      }

      setUploadedFileNames(filesPayload.map((f) => f.name));
      setAcsResult(processed);
      setShowGuide(false);

      const firstPopulated = processed.monthlyData.find((m) => m.tno > 0);
      if (firstPopulated) {
        setSelectedMonthIdx(firstPopulated.monthIndex);
      }

      if (processed.detectedIcao) {
        const code = processed.detectedIcao.toUpperCase();
        const stationInfo = getStationByIcao(code);
        const airportName = extractAirportLabel(stationInfo);
        setMeta((prev) => ({
          ...prev,
          icao: prev.icao || code,
          aerodrome:
            prev.aerodrome || (airportName ? `${airportName} (${code})` : code),
        }));
      }

      showToastMsg(
        `✅ Berhasil mengolah ${processed.totalHourlyObsCount} observasi jam penuh dari ${filesPayload.length} file (${processed.periodOfRecordStr})!`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToastMsg(`⚠️ Gagal memproses file Excel: ${msg}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleToggleRvr = (useRvr: boolean) => {
    setHasRvr(useRvr);
    if (!useRvr && activeModel === "A") {
      setActiveModel("B");
    }
  };

  const activeMonthData = useMemo(() => {
    if (!acsResult) return null;
    return acsResult.monthlyData[selectedMonthIdx] || null;
  }, [acsResult, selectedMonthIdx]);

  const activeDivisor = useMemo(() => {
    if (!activeMonthData) return 1;
    return resolveAcsDivisor(activeMonthData, divisorMode);
  }, [activeMonthData, divisorMode]);

  const handleExportExcel = () => {
    if (!acsResult || !activeMonthData) return;
    if (activeMonthData.tno === 0) {
      showToastMsg(
        `⚠️ Belum ada data METAR jam penuh pada bulan ${activeMonthData.monthName}!`,
      );
      return;
    }
    exportAcsExcelWorkbook(
      acsResult,
      selectedMonthIdx,
      hasRvr,
      divisorMode,
      meta,
    );
    showToastMsg(
      `✅ File Excel ACS Bulan ${activeMonthData.monthName} (${activeMonthData.periodOfRecordStr}) berhasil diunduh!`,
    );
  };

  const slideNameMap: Record<InfographicSlideType, string> = {
    combined: "Infografis_Gabungan_A-E",
    vis_cloud: "Infografis_Vis_TinggiDasar",
    wind: "Infografis_Angin_WindRose",
    temp: "Infografis_Suhu_Udara",
  };

  const handleDownloadJpg = async () => {
    if (!tableExportRef.current || !activeMonthData) return;
    try {
      const el = tableExportRef.current;
      const dataUrl = await toJpeg(el, {
        quality: 1,
        pixelRatio: 3,
        cacheBust: true,
        backgroundColor: "#ffffff",
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: {
          margin: "0",
        },
      });
      const link = document.createElement("a");
      const suffix =
        displayMode === "infographic"
          ? slideNameMap[activeSlide]
          : `Model_${activeModel}`;
      link.download = `ACS_${suffix}_${activeMonthData.monthName}_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch {
      showToastMsg("⚠️ Gagal mengunduh gambar JPG.");
    }
  };

  const formatCellVal = (freq: number, denom: number): string => {
    if (freq === 0) return "\u00A0";
    if (displayMode === "frequency") return String(freq);
    return ((freq / Math.max(1, denom)) * 100).toFixed(1);
  };

  const availableModels: { id: AcsModelTab; label: string; desc: string }[] = [
    ...(hasRvr
      ? [
          {
            id: "A" as AcsModelTab,
            label: "Model A",
            desc: "RVR / Visibility & Tinggi Dasar Awan (Alat)",
          },
        ]
      : []),
    { id: "B", label: "Model B", desc: "Visibility (Visual)" },
    { id: "C", label: "Model C", desc: "Tinggi Awan BKN/OVC (Visual)" },
    { id: "D", label: "Model D", desc: "Arah & Kecepatan Angin" },
    { id: "E", label: "Model E", desc: "Suhu Udara Permukaan" },
  ];

  const infographicSlides: {
    id: InfographicSlideType;
    label: string;
    desc: string;
  }[] = [
    {
      id: "combined",
      label: "Gabungan (A–E)",
      desc: "Ringkasan Seluruh Unsur",
    },
    {
      id: "vis_cloud",
      label: "Visibilitas & Tinggi Dasar",
      desc: hasRvr ? "Model A, B & C" : "Model B & C",
    },
    {
      id: "wind",
      label: "Angin (Wind Rose)",
      desc: "Model D",
    },
    {
      id: "temp",
      label: "Suhu Udara",
      desc: "Model E",
    },
  ];

  return (
    <div className="space-y-6 relative animate-in fade-in zoom-in-95 duration-300">
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in slide-in-from-bottom-5">
          <AlertCircle size={18} className="text-cyan-400" />
          <span className="text-sm font-semibold">{toast}</span>
        </div>
      )}

      {/* PANDUAN PENGGUNAAN MODUL ACS (COLLAPSIBLE) */}
      <div className="bg-amber-50/90 border border-amber-200 rounded-xl shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGuide((prev) => !prev)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-amber-100/60 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <BookOpen size={18} className="text-amber-700 shrink-0" />
            <span className="text-sm font-extrabold text-amber-950">
              Panduan Penggunaan & Ketentuan Perhitungan ACS
            </span>
          </div>
          <span className="text-xs font-bold text-amber-800 flex items-center gap-1">
            {showGuide ? (
              <>
                Sembunyikan <ChevronUp size={16} />
              </>
            ) : (
              <>
                Buka Panduan <ChevronDown size={16} />
              </>
            )}
          </span>
        </button>

        {showGuide && (
          <div className="px-5 pb-5 pt-2 border-t border-amber-200/80 text-xs text-slate-700 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 space-y-1.5">
                <div className="font-extrabold text-slate-900">
                  1. Input Data METAR (Boleh 30-Menitan)
                </div>
                <p className="leading-relaxed">
                  Unduh template Excel 12 bulan, lalu <i>copy-paste</i> sandi
                  METAR dari database. Tidak perlu menghapus data menit{" "}
                  <code className="bg-slate-100 px-1 rounded">:30</code> secara
                  manual—sistem otomatis menyaring{" "}
                  <b>jam penuh (00.00–23.00 UTC)</b>. Anda juga bisa langsung
                  mengunggah file Excel dari modul Verifikasi TAF.
                </p>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 space-y-1.5">
                <div className="font-extrabold text-slate-900">
                  2. Penggabungan Multi-Tahun (1–5 Tahun)
                </div>
                <p className="leading-relaxed">
                  Untuk menyusun laporan ACS periode 5 tahun (atau 2–4 tahun),
                  klik tombol <b>Upload File Excel</b> lalu pilih beberapa file
                  tahunan sekaligus (misal 2022–2026). Sistem otomatis
                  menjumlahkan frekuensi bulan yang sama lintas tahun.
                </p>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 space-y-1.5">
                <div className="font-extrabold text-slate-900">
                  3. Pilihan Model, Infografis & Pembagi (%)
                </div>
                <p className="leading-relaxed">
                  Gunakan <b>Tanpa RVR</b> untuk menghasilkan Model B–E, atau{" "}
                  <b>Dengan RVR</b> untuk lengkap <b>Model A–E</b>. Klik tab{" "}
                  <b>Infografis (16:9)</b> untuk memilih slide gabungan maupun
                  slide fokus per model siap ekspor JPG resolusi tinggi.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PANEL 1: DOWNLOAD TEMPLATE & MULTI-FILE UPLOAD */}
      <div className="bg-white/90 p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="text-teal-600" size={22} />
            Aerodrome Climatological Summary (ACS)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Pengolahan ringkasan klimatologi bandar udara per jam penuh
            (00.00–23.00 UTC) untuk periode 1 hingga 5 tahun (Model A–E &amp;
            Infografis 16:9).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
              1. Unduh Template Master ACS (12 Tab Bulan)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-white border border-slate-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-teal-500">
                <span className="text-xs font-bold text-slate-500 mr-2">
                  Tahun:
                </span>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={templateYear}
                  onChange={(e) => setTemplateYear(e.target.value)}
                  placeholder="2026"
                  className="w-20 text-sm font-bold text-slate-800 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Download size={16} /> Download Template .XLSX
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-800">
              2. Unggah File Excel (Bisa Pilih 1 s.d. 5+ File Sekaligus)
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleMultiFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Upload size={16} /> Upload File Excel (.XLSX)
              </button>
              {uploadedFileNames.length > 0 && (
                <span className="text-xs font-semibold text-slate-700 bg-white px-3 py-1.5 rounded-md border border-slate-200 flex items-center gap-1.5">
                  <CheckCircle2
                    size={14}
                    className="text-emerald-600 shrink-0"
                  />
                  {uploadedFileNames.length === 1
                    ? uploadedFileNames[0]
                    : `${uploadedFileNames.length} file tergabung (${uploadedFileNames.join(", ")})`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* PANEL INPUT MANUAL METADATA KOP STASIUN */}
        <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <Building2 size={15} className="text-slate-600" />
            3. Identitas Stasiun / Bandara (Kop Tabel &amp; Infografis ACS)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Aerodrome (Nama Bandara)
              </label>
              <input
                type="text"
                value={meta.aerodrome}
                onChange={(e) =>
                  setMeta({ ...meta, aerodrome: e.target.value })
                }
                placeholder="Contoh: APT Pranoto Samarinda (WALS)"
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Kode ICAO
              </label>
              <input
                type="text"
                maxLength={4}
                value={meta.icao}
                onChange={(e) =>
                  setMeta({ ...meta, icao: e.target.value.toUpperCase() })
                }
                placeholder="WALS"
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Latitude (Lintang)
              </label>
              <input
                type="text"
                value={meta.latitude}
                onChange={(e) => setMeta({ ...meta, latitude: e.target.value })}
                placeholder={`00° 22' 15" S`}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Longitude (Bujur)
              </label>
              <input
                type="text"
                value={meta.longitude}
                onChange={(e) =>
                  setMeta({ ...meta, longitude: e.target.value })
                }
                placeholder={`117° 15' 08" E`}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Elevation Above MSL (m)
              </label>
              <input
                type="text"
                value={meta.elevationM}
                onChange={(e) =>
                  setMeta({ ...meta, elevationM: e.target.value })
                }
                placeholder="15"
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* STATUS RINGKASAN & TOMBOL EXPORT */}
        {acsResult && activeMonthData && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800 text-white px-4 py-3 rounded-xl text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span>
                Periode Data:{" "}
                <span className="font-bold text-cyan-300">
                  {activeMonthData.periodOfRecordStr}
                </span>
              </span>
              <span>
                TNO Bulan Ini:{" "}
                <span className="font-bold text-emerald-400">
                  {activeMonthData.tno} jam
                </span>
              </span>
              <span>
                Total Hari Bulan Ini:{" "}
                <span className="font-bold text-amber-300">
                  {activeMonthData.totalDays} hari
                </span>
              </span>
              <span>
                Pembagi Model A/B/C:{" "}
                <span className="font-bold text-indigo-300">
                  {activeDivisor}
                </span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-all cursor-pointer"
              >
                <Download size={14} /> Export Excel ({activeMonthData.monthName}
                )
              </button>
              <button
                type="button"
                onClick={handleDownloadJpg}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-all cursor-pointer"
              >
                <ImageIcon size={14} />{" "}
                {displayMode === "infographic"
                  ? `Download JPG (${infographicSlides.find((s) => s.id === activeSlide)?.label})`
                  : `Download JPG (Model ${activeModel})`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PANEL 2: KONTROL FILTER & OUTPUT ACS (TABEL & INFOGRAFIS 16:9) */}
      {acsResult && activeMonthData && (
        <div className="space-y-4">
          <div className="bg-slate-100 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">Bulan:</span>
                <select
                  value={selectedMonthIdx}
                  onChange={(e) => setSelectedMonthIdx(Number(e.target.value))}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                >
                  {MONTH_SHEETS.map((mName, idx) => {
                    const mTno = acsResult.monthlyData[idx]?.tno || 0;
                    return (
                      <option key={mName} value={idx}>
                        {mName} (TNO: {mTno})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-300">
                <button
                  type="button"
                  onClick={() => handleToggleRvr(false)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    !hasRvr
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Tanpa RVR (Model B, C, D, E)
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleRvr(true)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    hasRvr
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Dengan RVR (Lengkap: Model A–E)
                </button>
              </div>

              {/* Sakelar Mode Tampilan: Persentase, Frekuensi, & Infografis 16:9 */}
              <div className="flex flex-wrap items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-300">
                <button
                  type="button"
                  onClick={() => setDisplayMode("percent")}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    displayMode === "percent"
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Hasil Persentase (%)
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayMode("frequency")}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    displayMode === "frequency"
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Frekuensi Kejadian
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayMode("infographic")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    displayMode === "infographic"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-indigo-700 hover:bg-indigo-50"
                  }`}
                >
                  <Presentation size={14} /> Infografis (16:9)
                </button>
              </div>
            </div>

            {/* Baris Sub-Tab Model ATAU Sub-Tab Slide Infografis + Pilihan Pembagi */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              {displayMode !== "infographic" ? (
                <div className="flex flex-wrap gap-2">
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActiveModel(m.id)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeModel === m.id
                          ? "bg-slate-900 text-white shadow-sm"
                          : "bg-white text-slate-700 hover:bg-slate-200 border border-slate-200"
                      }`}
                    >
                      <Layers size={14} />
                      <span>{m.label}</span>
                      <span className="hidden sm:inline font-normal opacity-80">
                        — {m.desc}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {infographicSlides.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveSlide(s.id)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeSlide === s.id
                          ? "bg-indigo-700 text-white shadow-sm"
                          : "bg-white text-slate-700 hover:bg-indigo-50 border border-slate-200"
                      }`}
                    >
                      <Presentation size={14} />
                      <span>{s.label}</span>
                      <span className="hidden sm:inline font-normal opacity-80">
                        — {s.desc}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {(displayMode === "infographic" ||
                ((activeModel === "A" ||
                  activeModel === "B" ||
                  activeModel === "C") &&
                  displayMode === "percent")) && (
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={14} className="text-slate-600" />
                  <span className="text-xs font-bold text-slate-600">
                    Pembagi (%):
                  </span>
                  <select
                    value={divisorMode}
                    onChange={(e) =>
                      setDivisorMode(e.target.value as AcsDivisorMode)
                    }
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700"
                  >
                    <option value="auto">
                      Otomatis (Ikuti Contoh SOP:{" "}
                      {activeMonthData.yearsIncluded.length <= 1
                        ? `${activeMonthData.totalDays} Hari`
                        : `TNO ${activeMonthData.tno}`}
                      )
                    </option>
                    <option value="days">
                      Selalu Jumlah Hari ({activeMonthData.totalDays} Hari)
                    </option>
                    <option value="tno">
                      Selalu TNO Gabungan ({activeMonthData.tno} Jam)
                    </option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* ==============================================================
              AREA PREVIEW & EXPORT JPG (INFOGRAFIS 16:9 ATAU TABEL BAKU)
             ============================================================== */}
          <div className="bg-slate-200/70 p-4 rounded-xl overflow-x-auto">
            {displayMode === "infographic" ? (
              <AcsInfographicSlide
                exportRef={tableExportRef}
                mData={activeMonthData}
                meta={meta}
                hasRvr={hasRvr}
                activeDivisor={activeDivisor}
                slideType={activeSlide}
              />
            ) : (
              <div
                ref={tableExportRef}
                style={{
                  backgroundColor: "#ffffff",
                  color: "#0f172a",
                  width: "920px",
                }}
                className="mx-auto p-6 rounded-xl shadow-md border border-slate-300 space-y-4"
              >
                {/* KOP RESMI LAMPIRAN III */}
                <div className="w-full border-2 border-slate-900 p-4 bg-slate-50/70 text-xs space-y-1.5">
                  <div className="font-extrabold text-sm tracking-wide">
                    AERODROME CLIMATOLOGICAL SUMMARY
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-bold">
                    <div>
                      TABULAR FORM &nbsp;&nbsp;&nbsp;&nbsp; MODEL {activeModel}
                    </div>
                    <div>
                      MODE DATA :{" "}
                      {displayMode === "percent"
                        ? "PERCENTAGE (%)"
                        : "FREQUENCY COUNT"}
                    </div>
                    <div>AERODROME : {meta.aerodrome || "-"}</div>
                    <div>
                      MONTH : {activeMonthData.monthName}{" "}
                      &nbsp;&nbsp;|&nbsp;&nbsp; PERIODE OF RECORD :{" "}
                      {activeMonthData.periodOfRecordStr}
                    </div>
                    <div>
                      TOTAL NUMBER OF OBSERVATION : {activeMonthData.tno}
                    </div>
                    <div>
                      OBSERVATION TIME :{" "}
                      {meta.observationTime ||
                        activeMonthData.detectedObsTimeStr}
                    </div>
                    <div>
                      LATITUDE : {meta.latitude || "-"}{" "}
                      &nbsp;&nbsp;|&nbsp;&nbsp; LONGITUDE :{" "}
                      {meta.longitude || "-"}
                    </div>
                    <div>
                      ELEVATION ABOVE MSL :{" "}
                      {meta.elevationM ? `${meta.elevationM} M` : "-"}
                    </div>
                  </div>
                </div>

                {/* TABEL MODEL A */}
                {activeModel === "A" && (
                  <table className="w-full table-fixed text-xs border-collapse border border-slate-800 text-center">
                    <colgroup>
                      <col style={{ width: "80px" }} />
                      {Array.from({ length: 8 }, (_, idx) => (
                        <col key={idx} style={{ width: "99px" }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 font-bold">
                        <th
                          colSpan={9}
                          className="border border-slate-800 px-3 py-2 text-center leading-snug"
                        >
                          FREQUENCIES (
                          {displayMode === "percent" ? "PER CENT" : "COUNT"}) OF
                          THE OCCURRENCE OF RUNWAY VISUAL RANGE / VISIBILITY
                          (BOTH IN METRES) AND/OR HEIGHT OF THE BASE OF THE
                          LOWEST CLOUD LAYER (IN FEET) OF BKN OR OVC EXTENT
                          BELOW SPECIFIED VALUES AT SPECIFIED TIMES
                        </th>
                      </tr>
                      <tr className="bg-slate-100 font-bold h-7">
                        <th
                          rowSpan={3}
                          className="border border-slate-800 p-1.5"
                        >
                          TIME
                          <br />
                          (UTC)
                        </th>
                        <th
                          colSpan={5}
                          className="border border-slate-800 p-1.5"
                        >
                          RVR / Hs
                        </th>
                        <th
                          colSpan={3}
                          className="border border-slate-800 p-1.5"
                        >
                          VIS / Hs
                        </th>
                      </tr>
                      <tr className="bg-slate-50 font-bold h-7">
                        {MODEL_A_VIS_HEADERS.map((h) => (
                          <th key={h} className="border border-slate-800 p-1.5">
                            {h}
                          </th>
                        ))}
                      </tr>
                      <tr className="bg-blue-50/70 font-bold text-blue-950 h-7">
                        {MODEL_A_CLOUD_HEADERS.map((h, i) => (
                          <th key={i} className="border border-slate-800 p-1.5">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }, (_, h) => {
                        const hrLabel = String(h).padStart(2, "0");
                        return (
                          <FragmentRowModelA
                            key={h}
                            hrLabel={hrLabel}
                            visRow={activeMonthData.modelA_VisFreq[h]}
                            cloudRow={activeMonthData.modelA_CloudFreq[h]}
                            denom={activeDivisor}
                            formatCellVal={formatCellVal}
                          />
                        );
                      })}

                      <tr className="bg-yellow-300 font-extrabold text-slate-900 h-7">
                        <td
                          rowSpan={2}
                          className="border border-slate-800 px-2 align-middle"
                        >
                          Mean
                        </td>
                        {Array.from({ length: 8 }, (_, c) => {
                          if (displayMode === "frequency") {
                            const tot = Array.from(
                              { length: 24 },
                              (_, h) => activeMonthData.modelA_VisFreq[h][c],
                            ).reduce((a, b) => a + b, 0);
                            return (
                              <td
                                key={c}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {tot}
                              </td>
                            );
                          }
                          const sumPct = Array.from(
                            { length: 24 },
                            (_, h) =>
                              (activeMonthData.modelA_VisFreq[h][c] /
                                activeDivisor) *
                              100,
                          ).reduce((a, b) => a + b, 0);
                          return (
                            <td
                              key={c}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {(
                                sumPct / activeMonthData.activeHoursCount
                              ).toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="bg-yellow-200 font-extrabold text-slate-900 h-7">
                        {Array.from({ length: 8 }, (_, c) => {
                          if (c <= 1) {
                            return (
                              <td
                                key={c}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                -
                              </td>
                            );
                          }
                          if (displayMode === "frequency") {
                            const tot = Array.from(
                              { length: 24 },
                              (_, h) => activeMonthData.modelA_CloudFreq[h][c],
                            ).reduce((a, b) => a + b, 0);
                            return (
                              <td
                                key={c}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {tot}
                              </td>
                            );
                          }
                          const sumPct = Array.from(
                            { length: 24 },
                            (_, h) =>
                              (activeMonthData.modelA_CloudFreq[h][c] /
                                activeDivisor) *
                              100,
                          ).reduce((a, b) => a + b, 0);
                          return (
                            <td
                              key={c}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {(
                                sumPct / activeMonthData.activeHoursCount
                              ).toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="h-8">
                        <td
                          colSpan={9}
                          className="border border-slate-800 px-3 py-1.5 text-left font-bold align-middle"
                        >
                          Remarks : {activeMonthData.remarksModelA}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {/* TABEL MODEL B */}
                {activeModel === "B" && (
                  <table className="w-full table-fixed text-xs border-collapse border border-slate-800 text-center">
                    <colgroup>
                      <col style={{ width: "80px" }} />
                      {Array.from({ length: 8 }, (_, idx) => (
                        <col key={idx} style={{ width: "99px" }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 font-bold">
                        <th
                          colSpan={9}
                          className="border border-slate-800 px-3 py-2 text-center leading-snug"
                        >
                          FREQUENCIES (
                          {displayMode === "percent" ? "PER CENT" : "COUNT"}) OF
                          VISIBILITY BELOW SPECIFIED VALUES (IN METRES) AT
                          SPECIFIED TIMES
                        </th>
                      </tr>
                      <tr className="bg-slate-100 font-bold h-7">
                        <th
                          rowSpan={2}
                          className="border border-slate-800 p-1.5"
                        >
                          TIME
                          <br />
                          (GMT)
                        </th>
                        <th
                          colSpan={8}
                          className="border border-slate-800 p-1.5"
                        >
                          VISIBILITY
                        </th>
                      </tr>
                      <tr className="bg-slate-50 font-bold h-7">
                        {MODEL_B_HEADERS.map((h) => (
                          <th key={h} className="border border-slate-800 p-1.5">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }, (_, h) => (
                        <tr key={h} className="hover:bg-slate-50 h-7">
                          <td className="border border-slate-800 px-2 h-7 align-middle font-mono font-bold bg-slate-50">
                            {String(h).padStart(2, "0")}
                          </td>
                          {MODEL_B_HEADERS.map((_, c) => (
                            <td
                              key={c}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {formatCellVal(
                                activeMonthData.modelB_Freq[h][c],
                                activeDivisor,
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="bg-yellow-300 font-extrabold text-slate-900 h-7">
                        <td className="border border-slate-800 px-2 h-7 align-middle">
                          {displayMode === "percent" ? "MEAN (%)" : "TOTAL"}
                        </td>
                        {MODEL_B_HEADERS.map((_, c) => {
                          if (displayMode === "frequency") {
                            const tot = Array.from(
                              { length: 24 },
                              (_, h) => activeMonthData.modelB_Freq[h][c],
                            ).reduce((a, b) => a + b, 0);
                            return (
                              <td
                                key={c}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {tot}
                              </td>
                            );
                          }
                          const sumPct = Array.from(
                            { length: 24 },
                            (_, h) =>
                              (activeMonthData.modelB_Freq[h][c] /
                                activeDivisor) *
                              100,
                          ).reduce((a, b) => a + b, 0);
                          return (
                            <td
                              key={c}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {(
                                sumPct / activeMonthData.activeHoursCount
                              ).toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="h-8">
                        <td
                          colSpan={9}
                          className="border border-slate-800 px-3 py-1.5 text-left font-bold align-middle"
                        >
                          Remarks : {activeMonthData.remarksModelB}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {/* TABEL MODEL C */}
                {activeModel === "C" && (
                  <table className="w-full table-fixed text-xs border-collapse border border-slate-800 text-center">
                    <colgroup>
                      <col style={{ width: "92px" }} />
                      {Array.from({ length: 6 }, (_, idx) => (
                        <col key={idx} style={{ width: "130px" }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 font-bold">
                        <th
                          colSpan={7}
                          className="border border-slate-800 px-3 py-2 text-center leading-snug"
                        >
                          FREQUENCIES (
                          {displayMode === "percent" ? "PER CENT" : "COUNT"}) OF
                          THE HEIGHT OF THE BASE OF THE LOWEST CLOUD LAYER
                          (FEET) OF BKN OR OVC EXTENT BELOW SPECIFIED VALUES AT
                          SPECIFIED TIMES
                        </th>
                      </tr>
                      <tr className="bg-slate-100 font-bold h-7">
                        <th
                          rowSpan={2}
                          className="border border-slate-800 p-1.5"
                        >
                          TIME
                          <br />
                          (GMT)
                        </th>
                        <th
                          colSpan={6}
                          className="border border-slate-800 p-1.5"
                        >
                          Hs
                        </th>
                      </tr>
                      <tr className="bg-slate-50 font-bold h-7">
                        {MODEL_C_HEADERS.map((h) => (
                          <th key={h} className="border border-slate-800 p-1.5">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }, (_, h) => (
                        <tr key={h} className="hover:bg-slate-50 h-7">
                          <td className="border border-slate-800 px-2 h-7 align-middle font-mono font-bold bg-slate-50">
                            {String(h).padStart(2, "0")}
                          </td>
                          {MODEL_C_HEADERS.map((_, c) => (
                            <td
                              key={c}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {formatCellVal(
                                activeMonthData.modelC_Freq[h][c],
                                activeDivisor,
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="bg-yellow-300 font-extrabold text-slate-900 h-7">
                        <td className="border border-slate-800 px-2 h-7 align-middle">
                          {displayMode === "percent" ? "MEAN (%)" : "TOTAL"}
                        </td>
                        {MODEL_C_HEADERS.map((_, c) => {
                          if (displayMode === "frequency") {
                            const tot = Array.from(
                              { length: 24 },
                              (_, h) => activeMonthData.modelC_Freq[h][c],
                            ).reduce((a, b) => a + b, 0);
                            return (
                              <td
                                key={c}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {tot}
                              </td>
                            );
                          }
                          const sumPct = Array.from(
                            { length: 24 },
                            (_, h) =>
                              (activeMonthData.modelC_Freq[h][c] /
                                activeDivisor) *
                              100,
                          ).reduce((a, b) => a + b, 0);
                          return (
                            <td
                              key={c}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {(
                                sumPct / activeMonthData.activeHoursCount
                              ).toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="h-8">
                        <td
                          colSpan={7}
                          className="border border-slate-800 px-3 py-1.5 text-left font-bold align-middle"
                        >
                          Remarks : {activeMonthData.remarksModelC}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {/* TABEL MODEL D */}
                {activeModel === "D" && (
                  <table className="w-full table-fixed text-xs border-collapse border border-slate-800 text-center">
                    <colgroup>
                      <col style={{ width: "112px" }} />
                      {Array.from({ length: 9 }, (_, idx) => (
                        <col key={idx} style={{ width: "75px" }} />
                      ))}
                      <col style={{ width: "85px" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 font-bold">
                        <th
                          colSpan={11}
                          className="border border-slate-800 px-3 py-2 text-center leading-snug"
                        >
                          FREQUENCIES (
                          {displayMode === "percent" ? "PERCENT" : "COUNT"}) OF
                          OCCURRENCE OF CONCURRENT WIND DIRECTION (IN SECTOR
                          30°) AND SPEED (IN KNOTS) WITHIN SPECIFIED RANGES
                        </th>
                      </tr>
                      <tr className="bg-slate-100 font-bold h-7">
                        <th
                          rowSpan={2}
                          className="border border-slate-800 p-1.5"
                        >
                          WIND
                          <br />
                          DIRECTION
                        </th>
                        <th
                          colSpan={9}
                          className="border border-slate-800 p-1.5"
                        >
                          WIND SPEED
                        </th>
                        <th
                          rowSpan={2}
                          className="border border-slate-800 p-1.5"
                        >
                          TOTAL
                        </th>
                      </tr>
                      <tr className="bg-slate-50 font-bold h-7">
                        {MODEL_D_SPEED_COLS.map((s) => (
                          <th key={s} className="border border-slate-800 p-1.5">
                            {s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MODEL_D_DIR_ROWS.map((dirLabel, rIdx) => {
                        if (rIdx === 0) {
                          const calmVal =
                            displayMode === "frequency"
                              ? String(activeMonthData.modelD_CalmTotal)
                              : (
                                  (activeMonthData.modelD_CalmTotal /
                                    Math.max(1, activeMonthData.tno)) *
                                  100
                                ).toFixed(1);
                          return (
                            <tr key={dirLabel} className="h-7">
                              <td className="border border-slate-800 px-2 h-7 align-middle font-bold bg-slate-50">
                                {dirLabel}
                              </td>
                              {MODEL_D_SPEED_COLS.map((s) => (
                                <td
                                  key={s}
                                  className="border border-slate-800 px-2 h-7 align-middle bg-slate-400/70"
                                >
                                  {"\u00A0"}
                                </td>
                              ))}
                              <td className="border border-slate-800 px-2 h-7 align-middle font-mono font-bold bg-slate-100">
                                {calmVal}
                              </td>
                            </tr>
                          );
                        }

                        const rowFreqs = activeMonthData.modelD_Freq[rIdx];
                        const rowSum = rowFreqs.reduce((a, b) => a + b, 0);
                        const rowTotalStr =
                          rowSum === 0
                            ? "\u00A0"
                            : displayMode === "frequency"
                              ? String(rowSum)
                              : (
                                  (rowSum / Math.max(1, activeMonthData.tno)) *
                                  100
                                ).toFixed(1);

                        return (
                          <tr key={dirLabel} className="hover:bg-slate-50 h-7">
                            <td className="border border-slate-800 px-2 h-7 align-middle font-mono font-bold bg-slate-50">
                              {dirLabel}
                            </td>
                            {rowFreqs.map((freq, cIdx) => (
                              <td
                                key={cIdx}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {formatCellVal(freq, activeMonthData.tno)}
                              </td>
                            ))}
                            <td className="border border-slate-800 px-2 h-7 align-middle font-mono font-bold bg-slate-100">
                              {rowTotalStr}
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="bg-yellow-300 font-extrabold text-slate-900 h-7">
                        <td className="border border-slate-800 px-2 h-7 align-middle">
                          TOTAL
                        </td>
                        {MODEL_D_SPEED_COLS.map((_, cIdx) => {
                          const colSum = Array.from(
                            { length: 13 },
                            (_, idx) =>
                              activeMonthData.modelD_Freq[idx + 1][cIdx],
                          ).reduce((a, b) => a + b, 0);
                          const colStr =
                            colSum === 0
                              ? "\u00A0"
                              : displayMode === "frequency"
                                ? String(colSum)
                                : (
                                    (colSum /
                                      Math.max(1, activeMonthData.tno)) *
                                    100
                                  ).toFixed(1);
                          return (
                            <td
                              key={cIdx}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {colStr}
                            </td>
                          );
                        })}
                        <td className="border border-slate-800 px-2 h-7 align-middle font-mono">
                          {displayMode === "frequency"
                            ? activeMonthData.tno
                            : activeMonthData.tno > 0
                              ? "100.0"
                              : "0.0"}
                        </td>
                      </tr>
                      <tr className="h-8">
                        <td
                          colSpan={11}
                          className="border border-slate-800 px-3 py-1.5 text-left font-bold align-middle"
                        >
                          Remarks : {activeMonthData.remarksModelD}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {/* TABEL MODEL E */}
                {activeModel === "E" && (
                  <table className="w-full table-fixed text-xs border-collapse border border-slate-800 text-center">
                    <colgroup>
                      <col style={{ width: "80px" }} />
                      {Array.from({ length: 9 }, (_, idx) => (
                        <col key={idx} style={{ width: "88px" }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 font-bold">
                        <th
                          colSpan={10}
                          className="border border-slate-800 px-3 py-2 text-center leading-snug"
                        >
                          FREQUENCIES (
                          {displayMode === "percent" ? "PERCENT" : "COUNT"}) OF
                          SURFACE TEMPERATURE (SCREEN) IN SPECIFIED RANGES OF
                          5°C AT SPECIFIED TIMES
                        </th>
                      </tr>
                      <tr className="bg-slate-100 font-bold h-7">
                        <th
                          rowSpan={2}
                          className="border border-slate-800 p-1.5"
                        >
                          TIME
                          <br />
                          (GMT)
                        </th>
                        <th
                          colSpan={9}
                          className="border border-slate-800 p-1.5"
                        >
                          TEMPERATURE
                        </th>
                      </tr>
                      <tr className="bg-slate-50 font-bold h-7">
                        {MODEL_E_TEMP_COLS.map((t) => (
                          <th key={t} className="border border-slate-800 p-1.5">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }, (_, h) => {
                        const rowFreqs = activeMonthData.modelE_Freq[h];
                        const rowDenom = rowFreqs.reduce((a, b) => a + b, 0);
                        return (
                          <tr key={h} className="hover:bg-slate-50 h-7">
                            <td className="border border-slate-800 px-2 h-7 align-middle font-mono font-bold bg-slate-50">
                              {String(h).padStart(2, "0")}
                            </td>
                            {rowFreqs.map((freq, cIdx) => (
                              <td
                                key={cIdx}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {formatCellVal(freq, rowDenom)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      <tr className="bg-yellow-300 font-extrabold text-slate-900 h-7">
                        <td className="border border-slate-800 px-2 h-7 align-middle">
                          {displayMode === "percent" ? "MEAN (%)" : "TOTAL"}
                        </td>
                        {MODEL_E_TEMP_COLS.map((_, cIdx) => {
                          if (displayMode === "frequency") {
                            const tot = Array.from(
                              { length: 24 },
                              (_, h) => activeMonthData.modelE_Freq[h][cIdx],
                            ).reduce((a, b) => a + b, 0);
                            return (
                              <td
                                key={cIdx}
                                className="border border-slate-800 px-2 h-7 align-middle font-mono"
                              >
                                {tot}
                              </td>
                            );
                          }
                          const sumPct = Array.from({ length: 24 }, (_, h) => {
                            const rTot = activeMonthData.modelE_Freq[h].reduce(
                              (a, b) => a + b,
                              0,
                            );
                            return rTot > 0
                              ? (activeMonthData.modelE_Freq[h][cIdx] / rTot) *
                                  100
                              : 0;
                          }).reduce((a, b) => a + b, 0);
                          return (
                            <td
                              key={cIdx}
                              className="border border-slate-800 px-2 h-7 align-middle font-mono"
                            >
                              {(
                                sumPct / activeMonthData.activeHoursCount
                              ).toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="h-8">
                        <td
                          colSpan={10}
                          className="border border-slate-800 px-3 py-1.5 text-left font-bold align-middle"
                        >
                          REMARKS : {activeMonthData.remarksModelE}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// KOMPONEN INFOGRAFIS LANDSCAPE 16:9 (GABUNGAN & PER MODEL — 1280 x 720 PX)
// ============================================================================
function AcsInfographicSlide({
  exportRef,
  mData,
  meta,
  hasRvr,
  activeDivisor,
  slideType,
}: {
  exportRef: React.RefObject<HTMLDivElement | null>;
  mData: AcsMonthlyAggregated;
  meta: AcsMetadata;
  hasRvr: boolean;
  activeDivisor: number;
  slideType: InfographicSlideType;
}) {
  const tnoSafe = Math.max(1, mData.tno);
  const divSafe = Math.max(1, activeDivisor);
  const hrsSafe = Math.max(1, mData.activeHoursCount);

  // 1. Analisis Wind Rose & Kelas Kecepatan Angin (Model D) — Arah Angin Menunjukkan Arah DARI
  const calmPct = (mData.modelD_CalmTotal / tnoSafe) * 100;
  const vrbSum = mData.modelD_Freq[1].reduce((a, b) => a + b, 0);
  const vrbPct = (vrbSum / tnoSafe) * 100;

  const windSectors = Array.from({ length: 12 }, (_, idx) => {
    const dirInfo = WIND_DIRECTION_NAMES[idx];
    const row = mData.modelD_Freq[idx + 2];
    const p1 = (row[0] / tnoSafe) * 100; // 1-5 kt
    const p2 = (row[1] / tnoSafe) * 100; // 6-10 kt
    const p3 = (row[2] / tnoSafe) * 100; // 11-15 kt
    const p4 =
      ((row[3] + row[4] + row[5] + row[6] + row[7] + row[8]) / tnoSafe) * 100; // >15 kt
    const totalPct = p1 + p2 + p3 + p4;
    return {
      idx,
      shortLabel: dirInfo.short,
      fullName: dirInfo.full,
      degRange: dirInfo.degRange,
      angleDeg: idx * 30,
      p1,
      p2,
      p3,
      p4,
      totalPct,
    };
  });

  const sortedWindSectors = [...windSectors].sort(
    (a, b) => b.totalPct - a.totalPct,
  );
  const topSector = sortedWindSectors[0];
  const maxSectorPct = Math.max(
    10,
    Math.ceil(Math.max(...windSectors.map((s) => s.totalPct)) / 5) * 5,
  );

  // Distribusi 9 Kelas Kecepatan Angin (Model D)
  const windSpeedDist = [
    { label: "Calm", pct: calmPct, color: "#94a3b8" },
    ...MODEL_D_SPEED_COLS.map((spdLabel, cIdx) => {
      const sumFreq = Array.from(
        { length: 13 },
        (_, r) => mData.modelD_Freq[r + 1][cIdx],
      ).reduce((a, b) => a + b, 0);
      const pct = (sumFreq / tnoSafe) * 100;
      const color =
        cIdx === 0
          ? "#38bdf8"
          : cIdx === 1
            ? "#0284c7"
            : cIdx === 2
              ? "#f59e0b"
              : "#e11d48";
      return { label: `${spdLabel} kt`, pct, color };
    }),
  ];
  const strongWindPct = windSpeedDist
    .slice(4)
    .reduce((acc, item) => acc + item.pct, 0); // > 15 kt
  const maxSpeedBarPct = Math.max(
    10,
    Math.ceil(Math.max(...windSpeedDist.map((s) => s.pct)) / 10) * 10,
  );

  // 2. Analisis Diurnal Visibility/RVR & Tinggi Dasar Awan BKN/OVC (Model A/B & C)
  const visSourceMatrix = hasRvr ? mData.modelA_VisFreq : mData.modelB_Freq;
  const diurnalWx = Array.from({ length: 24 }, (_, h) => {
    const vis5kPct = (visSourceMatrix[h][6] / divSafe) * 100; // < 5000m
    const vis3kPct = (visSourceMatrix[h][5] / divSafe) * 100; // < 3000m
    const vis1500Pct = (visSourceMatrix[h][4] / divSafe) * 100; // < 1500m
    const vis800Pct = (visSourceMatrix[h][3] / divSafe) * 100; // < 800m

    const ceil1500Pct = (mData.modelC_Freq[h][5] / divSafe) * 100; // Tinggi Dasar < 1500ft
    const ceil1kPct = (mData.modelC_Freq[h][4] / divSafe) * 100; // Tinggi Dasar < 1000ft
    const ceil500Pct = (mData.modelC_Freq[h][3] / divSafe) * 100; // Tinggi Dasar < 500ft
    const ceil300Pct = (mData.modelC_Freq[h][2] / divSafe) * 100; // Tinggi Dasar < 300ft

    return {
      h,
      vis5kPct,
      vis3kPct,
      vis1500Pct,
      vis800Pct,
      ceil1500Pct,
      ceil1kPct,
      ceil500Pct,
      ceil300Pct,
    };
  });

  const meanVis5k = diurnalWx.reduce((acc, d) => acc + d.vis5kPct, 0) / hrsSafe;
  const meanVis3k = diurnalWx.reduce((acc, d) => acc + d.vis3kPct, 0) / hrsSafe;
  const meanVis1500 =
    diurnalWx.reduce((acc, d) => acc + d.vis1500Pct, 0) / hrsSafe;
  const meanVis800 =
    diurnalWx.reduce((acc, d) => acc + d.vis800Pct, 0) / hrsSafe;

  const meanCeil1500 =
    diurnalWx.reduce((acc, d) => acc + d.ceil1500Pct, 0) / hrsSafe;
  const meanCeil1k =
    diurnalWx.reduce((acc, d) => acc + d.ceil1kPct, 0) / hrsSafe;
  const meanCeil500 =
    diurnalWx.reduce((acc, d) => acc + d.ceil500Pct, 0) / hrsSafe;
  const meanCeil300 =
    diurnalWx.reduce((acc, d) => acc + d.ceil300Pct, 0) / hrsSafe;

  const maxWxY = Math.max(
    10,
    Math.ceil(
      Math.max(...diurnalWx.map((d) => Math.max(d.vis5kPct, d.ceil1kPct))) / 10,
    ) * 10,
  );
  const maxVisOnlyY = Math.max(
    10,
    Math.ceil(Math.max(...diurnalWx.map((d) => d.vis5kPct)) / 10) * 10,
  );
  const maxCeilOnlyY = Math.max(
    10,
    Math.ceil(Math.max(...diurnalWx.map((d) => d.ceil1500Pct)) / 10) * 10,
  );

  // 3. Analisis Profil Suhu Udara Permukaan 24 Jam (Model E)
  const diurnalTemp = Array.from({ length: 24 }, (_, h) => {
    const row = mData.modelE_Freq[h];
    const rowTot = row.reduce((a, b) => a + b, 0);
    if (rowTot === 0) {
      return {
        h,
        hasData: false,
        tLow: 0,
        t20: 0,
        t25: 0,
        t30: 0,
        tHot: 0,
        allClasses: Array(9).fill(0),
      };
    }
    const lowCount = row[0] + row[1] + row[2] + row[3] + row[4]; // < 20°C
    return {
      h,
      hasData: true,
      tLow: (lowCount / rowTot) * 100,
      t20: (row[5] / rowTot) * 100, // 20-25°C
      t25: (row[6] / rowTot) * 100, // 25-30°C
      t30: (row[7] / rowTot) * 100, // 30-35°C
      tHot: (row[8] / rowTot) * 100, // >35°C
      allClasses: row.map((v) => (v / rowTot) * 100),
    };
  });

  const tempAllClassMeans = MODEL_E_TEMP_COLS.map((colLabel, cIdx) => {
    const meanVal =
      diurnalTemp.reduce((acc, d) => acc + d.allClasses[cIdx], 0) / hrsSafe;
    const colors = [
      "#1d4ed8",
      "#2563eb",
      "#0284c7",
      "#0ea5e9",
      "#38bdf8",
      "#34d399",
      "#facc15",
      "#fb923c",
      "#ef4444",
    ];
    return { label: `${colLabel}°C`, val: meanVal, color: colors[cIdx] };
  });

  const tempMeans = [
    {
      label: "< 20°C",
      val: diurnalTemp.reduce((a, b) => a + b.tLow, 0) / hrsSafe,
    },
    {
      label: "20–25°C",
      val: diurnalTemp.reduce((a, b) => a + b.t20, 0) / hrsSafe,
    },
    {
      label: "25–30°C",
      val: diurnalTemp.reduce((a, b) => a + b.t25, 0) / hrsSafe,
    },
    {
      label: "30–35°C",
      val: diurnalTemp.reduce((a, b) => a + b.t30, 0) / hrsSafe,
    },
    {
      label: "> 35°C",
      val: diurnalTemp.reduce((a, b) => a + b.tHot, 0) / hrsSafe,
    },
  ];
  const dominantTemp = [...tempMeans].sort((a, b) => b.val - a.val)[0];
  const coolTempPct = tempMeans[0].val + tempMeans[1].val; // < 25°C
  const warmTempPct = tempMeans[3].val; // 30-35°C
  const hotTempPct = tempMeans[4].val; // > 35°C

  // Helper SVG Wind Rose
  const createSectorPath = (
    cx: number,
    cy: number,
    r0: number,
    r1: number,
    centerDeg: number,
  ): string => {
    if (r1 <= r0 + 0.3) return "";
    const a0 = ((centerDeg - 13 - 90) * Math.PI) / 180;
    const a1 = ((centerDeg + 13 - 90) * Math.PI) / 180;
    const x0Start = cx + r0 * Math.cos(a0);
    const y0Start = cy + r0 * Math.sin(a0);
    const x1Start = cx + r1 * Math.cos(a0);
    const y1Start = cy + r1 * Math.sin(a0);
    const x1End = cx + r1 * Math.cos(a1);
    const y1End = cy + r1 * Math.sin(a1);
    const x0End = cx + r0 * Math.cos(a1);
    const y0End = cy + r0 * Math.sin(a1);

    return `M ${x0Start.toFixed(2)} ${y0Start.toFixed(2)} L ${x1Start.toFixed(2)} ${y1Start.toFixed(2)} A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 0 1 ${x1End.toFixed(2)} ${y1End.toFixed(2)} L ${x0End.toFixed(2)} ${y0End.toFixed(2)} A ${r0.toFixed(2)} ${r0.toFixed(2)} 0 0 0 ${x0Start.toFixed(2)} ${y0Start.toFixed(2)} Z`;
  };

  const renderWindRoseSvg = (sizePx: number, rMaxVal: number) => {
    const c = sizePx / 2;
    const rMinVal = sizePx > 320 ? 32 : 25;
    const scaleRadius = (pct: number) =>
      rMinVal + Math.min(1, pct / maxSectorPct) * (rMaxVal - rMinVal);

    return (
      <svg width={sizePx} height={sizePx} viewBox={`0 0 ${sizePx} ${sizePx}`}>
        {[1 / 3, 2 / 3, 1].map((ratio, idx) => {
          const rad = rMinVal + ratio * (rMaxVal - rMinVal);
          const pctTick = Math.round(ratio * maxSectorPct);
          return (
            <g key={idx}>
              <circle
                cx={c}
                cy={c}
                r={rad}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth="1"
                strokeDasharray={idx < 2 ? "3 3" : undefined}
              />
              <text
                x={c + rad * Math.cos((-45 * Math.PI) / 180) + 3}
                y={c + rad * Math.sin((-45 * Math.PI) / 180)}
                fontSize="8.5"
                fill="#64748b"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {pctTick}%
              </text>
            </g>
          );
        })}

        <line
          x1={c}
          y1={c - rMaxVal - 6}
          x2={c}
          y2={c + rMaxVal + 6}
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <line
          x1={c - rMaxVal - 6}
          y1={c}
          x2={c + rMaxVal + 6}
          y2={c}
          stroke="#e2e8f0"
          strokeWidth="1"
        />

        {windSectors.map((sec) => {
          const r0 = rMinVal;
          const r1 = scaleRadius(sec.p1);
          const r2 = scaleRadius(sec.p1 + sec.p2);
          const r3 = scaleRadius(sec.p1 + sec.p2 + sec.p3);
          const r4 = scaleRadius(sec.totalPct);

          const labelRad = rMaxVal + 21;
          const radAngle = ((sec.angleDeg - 90) * Math.PI) / 180;
          const lx = c + labelRad * Math.cos(radAngle);
          const ly = c + labelRad * Math.sin(radAngle);
          const isCardinal = sec.idx % 3 === 0;

          return (
            <g key={sec.shortLabel}>
              {sec.p1 > 0 && (
                <path
                  d={createSectorPath(c, c, r0, r1, sec.angleDeg)}
                  fill="#38bdf8"
                  stroke="#ffffff"
                  strokeWidth="0.6"
                />
              )}
              {sec.p2 > 0 && (
                <path
                  d={createSectorPath(c, c, r1, r2, sec.angleDeg)}
                  fill="#0284c7"
                  stroke="#ffffff"
                  strokeWidth="0.6"
                />
              )}
              {sec.p3 > 0 && (
                <path
                  d={createSectorPath(c, c, r2, r3, sec.angleDeg)}
                  fill="#f59e0b"
                  stroke="#ffffff"
                  strokeWidth="0.6"
                />
              )}
              {sec.p4 > 0 && (
                <path
                  d={createSectorPath(c, c, r3, r4, sec.angleDeg)}
                  fill="#e11d48"
                  stroke="#ffffff"
                  strokeWidth="0.6"
                />
              )}
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={isCardinal ? "9.5" : "8.5"}
                fontWeight={isCardinal ? "800" : "700"}
                fill={isCardinal ? "#0f172a" : "#475569"}
              >
                {sec.shortLabel}
              </text>
            </g>
          );
        })}

        <circle
          cx={c}
          cy={c}
          r={rMinVal}
          fill="#f8fafc"
          stroke="#475569"
          strokeWidth="1.5"
        />
        <text
          x={c}
          y={c - 4}
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="800"
          fill="#475569"
        >
          CALM
        </text>
        <text
          x={c}
          y={c + 8}
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fontFamily="monospace"
          fill="#0f172a"
        >
          {calmPct.toFixed(1)}%
        </text>
      </svg>
    );
  };

  const slideBadgeMap: Record<InfographicSlideType, string> = {
    combined: hasRvr
      ? "Model A, B, C, D & E (Alat & Visual)"
      : "Model B, C, D & E (Visual & Permukaan)",
    vis_cloud: hasRvr
      ? "Fokus Visibilitas / RVR & Tinggi Dasar Awan (Model A, B & C)"
      : "Fokus Visibilitas & Tinggi Dasar Awan BKN/OVC (Model B & C)",
    wind: "Fokus Distribusi Arah & Kecepatan Angin (Model D)",
    temp: "Fokus Profil Suhu Udara Permukaan (Model E)",
  };

  // Koordinat Grafik Diurnal Standar
  const chartW = 560;
  const chartH = 146;
  const padL = 32;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const slotW = plotW / 24;

  const ceil1kLinePoints = diurnalWx
    .map((d, idx) => {
      const x = padL + idx * slotW + slotW / 2;
      const y = padT + plotH - (d.ceil1kPct / maxWxY) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div
      ref={exportRef}
      style={{
        width: "1280px",
        minHeight: "720px",
        backgroundColor: "#f8fafc",
        color: "#0f172a",
      }}
      className="mx-auto shrink-0 rounded-xl shadow-lg border border-slate-300 overflow-hidden flex flex-col justify-between select-none"
    >
      {/* 1. HEADER BANNER SLIDE */}
      <div
        style={{ backgroundColor: "#0f172a", color: "#ffffff" }}
        className="px-7 py-4 flex items-center justify-between border-b-4 border-teal-500"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded bg-teal-500/20 border border-teal-400/40 text-teal-300 text-[11px] font-extrabold tracking-widest uppercase">
              Aerodrome Climatological Summary (ACS)
            </span>
            <span className="text-xs text-slate-300 font-semibold">
              {slideBadgeMap[slideType]}
            </span>
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-white">
            {meta.aerodrome || "STASIUN METEOROLOGI BANDAR UDARA"} — BULAN{" "}
            {mData.monthName} ({mData.periodOfRecordStr})
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-300 font-medium">
            <span>
              Lintang: <b className="text-white">{meta.latitude || "-"}</b>
            </span>
            <span>•</span>
            <span>
              Bujur: <b className="text-white">{meta.longitude || "-"}</b>
            </span>
            <span>•</span>
            <span>
              Elevasi:{" "}
              <b className="text-white">
                {meta.elevationM ? `${meta.elevationM} m MSL` : "-"}
              </b>
            </span>
            <span>•</span>
            <span>
              Jam Pengamatan:{" "}
              <b className="text-white">
                {meta.observationTime || mData.detectedObsTimeStr}
              </b>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-800/90 border border-slate-700 px-4 py-2.5 rounded-xl text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Total Observasi (TNO)
            </div>
            <div className="text-xl font-extrabold text-cyan-300 font-mono">
              {mData.tno}{" "}
              <span className="text-xs font-normal text-slate-300">jam</span>
            </div>
          </div>
          <div className="bg-slate-800/90 border border-slate-700 px-4 py-2.5 rounded-xl text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Pembagi Model A/B/C
            </div>
            <div className="text-xl font-extrabold text-emerald-400 font-mono">
              {activeDivisor}{" "}
              <span className="text-xs font-normal text-slate-300">
                {activeDivisor === mData.totalDays ? "hari" : "obs"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================
          SLIDE 1: GABUNGAN (MODEL A–E)
         ==================================================================== */}
      {slideType === "combined" && (
        <>
          <div className="px-7 pt-3.5 grid grid-cols-4 gap-3.5">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                <Wind size={22} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-500 uppercase">
                  Angin Dominan (Arah DARI)
                </div>
                <div className="text-base font-extrabold text-slate-900 truncate">
                  Dari {topSector?.fullName || "-"}{" "}
                  <span className="text-blue-700 font-mono">
                    ({topSector ? topSector.totalPct.toFixed(1) : "0.0"}%)
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 font-medium">
                  Calm: <b>{calmPct.toFixed(1)}%</b> • Variable:{" "}
                  <b>{vrbPct.toFixed(1)}%</b>
                </div>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-100 shrink-0">
                <Thermometer size={22} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-500 uppercase">
                  Suhu Udara Dominan
                </div>
                <div className="text-base font-extrabold text-slate-900 truncate">
                  {dominantTemp?.label || "-"}{" "}
                  <span className="text-amber-700 font-mono">
                    ({dominantTemp ? dominantTemp.val.toFixed(1) : "0.0"}%)
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 font-medium">
                  Kejadian Suhu &gt; 35°C:{" "}
                  <b className="text-rose-600">{hotTempPct.toFixed(1)}%</b>
                </div>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-100 shrink-0">
                <Eye size={22} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-500 uppercase">
                  {hasRvr ? "RVR / Visibilitas Rendah" : "Visibilitas Rendah"}
                </div>
                <div className="text-base font-extrabold text-slate-900 truncate">
                  &lt; 5000 m:{" "}
                  <span className="text-teal-700 font-mono">
                    {meanVis5k.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 font-medium">
                  Rata-rata &lt; 1500 m:{" "}
                  <b className="text-rose-600">{meanVis1500.toFixed(1)}%</b>
                </div>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0">
                <Cloud size={22} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-500 uppercase">
                  Awan Rendah (BKN/OVC)
                </div>
                <div className="text-base font-extrabold text-slate-900 truncate">
                  Tinggi Dasar &lt; 1000 ft:{" "}
                  <span className="text-indigo-700 font-mono">
                    {meanCeil1k.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 font-medium">
                  Rata-rata Tinggi Dasar &lt; 500 ft:{" "}
                  <b className="text-rose-600">{meanCeil500.toFixed(1)}%</b>
                </div>
              </div>
            </div>
          </div>

          <div className="px-7 py-3 flex-1 grid grid-cols-12 gap-4 min-h-0">
            {/* Wind Rose */}
            <div className="col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Distribusi Arah &amp; Kecepatan Angin (Model D)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Wind Rose 12 Arah (Menunjukkan arah datangnya angin / DARI)
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  Skala Maks: {maxSectorPct}%
                </span>
              </div>

              <div className="flex-1 flex items-center justify-center my-auto">
                {renderWindRoseSvg(300, 106)}
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-center gap-3 text-[10px] font-bold text-slate-700">
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#38bdf8" }}
                  />{" "}
                  1–5 kt
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#0284c7" }}
                  />{" "}
                  6–10 kt
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#f59e0b" }}
                  />{" "}
                  11–15 kt
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#e11d48" }}
                  />{" "}
                  &gt; 15 kt
                </span>
              </div>
            </div>

            {/* 2 Grafik Diurnal */}
            <div className="col-span-7 flex flex-col gap-3.5 justify-between">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5 flex-1 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                      Pola Diurnal Visibilitas &amp; Tinggi Dasar Awan (00–23
                      UTC)
                    </h3>
                    <p className="text-[10.5px] text-slate-500">
                      Persentase Kejadian per Jam (
                      {hasRvr ? "Model A & C" : "Model B & C"})
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-bold">
                    <span className="flex items-center gap-1 text-blue-800">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#93c5fd" }}
                      />{" "}
                      Vis &lt; 5000m
                    </span>
                    <span className="flex items-center gap-1 text-rose-700">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#f43f5e" }}
                      />{" "}
                      Vis &lt; 1500m
                    </span>
                    <span className="flex items-center gap-1 text-teal-800">
                      <span
                        className="w-3 h-0.5 inline-block"
                        style={{ backgroundColor: "#0d9488" }}
                      />{" "}
                      Tinggi Dasar &lt; 1000 ft
                    </span>
                  </div>
                </div>

                <svg
                  width="100%"
                  height={chartH}
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  className="overflow-visible"
                >
                  {[0, 0.5, 1].map((ratio, idx) => {
                    const y = padT + plotH - ratio * plotH;
                    const valLabel = Math.round(ratio * maxWxY);
                    return (
                      <g key={idx}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={chartW - padR}
                          y2={y}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                          strokeDasharray={ratio > 0 ? "3 3" : undefined}
                        />
                        <text
                          x={padL - 5}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fill="#64748b"
                        >
                          {valLabel}%
                        </text>
                      </g>
                    );
                  })}

                  {diurnalWx.map((d, idx) => {
                    const xBar = padL + idx * slotW + 3;
                    const wBar = slotW - 6;
                    const h5k = (d.vis5kPct / maxWxY) * plotH;
                    const h1500 = (d.vis1500Pct / maxWxY) * plotH;
                    return (
                      <g key={d.h}>
                        {h5k > 0 && (
                          <rect
                            x={xBar}
                            y={padT + plotH - h5k}
                            width={wBar}
                            height={h5k}
                            rx="1.5"
                            fill="#93c5fd"
                          />
                        )}
                        {h1500 > 0 && (
                          <rect
                            x={xBar + 2}
                            y={padT + plotH - h1500}
                            width={Math.max(2, wBar - 4)}
                            height={h1500}
                            rx="1"
                            fill="#f43f5e"
                          />
                        )}
                        <text
                          x={padL + idx * slotW + slotW / 2}
                          y={chartH - 6}
                          textAnchor="middle"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fontWeight="600"
                          fill="#475569"
                        >
                          {String(d.h).padStart(2, "0")}
                        </text>
                      </g>
                    );
                  })}

                  <polyline
                    fill="none"
                    stroke="#0d9488"
                    strokeWidth="2"
                    points={ceil1kLinePoints}
                  />
                  {diurnalWx.map((d, idx) => {
                    const cxPt = padL + idx * slotW + slotW / 2;
                    const cyPt = padT + plotH - (d.ceil1kPct / maxWxY) * plotH;
                    return (
                      <circle
                        key={d.h}
                        cx={cxPt}
                        cy={cyPt}
                        r="2.5"
                        fill="#0d9488"
                        stroke="#ffffff"
                        strokeWidth="0.8"
                      />
                    );
                  })}
                </svg>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5 flex-1 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                      Profil Diurnal Suhu Udara Permukaan (Model E)
                    </h3>
                    <p className="text-[10.5px] text-slate-500">
                      Proporsi Kejadian Kelas Suhu (°C) per Jam (00–23 UTC)
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 text-[10px] font-bold text-slate-700">
                    <span className="flex items-center gap-1">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#38bdf8" }}
                      />{" "}
                      &lt;20°
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#34d399" }}
                      />{" "}
                      20–25°
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#facc15" }}
                      />{" "}
                      25–30°
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#fb923c" }}
                      />{" "}
                      30–35°
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: "#ef4444" }}
                      />{" "}
                      &gt;35°
                    </span>
                  </div>
                </div>

                <svg
                  width="100%"
                  height={chartH}
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  className="overflow-visible"
                >
                  {[0, 50, 100].map((pctTick) => {
                    const y = padT + plotH - (pctTick / 100) * plotH;
                    return (
                      <g key={pctTick}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={chartW - padR}
                          y2={y}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                          strokeDasharray={pctTick > 0 ? "3 3" : undefined}
                        />
                        <text
                          x={padL - 5}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fill="#64748b"
                        >
                          {pctTick}%
                        </text>
                      </g>
                    );
                  })}

                  {diurnalTemp.map((d, idx) => {
                    const xBar = padL + idx * slotW + 3.5;
                    const wBar = slotW - 7;
                    const segments = [
                      { pct: d.tLow, color: "#38bdf8" },
                      { pct: d.t20, color: "#34d399" },
                      { pct: d.t25, color: "#facc15" },
                      { pct: d.t30, color: "#fb923c" },
                      { pct: d.tHot, color: "#ef4444" },
                    ];

                    let currentY = padT + plotH;
                    return (
                      <g key={d.h}>
                        {d.hasData &&
                          segments.map((seg, sIdx) => {
                            if (seg.pct <= 0) return null;
                            const segH = (seg.pct / 100) * plotH;
                            currentY -= segH;
                            return (
                              <rect
                                key={sIdx}
                                x={xBar}
                                y={currentY}
                                width={wBar}
                                height={segH}
                                fill={seg.color}
                              />
                            );
                          })}
                        <text
                          x={padL + idx * slotW + slotW / 2}
                          y={chartH - 6}
                          textAnchor="middle"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fontWeight="600"
                          fill="#475569"
                        >
                          {String(d.h).padStart(2, "0")}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ====================================================================
          SLIDE 2: FOKUS VISIBILITAS & TINGGI DASAR AWAN (MODEL A, B & C)
         ==================================================================== */}
      {slideType === "vis_cloud" && (
        <>
          <div className="px-7 pt-3.5 grid grid-cols-4 gap-3.5">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Rata-Rata Visibilitas &lt; 5000 m
              </div>
              <div className="text-xl font-extrabold text-blue-700 font-mono mt-0.5">
                {meanVis5k.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Visibilitas &lt; 3000 m: <b>{meanVis3k.toFixed(1)}%</b>
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Rata-Rata Visibilitas &lt; 1500 m
              </div>
              <div className="text-xl font-extrabold text-rose-600 font-mono mt-0.5">
                {meanVis1500.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Visibilitas &lt; 800 m: <b>{meanVis800.toFixed(1)}%</b>
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Tinggi Dasar Awan &lt; 1000 ft
              </div>
              <div className="text-xl font-extrabold text-teal-700 font-mono mt-0.5">
                {meanCeil1k.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Tinggi Dasar &lt; 1500 ft: <b>{meanCeil1500.toFixed(1)}%</b>
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Tinggi Dasar Awan &lt; 500 ft
              </div>
              <div className="text-xl font-extrabold text-indigo-700 font-mono mt-0.5">
                {meanCeil500.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Tinggi Dasar &lt; 300 ft: <b>{meanCeil300.toFixed(1)}%</b>
              </div>
            </div>
          </div>

          <div className="px-7 py-3 flex-1 grid grid-cols-2 gap-4 min-h-0">
            {/* Panel Kiri: Grafik Diurnal Multi-Ambang Visibilitas */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Distribusi Diurnal Visibilitas Rendah (00–23 UTC)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Perbandingan Ambang &lt; 5000m, &lt; 3000m, dan &lt; 1500m
                  </p>
                </div>
                <div className="flex items-center gap-2.5 text-[10px] font-bold">
                  <span className="flex items-center gap-1 text-blue-700">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#93c5fd" }}
                    />{" "}
                    &lt;5000m
                  </span>
                  <span className="flex items-center gap-1 text-amber-700">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#f59e0b" }}
                    />{" "}
                    &lt;3000m
                  </span>
                  <span className="flex items-center gap-1 text-rose-700">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#e11d48" }}
                    />{" "}
                    &lt;1500m
                  </span>
                </div>
              </div>

              <svg
                width="100%"
                height="310"
                viewBox="0 0 560 310"
                className="overflow-visible my-auto"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                  const y = 16 + 260 - ratio * 260;
                  const lbl = Math.round(ratio * maxVisOnlyY);
                  return (
                    <g key={idx}>
                      <line
                        x1={34}
                        y1={y}
                        x2={550}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                        strokeDasharray={ratio > 0 ? "3 3" : undefined}
                      />
                      <text
                        x={28}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="9"
                        fontFamily="monospace"
                        fill="#64748b"
                      >
                        {lbl}%
                      </text>
                    </g>
                  );
                })}
                {diurnalWx.map((d, idx) => {
                  const sW = 516 / 24;
                  const xBase = 34 + idx * sW + 2;
                  const bW = sW - 4;
                  const h5 = (d.vis5kPct / maxVisOnlyY) * 260;
                  const h3 = (d.vis3kPct / maxVisOnlyY) * 260;
                  const h15 = (d.vis1500Pct / maxVisOnlyY) * 260;
                  return (
                    <g key={d.h}>
                      {h5 > 0 && (
                        <rect
                          x={xBase}
                          y={276 - h5}
                          width={bW}
                          height={h5}
                          rx="1.5"
                          fill="#93c5fd"
                        />
                      )}
                      {h3 > 0 && (
                        <rect
                          x={xBase + 1.5}
                          y={276 - h3}
                          width={Math.max(2, bW - 3)}
                          height={h3}
                          rx="1"
                          fill="#f59e0b"
                        />
                      )}
                      {h15 > 0 && (
                        <rect
                          x={xBase + 3}
                          y={276 - h15}
                          width={Math.max(2, bW - 6)}
                          height={h15}
                          rx="1"
                          fill="#e11d48"
                        />
                      )}
                      <text
                        x={34 + idx * sW + sW / 2}
                        y={294}
                        textAnchor="middle"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="600"
                        fill="#475569"
                      >
                        {String(d.h).padStart(2, "0")}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Panel Kanan: Grafik Diurnal Multi-Ambang Tinggi Dasar Awan BKN/OVC */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Distribusi Diurnal Tinggi Dasar Awan BKN/OVC (00–23 UTC)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Perbandingan Tinggi Dasar &lt; 1500 ft, &lt; 1000 ft, dan
                    &lt; 500 ft
                  </p>
                </div>
                <div className="flex items-center gap-2.5 text-[10px] font-bold">
                  <span className="flex items-center gap-1 text-teal-700">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#5eead4" }}
                    />{" "}
                    &lt;1500 ft
                  </span>
                  <span className="flex items-center gap-1 text-indigo-700">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#6366f1" }}
                    />{" "}
                    &lt;1000 ft
                  </span>
                  <span className="flex items-center gap-1 text-purple-800">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#7e22ce" }}
                    />{" "}
                    &lt;500 ft
                  </span>
                </div>
              </div>

              <svg
                width="100%"
                height="310"
                viewBox="0 0 560 310"
                className="overflow-visible my-auto"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                  const y = 16 + 260 - ratio * 260;
                  const lbl = Math.round(ratio * maxCeilOnlyY);
                  return (
                    <g key={idx}>
                      <line
                        x1={34}
                        y1={y}
                        x2={550}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                        strokeDasharray={ratio > 0 ? "3 3" : undefined}
                      />
                      <text
                        x={28}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="9"
                        fontFamily="monospace"
                        fill="#64748b"
                      >
                        {lbl}%
                      </text>
                    </g>
                  );
                })}
                {diurnalWx.map((d, idx) => {
                  const sW = 516 / 24;
                  const xBase = 34 + idx * sW + 2;
                  const bW = sW - 4;
                  const h15 = (d.ceil1500Pct / maxCeilOnlyY) * 260;
                  const h10 = (d.ceil1kPct / maxCeilOnlyY) * 260;
                  const h5 = (d.ceil500Pct / maxCeilOnlyY) * 260;
                  return (
                    <g key={d.h}>
                      {h15 > 0 && (
                        <rect
                          x={xBase}
                          y={276 - h15}
                          width={bW}
                          height={h15}
                          rx="1.5"
                          fill="#5eead4"
                        />
                      )}
                      {h10 > 0 && (
                        <rect
                          x={xBase + 1.5}
                          y={276 - h10}
                          width={Math.max(2, bW - 3)}
                          height={h10}
                          rx="1"
                          fill="#6366f1"
                        />
                      )}
                      {h5 > 0 && (
                        <rect
                          x={xBase + 3}
                          y={276 - h5}
                          width={Math.max(2, bW - 6)}
                          height={h5}
                          rx="1"
                          fill="#7e22ce"
                        />
                      )}
                      <text
                        x={34 + idx * sW + sW / 2}
                        y={294}
                        textAnchor="middle"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="600"
                        fill="#475569"
                      >
                        {String(d.h).padStart(2, "0")}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </>
      )}

      {/* ====================================================================
          SLIDE 3: FOKUS ANGIN / WIND ROSE (MODEL D)
         ==================================================================== */}
      {slideType === "wind" && (
        <>
          <div className="px-7 pt-3.5 grid grid-cols-4 gap-3.5">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Arah Angin Paling Dominan
              </div>
              <div className="text-lg font-extrabold text-blue-700 mt-0.5">
                Dari {topSector?.fullName || "-"}{" "}
                <span className="font-mono">
                  ({topSector ? topSector.totalPct.toFixed(1) : "0.0"}%)
                </span>
              </div>
              <div className="text-[11px] text-slate-600">
                Rentang Sudut Datang: <b>{topSector?.degRange || "-"}</b>
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Kondisi Angin Tenang (Calm)
              </div>
              <div className="text-xl font-extrabold text-slate-800 font-mono mt-0.5">
                {calmPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600">
                Total: <b>{mData.modelD_CalmTotal}</b> dari {mData.tno} obs
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Angin Berubah-Ubah (Variable)
              </div>
              <div className="text-xl font-extrabold text-teal-700 font-mono mt-0.5">
                {vrbPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600">
                Total: <b>{vrbSum}</b> observasi jam penuh
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Angin Kencang (&gt; 15 Knot)
              </div>
              <div className="text-xl font-extrabold text-rose-600 font-mono mt-0.5">
                {strongWindPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600">
                Kecepatan dominan:{" "}
                <b>
                  {[...windSpeedDist].sort((a, b) => b.pct - a.pct)[0]?.label}
                </b>
              </div>
            </div>
          </div>

          <div className="px-7 py-3 flex-1 grid grid-cols-12 gap-4 min-h-0">
            {/* Wind Rose Besar di Kiri */}
            <div className="col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Diagram Mawar Angin (Wind Rose)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Arah menunjukkan arah datangnya angin (DARI)
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  Skala: {maxSectorPct}%
                </span>
              </div>

              <div className="flex-1 flex items-center justify-center my-auto">
                {renderWindRoseSvg(336, 122)}
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-center gap-3 text-[10px] font-bold text-slate-700">
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#38bdf8" }}
                  />{" "}
                  1–5 kt
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#0284c7" }}
                  />{" "}
                  6–10 kt
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#f59e0b" }}
                  />{" "}
                  11–15 kt
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-xs inline-block"
                    style={{ backgroundColor: "#e11d48" }}
                  />{" "}
                  &gt; 15 kt
                </span>
              </div>
            </div>

            {/* Kanan: Peringkat Arah Dominan + Grafik Kelas Kecepatan Angin */}
            <div className="col-span-7 flex flex-col gap-3.5 justify-between">
              {/* Top 6 Arah Angin Datang */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex-1 flex flex-col justify-between">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    6 Arah Angin Datang Paling Dominan (Arah DARI)
                  </h3>
                  <span className="text-[10.5px] text-slate-500 font-semibold">
                    Persentase dari Total Observasi ({mData.tno} jam)
                  </span>
                </div>
                <div className="space-y-2 my-auto pt-1">
                  {sortedWindSectors.slice(0, 6).map((sec, idx) => {
                    const widthRatio = Math.min(
                      100,
                      (sec.totalPct / maxSectorPct) * 100,
                    );
                    return (
                      <div
                        key={sec.shortLabel}
                        className="flex items-center gap-3 text-xs"
                      >
                        <div className="w-44 font-bold text-slate-800 truncate shrink-0">
                          {idx + 1}. Dari {sec.fullName}
                        </div>
                        <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden flex">
                          <div
                            style={{
                              width: `${widthRatio}%`,
                              backgroundColor:
                                idx === 0 ? "#0284c7" : "#38bdf8",
                            }}
                            className="h-full rounded-full transition-all"
                          />
                        </div>
                        <div className="w-16 text-right font-mono font-extrabold text-slate-900 shrink-0">
                          {sec.totalPct.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Distribusi Kelas Kecepatan Angin */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex-1 flex flex-col justify-between">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Distribusi Frekuensi Kelas Kecepatan Angin (Knot)
                  </h3>
                  <span className="text-[10.5px] text-slate-500 font-semibold">
                    Termasuk Calm &amp; Seluruh Arah
                  </span>
                </div>
                <svg
                  width="100%"
                  height="145"
                  viewBox="0 0 560 145"
                  className="overflow-visible my-auto"
                >
                  {windSpeedDist.map((item, idx) => {
                    const colW = 540 / windSpeedDist.length;
                    const x = 10 + idx * colW + 8;
                    const w = colW - 16;
                    const barH = (item.pct / maxSpeedBarPct) * 102;
                    return (
                      <g key={item.label}>
                        <rect
                          x={x}
                          y={116 - barH}
                          width={w}
                          height={Math.max(1, barH)}
                          rx="3"
                          fill={item.color}
                        />
                        {item.pct > 0 && (
                          <text
                            x={x + w / 2}
                            y={111 - barH}
                            textAnchor="middle"
                            fontSize="8.5"
                            fontFamily="monospace"
                            fontWeight="800"
                            fill="#0f172a"
                          >
                            {item.pct.toFixed(1)}%
                          </text>
                        )}
                        <text
                          x={x + w / 2}
                          y={133}
                          textAnchor="middle"
                          fontSize="8.5"
                          fontWeight="700"
                          fill="#475569"
                        >
                          {item.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ====================================================================
          SLIDE 4: FOKUS SUHU UDARA PERMUKAAN (MODEL E)
         ==================================================================== */}
      {slideType === "temp" && (
        <>
          <div className="px-7 pt-3.5 grid grid-cols-4 gap-3.5">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Rentang Suhu Dominan
              </div>
              <div className="text-xl font-extrabold text-amber-700 font-mono mt-0.5">
                {dominantTemp?.label || "-"}{" "}
                <span>
                  ({dominantTemp ? dominantTemp.val.toFixed(1) : "0.0"}%)
                </span>
              </div>
              <div className="text-[11px] text-slate-600">
                Rata-rata kejadian harian
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Suhu Sejuk (&lt; 25°C)
              </div>
              <div className="text-xl font-extrabold text-teal-700 font-mono mt-0.5">
                {coolTempPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600">
                Umumnya terjadi dini hari–pagi
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Suhu Panas (30–35°C)
              </div>
              <div className="text-xl font-extrabold text-orange-600 font-mono mt-0.5">
                {warmTempPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600">
                Umumnya terjadi siang–sore
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 uppercase">
                Suhu Ekstrem (&gt; 35°C)
              </div>
              <div className="text-xl font-extrabold text-rose-600 font-mono mt-0.5">
                {hotTempPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-600 truncate">
                {mData.remarksModelE}
              </div>
            </div>
          </div>

          <div className="px-7 py-3 flex-1 grid grid-cols-12 gap-4 min-h-0">
            {/* Grafik Diurnal 24 Jam (7 Kolom) */}
            <div className="col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Variasi Diurnal Suhu Udara Permukaan (00–23 UTC)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Proporsi Persentase Kelas Suhu Tiap Jam Pengamatan
                  </p>
                </div>
                <div className="flex items-center gap-2.5 text-[10px] font-bold text-slate-700">
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#38bdf8" }}
                    />{" "}
                    &lt;20°
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#34d399" }}
                    />{" "}
                    20–25°
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#facc15" }}
                    />{" "}
                    25–30°
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#fb923c" }}
                    />{" "}
                    30–35°
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-xs inline-block"
                      style={{ backgroundColor: "#ef4444" }}
                    />{" "}
                    &gt;35°
                  </span>
                </div>
              </div>

              <svg
                width="100%"
                height="305"
                viewBox="0 0 560 305"
                className="overflow-visible my-auto"
              >
                {[0, 25, 50, 75, 100].map((pctTick) => {
                  const y = 16 + 255 - (pctTick / 100) * 255;
                  return (
                    <g key={pctTick}>
                      <line
                        x1={34}
                        y1={y}
                        x2={550}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                        strokeDasharray={pctTick > 0 ? "3 3" : undefined}
                      />
                      <text
                        x={28}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="9"
                        fontFamily="monospace"
                        fill="#64748b"
                      >
                        {pctTick}%
                      </text>
                    </g>
                  );
                })}

                {diurnalTemp.map((d, idx) => {
                  const sW = 516 / 24;
                  const xBar = 34 + idx * sW + 3;
                  const wBar = sW - 6;
                  const segments = [
                    { pct: d.tLow, color: "#38bdf8" },
                    { pct: d.t20, color: "#34d399" },
                    { pct: d.t25, color: "#facc15" },
                    { pct: d.t30, color: "#fb923c" },
                    { pct: d.tHot, color: "#ef4444" },
                  ];

                  let currentY = 271;
                  return (
                    <g key={d.h}>
                      {d.hasData &&
                        segments.map((seg, sIdx) => {
                          if (seg.pct <= 0) return null;
                          const segH = (seg.pct / 100) * 255;
                          currentY -= segH;
                          return (
                            <rect
                              key={sIdx}
                              x={xBar}
                              y={currentY}
                              width={wBar}
                              height={segH}
                              fill={seg.color}
                            />
                          );
                        })}
                      <text
                        x={34 + idx * sW + sW / 2}
                        y={290}
                        textAnchor="middle"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="600"
                        fill="#475569"
                      >
                        {String(d.h).padStart(2, "0")}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Distribusi 9 Kelas Suhu Lengkap (5 Kolom) */}
            <div className="col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between">
              <div className="border-b border-slate-100 pb-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                  Rata-Rata Bulanan Per Kelas Suhu (Model E)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Seluruh Interval 5°C (-5°C s.d. &gt;35°C)
                </p>
              </div>

              <div className="space-y-2.5 my-auto py-1">
                {tempAllClassMeans.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 text-xs"
                  >
                    <div className="w-20 font-mono font-bold text-slate-700 shrink-0">
                      {item.label}
                    </div>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        style={{
                          width: `${Math.min(100, item.val)}%`,
                          backgroundColor: item.color,
                        }}
                        className="h-full rounded-full"
                      />
                    </div>
                    <div className="w-14 text-right font-mono font-extrabold text-slate-900 shrink-0">
                      {item.val.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 4. FOOTER CATATAN KEJADIAN EKSTREM (REMARKS) */}
      <div
        style={{ backgroundColor: "#1e293b", color: "#f1f5f9" }}
        className="px-7 py-3 flex items-center justify-between gap-6 text-[11px]"
      >
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-extrabold uppercase shrink-0 mt-0.5">
            Remarks Ekstrem
          </span>
          <div className="whitespace-normal leading-relaxed font-medium text-slate-100">
            <span>
              <b className="text-amber-200">Suhu:</b> {mData.remarksModelE}
            </span>
            <span className="mx-2 text-slate-500">|</span>
            <span>
              <b className="text-cyan-200">Visibilitas:</b>{" "}
              {mData.remarksModelB}
            </span>
            <span className="mx-2 text-slate-500">|</span>
            <span>
              <b className="text-indigo-200">Tinggi Dasar Awan:</b>{" "}
              {mData.remarksModelC}
            </span>
          </div>
        </div>
        <div className="text-slate-300 font-mono font-bold shrink-0 text-right">
          ACS • {meta.icao || "BMKG"} • {mData.monthName}{" "}
          {mData.periodOfRecordStr}
        </div>
      </div>
    </div>
  );
}

// Helper komponen 2 sub-baris per jam untuk Model A dengan tinggi baris seragam (h-7)
function FragmentRowModelA({
  hrLabel,
  visRow,
  cloudRow,
  denom,
  formatCellVal,
}: {
  hrLabel: string;
  visRow: number[];
  cloudRow: number[];
  denom: number;
  formatCellVal: (freq: number, denom: number) => string;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50 h-7">
        <td
          rowSpan={2}
          className="border border-slate-800 px-2 font-mono font-bold bg-slate-50 align-middle"
        >
          {hrLabel}
        </td>
        {visRow.map((freq, idx) => (
          <td
            key={idx}
            className="border border-slate-800 px-2 h-7 align-middle font-mono"
          >
            {formatCellVal(freq, denom)}
          </td>
        ))}
      </tr>
      <tr className="bg-blue-50/40 text-blue-950 italic h-7">
        {cloudRow.map((freq, idx) => (
          <td
            key={idx}
            className="border border-slate-800 px-2 h-7 align-middle font-mono"
          >
            {idx <= 1 ? "-" : formatCellVal(freq, denom)}
          </td>
        ))}
      </tr>
    </>
  );
}
