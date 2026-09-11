"use client";
import { useState } from "react";
import {
  parseSingleMetar,
  translateWxToMetReport,
  translateCldToMetReport,
} from "@/utils/parser";
import { Copy, Check, AlertCircle } from "lucide-react";

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

  const handleGenerate = () => {
    if (!inputText.trim() || !qfeText.trim()) {
      showToastMsg("⚠️ Lengkapin dulu QFEnya to yaaaa...");
      return;
    }

    const data = parseSingleMetar(inputText.trim());

    let dateNum = parseInt(data.day, 10),
      now = new Date(),
      month = now.getMonth(),
      year = now.getFullYear();

    if (dateNum > now.getDate() + 5) {
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
      let hPaQnh = safeQnh.split(".")[0]; // Ambil angka utuhnya saja untuk hPa
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
      let hPaQfe = safeQfe.split(".")[0]; // Ambil angka utuhnya saja untuk hPa
      if (safeQfe.includes(".")) {
        let inch = (parseFloat(safeQfe) * 0.0295299).toFixed(2);
        finalQfeStr = `${hPaQfe} hPa / ${inch} inHg`;
      } else {
        finalQfeStr = `${hPaQfe} hPa`;
      }
    }

    let reportTitle = data.type === "SPECI" ? "SPECIAL REPORT" : "MET REPORT";
    let text = `${reportTitle} (QAM)\nAPT PRANOTO (${data.station || "WALS"})\nDATE : ${dateStr}\nTIME : ${timeStr}\n=================\nWIND : ${windStr}\nVIS  : ${visStr}\nWX   : ${wxStr}\nCLD  : ${cldStr}\nTT/TD: ${data.tt && data.td ? `${data.tt}/${data.td} °C` : "NIL"}\nQNH  : ${finalQnhStr}\nQFE  : ${finalQfeStr}\nTREND: ${data.trendTokens.join(" ") || "NOSIG"}\nRMK  : ${data.rmkTokens.join(" ") || "NIL"}`;

    setReportOutput(text);
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
            placeholder="Contoh: METAR WALS 110230Z 21006KT 9999 SCT020 32/23 Q1013 NOSIG="
            className="w-full h-24 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        <button
          onClick={handleGenerate}
          className="px-6 py-3 w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-all active:scale-95"
        >
          🚀 Generate MET REPORT
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
