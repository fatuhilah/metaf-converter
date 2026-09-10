"use client";
import { useState } from "react";
import { TableProperties, FileText, CloudRain } from "lucide-react";
import MetarTableTab from "@/components/MetarTableTab";
import MetarReportTab from "@/components/MetarReportTab";
import TafTableTab from "@/components/TafTableTab";

export default function Home() {
  const [activeTab, setActiveTab] = useState("METAR_TABLE");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 text-slate-800 font-sans p-4 md:p-8">
      <header className="max-w-6xl mx-auto mb-6 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-cyan-600 mb-2">
          Aviation Weather Smart Converter
        </h1>
        <p className="text-slate-500 text-sm font-medium">
          Sistem Pengolah & Interpretasi Data Meteorology Penerbangan
        </p>
      </header>

      <main className="max-w-6xl mx-auto bg-white/70 backdrop-blur-md border border-white shadow-xl rounded-2xl overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/50">
          <button
            onClick={() => setActiveTab("METAR_TABLE")}
            className={`flex-1 py-3.5 px-4 flex items-center justify-center gap-2 font-semibold text-sm transition-all ${
              activeTab === "METAR_TABLE"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <TableProperties size={18} /> METAR to Table
          </button>
          <button
            onClick={() => setActiveTab("METAR_REPORT")}
            className={`flex-1 py-3.5 px-4 flex items-center justify-center gap-2 font-semibold text-sm transition-all ${
              activeTab === "METAR_REPORT"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <FileText size={18} /> METAR to MET REPORT
          </button>
          <button
            onClick={() => setActiveTab("TAF_TABLE")}
            className={`flex-1 py-3.5 px-4 flex items-center justify-center gap-2 font-semibold text-sm transition-all ${
              activeTab === "TAF_TABLE"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <CloudRain size={18} /> TAF to Table
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 md:p-8">
          {activeTab === "METAR_TABLE" && <MetarTableTab />}
          {activeTab === "METAR_REPORT" && <MetarReportTab />}
          {activeTab === "TAF_TABLE" && <TafTableTab />}
        </div>
      </main>
    </div>
  );
}
