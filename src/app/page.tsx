"use client";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  TableProperties,
  FileText,
  CloudRain,
  ClipboardCheck,
  Lock,
  ArrowRight,
  LogOut,
  BarChart4,
  Eye,
  EyeOff,
  ClockAlert,
  BrainCircuit,
} from "lucide-react";
import MetarTableTab from "@/components/MetarTableTab";
import MetarReportTab from "@/components/MetarReportTab";
import TafTableTab from "@/components/TafTableTab";
import TafVerificationTab from "@/components/TafVerificationTab";
import AcsTab from "@/components/AcsTab";
import MachineLearningTab from "@/components/MachineLearningTab";

// Durasi sesi: 24 jam dalam milidetik
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

export default function Home() {
  // State Autentikasi
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // State Navigasi Tab
  const [activeTab, setActiveTab] = useState("METAR_TABLE");

  // Helper: Paksa Logout karena Sesi Habis
  const expireSession = useCallback(() => {
    setIsAuthenticated(false);
    setPassword("");
    setShowPassword(false);
    setLoginError(false);
    setSessionExpired(true);
    localStorage.removeItem("authAviationWeb");
    localStorage.removeItem("authAviationLoginTime");
  }, []);

  // 1. Cek localStorage & batas waktu 24 jam saat web pertama kali dibuka
  useEffect(() => {
    const savedAuth = localStorage.getItem("authAviationWeb");
    const savedLoginTime = localStorage.getItem("authAviationLoginTime");

    if (savedAuth === "true") {
      const loginTimestamp = savedLoginTime ? Number(savedLoginTime) : 0;
      const isExpired =
        !loginTimestamp || Date.now() - loginTimestamp >= SESSION_DURATION_MS;

      if (isExpired) {
        expireSession();
      } else {
        setIsAuthenticated(true);
      }
    }
    setIsCheckingAuth(false);
  }, [expireSession]);

  // 2. Pantau sisa waktu 24 jam secara real-time + saat tab aktif/laptop bangun dari sleep
  useEffect(() => {
    if (!isAuthenticated) return;

    const verifySession = () => {
      const savedLoginTime = localStorage.getItem("authAviationLoginTime");
      const loginTimestamp = savedLoginTime ? Number(savedLoginTime) : 0;

      if (
        !loginTimestamp ||
        Date.now() - loginTimestamp >= SESSION_DURATION_MS
      ) {
        expireSession();
      }
    };

    const checkSessionInterval = setInterval(verifySession, 10000);
    window.addEventListener("focus", verifySession);
    document.addEventListener("visibilitychange", verifySession);

    return () => {
      clearInterval(checkSessionInterval);
      window.removeEventListener("focus", verifySession);
      document.removeEventListener("visibilitychange", verifySession);
    };
  }, [isAuthenticated, expireSession]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || isLoggingIn) return;

    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setIsAuthenticated(true);
        setLoginError(false);
        setSessionExpired(false);
        localStorage.setItem("authAviationWeb", "true");
        localStorage.setItem("authAviationLoginTime", Date.now().toString());
      } else {
        setLoginError(true);
        setSessionExpired(false);
        setPassword("");
      }
    } catch {
      setLoginError(true);
      setSessionExpired(false);
      setPassword("");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Fungsi Logout Manual
  const handleLogout = () => {
    setIsAuthenticated(false);
    setPassword("");
    setShowPassword(false);
    setSessionExpired(false);
    localStorage.removeItem("authAviationWeb");
    localStorage.removeItem("authAviationLoginTime");
  };

  // Tampilkan layar kosong sebentar pas ngecek memori (hindari glitch tampilan)
  if (isCheckingAuth) return <div className="min-h-screen bg-slate-900"></div>;

  // ---------------------------------------------------------
  // UI HALAMAN LOGIN (LAWANG SEWU + FROSTED GLASSMORPHISM)
  // ---------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4 font-sans overflow-hidden select-none">
        {/* Background Image Preloaded dari public/lawang-sewu.jpg */}
        <Image
          src="/lawang-sewu.jpg"
          alt="Lawang Sewu Background"
          fill
          priority
          quality={90}
          className="object-cover object-center scale-[1.01]"
        />

        {/* Overlay Halus & Vignette */}
        <div className="absolute inset-0 bg-linear-to-b from-slate-950/35 via-slate-900/20 to-slate-950/60 pointer-events-none" />

        {/* Kartu Login Frosted Glassmorphism */}
        <div className="relative z-10 w-full max-w-100 bg-white/15 backdrop-blur-md border border-white/40 px-8 py-10 rounded-[28px] shadow-[0_24px_60px_rgba(0,0,0,0.4)] animate-in fade-in zoom-in-95 duration-500">
          <div className="text-center mb-7">
            <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
              Welcome to METAF
            </h1>
            <p className="text-white/90 text-xs md:text-sm mt-1.5 font-medium drop-shadow-[0_1px_6px_rgba(0,0,0,0.4)]">
              Sistem Pengolah &amp; Interpretasi Meteorologi Penerbangan
            </p>
          </div>

          {/* Notifikasi Sesi Habis (24 Jam) */}
          {sessionExpired && (
            <div className="mb-5 flex items-center gap-2.5 text-amber-100 bg-amber-950/70 border border-amber-400/50 backdrop-blur-sm rounded-xl px-3.5 py-2.5 text-xs font-semibold shadow-md animate-in fade-in slide-in-from-top-2">
              <ClockAlert size={18} className="text-amber-300 shrink-0" />
              <span>Sesi Login Anda Habis, Silakan Login Ulang</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              {/* Input Password Glass Style */}
              <div className="relative group">
                <Lock
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/85 group-focus-within:text-white transition-colors"
                  size={18}
                />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (loginError) setLoginError(false);
                    if (sessionExpired) setSessionExpired(false);
                  }}
                  placeholder="Masukkan Password..."
                  autoComplete="current-password"
                  className="w-full bg-white/15 hover:bg-white/20 focus:bg-white/25 backdrop-blur-sm border border-white/50 focus:border-white text-white placeholder-white/80 pl-11 pr-11 py-3.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40 transition-all text-sm font-medium shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword ? "Sembunyikan password" : "Lihat password"
                  }
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {loginError && (
                <p className="text-rose-200 bg-rose-950/65 border border-rose-400/40 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs mt-2.5 font-semibold animate-pulse">
                  ⚠️ Password salah, silakan coba lagi!
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-linear-to-r from-[#b84a39] via-[#c85543] to-[#9e3a2b] hover:from-[#c95644] hover:via-[#d66350] hover:to-[#b04232] text-white font-bold py-3.5 rounded-xl shadow-[0_10px_25px_rgba(158,58,43,0.45)] border border-white/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              Masuk Sistem <ArrowRight size={18} />
            </button>
          </form>

          <p className="text-center text-white/85 text-[11px] mt-8 font-medium drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]">
            © 2026 Fatuh Hidayatullah.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // UI HALAMAN UTAMA (DASHBOARD — LAWANG SEWU & TERRACOTTA GLASS)
  // ---------------------------------------------------------
  const navTabStyle = (tabKey: string, extraClasses = "") =>
    `py-4 px-3 flex items-center justify-center gap-2 font-bold text-[13px] transition-all cursor-pointer ${extraClasses} ${
      activeTab === tabKey
        ? "bg-gradient-to-r from-[#b84a39] to-[#c95644] text-white shadow-inner"
        : "bg-slate-700/90 hover:bg-slate-800 text-slate-100"
    }`;

  return (
    <div className="min-h-screen relative text-slate-800 font-sans p-3 md:p-8 overflow-x-hidden">
      {/* Latar Belakang Lawang Sewu Terkunci (Fixed) + Soft Blur & Tirai Langit */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <Image
          src="/lawang-sewu.jpg"
          alt="Lawang Sewu Dashboard Background"
          fill
          priority
          quality={90}
          className="object-cover object-center blur-[5px] scale-[1.06]"
        />
        <div className="absolute inset-0 bg-linear-to-b from-slate-950/45 via-slate-900/10 to-slate-900/35" />
        <div className="absolute inset-0 bg-white/8 backdrop-blur-[1px]" />
      </div>

      {/* Header dengan Judul Putih Kontras */}
      <header className="max-w-7xl mx-auto mb-6 text-center pt-2 md:pt-1 relative z-10">
        <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight drop-shadow-[0_3px_14px_rgba(0,0,0,0.45)] mb-2">
          METAF Smart Converter
        </h1>
        <p className="text-white/95 text-xs md:text-base font-medium px-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
          Sistem Pengolah &amp; Interpretasi Data Meteorologi Penerbangan
        </p>
      </header>

      {/* Kontainer Utama Warm Frosted Glass Transparan */}
      <main className="relative z-10 max-w-7xl mx-auto bg-stone-100/45 backdrop-blur-md border border-white/60 shadow-[0_24px_60px_rgba(15,23,42,0.32)] rounded-3xl overflow-hidden mb-16 md:mb-0">
        {/* Navigation Tabs Menyatu Penuh (Edge-to-Edge) dengan Sekat Garis Putih Tipis */}
        {/* Navigation Tabs Menyatu Penuh (6 Menu) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-b border-white/35 overflow-hidden">
          <button
            onClick={() => setActiveTab("METAR_TABLE")}
            className={navTabStyle(
              "METAR_TABLE",
              "border-b lg:border-b-0 border-r border-white/35",
            )}
          >
            <TableProperties size={16} /> METAR to Table
          </button>
          <button
            onClick={() => setActiveTab("METAR_REPORT")}
            className={navTabStyle(
              "METAR_REPORT",
              "border-b lg:border-b-0 md:border-r border-white/35",
            )}
          >
            <FileText size={16} /> MET REPORT
          </button>
          <button
            onClick={() => setActiveTab("TAF_TABLE")}
            className={navTabStyle(
              "TAF_TABLE",
              "border-b lg:border-b-0 border-r border-white/35",
            )}
          >
            <CloudRain size={16} /> TAF to Table
          </button>
          <button
            onClick={() => setActiveTab("TAF_VERIFICATION")}
            className={navTabStyle(
              "TAF_VERIFICATION",
              "border-b md:border-b-0 md:border-r border-white/35",
            )}
          >
            <ClipboardCheck size={16} /> Verifikasi TAF
          </button>
          <button
            onClick={() => setActiveTab("ACS_CLIMATOLOGY")}
            className={navTabStyle(
              "ACS_CLIMATOLOGY",
              "border-r border-white/35",
            )}
          >
            <BarChart4 size={16} /> ACS
          </button>
          <button
            onClick={() => setActiveTab("MACHINE_LEARNING")}
            className={navTabStyle("MACHINE_LEARNING")}
          >
            <BrainCircuit size={16} /> Machine Learning
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 md:p-7">
          {activeTab === "METAR_TABLE" && <MetarTableTab />}
          {activeTab === "METAR_REPORT" && <MetarReportTab />}
          {activeTab === "TAF_TABLE" && <TafTableTab />}
          {activeTab === "TAF_VERIFICATION" && <TafVerificationTab />}
          {activeTab === "ACS_CLIMATOLOGY" && <AcsTab />}
          {activeTab === "MACHINE_LEARNING" && <MachineLearningTab />}
        </div>
      </main>

      {/* Tombol Logout Melayang di Pojok Kanan Bawah */}
      <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-50 animate-in slide-in-from-bottom-5">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 bg-white/90 backdrop-blur-md border border-white text-slate-700 hover:text-rose-700 hover:bg-rose-50 px-5 py-2.5 rounded-full text-xs md:text-sm font-bold shadow-lg shadow-slate-950/20 transition-all hover:-translate-y-1 cursor-pointer"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    </div>
  );
}
