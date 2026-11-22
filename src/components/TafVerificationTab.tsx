"use client";
import { useState, useRef, useMemo } from "react";
import {
  downloadTafVerificationTemplate,
  processUploadedVerificationWorkbook,
  exportMonthlyVerificationExcel,
  exportAnnualVerificationExcel,
  calcIndividualOverallAverage,
  FullVerificationWorkbookResult,
  MONTH_SHEETS,
  MONTH_SHORT_LABELS,
} from "@/utils/tafExcelHelper";
import { getStationByIcao } from "@/utils/stations";
import {
  FileSpreadsheet,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  Table2,
  CalendarDays,
  BarChart3,
  Image as ImageIcon,
  MapPin,
} from "lucide-react";
import { toJpeg } from "html-to-image";

type ActiveSubTab = "individu" | "bulanan" | "tahunan";

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
  if (typeof direct === "string" && direct.trim()) return direct.trim();
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
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return "";
};

export default function TafVerificationTab() {
  const currentYear = new Date().getUTCFullYear();
  const [templateYear, setTemplateYear] = useState<string>(String(currentYear));
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [resultData, setResultData] =
    useState<FullVerificationWorkbookResult | null>(null);

  const [activeSubTab, setActiveSubTab] = useState<ActiveSubTab>("individu");
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(0);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recapExportRef = useRef<HTMLDivElement>(null);
  const validityCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const stationMeta = useMemo(() => {
    if (!resultData?.detectedStationIcao) return null;
    const code = resultData.detectedStationIcao.toUpperCase();
    const info = getStationByIcao(code);
    const bandara = getAirportName(info);
    const stasiun = getStationName(info);
    return {
      icao: code,
      bandara,
      stasiun,
      label: bandara
        ? `Bandara ${bandara} (${code})${stasiun ? ` — Stamet ${stasiun}` : ""}`
        : `Kode ICAO (${code})`,
    };
  }, [resultData]);

  const handleDownloadTemplate = () => {
    const parsedYear = parseInt(templateYear.trim(), 10);
    if (!parsedYear || parsedYear < 2000 || parsedYear > 2100) {
      showToastMsg("⚠️ Masukkan tahun yang valid (4 digit, contoh: 2026)!");
      return;
    }

    downloadTafVerificationTemplate(parsedYear);
    showToastMsg(
      `✅ Template Excel 12 Bulan Tahun ${parsedYear} berhasil diunduh!`,
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const parsed = processUploadedVerificationWorkbook(buffer);

      if (parsed.totalTafCount === 0) {
        showToastMsg(
          "⚠️ Tidak ditemukan data sandi TAF pada file Excel yang diunggah!",
        );
        return;
      }

      setUploadedFileName(file.name);
      setResultData(parsed);

      const firstPopulatedMonth = parsed.monthlyRecaps.find(
        (m) => m.items.length > 0,
      );
      const initMonth = firstPopulatedMonth
        ? firstPopulatedMonth.bulanIndex
        : parsed.individualResults[0].bulanIndex;
      setSelectedMonthIdx(initMonth);

      const firstItem =
        firstPopulatedMonth?.items[0] || parsed.individualResults[0];
      if (firstItem) {
        setSelectedDate(firstItem.tanggal);
      } else {
        setSelectedDate(null);
      }

      showToastMsg(
        `✅ Berhasil memproses ${parsed.totalTafCount} sandi TAF dan ${parsed.totalMetarCount} observasi METAR!`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToastMsg(`⚠️ Gagal membaca file Excel: ${msg}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Daftar seluruh TAF individu pada bulan yang sedang dipilih
  const monthIndividualList = useMemo(() => {
    if (!resultData) return [];
    return resultData.individualResults.filter(
      (item) => item.bulanIndex === selectedMonthIdx,
    );
  }, [resultData, selectedMonthIdx]);

  // Daftar tanggal unik pada bulan tersebut beserta jumlah validitasnya
  const availableDatesInMonth = useMemo(() => {
    const dateMap = new Map<number, number>();
    for (const item of monthIndividualList) {
      dateMap.set(item.tanggal, (dateMap.get(item.tanggal) || 0) + 1);
    }
    return Array.from(dateMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([tanggal, count]) => ({ tanggal, count }));
  }, [monthIndividualList]);

  // Seluruh blok validitas (00, 06, 12, 18 UTC) untuk tanggal yang sedang dipilih
  const activeDateTafs = useMemo(() => {
    if (monthIndividualList.length === 0) return [];
    const targetDay =
      selectedDate !== null &&
      monthIndividualList.some((it) => it.tanggal === selectedDate)
        ? selectedDate
        : monthIndividualList[0].tanggal;

    return monthIndividualList.filter((it) => it.tanggal === targetDay);
  }, [monthIndividualList, selectedDate]);

  // Rekap bulanan pada bulan yang sedang dipilih
  const activeMonthlyRecap = useMemo(() => {
    if (!resultData) return null;
    return resultData.monthlyRecaps[selectedMonthIdx] || null;
  }, [resultData, selectedMonthIdx]);

  const handleMonthChange = (newMonth: number) => {
    setSelectedMonthIdx(newMonth);
    if (!resultData) return;
    const itemsInMonth = resultData.individualResults.filter(
      (it) => it.bulanIndex === newMonth,
    );
    if (itemsInMonth.length > 0) {
      setSelectedDate(itemsInMonth[0].tanggal);
    } else {
      setSelectedDate(null);
    }
  };

  const handleDownloadRecapJpg = async () => {
    if (!recapExportRef.current) return;
    try {
      const dataUrl = await toJpeg(recapExportRef.current, {
        quality: 0.95,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = `Verifikasi_TAF_${activeSubTab.toUpperCase()}_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch {
      showToastMsg("⚠️ Gagal mengunduh gambar JPG.");
    }
  };

  const handleDownloadValidityJpg = async (
    cardKey: string,
    tanggal: number,
    cycle: string,
  ) => {
    const node = validityCardRefs.current[cardKey];
    if (!node) return;
    try {
      const dataUrl = await toJpeg(node, {
        quality: 0.95,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = `Verifikasi_Individu_Tgl${tanggal}_${cycle}UTC_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch {
      showToastMsg("⚠️ Gagal mengunduh gambar JPG.");
    }
  };

  const handleExportMonthlyExcel = () => {
    if (!resultData) return;
    const monthName = MONTH_SHEETS[selectedMonthIdx];
    const hasData = resultData.individualResults.some(
      (it) => it.bulanIndex === selectedMonthIdx,
    );
    if (!hasData) {
      showToastMsg(
        `⚠️ Tidak ada data TAF terverifikasi pada bulan ${monthName}!`,
      );
      return;
    }

    exportMonthlyVerificationExcel(
      resultData,
      selectedMonthIdx,
      stationMeta?.label || "",
    );
    showToastMsg(
      `✅ File Excel Verifikasi Bulan ${monthName} ${resultData.tahun} berhasil diunduh!`,
    );
  };

  const handleExportAnnualExcel = () => {
    if (!resultData) return;
    exportAnnualVerificationExcel(resultData, stationMeta?.label || "");
    showToastMsg(
      `✅ File Excel Verifikasi Tahun ${resultData.tahun} berhasil diunduh!`,
    );
  };

  const renderScoreBadge = (val: 0 | 1) => (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded font-bold text-[11px] ${
        val === 1
          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
          : "bg-rose-100 text-rose-800 border border-rose-300"
      }`}
    >
      {val}
    </span>
  );

  const getCycleRowTint = (cycle: string) => {
    if (cycle === "00") return "bg-emerald-50/70";
    if (cycle === "06") return "bg-amber-50/70";
    if (cycle === "12") return "bg-blue-50/70";
    return "bg-orange-50/70";
  };

  const monthlyOverallAverage = activeMonthlyRecap?.monthlyAverage
    ? calcIndividualOverallAverage(activeMonthlyRecap.monthlyAverage)
    : null;

  return (
    <div className="space-y-6 relative animate-in fade-in zoom-in-95 duration-300">
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in slide-in-from-bottom-5">
          <AlertCircle size={18} className="text-cyan-400" />
          <span className="text-sm font-semibold">{toast}</span>
        </div>
      )}

      {/* PANEL 1: DOWNLOAD TEMPLATE & UPLOAD EXCEL 12 TAB */}
      <div className="bg-white/90 p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="text-emerald-600" size={22} />
              Verifikasi Aerodrome Forecast (SOP/024/DM/X/2025)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Unduh template Excel 12 bulan (JANUARI–DESEMBER), isi sandi TAF &
              METAR rutin 30-menitan, lalu unggah kembali untuk menghitung hasil
              verifikasi secara otomatis.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Blok Download Template */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
              1. Unduh Template Master (12 Tab Bulan)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-white border border-slate-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
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
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Download size={16} /> Download Template .XLSX
              </button>
            </div>
          </div>

          {/* Blok Upload Template */}
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-800">
              2. Unggah File Excel yang Sudah Diisi
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Upload size={16} /> Upload File Excel (.XLSX)
              </button>
              {uploadedFileName && (
                <span className="text-xs font-semibold text-slate-700 bg-white px-3 py-1.5 rounded-md border border-slate-200 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  {uploadedFileName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status Info Hasil Parsing & Tombol Export Excel */}
        {resultData && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800 text-white px-4 py-3 rounded-xl text-xs">
            <div className="flex flex-wrap items-center gap-4">
              {stationMeta && (
                <span className="flex items-center gap-1.5 font-semibold text-cyan-300">
                  <MapPin size={14} /> {stationMeta.label}
                </span>
              )}
              <span>
                Tahun Evaluasi:{" "}
                <span className="font-bold">{resultData.tahun}</span>
              </span>
              <span>
                Total TAF Terbaca:{" "}
                <span className="font-bold text-emerald-400">
                  {resultData.totalTafCount}
                </span>
              </span>
              <span>
                Total METAR Terbaca:{" "}
                <span className="font-bold text-amber-300">
                  {resultData.totalMetarCount}
                </span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportMonthlyExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-all cursor-pointer"
                title="Unduh Rekap Bulanan + Tab Individu per Tanggal (00, 06, 12, 18) untuk bulan terpilih"
              >
                <Download size={14} /> Export Bulan (
                {MONTH_SHEETS[selectedMonthIdx]})
              </button>
              <button
                type="button"
                onClick={handleExportAnnualExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg transition-all cursor-pointer"
                title="Unduh Rekap Tahunan + Rekap Semua Bulan + Tab Individu Harian"
              >
                <Download size={14} /> Export Tahun ({resultData.tahun})
              </button>
              {(activeSubTab === "bulanan" || activeSubTab === "tahunan") && (
                <button
                  type="button"
                  onClick={handleDownloadRecapJpg}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-all cursor-pointer"
                >
                  <ImageIcon size={14} /> Download JPG
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PANEL 2: HASIL VERIFIKASI (INDIVIDU, REKAP BULANAN, REKAP TAHUNAN) */}
      {resultData && (
        <div className="space-y-4">
          {/* Navigasi Sub-Tab */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-100 p-3 rounded-xl border border-slate-200">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveSubTab("individu")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeSubTab === "individu"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white text-slate-700 hover:bg-slate-200"
                }`}
              >
                <Table2 size={15} /> Verifikasi Individu
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("bulanan")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeSubTab === "bulanan"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white text-slate-700 hover:bg-slate-200"
                }`}
              >
                <CalendarDays size={15} /> Rekap Bulanan
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("tahunan")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeSubTab === "tahunan"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white text-slate-700 hover:bg-slate-200"
                }`}
              >
                <BarChart3 size={15} /> Rekap Tahunan
              </button>
            </div>

            {/* Filter Bulan & Tanggal */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedMonthIdx}
                onChange={(e) => handleMonthChange(Number(e.target.value))}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700"
              >
                {MONTH_SHEETS.map((mName, idx) => {
                  const count =
                    resultData.monthlyRecaps[idx]?.items.length || 0;
                  return (
                    <option key={mName} value={idx}>
                      {mName} ({count} TAF)
                    </option>
                  );
                })}
              </select>

              {activeSubTab === "individu" &&
                availableDatesInMonth.length > 0 && (
                  <select
                    value={
                      selectedDate !== null
                        ? selectedDate
                        : availableDatesInMonth[0].tanggal
                    }
                    onChange={(e) => setSelectedDate(Number(e.target.value))}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700"
                  >
                    {availableDatesInMonth.map((d) => (
                      <option key={d.tanggal} value={d.tanggal}>
                        Tanggal {d.tanggal} ({d.count} validitas)
                      </option>
                    ))}
                  </select>
                )}
            </div>
          </div>

          {/* ============================================================
              TAMPILAN 1: VERIFIKASI INDIVIDU (PER TANGGAL: 00 s.d. 18 UTC)
             ============================================================ */}
          {activeSubTab === "individu" && (
            <div className="space-y-6">
              {activeDateTafs.length === 0 ? (
                <div className="bg-white p-8 text-center text-slate-500 text-sm border border-dashed border-slate-300 rounded-xl">
                  Tidak ada sandi TAF pada bulan{" "}
                  <span className="font-bold">
                    {MONTH_SHEETS[selectedMonthIdx]}
                  </span>
                  . Silakan pilih bulan lain yang memiliki data.
                </div>
              ) : (
                activeDateTafs.map((tafItem) => {
                  const cardKey = `${tafItem.bulanIndex}-${tafItem.tanggal}-${tafItem.validityCycle}`;
                  const overallAverage = calcIndividualOverallAverage(
                    tafItem.scores,
                  );

                  return (
                    <div
                      key={cardKey}
                      className="bg-slate-200/50 p-2 rounded-xl overflow-x-auto space-y-2"
                    >
                      <div className="flex items-center justify-between px-2 pt-1">
                        <span className="text-xs font-extrabold text-slate-700">
                          Tanggal {tafItem.tanggal}{" "}
                          {MONTH_SHEETS[tafItem.bulanIndex]} {tafItem.tahun} —
                          Validitas {tafItem.validityCycle}.00 UTC
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadValidityJpg(
                              cardKey,
                              tafItem.tanggal,
                              tafItem.validityCycle,
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer"
                        >
                          <ImageIcon size={14} /> Download JPG (
                          {tafItem.validityCycle}.00 UTC)
                        </button>
                      </div>

                      <div
                        ref={(el) => {
                          validityCardRefs.current[cardKey] = el;
                        }}
                        style={{
                          backgroundColor: "#ffffff",
                          color: "#0f172a",
                        }}
                        className="p-6 rounded-xl shadow-md border border-slate-200 min-w-max"
                      >
                        <h3 className="font-extrabold text-base text-slate-800 mb-3">
                          Verifikasi Individu — Validitas{" "}
                          {tafItem.validityCycle}.00 UTC
                          {stationMeta ? ` (${stationMeta.label})` : ""}
                        </h3>

                        <table className="w-full text-xs border-collapse border border-slate-400">
                          <thead>
                            <tr className="bg-slate-50 text-left align-top">
                              <th
                                rowSpan={2}
                                className="border border-slate-400 p-2 text-center w-10"
                              >
                                (1)
                                <br />
                                No
                              </th>
                              <th
                                rowSpan={2}
                                className="border border-slate-400 p-2 text-center w-16"
                              >
                                (2)
                                <br />
                                Tanggal
                              </th>
                              <th
                                rowSpan={2}
                                className="border border-slate-400 p-2 text-center w-16"
                              >
                                (3)
                                <br />
                                Waktu
                              </th>
                              <th
                                colSpan={8}
                                className="border border-slate-400 p-2.5 font-normal text-slate-800"
                              >
                                <div className="text-center font-bold mb-1">
                                  (4) PRAKIRAAN (TAF)
                                </div>
                                <div className="space-y-0.5 text-[11px]">
                                  <div>
                                    <span className="font-bold">
                                      PERIODE VALIDITAS:
                                    </span>{" "}
                                    {tafItem.periodeValiditasStr}
                                  </div>
                                  <div className="font-mono">
                                    <span className="font-bold font-sans">
                                      PRAKIRAAN:
                                    </span>{" "}
                                    {tafItem.rawTaf}
                                  </div>
                                  <div>
                                    <span className="font-bold">
                                      FORECASTER:
                                    </span>{" "}
                                    {tafItem.forecaster}
                                  </div>
                                  <div>
                                    <span className="font-bold">
                                      VERIFIKATOR:
                                    </span>{" "}
                                    {tafItem.verifikator}
                                  </div>
                                </div>
                              </th>
                              <th
                                colSpan={15}
                                className="border border-slate-400 p-2.5 text-center align-middle font-bold text-slate-800"
                              >
                                (5) PENGAMATAN (METAR)
                              </th>
                            </tr>

                            <tr className="bg-slate-100 text-center font-bold text-[11px]">
                              <th className="border border-slate-400 p-1.5">
                                (4-1)
                                <br />
                                Change Group
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-2)
                                <br />A
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-3)
                                <br />
                                B1
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-4)
                                <br />
                                B2
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-5)
                                <br />C
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-6)
                                <br />D
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-7)
                                <br />E
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (4-8)
                                <br />F
                              </th>

                              <th className="border border-slate-400 p-1.5 min-w-[230px]">
                                (5-1)
                                <br />
                                DATA METAR
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-2)
                                <br />A
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-3)
                                <br />H
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-4)
                                <br />
                                B1
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-5)
                                <br />H
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-6)
                                <br />
                                B2
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-7)
                                <br />H
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-8)
                                <br />C
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-9)
                                <br />H
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-10)
                                <br />D
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-11)
                                <br />H
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-12)
                                <br />E
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-13)
                                <br />H
                              </th>
                              <th className="border border-slate-400 p-1.5">
                                (5-14)
                                <br />F
                              </th>
                              <th className="border border-slate-400 p-1.5 bg-slate-200">
                                (5-15)
                                <br />H
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {tafItem.rows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={26}
                                  className="border border-slate-400 p-6 text-center text-slate-500 italic"
                                >
                                  Tidak ada data METAR pengamatan yang cocok
                                  pada rentang 12 jam pertama TAF ini.
                                </td>
                              </tr>
                            ) : (
                              tafItem.rows.map((r, idx) => {
                                const showDateCell =
                                  idx === 0 ||
                                  r.tanggal !== tafItem.rows[idx - 1].tanggal;
                                const dateRowSpan = tafItem.rows.filter(
                                  (x) => x.tanggal === r.tanggal,
                                ).length;

                                return (
                                  <tr
                                    key={r.no}
                                    className="hover:bg-blue-50/40 text-center"
                                  >
                                    <td className="border border-slate-400 p-1.5">
                                      {r.no}
                                    </td>
                                    {showDateCell && (
                                      <td
                                        rowSpan={dateRowSpan}
                                        className="border border-slate-400 p-1.5 font-bold align-middle bg-white"
                                      >
                                        {r.tanggal}
                                      </td>
                                    )}
                                    <td className="border border-slate-400 p-1.5 font-mono font-semibold">
                                      {r.waktuUtc}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 font-semibold text-blue-900">
                                      {r.changeGroup}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstA}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstB1}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstB2}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstC}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstD}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstE}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.fcstF}
                                    </td>

                                    <td className="border border-slate-400 p-1.5 text-left font-mono text-[10px] text-blue-950">
                                      {r.metarRaw}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsA}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreA)}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsB1}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreB1)}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsB2}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreB2)}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsC}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreC)}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsD}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreD)}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsE}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreE)}
                                    </td>
                                    <td className="border border-slate-400 p-1.5">
                                      {r.obsF}
                                    </td>
                                    <td className="border border-slate-400 p-1.5 bg-slate-50">
                                      {renderScoreBadge(r.scoreF)}
                                    </td>
                                  </tr>
                                );
                              })
                            )}

                            {/* Baris Kuning HASIL VERIFIKASI (%) */}
                            <tr className="bg-yellow-300 font-extrabold text-slate-900 text-center">
                              <td
                                colSpan={11}
                                className="border border-slate-400 p-2 text-center"
                              >
                                HASIL VERIFIKASI (%)
                              </td>
                              <td className="border border-slate-400 p-2 text-left text-[11px]">
                                Total Data: {tafItem.totalVerifiedRows}
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.arahAngin.toFixed(2)}%
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.kecepatanAngin.toFixed(2)}%
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.gusty.toFixed(2)}%
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.visibilitas.toFixed(2)}%
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.presipitasi.toFixed(2)}%
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.jumlahAwan.toFixed(2)}%
                              </td>
                              <td
                                colSpan={2}
                                className="border border-slate-400 p-2"
                              >
                                {tafItem.scores.tinggiAwan.toFixed(2)}%
                              </td>
                            </tr>

                            {/* Baris Rata-rata Total 7 Unsur di bawah baris kuning */}
                            <tr className="bg-emerald-100 font-extrabold text-emerald-950 text-center">
                              <td
                                colSpan={12}
                                className="border border-slate-400 p-2 text-right pr-4"
                              >
                                RATA-RATA TOTAL VERIFIKASI (7 UNSUR)
                              </td>
                              <td
                                colSpan={14}
                                className="border border-slate-400 p-2 text-center text-sm"
                              >
                                {overallAverage.toFixed(2)}%
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ============================================================
              TAMPILAN 2 & 3: REKAP BULANAN & REKAP TAHUNAN
             ============================================================ */}
          {(activeSubTab === "bulanan" || activeSubTab === "tahunan") && (
            <div className="bg-slate-200/50 p-2 rounded-xl overflow-x-auto">
              <div
                ref={recapExportRef}
                style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                className="p-6 rounded-xl shadow-md border border-slate-200 min-w-max"
              >
                {/* REKAP BULANAN */}
                {activeSubTab === "bulanan" && activeMonthlyRecap && (
                  <div>
                    <h3 className="font-extrabold text-base text-slate-800 mb-3">
                      Rekap Bulanan
                      {stationMeta ? ` — ${stationMeta.label}` : ""}
                    </h3>

                    <table className="w-full text-xs border-collapse border border-slate-400">
                      <thead>
                        <tr>
                          <th
                            colSpan={11}
                            className="border border-slate-400 p-2 text-center bg-slate-50 font-bold text-sm"
                          >
                            {activeMonthlyRecap.bulanNama}{" "}
                            {activeMonthlyRecap.tahun}
                          </th>
                        </tr>
                        <tr className="bg-slate-100 text-center font-bold">
                          <th className="border border-slate-400 p-2">
                            (1)
                            <br />
                            Tanggal TAF diterbitkan
                          </th>
                          <th className="border border-slate-400 p-2">
                            (2)
                            <br />
                            Jam validitas TAF
                          </th>
                          <th className="border border-slate-400 p-2">
                            (3)
                            <br />
                            Forecaster / Verifikator
                          </th>
                          <th className="border border-slate-400 p-2">
                            (4)
                            <br />
                            A. Arah angin
                          </th>
                          <th className="border border-slate-400 p-2">
                            (5)
                            <br />
                            B.1 Kecepatan Angin
                          </th>
                          <th className="border border-slate-400 p-2">
                            (6)
                            <br />
                            B.2 Gusty
                          </th>
                          <th className="border border-slate-400 p-2">
                            (7)
                            <br />
                            C. Visibilitas
                          </th>
                          <th className="border border-slate-400 p-2">
                            (8)
                            <br />
                            D. Presipitasi
                          </th>
                          <th className="border border-slate-400 p-2">
                            (9)
                            <br />
                            E. Jumlah Awan
                          </th>
                          <th className="border border-slate-400 p-2">
                            (10)
                            <br />
                            F. Ketinggian Awan
                          </th>
                          <th className="border border-slate-400 p-2 bg-slate-200">
                            (11)
                            <br />
                            Rata-rata (%)
                          </th>
                        </tr>

                        {/* Baris Hijau (B) Rata-rata 1 bulan */}
                        <tr className="bg-lime-500 text-slate-900 font-extrabold text-center">
                          <td className="border border-slate-400 p-2 text-left">
                            (B) rata-rata 1 bulan
                          </td>
                          <td className="border border-slate-400 p-2"></td>
                          <td className="border border-slate-400 p-2"></td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.arahAngin.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.kecepatanAngin.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.gusty.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.visibilitas.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.presipitasi.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.jumlahAwan.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {activeMonthlyRecap.monthlyAverage
                              ? activeMonthlyRecap.monthlyAverage.tinggiAwan.toFixed(
                                  2,
                                )
                              : "-"}
                          </td>
                          <td className="border border-slate-400 p-2">
                            {monthlyOverallAverage !== null
                              ? monthlyOverallAverage.toFixed(2)
                              : "-"}
                          </td>
                        </tr>
                      </thead>

                      <tbody>
                        {activeMonthlyRecap.items.length === 0 ? (
                          <tr>
                            <td
                              colSpan={11}
                              className="border border-slate-400 p-6 text-center text-slate-500 italic"
                            >
                              Belum ada TAF terverifikasi pada bulan{" "}
                              {activeMonthlyRecap.bulanNama}.
                            </td>
                          </tr>
                        ) : (
                          <>
                            {activeMonthlyRecap.items.map((item, idx) => {
                              const showDate =
                                idx === 0 ||
                                item.tanggal !==
                                  activeMonthlyRecap.items[idx - 1].tanggal;
                              const dateSpan = activeMonthlyRecap.items.filter(
                                (x) => x.tanggal === item.tanggal,
                              ).length;
                              const rowAvg = calcIndividualOverallAverage(
                                item.scores,
                              );

                              return (
                                <tr
                                  key={`${item.tanggal}-${item.validityCycle}`}
                                  className={`${getCycleRowTint(item.validityCycle)} text-right`}
                                >
                                  {showDate && (
                                    <td
                                      rowSpan={dateSpan}
                                      className="border border-slate-400 p-2 text-center font-bold align-middle bg-white"
                                    >
                                      {item.tanggal}
                                    </td>
                                  )}
                                  <td className="border border-slate-400 p-2 text-center font-mono font-bold">
                                    {item.validityCycle}
                                  </td>
                                  <td className="border border-slate-400 p-2 text-center">
                                    {item.forecaster} / {item.verifikator}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.arahAngin.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.kecepatanAngin.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.gusty.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.visibilitas.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.presipitasi.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.jumlahAwan.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono">
                                    {item.scores.tinggiAwan.toFixed(2)}
                                  </td>
                                  <td className="border border-slate-400 p-2 font-mono font-bold bg-slate-50/90">
                                    {rowAvg.toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}

                            {/* Baris Bawah 1: Rata-rata Tiap Unsur */}
                            {activeMonthlyRecap.monthlyAverage &&
                              monthlyOverallAverage !== null && (
                                <>
                                  <tr className="bg-yellow-300 font-extrabold text-slate-900 text-right">
                                    <td
                                      colSpan={3}
                                      className="border border-slate-400 p-2 text-right pr-3"
                                    >
                                      RATA-RATA TIAP UNSUR (%)
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.arahAngin.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.kecepatanAngin.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.gusty.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.visibilitas.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.presipitasi.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.jumlahAwan.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {activeMonthlyRecap.monthlyAverage.tinggiAwan.toFixed(
                                        2,
                                      )}
                                    </td>
                                    <td className="border border-slate-400 p-2 font-mono">
                                      {monthlyOverallAverage.toFixed(2)}
                                    </td>
                                  </tr>

                                  {/* Baris Bawah 2: Rata-rata Keseluruhan Bulan */}
                                  <tr className="bg-emerald-100 font-extrabold text-emerald-950">
                                    <td
                                      colSpan={3}
                                      className="border border-slate-400 p-2 text-right pr-3"
                                    >
                                      RATA-RATA KESELURUHAN BULAN (
                                      {activeMonthlyRecap.bulanNama})
                                    </td>
                                    <td
                                      colSpan={8}
                                      className="border border-slate-400 p-2 text-center text-sm font-mono"
                                    >
                                      {monthlyOverallAverage.toFixed(2)}%
                                    </td>
                                  </tr>
                                </>
                              )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* REKAP TAHUNAN */}
                {activeSubTab === "tahunan" && (
                  <div>
                    <h3 className="font-extrabold text-base text-slate-800 mb-3">
                      Rekap Tahunan — Tahun {resultData.tahun}
                      {stationMeta ? ` (${stationMeta.label})` : ""}
                    </h3>

                    <table className="w-full text-xs border-collapse border border-slate-400">
                      <thead>
                        <tr className="bg-slate-100 text-center font-bold">
                          <th
                            rowSpan={2}
                            className="border border-slate-400 p-2 w-12"
                          >
                            No
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-slate-400 p-2 min-w-[180px]"
                          >
                            Unsur Cuaca
                          </th>
                          <th
                            colSpan={12}
                            className="border border-slate-400 p-2 text-center"
                          >
                            Hasil Verifikasi TAF (dalam %)
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-slate-400 p-2 bg-slate-200 w-28"
                          >
                            Rata-rata
                            <br />1 Tahun (%)
                          </th>
                        </tr>
                        <tr className="bg-slate-100 text-center font-bold">
                          {MONTH_SHORT_LABELS.map((m) => (
                            <th key={m} className="border border-slate-400 p-2">
                              {m}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {resultData.annualRows.map((row) => (
                          <tr key={row.no} className="hover:bg-slate-50">
                            <td className="border border-slate-400 p-2 text-center font-bold">
                              {row.no}
                            </td>
                            <td className="border border-slate-400 p-2 font-semibold">
                              {row.unsur}
                            </td>
                            {row.monthlyValues.map((val, mIdx) => (
                              <td
                                key={mIdx}
                                className="border border-slate-400 p-2 text-center font-mono"
                              >
                                {val !== null ? val.toFixed(2) : "-"}
                              </td>
                            ))}
                            <td className="border border-slate-400 p-2 text-center font-mono font-bold bg-slate-50">
                              {row.annualAverage !== null
                                ? row.annualAverage.toFixed(2)
                                : "-"}
                            </td>
                          </tr>
                        ))}

                        {/* Baris Kuning Rata - rata 1 tahun */}
                        <tr className="bg-yellow-300 font-extrabold text-slate-900">
                          <td
                            colSpan={2}
                            className="border border-slate-400 p-2 text-center"
                          >
                            Rata - rata 1 tahun
                          </td>
                          {resultData.annualMonthlyOverall.map((val, mIdx) => (
                            <td
                              key={mIdx}
                              className="border border-slate-400 p-2 text-center font-mono"
                            >
                              {val !== null ? val.toFixed(2) : "-"}
                            </td>
                          ))}
                          <td className="border border-slate-400 p-2 text-center font-mono">
                            {resultData.annualGrandAverage !== null
                              ? `${resultData.annualGrandAverage.toFixed(2)}%`
                              : "-"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
