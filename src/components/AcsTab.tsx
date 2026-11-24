"use client";
import { useState, useRef, useMemo } from "react";
import {
  downloadAcsTemplate,
  processAcsWorkbooks,
  exportAcsExcelWorkbook,
  resolveAcsDivisor,
  AcsDivisorMode,
  AcsMetadata,
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
} from "lucide-react";
import { toJpeg } from "html-to-image";

type AcsModelTab = "A" | "B" | "C" | "D" | "E";
type DisplayValueMode = "percent" | "frequency";

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
    if (useRvr && (activeModel === "B" || activeModel === "C")) {
      setActiveModel("A");
    } else if (!useRvr && activeModel === "A") {
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

  const handleDownloadJpg = async () => {
    if (!tableExportRef.current || !activeMonthData) return;
    try {
      const dataUrl = await toJpeg(tableExportRef.current, {
        quality: 0.95,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = `ACS_Model_${activeModel}_${activeMonthData.monthName}_${Date.now()}.jpg`;
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

  const availableModels: { id: AcsModelTab; label: string; desc: string }[] =
    hasRvr
      ? [
          {
            id: "A",
            label: "Model A",
            desc: "RVR / Visibility & Tinggi Dasar Awan (Alat)",
          },
          { id: "D", label: "Model D", desc: "Arah & Kecepatan Angin" },
          { id: "E", label: "Model E", desc: "Suhu Udara Permukaan" },
        ]
      : [
          { id: "B", label: "Model B", desc: "Visibility (Visual)" },
          {
            id: "C",
            label: "Model C",
            desc: "Tinggi Awan BKN/OVC (Visual)",
          },
          { id: "D", label: "Model D", desc: "Arah & Kecepatan Angin" },
          { id: "E", label: "Model E", desc: "Suhu Udara Permukaan" },
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
                  3. Pilihan Model & Opsi Pembagi (%)
                </div>
                <p className="leading-relaxed">
                  Gunakan <b>Tanpa RVR</b> untuk menampilkan Model B, C, D, E,
                  atau <b>Dengan RVR</b> untuk Model A, D, E. Pada Model A/B/C,
                  mode pembagi <b>Otomatis</b> memakai jumlah hari (
                  <code className="bg-slate-100 px-1 rounded">n</code>) untuk
                  data 1 tahun dan{" "}
                  <code className="bg-slate-100 px-1 rounded">TNO</code>{" "}
                  gabungan untuk data &gt;1 tahun sesuai contoh di SOP, dan
                  dapat diubah kapan saja.
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
            (00.00–23.00 UTC) untuk periode 1 hingga 5 tahun (Model A–E).
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
            3. Identitas Stasiun / Bandara (Kop Tabel Laporan ACS)
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
                <ImageIcon size={14} /> Download JPG (Model {activeModel})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PANEL 2: KONTROL FILTER & TABEL LAPORAN ACS (MODEL A–E) */}
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
                  Dengan RVR (Model A, D, E)
                </button>
              </div>

              <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-300">
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
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
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

              {(activeModel === "A" ||
                activeModel === "B" ||
                activeModel === "C") &&
                displayMode === "percent" && (
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

          {/* KERTAS LAPORAN RESMI LAMPIRAN III (UKURAN PRESISI & SIAP EXPORT JPG) */}
          <div className="bg-slate-200/60 p-4 rounded-xl overflow-x-auto">
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
                  <div>TOTAL NUMBER OF OBSERVATION : {activeMonthData.tno}</div>
                  <div>
                    OBSERVATION TIME :{" "}
                    {meta.observationTime || activeMonthData.detectedObsTimeStr}
                  </div>
                  <div>
                    LATITUDE : {meta.latitude || "-"} &nbsp;&nbsp;|&nbsp;&nbsp;
                    LONGITUDE : {meta.longitude || "-"}
                  </div>
                  <div>
                    ELEVATION ABOVE MSL :{" "}
                    {meta.elevationM ? `${meta.elevationM} M` : "-"}
                  </div>
                </div>
              </div>

              {/* ==========================================================
                  TABEL MODEL A (RVR/VIS & Hs BKN/OVC — 9 KOLOM PRESISI)
                 ========================================================== */}
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
                        THE OCCURRENCE OF RUNWAY VISUAL RANGE / VISIBILITY (BOTH
                        IN METRES) AND/OR HEIGHT OF THE BASE OF THE LOWEST CLOUD
                        LAYER (IN FEET) OF BKN OR OVC EXTENT BELOW SPECIFIED
                        VALUES AT SPECIFIED TIMES
                      </th>
                    </tr>
                    <tr className="bg-slate-100 font-bold h-7">
                      <th rowSpan={3} className="border border-slate-800 p-1.5">
                        TIME
                        <br />
                        (UTC)
                      </th>
                      <th colSpan={5} className="border border-slate-800 p-1.5">
                        RVR / Hs
                      </th>
                      <th colSpan={3} className="border border-slate-800 p-1.5">
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

              {/* ==========================================================
                  TABEL MODEL B (VISIBILITY VISUAL — 9 KOLOM PRESISI)
                 ========================================================== */}
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
                      <th rowSpan={2} className="border border-slate-800 p-1.5">
                        TIME
                        <br />
                        (GMT)
                      </th>
                      <th colSpan={8} className="border border-slate-800 p-1.5">
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

              {/* ==========================================================
                  TABEL MODEL C (HS AWAN TERENDAH BKN/OVC — 7 KOLOM PRESISI)
                 ========================================================== */}
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
                        THE HEIGHT OF THE BASE OF THE LOWEST CLOUD LAYER (FEET)
                        OF BKN OR OVC EXTENT BELOW SPECIFIED VALUES AT SPECIFIED
                        TIMES
                      </th>
                    </tr>
                    <tr className="bg-slate-100 font-bold h-7">
                      <th rowSpan={2} className="border border-slate-800 p-1.5">
                        TIME
                        <br />
                        (GMT)
                      </th>
                      <th colSpan={6} className="border border-slate-800 p-1.5">
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

              {/* ==========================================================
                  TABEL MODEL D (ARAH & KECEPATAN ANGIN — 11 KOLOM PRESISI)
                 ========================================================== */}
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
                        OCCURRENCE OF CONCURRENT WIND DIRECTION (IN SECTOR 30°)
                        AND SPEED (IN KNOTS) WITHIN SPECIFIED RANGES
                      </th>
                    </tr>
                    <tr className="bg-slate-100 font-bold h-7">
                      <th rowSpan={2} className="border border-slate-800 p-1.5">
                        WIND
                        <br />
                        DIRECTION
                      </th>
                      <th colSpan={9} className="border border-slate-800 p-1.5">
                        WIND SPEED
                      </th>
                      <th rowSpan={2} className="border border-slate-800 p-1.5">
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
                                  (colSum / Math.max(1, activeMonthData.tno)) *
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

              {/* ==========================================================
                  TABEL MODEL E (SUHU UDARA PERMUKAAN — 10 KOLOM PRESISI)
                 ========================================================== */}
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
                        SURFACE TEMPERATURE (SCREEN) IN SPECIFIED RANGES OF 5°C
                        AT SPECIFIED TIMES
                      </th>
                    </tr>
                    <tr className="bg-slate-100 font-bold h-7">
                      <th rowSpan={2} className="border border-slate-800 p-1.5">
                        TIME
                        <br />
                        (GMT)
                      </th>
                      <th colSpan={9} className="border border-slate-800 p-1.5">
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
          </div>
        </div>
      )}
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
