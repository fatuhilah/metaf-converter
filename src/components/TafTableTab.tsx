"use client";
import { useState, useRef } from "react";
import {
  Copy,
  Check,
  Download,
  AlertCircle,
  LayoutGrid,
  Image as ImageIcon,
  Bot,
  Edit,
  Save,
} from "lucide-react";
import { toJpeg } from "html-to-image";

export default function TafTableTab() {
  const [inputText, setInputText] = useState("");
  const [tableRows, setTableRows] = useState<any[]>([]);
  const [rawTafHeader, setRawTafHeader] = useState("");

  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showVis, setShowVis] = useState(false);

  // States AI & UI
  const [aiResponse, setAiResponse] = useState<string>("");
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  const [isEditingAi, setIsEditingAi] = useState<boolean>(false);
  const [copiedAi, setCopiedAi] = useState<boolean>(false);

  const tableRef = useRef<HTMLDivElement>(null);
  const visRef = useRef<HTMLDivElement>(null);

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const getBmkgIconUrl = (wx: string, cld: string) => {
    let wxStr = (wx || "").toUpperCase();
    let cldStr = (cld || "").toUpperCase();

    let iconId = "0";
    if (wxStr.includes("TS")) iconId = "95";
    else if (wxStr.includes("+RA")) iconId = "63";
    else if (wxStr.includes("-RA")) iconId = "60";
    else if (
      wxStr.includes("RA") ||
      wxStr.includes("SH") ||
      wxStr.includes("DZ")
    )
      iconId = "61";
    else if (wxStr.includes("FG") || wxStr.includes("BR")) iconId = "10";
    else if (
      wxStr.includes("HZ") ||
      wxStr.includes("FU") ||
      wxStr.includes("VA")
    )
      iconId = "5";
    else if (cldStr.includes("OVC") || cldStr.includes("BKN")) iconId = "3";
    else if (cldStr.includes("SCT") || cldStr.includes("FEW")) iconId = "1";

    return `https://ibnux.github.io/BMKG-importer/icon/${iconId}.png`;
  };

  const processTAF = () => {
    if (!inputText.trim()) {
      showToastMsg("⚠️ Masukkan raw data TAF dulu to yaa, baru di-generate!");
      return;
    }

    setRawTafHeader(inputText.trim());
    const tokens = inputText.replace(/=/g, "").trim().split(/\s+/);
    let baseStart = "",
      baseEnd = "";
    let baseWeather: any = {
      A: "",
      B1: "",
      B2: "",
      C: "",
      D: "",
      E: "",
      F: "",
    };
    let changeGroups: any[] = [];
    let currentGroup = baseWeather;

    for (let t of tokens) {
      if (/^\d{4}\/\d{4}$/.test(t)) {
        if (!baseStart) {
          baseStart = t.split("/")[0];
          baseEnd = t.split("/")[1];
        } else {
          currentGroup.start = t.split("/")[0];
          currentGroup.end = t.split("/")[1];
        }
        continue;
      }
      if (t === "TEMPO" || t === "BECMG" || t === "FM") {
        currentGroup = {
          type: t,
          start: "",
          end: "",
          A: "",
          B1: "",
          B2: "",
          C: "",
          D: "",
          E: "",
          F: "",
          changes: [],
        };
        changeGroups.push(currentGroup);
        continue;
      }
      let windMatch = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT$/);
      if (windMatch) {
        currentGroup.A = windMatch[1];
        currentGroup.B1 = parseInt(windMatch[2], 10).toString();
        if (currentGroup.type) currentGroup.changes.push("WIND");
        continue;
      }
      if (/^\d{4}$/.test(t) && t !== "9999") {
        currentGroup.C = t;
        if (currentGroup.type) currentGroup.changes.push("VIS");
        continue;
      }
      if (t === "CAVOK" || t === "9999") {
        currentGroup.C = "9999";
        if (currentGroup.type) currentGroup.changes.push("VIS");
        continue;
      }
      let cloudMatch = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
      if (cloudMatch) {
        currentGroup.E = cloudMatch[1];
        currentGroup.F = (parseInt(cloudMatch[2], 10) * 100).toString();
        if (currentGroup.type && !currentGroup.changes.includes("CLD"))
          currentGroup.changes.push("CLD");
        continue;
      }
      const wxCodes = [
        "BR",
        "FG",
        "FU",
        "VA",
        "DU",
        "SA",
        "HZ",
        "PO",
        "SQ",
        "FC",
        "SS",
        "DS",
        "DZ",
        "RA",
        "SN",
        "SG",
        "IC",
        "PL",
        "GR",
        "GS",
        "UP",
        "TS",
        "SH",
        "FZ",
        "MI",
        "PR",
        "BC",
        "DR",
        "BL",
        "VC",
        "NSW",
      ];
      if (
        wxCodes.some((c) => t.includes(c)) &&
        !/\d/.test(t) &&
        t !== "TEMPO" &&
        t !== "BECMG" &&
        t !== "FM"
      ) {
        currentGroup.D = t;
        if (currentGroup.type && !currentGroup.changes.includes("WX"))
          currentGroup.changes.push("WX");
        continue;
      }
    }

    if (!baseStart) {
      showToastMsg("⚠️ Format waktu TAF tidak valid atau tidak ditemukan.");
      return;
    }

    const getValidDate = (ddhh: string, referenceDate: Date) => {
      let d = parseInt(ddhh.substring(0, 2)),
        h = parseInt(ddhh.substring(2, 4));
      let date = new Date(referenceDate);
      date.setUTCDate(d);
      date.setUTCHours(h, 0, 0, 0);
      return date;
    };

    let refDate = new Date();
    let startObj = getValidDate(baseStart, refDate);
    let endObj = getValidDate(baseEnd, refDate);
    if (endObj < startObj) endObj.setUTCMonth(endObj.getUTCMonth() + 1);

    for (let cg of changeGroups) {
      if (!cg.start) continue;
      cg.startObj = getValidDate(cg.start, refDate);
      cg.endObj = getValidDate(cg.end, refDate);
      if (cg.endObj < cg.startObj)
        cg.endObj.setUTCMonth(cg.endObj.getUTCMonth() + 1);
    }

    let current = new Date(startObj);
    let prevailingWx = { ...baseWeather };
    let rows: any[] = [];

    while (current <= endObj) {
      let hr = String(current.getUTCHours()).padStart(2, "0");
      let mn = String(current.getUTCMinutes()).padStart(2, "0");
      let timeStr = `${hr}${mn}`;

      for (let cg of changeGroups) {
        if (cg.type === "BECMG" || cg.type === "FM") {
          if (current >= cg.startObj) {
            if (cg.A) prevailingWx.A = cg.A;
            if (cg.B1) prevailingWx.B1 = cg.B1;
            if (cg.C) prevailingWx.C = cg.C;
            if (cg.D !== undefined) prevailingWx.D = cg.D;
            if (cg.E) prevailingWx.E = cg.E;
            if (cg.F) prevailingWx.F = cg.F;
          }
        }
      }

      let activeWx = { ...prevailingWx };
      let currentType = "GENERAL";
      let currentActiveCg = null;

      for (let cg of changeGroups) {
        if (current >= cg.startObj && current <= cg.endObj) {
          currentType = cg.type;
          currentActiveCg = cg;
          if (cg.type === "TEMPO") {
            if (cg.A) activeWx.A = cg.A;
            if (cg.B1) activeWx.B1 = cg.B1;
            if (cg.C) activeWx.C = cg.C;
            if (cg.D !== undefined) activeWx.D = cg.D;
            if (cg.E) activeWx.E = cg.E;
            if (cg.F) activeWx.F = cg.F;
          }
        }
      }

      let changeColText = currentActiveCg?.changes
        ? currentActiveCg.changes.join(",")
        : "";
      rows.push({ timeStr, currentType, changeColText, ...activeWx });
      current.setUTCMinutes(current.getUTCMinutes() + 30);
    }
    setTableRows(rows);
    setShowVis(false);
    setAiResponse("");
    setIsEditingAi(false);
  };

  const handleAskAI = async () => {
    if (tableRows.length === 0) return;
    setLoadingAi(true);
    setIsEditingAi(false);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataMetar: tableRows,
          timezone: "UTC",
          period: rawTafHeader,
          reportType: "TAF",
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

  const handleCopyTable = () => {
    if (tableRows.length === 0) return;
    const copyString = tableRows
      .map(
        (r) =>
          `\({r.currentType || ""}\t\){r.changeColText || ""}\t\({r.A === "VRB" ? "999" : r.A || ""}\t\){r.B1 || ""}\t\({r.B2 || ""}\t\){r.C || ""}\t\({r.D || ""}\t\){r.E || ""}\t${r.F || ""}`,
      )
      .join("\n");
    navigator.clipboard.writeText(copyString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyAiToClipboard = () => {
    navigator.clipboard.writeText(aiResponse);
    setCopiedAi(true);
    setTimeout(() => setCopiedAi(false), 2000);
  };

  const handleDownloadJPG = async (
    ref: React.RefObject<HTMLDivElement | null>,
    filename: string,
  ) => {
    if (!ref.current) return;
    try {
      const dataUrl = await toJpeg(ref.current, {
        quality: 0.95,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      showToastMsg(`⚠️ Gagal generate JPG untuk ${filename}.`);
    }
  };

  return (
    <div className="space-y-6 relative animate-in fade-in zoom-in-95 duration-300">
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in slide-in-from-bottom-5">
          <AlertCircle size={18} className="text-rose-400" />
          <span className="text-sm font-semibold">{toast}</span>
        </div>
      )}

      {/* INPUT AREA */}
      <div className="bg-white/80 p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste TAF di sini..."
          className="w-full h-28 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
        />
        <div className="flex gap-3">
          <button
            onClick={processTAF}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all active:scale-95"
          >
            🚀 Generate Tabel Verifikasi TAF
          </button>
          <button
            onClick={() => {
              setInputText("");
              setTableRows([]);
              setShowVis(false);
              setAiResponse("");
            }}
            className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg transition-all"
          >
            🗑️ Bersihkan
          </button>
        </div>
      </div>

      {tableRows.length > 0 && (
        <>
          {/* TABEL VERIFIKASI */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleCopyTable}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm transition-all"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Tersalin!" : "Salin Data"}
            </button>
            <button
              onClick={() =>
                handleDownloadJPG(tableRef, `TAF_Table_${Date.now()}.jpg`)
              }
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm transition-all"
            >
              <Download size={16} /> Download Tabel TAF
            </button>
            <button
              onClick={() => setShowVis(!showVis)}
              className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg text-sm shadow-md transition-all ml-auto"
            >
              <LayoutGrid size={16} />{" "}
              {showVis ? "Tutup Visualisasi" : "Buat Visualisasi TAF"}
            </button>
          </div>

          <div className="overflow-x-auto bg-white rounded-xl shadow-md border border-slate-200 p-4">
            <div
              ref={tableRef}
              style={{ backgroundColor: "#ffffff" }}
              className="min-w-max p-2"
            >
              <table className="w-full text-xs text-left border-collapse border border-slate-300">
                <thead className="bg-lime-500 text-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-300 p-2 text-center">
                      Waktu
                    </th>
                    <th className="border border-slate-300 p-2">Group</th>
                    <th className="border border-slate-300 p-2">Change</th>
                    <th className="border border-slate-300 p-2 text-center">
                      A
                    </th>
                    <th className="border border-slate-300 p-2 text-center">
                      B1
                    </th>
                    <th className="border border-slate-300 p-2 text-center">
                      B2
                    </th>
                    <th className="border border-slate-300 p-2 text-center">
                      C
                    </th>
                    <th className="border border-slate-300 p-2 text-center">
                      D
                    </th>
                    <th className="border border-slate-300 p-2 text-center">
                      E
                    </th>
                    <th className="border border-slate-300 p-2 text-center">
                      F
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, i) => (
                    <tr
                      key={i}
                      className="hover:bg-slate-50 border-b border-slate-200 text-blue-900"
                    >
                      <td className="border border-slate-300 p-1.5 font-bold text-center text-slate-800">
                        {r.timeStr}
                      </td>
                      <td className="border border-slate-300 p-1.5 font-semibold text-blue-900">
                        {r.currentType}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-rose-600 font-medium">
                        {r.changeColText}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center">
                        {r.A === "VRB" ? "999" : r.A}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center">
                        {r.B1}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center">
                        {r.B2}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center font-bold text-emerald-700">
                        {r.C}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center font-bold text-blue-600">
                        {r.D}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center">
                        {r.E}
                      </td>
                      <td className="border border-slate-300 p-1.5 text-center">
                        {r.F}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AREA VISUALISASI GRID */}
          {showVis && (
            <div className="animate-in slide-in-from-top-5 space-y-3 mt-6">
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    handleDownloadJPG(
                      visRef,
                      `AERODROME_FORECAST_${Date.now()}.jpg`,
                    )
                  }
                  className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-sm transition-all shadow-md"
                >
                  <ImageIcon size={16} /> Download Grid Gambar
                </button>
              </div>

              <div
                ref={visRef}
                style={{
                  backgroundColor: "#ffffff",
                  padding: "32px",
                  color: "#000",
                }}
                className="border border-slate-300 shadow-xl rounded-xl"
              >
                <div className="text-center mb-8 space-y-2">
                  <h2 className="text-xl font-extrabold uppercase tracking-wide">
                    AERODROME FORECAST
                  </h2>
                  <p className="text-sm font-mono text-slate-700 max-w-4xl mx-auto">
                    {rawTafHeader}
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-0 border-l border-t border-slate-800">
                  {tableRows.map((r, idx) => (
                    <div
                      key={idx}
                      className="border-r border-b border-slate-800 p-3 flex flex-col items-center justify-start text-center space-y-2"
                    >
                      <div className="font-bold text-sm tracking-wide bg-slate-100 w-full rounded-sm py-1 border-b border-slate-300">
                        {r.timeStr} Z
                      </div>
                      <div className="h-12 flex items-center justify-center my-2">
                        <img
                          src={getBmkgIconUrl(r.D, r.E)}
                          alt="Weather Icon"
                          className="w-10 h-10 drop-shadow-sm"
                          crossOrigin="anonymous"
                        />
                      </div>
                      <div className="text-xs font-semibold text-slate-800 space-y-1 w-full">
                        <div className="border-b border-slate-200 pb-1">
                          {r.A ? `${r.A}/${r.B1}KT` : "Calm"}
                        </div>
                        <div className="border-b border-slate-200 pb-1">
                          {r.C === "9999" ? "10 KM" : `${r.C} M`}
                        </div>
                        <div className="border-b border-slate-200 pb-1 text-rose-700">
                          {r.D || "NSW"}
                        </div>
                        <div className="pt-1">
                          {r.E && r.F ? `${r.E}${r.F}` : "NSC"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Gemini AI Section untuk TAF */}
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
                    {isEditingAi ? <Save size={16} /> : <Edit size={16} />}
                    {isEditingAi ? "Simpan Perubahan" : "Edit Teks"}
                  </button>
                  <button
                    onClick={copyAiToClipboard}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-all"
                  >
                    {copiedAi ? <Check size={16} /> : <Copy size={16} />}
                    {copiedAi ? "Tersalin!" : "Salin Paragraf"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-slate-400 text-sm italic border-t border-slate-700 pt-4">
                Klik tombol di atas untuk mendapatkan ringkasan Aerodrome
                Forecast (TAF).
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
