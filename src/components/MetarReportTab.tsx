"use client";
import { useState } from "react";
import {
  parseSingleMetar,
  translateWxToMetReport,
  translateCldToMetReport,
} from "@/utils/parser";

export default function MetarReportTab() {
  const [inputText, setInputText] = useState("");
  const [qfeText, setQfeText] = useState("");
  const [reportOutput, setReportOutput] = useState("");

  const handleGenerate = () => {
    if (!inputText.trim() || !qfeText.trim()) return;
    const data = parseSingleMetar(inputText.trim());

    let dateNum = parseInt(data.day, 10),
      now = new Date(),
      month = now.getMonth(),
      year = now.getFullYear();
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

    let reportTitle = data.type === "SPECI" ? "SPECIAL REPORT" : "MET REPORT";
    let text = `${reportTitle} (QAM)\nAPT PRANOTO (${data.station || "WALS"})\nDATE : ${dateStr}\nTIME : ${timeStr}\n=================\nWIND : ${windStr}\nVIS : ${visStr}\nWX :  ${wxStr}\nCLD : ${cldStr}\nTT/TD : ${data.tt && data.td ? `${data.tt}/${data.td}` : "NIL"}\nQNH : ${data.qnh ? `${data.qnh} hPa` : "NIL"}\nQFE : ${qfeText} hPa\nTREND : ${data.trendTokens.join(" ") || "NOSIG"}\nREMARK : ${data.rmkTokens.join(" ") || "NIL"}`;

    setReportOutput(text);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white/80 p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex gap-4 items-center">
          <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">
            Wajib Input QFE (hPa):
          </label>
          <input
            type="number"
            value={qfeText}
            onChange={(e) => setQfeText(e.target.value)}
            placeholder="Contoh: 1010"
            className="p-2 border border-slate-300 rounded-md text-sm font-bold w-36 focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste SATU data METAR / SPECI di sini..."
          className="w-full h-28 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
        />
        <button
          onClick={handleGenerate}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md"
        >
          🚀 Generate MET REPORT
        </button>
      </div>

      {reportOutput && (
        <div className="bg-slate-900 text-emerald-400 p-5 rounded-xl font-mono text-sm leading-relaxed whitespace-pre-wrap shadow-inner border border-slate-800">
          {reportOutput}
        </div>
      )}
    </div>
  );
}
