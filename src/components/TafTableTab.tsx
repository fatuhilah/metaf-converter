"use client";
import { useState } from "react";

export default function TafTableTab() {
  const [inputText, setInputText] = useState("");
  const [tableRows, setTableRows] = useState<any[]>([]);

  const processTAF = () => {
    if (!inputText.trim()) return;
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

    if (!baseStart) return;

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
      let timeStr = `${hr}:${mn}`;

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
  };

  return (
    <div className="space-y-6">
      <div className="bg-white/80 p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste raw TAF di sini (contoh: TAF WALS 032300Z...)"
          className="w-full h-28 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
        />
        <button
          onClick={processTAF}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md"
        >
          🚀 Generate Tabel Verifikasi TAF
        </button>
      </div>

      {tableRows.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-xl shadow-md border border-slate-200 p-4">
          <table className="w-full text-xs text-left border-collapse border border-slate-300">
            <thead className="bg-lime-500 text-slate-900 font-bold">
              <tr>
                <th className="border border-slate-300 p-2">Waktu</th>
                <th className="border border-slate-300 p-2">Group</th>
                <th className="border border-slate-300 p-2">Change</th>
                <th className="border border-slate-300 p-2">A</th>
                <th className="border border-slate-300 p-2">B1</th>
                <th className="border border-slate-300 p-2">B2</th>
                <th className="border border-slate-300 p-2">C</th>
                <th className="border border-slate-300 p-2">D</th>
                <th className="border border-slate-300 p-2">E</th>
                <th className="border border-slate-300 p-2">F</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => (
                <tr
                  key={i}
                  className="hover:bg-slate-50 border-b border-slate-200 text-blue-900"
                >
                  <td className="border border-slate-300 p-1.5 font-bold text-right">
                    {r.timeStr}
                  </td>
                  <td className="border border-slate-300 p-1.5">
                    {r.currentType}
                  </td>
                  <td className="border border-slate-300 p-1.5">
                    {r.changeColText}
                  </td>
                  <td className="border border-slate-300 p-1.5 text-right">
                    {r.A}
                  </td>
                  <td className="border border-slate-300 p-1.5 text-right">
                    {r.B1}
                  </td>
                  <td className="border border-slate-300 p-1.5">{r.B2}</td>
                  <td className="border border-slate-300 p-1.5 text-right">
                    {r.C}
                  </td>
                  <td className="border border-slate-300 p-1.5 text-center">
                    {r.D}
                  </td>
                  <td className="border border-slate-300 p-1.5 text-center">
                    {r.E}
                  </td>
                  <td className="border border-slate-300 p-1.5 text-right">
                    {r.F}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
