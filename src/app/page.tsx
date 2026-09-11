"use client";
import { useState, useEffect } from "react";
import {
  TableProperties,
  FileText,
  CloudRain,
  Lock,
  ArrowRight,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import MetarTableTab from "@/components/MetarTableTab";
import MetarReportTab from "@/components/MetarReportTab";
import TafTableTab from "@/components/TafTableTab";

export default function Home() {
  // State Autentikasi
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true); // Biar gak kedip pas load
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);

  // State Navigasi Tab
  const [activeTab, setActiveTab] = useState("METAR_TABLE");

  // Cek localStorage pas web pertama kali dibuka
  useEffect(() => {
    const savedAuth = localStorage.getItem("authAviationWeb");
    if (savedAuth === "true") {
      setIsAuthenticated(true);
    }
    setIsCheckingAuth(false);
  }, []);

  // Fungsi Login dengan localStorage
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // GANTI PASSWORD DI BAWAH INI SESUAI SELERA LU
    if (password === "opr96607") {
      setIsAuthenticated(true);
      setLoginError(false);
      localStorage.setItem("authAviationWeb", "true"); // Simpan ke browser
    } else {
      setLoginError(true);
      setPassword("");
    }
  };

  // Fungsi Logout
  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("authAviationWeb"); // Hapus memori login dari browser
  };

  // Tampilkan layar kosong sebentar pas ngecek memori (hindari glitch tampilan)
  if (isCheckingAuth) return <div className="min-h-screen bg-slate-900"></div>;

  // ---------------------------------------------------------
  // UI HALAMAN LOGIN
  // ---------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex items-center justify-center p-4 font-sans">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in duration-500">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-500/20 p-4 rounded-full border border-blue-400/30">
              <ShieldCheck size={48} className="text-blue-400" />
            </div>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-center text-white mb-2">
            METAF Smart Converter
          </h1>
          <p className="text-blue-200 text-center text-sm mb-8 font-medium">
            Masukkan Password untuk Akses Sistem
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <div className="relative">
                <Lock
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  size={20}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan Password..."
                  className="w-full bg-slate-900/50 border border-slate-600 text-white placeholder-slate-400 pl-12 pr-4 py-3.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono"
                />
              </div>
              {loginError && (
                <p className="text-rose-400 text-xs mt-2 ml-1 font-medium animate-pulse">
                  ⚠️ Password salah, jangan ngarang!
                </p>
              )}
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              Masuk Sistem <ArrowRight size={18} />
            </button>
          </form>
          <p className="text-center text-slate-400 text-xs mt-8">
            © 2026 Fatuh Hidayatullah.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // UI HALAMAN UTAMA (DASHBOARD)
  // ---------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 text-slate-800 font-sans p-3 md:p-8 relative">
      <header className="max-w-6xl mx-auto mb-6 text-center pt-2 md:pt-0">
        <h1 className="text-2xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-cyan-600 mb-2">
          METAF Smart Converter
        </h1>
        <p className="text-slate-500 text-xs md:text-sm font-medium px-4">
          Sistem Pengolah & Interpretasi Data Meteorologi Penerbangan
        </p>
      </header>

      <main className="max-w-6xl mx-auto bg-white/70 backdrop-blur-md border border-white shadow-xl rounded-2xl overflow-hidden mb-16 md:mb-0">
        {/* Navigation Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 border-b border-slate-200 bg-slate-50/50">
          <button
            onClick={() => setActiveTab("METAR_TABLE")}
            className={`py-4 px-4 flex items-center justify-center gap-2 font-bold text-sm transition-all border-b sm:border-b-0 sm:border-r border-slate-200 ${
              activeTab === "METAR_TABLE"
                ? "bg-blue-600 text-white shadow-inner"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <TableProperties size={18} /> METAR to Table
          </button>
          <button
            onClick={() => setActiveTab("METAR_REPORT")}
            className={`py-4 px-4 flex items-center justify-center gap-2 font-bold text-sm transition-all border-b sm:border-b-0 sm:border-r border-slate-200 ${
              activeTab === "METAR_REPORT"
                ? "bg-blue-600 text-white shadow-inner"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <FileText size={18} /> MET REPORT
          </button>
          <button
            onClick={() => setActiveTab("TAF_TABLE")}
            className={`py-4 px-4 flex items-center justify-center gap-2 font-bold text-sm transition-all ${
              activeTab === "TAF_TABLE"
                ? "bg-blue-600 text-white shadow-inner"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <CloudRain size={18} /> TAF to Table
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 md:p-8">
          {activeTab === "METAR_TABLE" && <MetarTableTab />}
          {activeTab === "METAR_REPORT" && <MetarReportTab />}
          {activeTab === "TAF_TABLE" && <TafTableTab />}
        </div>
      </main>

      {/* Tombol Logout Melayang di Pojok Kanan Bawah */}
      <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-50 animate-in slide-in-from-bottom-5">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 bg-white/80 backdrop-blur-md border border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-5 py-2.5 rounded-full text-xs md:text-sm font-bold shadow-lg shadow-slate-200/50 transition-all hover:-translate-y-1"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    </div>
  );
}
