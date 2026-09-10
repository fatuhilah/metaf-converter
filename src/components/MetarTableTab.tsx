"use client";
import { useState, useRef } from "react";
import {
  parseSingleMetar,
  getCommonWeatherDesc,
  MetarParsedData,
} from "@/utils/parser";
import { Bot, Copy, Download, SlidersHorizontal, Check } from "lucide-react";
import html2canvas from "html2canvas";

export default function MetarTableTab() {
  const [inputText, setInputText] = useState("");
  const [parsedData, setParsedData] = useState<MetarParsedData[]>([]);
  const [aiResponse, setAiResponse] = useState<string>("");
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // State Filter Checkbox Kolom
  const [visibleColumns, setVisibleColumns] = useState({
    waktu: true,
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

  const toggleColumn = (key: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    const lines = inputText.trim().split("\n");
    const list: MetarParsedData[] = [];
    lines.forEach((line) => {
      if (line.trim()) list.push(parseSingleMetar(line.trim()));
    });
    setParsedData(list);
    setAiResponse("");

    // Otomatis minta Gemini Interpretasi Data
    if (list.length > 0) {
      setLoadingAi(true);
      try {
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataMetar: list }),
        });
        const data = await res.json();
        setAiResponse(data.text || "Tidak ada respon dari AI.");
      } catch (e) {
        setAiResponse("Gagal memproses interpretasi AI.");
      } finally {
        setLoadingAi(false);
      }
    }
  };

  const handleCopy = () => {
    if (!tableRef.current) return;
    const range = document.createRange();
    range.selectNode(tableRef.current);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.execCommand("copy");
    window.getSelection()?.removeAllRanges();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJPG = async () => {
    if (!tableRef.current) return;
    const canvas = await html2canvas(tableRef.current, { scale: 2 });
    const link = document.createElement("a");
    link.download = `METAR_Table_${Date.now()}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.9);
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="bg-white/80 p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <label className="block text-sm font-semibold text-slate-700">
          Paste Data Raw METAR / SPECI:
        </label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste baris METAR di sini (bisa multiple lines)..."
          className="w-full h-32 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
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
            }}
            className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg transition-all"
          >
            🗑️ Bersihkan
          </button>
        </div>
      </div>

      {parsedData.length > 0 && (
        <>
          {/* Checkbox Filter Kolom */}
          <div className="bg-slate-100/80 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3 text-slate-700 font-semibold text-sm">
              <SlidersHorizontal size={16} />
              <span>Filter Kolom Tabel METAR:</span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {Object.keys(visibleColumns).map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-1.5 cursor-pointer bg-white px-3 py-1.5 rounded-md border border-slate-200 shadow-sm hover:bg-blue-50"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns[col as keyof typeof visibleColumns]}
                    onChange={() =>
                      toggleColumn(col as keyof typeof visibleColumns)
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="capitalize text-slate-700">{col}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow-sm text-sm"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Tersalin!" : "Copy Tabel"}
            </button>
            <button
              onClick={handleDownloadJPG}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm text-sm"
            >
              <Download size={16} />
              Download JPG
            </button>
          </div>

          {/* Table Container */}
          <div
            ref={tableRef}
            className="p-4 bg-white rounded-xl shadow-md border border-slate-200 overflow-x-auto"
          >
            <h3 className="text-center font-bold text-slate-800 text-lg mb-4">
              Data METAR Bandara APT Pranoto (WALS)
            </h3>
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  {visibleColumns.waktu && (
                    <th className="p-2 border border-slate-200">Waktu (UTC)</th>
                  )}
                  {visibleColumns.angin && (
                    <th className="p-2 border border-slate-200">Angin</th>
                  )}
                  {visibleColumns.variabilitas && (
                    <th className="p-2 border border-slate-200">
                      Variabilitas
                    </th>
                  )}
                  {visibleColumns.visibility && (
                    <th className="p-2 border border-slate-200">Visibility</th>
                  )}
                  {visibleColumns.cuaca && (
                    <th className="p-2 border border-slate-200">Cuaca</th>
                  )}
                  {visibleColumns.awan && (
                    <th className="p-2 border border-slate-200">Awan</th>
                  )}
                  {visibleColumns.suhu && (
                    <th className="p-2 border border-slate-200">Suhu (°C)</th>
                  )}
                  {visibleColumns.qnh && (
                    <th className="p-2 border border-slate-200">QNH</th>
                  )}
                  {visibleColumns.trend && (
                    <th className="p-2 border border-slate-200">Trend</th>
                  )}
                  {visibleColumns.remark && (
                    <th className="p-2 border border-slate-200">Remark</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {parsedData.map((data, idx) => {
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
                      : "Tidak ada cuaca signifikan";
                  if (data.visMetar === "CAVOK") cuacaStr = "CAVOK";

                  return (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50 border-b border-slate-200"
                    >
                      {visibleColumns.waktu && (
                        <td className="p-2 border border-slate-200 font-mono">
                          {data.waktuZ}
                        </td>
                      )}
                      {visibleColumns.angin && (
                        <td className="p-2 border border-slate-200">
                          {anginStr}
                        </td>
                      )}
                      {visibleColumns.variabilitas && (
                        <td className="p-2 border border-slate-200">
                          {data.windVar}
                        </td>
                      )}
                      {visibleColumns.visibility && (
                        <td className="p-2 border border-slate-200">
                          {visTabel}
                        </td>
                      )}
                      {visibleColumns.cuaca && (
                        <td className="p-2 border border-slate-200">
                          {cuacaStr}
                        </td>
                      )}
                      {visibleColumns.awan && (
                        <td className="p-2 border border-slate-200">
                          {data.cloudTokens.join(", ") || "-"}
                        </td>
                      )}
                      {visibleColumns.suhu && (
                        <td className="p-2 border border-slate-200">
                          {data.tt && data.td ? `${data.tt}/${data.td}` : "-"}
                        </td>
                      )}
                      {visibleColumns.qnh && (
                        <td className="p-2 border border-slate-200">
                          {data.qnh ? `${data.qnh} hPa` : "-"}
                        </td>
                      )}
                      {visibleColumns.trend && (
                        <td className="p-2 border border-slate-200">
                          {data.trendTokens.join(" ") || "-"}
                        </td>
                      )}
                      {visibleColumns.remark && (
                        <td className="p-2 border border-slate-200">
                          {data.rmkTokens.join(" ") || "-"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Gemini AI Explanation Section */}
          <div className="p-5 bg-gradient-to-r from-blue-900 to-slate-900 text-white rounded-xl shadow-lg border border-blue-500/30">
            <div className="flex items-center gap-2 mb-3 text-cyan-400 font-bold">
              <Bot size={22} />
              <span>AI Gemini Interpretation (Max 2 Paragraf)</span>
            </div>
            {loadingAi ? (
              <div className="animate-pulse text-slate-300 text-sm">
                Sedang menganalisis kondisi cuaca...
              </div>
            ) : (
              <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">
                {aiResponse || "Belum ada analisis AI."}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
