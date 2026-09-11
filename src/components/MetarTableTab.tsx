"use client";
import { useState, useRef, useMemo } from "react";
import {
  parseSingleMetar,
  getCommonWeatherDesc,
  MetarParsedData,
} from "@/utils/parser";
import {
  Bot,
  Copy,
  Download,
  SlidersHorizontal,
  Check,
  Wind,
  TrendingUp,
  AlertCircle,
  ArrowUp,
  Edit,
  Save,
  ArrowDown,
} from "lucide-react";
import { toJpeg } from "html-to-image";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

export default function MetarTableTab() {
  const [inputText, setInputText] = useState("");
  const [parsedData, setParsedData] = useState<MetarParsedData[]>([]);

  // States AI & UI
  const [aiResponse, setAiResponse] = useState<string>("");
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  const [isEditingAi, setIsEditingAi] = useState<boolean>(false);
  const [copiedAi, setCopiedAi] = useState<boolean>(false);

  const [copiedTable, setCopiedTable] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const [showWita, setShowWita] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // States Override Bulan & Tahun Manual
  const [overrideMonth, setOverrideMonth] = useState<string>("");
  const [overrideYear, setOverrideYear] = useState<string>("");

  const [visibleColumns, setVisibleColumns] = useState({
    angin: true,
    variabilitas: true,
    visibility: true,
    cuaca: true,
    awan: true,
    suhu: true,
    qnh: true,
    trend: true,
    remark: true,
  });

  const monthNamesFull = [
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

  const toggleColumn = (key: keyof typeof visibleColumns) =>
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleGenerate = () => {
    if (!inputText.trim())
      return showToastMsg(
        "⚠️ Masukkan data METAR nya yaaa, terus ini mau generate apaan?!",
      );

    const lines = inputText.trim().split("\n");
    let list: MetarParsedData[] = [];

    lines.forEach((line) => {
      if (line.trim() && !line.startsWith("SAID")) {
        list.push(parseSingleMetar(line.trim()));
      }
    });

    if (list.length === 0)
      return showToastMsg("⚠️ Format METAR tidak ditemukan atau data kosong!");

    // Sorting Chronological dengan Cek Nyebrang Bulan
    list.sort((a, b) => {
      let dayA = parseInt(a.day, 10),
        dayB = parseInt(b.day, 10);
      let timeA = parseInt(a.waktuZ.replace("Z", ""), 10),
        timeB = parseInt(b.waktuZ.replace("Z", ""), 10);

      if (dayA > 20 && dayB < 10) return -1; // dayA (misal 31) lebih dulu dari dayB (misal 1)
      if (dayB > 20 && dayA < 10) return 1;

      if (dayA !== dayB) return dayA - dayB;
      return timeA - timeB;
    });

    setParsedData(list);
    setAiResponse("");
    setIsEditingAi(false);
  };

  // KALKULASI BARIS OTOMATIS: Track offset bulan dan tahun yang menyebrang
  const processedRows = useMemo(() => {
    if (parsedData.length === 0) return [];

    // 1. Hitung Offset Bulan
    let monthOffsets = new Array(parsedData.length).fill(0);
    let currentOffset = 0;
    for (let i = 1; i < parsedData.length; i++) {
      let prevDay = parseInt(parsedData[i - 1].day, 10);
      let currDay = parseInt(parsedData[i].day, 10);
      // Jika anjlok dari tanggal besar (>20) ke kecil (<10), artinya masuk bulan baru
      if (prevDay > 20 && currDay < 10) {
        currentOffset += 1;
      }
      monthOffsets[i] = currentOffset;
    }

    let maxOffset = currentOffset;
    let startM = 0;
    let startY = 0;
    let now = new Date();

    if (overrideMonth !== "" && overrideYear !== "") {
      // MODE MANUAL: Jangkar bulan/tahun pada data PERTAMA (terlama)
      startM = parseInt(overrideMonth, 10);
      startY = parseInt(overrideYear, 10);
    } else {
      // MODE AUTO: Jangkar bulan/tahun pada data TERAKHIR (terbaru) terhadap waktu sekarang
      let lastDay = parseInt(parsedData[parsedData.length - 1].day, 10);
      let endM = now.getUTCMonth();
      let endY = now.getUTCFullYear();

      if (lastDay > now.getUTCDate() + 5) {
        endM -= 1;
        if (endM < 0) {
          endM = 11;
          endY -= 1;
        }
      }

      startM = endM - maxOffset;
      startY = endY;
      while (startM < 0) {
        startM += 12;
        startY -= 1;
      }
    }

    // 2. Terapkan Tanggal Mutlak ke Semua Row
    return parsedData.map((data, idx) => {
      let day = parseInt(data.day, 10);
      let m = startM + monthOffsets[idx];
      let y = startY;

      // Handle Tahun Nyebrang (Desember ke Januari)
      while (m > 11) {
        m -= 12;
        y += 1;
      }

      let hours =
        data.waktuZ === "-" ? 0 : parseInt(data.waktuZ.slice(0, 2), 10);
      let mins =
        data.waktuZ === "-" ? 0 : parseInt(data.waktuZ.slice(2, 4), 10);

      let utcDateObj = new Date(Date.UTC(y, m, day, hours, mins));
      let displayDateObj = new Date(
        utcDateObj.getTime() + (showWita ? 8 * 3600000 : 0),
      );

      return {
        ...data,
        displayDay: displayDateObj.getUTCDate(),
        displayMonthName: monthNamesFull[displayDateObj.getUTCMonth()],
        displayYear: displayDateObj.getUTCFullYear(),
        displayDateStr: `${displayDateObj.getUTCDate()} ${monthNamesFull[displayDateObj.getUTCMonth()]} ${displayDateObj.getUTCFullYear()}`,
        displayTimeStr:
          data.waktuZ !== "-"
            ? `${displayDateObj.getUTCHours().toString().padStart(2, "0")}${displayDateObj.getUTCMinutes().toString().padStart(2, "0")}`
            : "-",
      };
    });
  }, [parsedData, showWita, overrideMonth, overrideYear]);

  const uniqueDates = new Set(processedRows.map((r) => r.displayDateStr));
  const hasMultipleDates = uniqueDates.size > 1;

  let titleDateStr = "";
  if (processedRows.length > 0) {
    if (hasMultipleDates) {
      const first = processedRows[0];
      const last = processedRows[processedRows.length - 1];
      titleDateStr = `Periode: ${first.displayDay} ${first.displayMonthName} ${first.displayYear} - ${last.displayDateStr}`;
    } else {
      titleDateStr = `Tanggal: ${processedRows[0].displayDateStr}`;
    }
  }

  const handleAskAI = async () => {
    if (processedRows.length === 0) return;
    setLoadingAi(true);
    setIsEditingAi(false);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataMetar: processedRows,
          timezone: showWita ? "WITA" : "UTC",
          period: titleDateStr,
        }),
      });
      const data = await res.json();

      let cleanText = (data.reply || "Tidak ada respon dari AI.")
        .replace(/[*$#_~`]/g, "")
        .replace(/\\/g, "");

      setAiResponse(cleanText);
    } catch (e: any) {
      setAiResponse(`Gagal memproses AI: ${e.message}`);
    } finally {
      setLoadingAi(false);
    }
  };

  const copyToClipboard = (text: string, type: "table" | "ai") => {
    if (type === "table" && tableRef.current) {
      const range = document.createRange();
      range.selectNode(tableRef.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
      setCopiedTable(true);
      setTimeout(() => setCopiedTable(false), 2000);
    } else {
      navigator.clipboard.writeText(text);
      setCopiedAi(true);
      setTimeout(() => setCopiedAi(false), 2000);
    }
  };

  const handleDownloadJPG = async () => {
    if (!tableRef.current) return;
    try {
      const dataUrl = await toJpeg(tableRef.current, {
        quality: 0.95,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = `METAR_Table_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      showToastMsg("⚠️ Gagal generate JPG.");
    }
  };

  const handleDownloadDashboard = async () => {
    if (!dashboardRef.current) return;
    try {
      const dataUrl = await toJpeg(dashboardRef.current, {
        quality: 0.95,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = `Dashboard_Angin_Vis_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      showToastMsg("⚠️ Gagal generate JPG Dashboard.");
    }
  };

  let dateCounts: Record<string, number> = {};
  if (hasMultipleDates) {
    processedRows.forEach((r) => {
      dateCounts[r.displayDateStr] = (dateCounts[r.displayDateStr] || 0) + 1;
    });
  }

  let sumU = 0,
    sumV = 0,
    validWindCount = 0,
    sumSpd = 0;
  let chartLabels: string[] = [],
    chartVisData: number[] = [];

  processedRows.forEach((d) => {
    chartLabels.push(d.displayTimeStr);
    chartVisData.push(d.visAngka);
    if (d.rawDir !== null && d.rawSpd !== null) {
      let rad = d.rawDir * (Math.PI / 180);
      sumU += Math.sin(rad);
      sumV += Math.cos(rad);
      sumSpd += d.rawSpd;
      validWindCount++;
    }
  });

  let avgDirRaw =
    validWindCount > 0 ? Math.atan2(sumU, sumV) * (180 / Math.PI) : 0;
  if (avgDirRaw < 0) avgDirRaw += 360;
  let avgDir = Math.round(avgDirRaw / 10) * 10;
  if (avgDir === 0 && validWindCount > 0) avgDir = 360;
  let avgSpd = validWindCount > 0 ? Math.round(sumSpd / validWindCount) : 0;

  return (
    <div className="space-y-6 relative animate-in fade-in zoom-in-95 duration-300">
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in slide-in-from-bottom-5">
          <AlertCircle size={18} className="text-rose-400" />
          <span className="text-sm font-semibold">{toast}</span>
        </div>
      )}

      {/* Input Section */}
      <div className="bg-white/80 p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste data METAR di sini..."
          className="w-full h-36 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
        />
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all"
          >
            🚀 Generate Tabel
          </button>
          <button
            onClick={() => {
              setInputText("");
              setParsedData([]);
              setAiResponse("");
              setShowDashboard(false);
            }}
            className="px-5 py-2.5 bg-slate-200 text-slate-700 font-semibold rounded-lg transition-all"
          >
            🗑️ Bersihkan
          </button>
        </div>
      </div>

      {processedRows.length > 0 && (
        <>
          <div className="bg-slate-100/80 p-4 rounded-xl border border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 pb-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
                <input
                  type="checkbox"
                  checked={showWita}
                  onChange={() => setShowWita(!showWita)}
                  className="rounded text-blue-600 w-4 h-4"
                />{" "}
                Waktu WITA
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
                  <input
                    type="checkbox"
                    checked={showDashboard}
                    onChange={() => setShowDashboard(!showDashboard)}
                    className="rounded text-blue-600 w-4 h-4"
                  />{" "}
                  Grafik Angin & Visibility
                </label>

                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <select
                    value={overrideMonth}
                    onChange={(e) => setOverrideMonth(e.target.value)}
                    className="bg-transparent text-slate-700 text-xs font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="">Bulan (Auto)</option>
                    {monthNamesFull.map((m, i) => (
                      <option key={i} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-300">|</span>
                  <select
                    value={overrideYear}
                    onChange={(e) => setOverrideYear(e.target.value)}
                    className="bg-transparent text-slate-700 text-xs font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="">Tahun (Auto)</option>
                    {Array.from({ length: 10 }).map((_, i) => {
                      const y = new Date().getFullYear() - i;
                      return (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {Object.keys(visibleColumns).map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-1.5 cursor-pointer bg-white px-3 py-1.5 rounded-md shadow-sm"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns[col as keyof typeof visibleColumns]}
                    onChange={() =>
                      toggleColumn(col as keyof typeof visibleColumns)
                    }
                    className="rounded text-blue-600"
                  />
                  <span className="capitalize text-slate-700">{col}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => copyToClipboard("", "table")}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm"
            >
              {copiedTable ? <Check size={16} /> : <Copy size={16} />}{" "}
              {copiedTable ? "Tersalin!" : "Copy Tabel"}
            </button>
            <button
              onClick={handleDownloadJPG}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm"
            >
              <Download size={16} /> Download Tabel
            </button>
          </div>

          <div className="bg-slate-200/50 p-2 rounded-xl overflow-x-auto">
            <div
              ref={tableRef}
              style={{ backgroundColor: "#ffffff", color: "#1e293b" }}
              className="p-6 rounded-xl shadow-md border border-slate-200 min-w-max"
            >
              <h3 className="text-center font-extrabold text-xl mb-1 text-slate-800">
                Data METAR Bandara APT Pranoto (WALS)
              </h3>
              <p className="text-center text-blue-600 font-bold mb-5 text-sm">
                {titleDateStr}
              </p>

              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-300">
                    {hasMultipleDates && (
                      <th className="p-3 border border-slate-200 text-center">
                        Tanggal
                      </th>
                    )}
                    <th className="p-3 border border-slate-200 whitespace-nowrap">
                      Waktu{" "}
                      <span className="text-xs text-blue-600">
                        {showWita ? "(WITA)" : "(UTC)"}
                      </span>
                    </th>
                    {visibleColumns.angin && (
                      <th className="p-3 border border-slate-200">Angin</th>
                    )}
                    {visibleColumns.variabilitas && (
                      <th className="p-3 border border-slate-200">
                        Variabilitas
                      </th>
                    )}
                    {visibleColumns.visibility && (
                      <th className="p-3 border border-slate-200">
                        Visibility
                      </th>
                    )}
                    {visibleColumns.cuaca && (
                      <th className="p-3 border border-slate-200 min-w-[120px]">
                        Cuaca
                      </th>
                    )}
                    {visibleColumns.awan && (
                      <th className="p-3 border border-slate-200">Awan</th>
                    )}
                    {visibleColumns.suhu && (
                      <th className="p-3 border border-slate-200">Suhu (°C)</th>
                    )}
                    {visibleColumns.qnh && (
                      <th className="p-3 border border-slate-200">QNH</th>
                    )}
                    {visibleColumns.trend && (
                      <th className="p-3 border border-slate-200">Trend</th>
                    )}
                    {visibleColumns.remark && (
                      <th className="p-3 border border-slate-200 min-w-[150px]">
                        Remark
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {processedRows.map((data, idx) => {
                    const isFirstOfDate =
                      idx === 0 ||
                      data.displayDateStr !==
                        processedRows[idx - 1].displayDateStr;

                    let anginStr =
                      data.windDir && data.windSpd
                        ? `${data.windDir}°/${data.windSpd}${data.windUnit}`
                        : "-";
                    let visTabel =
                      data.visMetar === "CAVOK" || data.visAngka === 10000
                        ? "≥10 km"
                        : data.visAngka > 0
                          ? `${data.visAngka} m`
                          : "-";

                    let cuacaStr =
                      data.wxTokens.length > 0
                        ? data.wxTokens.map(getCommonWeatherDesc).join(", ")
                        : "NSW";
                    if (data.visMetar === "CAVOK") cuacaStr = "CAVOK";

                    let rmkJoined = data.rmkTokens.join(" ").toUpperCase();
                    if (
                      rmkJoined.includes("FU IN APCH") ||
                      rmkJoined.includes("FU IN AREA")
                    ) {
                      if (cuacaStr === "NSW" || cuacaStr === "CAVOK")
                        cuacaStr = "Asap";
                      else if (!cuacaStr.includes("Asap")) cuacaStr += ", Asap";
                    }

                    return (
                      <tr
                        key={idx}
                        className="hover:bg-blue-50/50 border-b border-slate-200"
                      >
                        {hasMultipleDates && isFirstOfDate && (
                          <td
                            rowSpan={dateCounts[data.displayDateStr]}
                            className="p-3 border border-slate-200 text-center align-middle font-bold text-blue-800 bg-white shadow-inner"
                          >
                            {data.displayDay}
                            <br />
                            <span className="text-xs font-normal text-slate-500">
                              {data.displayMonthName} {data.displayYear}
                            </span>
                          </td>
                        )}
                        <td className="p-3 border border-slate-200 font-mono font-bold">
                          {data.displayTimeStr}
                        </td>
                        {visibleColumns.angin && (
                          <td className="p-3 border border-slate-200">
                            {anginStr}
                          </td>
                        )}
                        {visibleColumns.variabilitas && (
                          <td className="p-3 border border-slate-200">
                            {data.windVar}
                          </td>
                        )}
                        {visibleColumns.visibility && (
                          <td className="p-3 border border-slate-200">
                            {visTabel}
                          </td>
                        )}
                        {visibleColumns.cuaca && (
                          <td className="p-3 border border-slate-200 font-medium">
                            {cuacaStr}
                          </td>
                        )}
                        {visibleColumns.awan && (
                          <td className="p-3 border border-slate-200">
                            {data.cloudTokens.join(", ") || "-"}
                          </td>
                        )}
                        {visibleColumns.suhu && (
                          <td className="p-3 border border-slate-200">
                            {data.tt && data.td ? `${data.tt}/${data.td}` : "-"}
                          </td>
                        )}
                        {visibleColumns.qnh && (
                          <td className="p-3 border border-slate-200">
                            {data.qnh ? `${data.qnh} hPa` : "-"}
                          </td>
                        )}
                        {visibleColumns.trend && (
                          <td className="p-3 border border-slate-200">
                            {data.trendTokens.join(" ") || "-"}
                          </td>
                        )}
                        {visibleColumns.remark && (
                          <td className="p-3 border border-slate-200 text-xs">
                            {data.rmkTokens.join(" ") || "-"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {showDashboard && (
            <div className="space-y-3 animate-in slide-in-from-top-4">
              <div className="flex justify-end">
                <button
                  onClick={handleDownloadDashboard}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm text-xs transition-all"
                >
                  <Download size={14} /> Download Grafik
                </button>
              </div>

              <div
                ref={dashboardRef}
                style={{ backgroundColor: "#f8fafc" }}
                className="p-4 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 border border-slate-200 shadow-sm"
              >
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center items-center text-center">
                  <h4 className="text-sm font-bold text-slate-500 tracking-wide mb-4">
                    RATA-RATA ANGIN PERMUKAAN
                  </h4>
                  <div className="relative w-24 h-24 rounded-full border-4 border-slate-200 bg-slate-50 flex items-center justify-center shadow-inner mb-3">
                    <span className="absolute top-1 text-[10px] font-bold text-slate-400">
                      N
                    </span>
                    <span className="absolute bottom-1 text-[10px] font-bold text-slate-400">
                      S
                    </span>
                    <span className="absolute left-1 text-[10px] font-bold text-slate-400">
                      W
                    </span>
                    <span className="absolute right-1 text-[10px] font-bold text-slate-400">
                      E
                    </span>
                    {validWindCount > 0 ? (
                      <ArrowDown
                        size={36}
                        className="text-rose-500 drop-shadow-md"
                        style={{ transform: `rotate(${avgDir}deg)` }}
                      />
                    ) : (
                      <div className="w-2 h-2 bg-slate-300 rounded-full"></div>
                    )}
                  </div>
                  <p className="text-2xl font-extrabold text-slate-800">
                    {avgSpd} KT
                  </p>
                  <p className="text-sm font-medium text-slate-500 mt-1">
                    {validWindCount > 0
                      ? `${avgDir.toString().padStart(3, "0")}°`
                      : "Calm"}
                  </p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm md:col-span-2 h-64 flex flex-col">
                  <div className="flex items-center gap-2 mb-3 text-slate-600 font-bold text-sm">
                    <TrendingUp size={16} /> Tren Visibility (Meter)
                  </div>
                  <div className="flex-1 min-h-0">
                    <Bar
                      data={{
                        labels: chartLabels,
                        datasets: [
                          {
                            label: "Visibility (m)",
                            data: chartVisData,
                            backgroundColor: "#3b82f6",
                            borderRadius: 4,
                          },
                        ],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Gemini AI Section */}
          <div className="p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl shadow-lg border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-lg">
                <Bot size={24} /> <span>Interpretasi AI</span>
              </div>
              <button
                onClick={handleAskAI}
                disabled={loadingAi}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg shadow-md text-sm transition-all"
              >
                {loadingAi ? "Menganalisis..." : "Tanya AI Sekarang"}
              </button>
            </div>

            {aiResponse ? (
              <div className="border-t border-slate-700 pt-5 space-y-4">
                {isEditingAi ? (
                  <textarea
                    value={aiResponse}
                    onChange={(e) => setAiResponse(e.target.value)}
                    className="w-full h-48 p-4 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm md:text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 text-justify"
                  />
                ) : (
                  <div className="text-slate-200 text-sm md:text-base leading-relaxed whitespace-pre-line text-justify">
                    {aiResponse}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setIsEditingAi(!isEditingAi)}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg transition-all"
                  >
                    {isEditingAi ? <Save size={16} /> : <Edit size={16} />}{" "}
                    {isEditingAi ? "Simpan Perubahan" : "Edit Teks"}
                  </button>
                  <button
                    onClick={() => copyToClipboard(aiResponse, "ai")}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-all"
                  >
                    {copiedAi ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copiedAi ? "Tersalin!" : "Salin Paragraf"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-slate-400 text-sm italic border-t border-slate-700 pt-4">
                Klik tombol di atas untuk mendapatkan ringkasan kondisi cuaca
                berdasarkan data METAR.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
