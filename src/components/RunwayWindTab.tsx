"use client";

import React, { useState, useMemo } from "react";
import {
  Compass,
  Wind,
  PlaneTakeoff,
  AlertTriangle,
  CheckCircle2,
  Droplets,
  Info,
  BookOpen,
  Sliders,
  FileText,
  Clock,
  ArrowUpRight,
  RotateCcw,
  Building2,
  Plane,
} from "lucide-react";
import { DAFTAR_STAMET_BANDARA, StametBandara } from "@/utils/stations";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type RwyccCode = 6 | 5 | 3 | 2;

interface RwyccProfile {
  code: RwyccCode;
  label: string;
  description: string;
  brakingAction: string;
  crosswindFactor: number; // Multiplier terhadap batas kering (ICAO Doc 10064 / FAA AC 91-79B)
  maxTailwindKt: number; // Batas tailwind operasional (kt)
  badgeColor: string;
}

interface ParsedWeatherPeriod {
  id: string;
  label: string;
  rawSegment: string;
  windDir: number | "VRB";
  windSpeedKt: number;
  windGustKt: number | null;
  windVarFrom: number | null;
  windVarTo: number | null;
  tempC: number | null;
  qnhHpa: number | null;
  weatherCodes: string[];
  suggestedRwycc: RwyccCode;
}

interface WindComponents {
  headwindKt: number;
  tailwindKt: number;
  crosswindKt: number;
  crosswindSide: "Kiri" | "Kanan" | "Netral";
  gustHeadwindKt: number | null;
  gustTailwindKt: number | null;
  gustCrosswindKt: number | null;
  worstCaseCrosswindKt: number;
  worstCaseTailwindKt: number;
}

// ============================================================================
// CONSTANTS & REGULATORY MATRICES
// ============================================================================

const RWYCC_PROFILES: Record<RwyccCode, RwyccProfile> = {
  6: {
    code: 6,
    label: "RWYCC 6 — DRY",
    description: "Permukaan landasan kering (100% Dry)",
    brakingAction: "Normal (Optimal)",
    crosswindFactor: 1.0,
    maxTailwindKt: 15,
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
  5: {
    code: 5,
    label: "RWYCC 5 — WET (≤ 3 mm)",
    description: "Basah dengan lapisan air tipis ≤ 3 mm (-RA / RA / SHRA)",
    brakingAction: "Good (Baik)",
    crosswindFactor: 0.75, // Reduksi 25% (FAA AC 91-79B / ICAO Doc 10064)
    maxTailwindKt: 10,
    badgeColor: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  },
  3: {
    code: 3,
    label: "RWYCC 3 — SLIPPERY WET",
    description: "Basah licin / daya cengkeram menurun (Medium Braking)",
    brakingAction: "Medium (Sedang)",
    crosswindFactor: 0.6, // Reduksi 40%
    maxTailwindKt: 5,
    badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  },
  2: {
    code: 2,
    label: "RWYCC 2 — STANDING WATER (> 3 mm)",
    description: "Genangan air > 3 mm (+RA / TSRA) — Risiko Aquaplaning",
    brakingAction: "Medium to Poor",
    crosswindFactor: 0.5, // Reduksi 50%
    maxTailwindKt: 5,
    badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  },
};

const AIRCRAFT_LIMIT_BENCHMARKS = [
  {
    category: "ICAO Aerodrome Code A/B (Light / Commuter)",
    dryCrosswindLimit: 13, // ICAO Annex 14 Vol. I Ch. 3 (10.5 - 13 kt)
    notes: "Cessna Caravan, Twin Otter",
  },
  {
    category: "ICAO Aerodrome Code C (Regional Turboprop / Narrow-Body)",
    dryCrosswindLimit: 20, // ICAO Annex 14 Vol. I Ch. 3 (20 kt design limit)
    notes: "ATR 72-600, Boeing 737, Airbus A320",
  },
  {
    category: "Operational Max Demonstrated (Commercial Jet Wet/Dry Ref)",
    dryCrosswindLimit: 30, // Umum operasional maskapai komersial
    notes: "B737NG / A320ceo/neo Operational Limit",
  },
];

// Referensi Jarak Lepas Landas Standar (Sea Level, ISA 15°C, MTOW) dari Airport Planning Manual / POH
const AIRCRAFT_TAKEOFF_PRESETS = [
  { label: "Cessna 208B", distM: 740, source: "Cessna 208B POH" },
  { label: "ATR 72-600", distM: 1333, source: "ATR 72-600 APM" },
  { label: "Airbus A320neo", distM: 1950, source: "Airbus A320 AC" },
  { label: "Boeing 737-800", distM: 2090, source: "Boeing D6-58325-6" },
];

// ============================================================================
// HELPER FUNCTIONS (METEOROLOGY, STATION LOOKUP & AERODYNAMICS)
// ============================================================================

function normalizeHeading(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return mod === 0 ? 360 : mod;
}

function getReciprocalHeading(deg: number): number {
  return normalizeHeading(deg + 180);
}

function formatRunwayDesignator(deg: number): string {
  const rounded = Math.round(normalizeHeading(deg) / 10);
  const num = rounded === 0 ? 36 : rounded;
  return num.toString().padStart(2, "0");
}

function detectRwyccFromWeather(weatherCodes: string[]): RwyccCode {
  const joined = weatherCodes.join(" ");
  if (/(\+RA|\+TSRA|TSRA|\+SHRA)/.test(joined)) return 2; // Standing water potential
  if (/(RA|SHRA|DZ|TS)/.test(joined)) return 5; // Wet <= 3mm
  return 6; // Dry
}

function findStationByIcao(icaoCode: string): StametBandara | null {
  if (!icaoCode) return null;
  const upper = icaoCode.trim().toUpperCase();
  return (
    DAFTAR_STAMET_BANDARA.find((item) => item.icao.toUpperCase() === upper) ??
    null
  );
}

function parseAviationMessage(rawText: string): {
  icao: string;
  stationInfo: StametBandara | null;
  reportType: "METAR/SPECI" | "TAF" | "UNKNOWN";
  periods: ParsedWeatherPeriod[];
} {
  const clean = rawText
    .toUpperCase()
    .replace(/=/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return {
      icao: "",
      stationInfo: null,
      reportType: "UNKNOWN",
      periods: [],
    };
  }

  const isTaf =
    /\bTAF\b/.test(clean) || /\b(BECMG|TEMPO|FM\d{6}|PROB[34]0)\b/.test(clean);
  const icaoMatch =
    clean.match(/\b(?:METAR|SPECI|TAF(?:\s+AMD|\s+COR)?)\s+([A-Z]{4})\b/) ||
    clean.match(/\b([W|A|K|E|R|O|Z|V|Y][A-Z]{3})\b/);
  const icao = icaoMatch ? icaoMatch[1] : "";
  const stationInfo = findStationByIcao(icao);

  const tempDewMatch = clean.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  const parsedTemp = tempDewMatch
    ? parseInt(tempDewMatch[1].replace("M", "-"), 10)
    : null;

  const qnhMatch = clean.match(/\bQ(\d{4})\b/);
  const altimMatch = clean.match(/\bA(\d{4})\b/);
  const parsedQnh = qnhMatch
    ? parseInt(qnhMatch[1], 10)
    : altimMatch
      ? Math.round(parseInt(altimMatch[1], 10) * 0.01 * 33.8639)
      : null;

  const segmentRegex =
    /(?=\b(?:FM\d{6}|BECMG|TEMPO|PROB[34]0\s+TEMPO|PROB[34]0)\b)/g;
  const rawSegments = isTaf
    ? clean.split(segmentRegex).filter(Boolean)
    : [clean];

  const periods: ParsedWeatherPeriod[] = [];

  rawSegments.forEach((seg, idx) => {
    const windMatch = seg.match(
      /\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/,
    );
    const varMatch = seg.match(/\b(\d{3})V(\d{3})\b/);
    const wxMatches =
      seg.match(
        /\b(?:\+|-|VC)?(?:TS|SH|FZ)?(?:RA|DZ|SN|SG|IC|PL|GR|GS|BR|FG|FU|VA|DU|SA|HZ|SQ|FC|SS|DS)+\b/g,
      ) || [];

    if (windMatch || idx === 0) {
      const unitFactor = windMatch && windMatch[4] === "MPS" ? 1.94384 : 1;
      const windDir: number | "VRB" = !windMatch
        ? 0
        : windMatch[1] === "VRB"
          ? "VRB"
          : normalizeHeading(parseInt(windMatch[1], 10));

      const windSpeedKt = windMatch
        ? Math.round(parseInt(windMatch[2], 10) * unitFactor)
        : 0;
      const windGustKt =
        windMatch && windMatch[3]
          ? Math.round(parseInt(windMatch[3], 10) * unitFactor)
          : null;

      let label = isTaf ? "Base Forecast (Initial)" : "Observasi Utama";
      if (idx > 0) {
        const changeHeader = seg.match(
          /^(FM\d{6}|BECMG\s+\d{4}\/\d{4}|TEMPO\s+\d{4}\/\d{4}|PROB[34]0(?:\s+TEMPO)?\s+\d{4}\/\d{4})/,
        );
        label = changeHeader ? changeHeader[1] : `Periode ${idx + 1}`;
      }

      periods.push({
        id: `period-${idx}`,
        label,
        rawSegment: seg.trim(),
        windDir,
        windSpeedKt,
        windGustKt,
        windVarFrom: varMatch ? parseInt(varMatch[1], 10) : null,
        windVarTo: varMatch ? parseInt(varMatch[2], 10) : null,
        tempC: parsedTemp,
        qnhHpa: parsedQnh,
        weatherCodes: wxMatches,
        suggestedRwycc: detectRwyccFromWeather(wxMatches),
      });
    }
  });

  return {
    icao,
    stationInfo,
    reportType: isTaf ? "TAF" : periods.length > 0 ? "METAR/SPECI" : "UNKNOWN",
    periods,
  };
}

function calculateWindComponents(
  trueWindDir: number | "VRB",
  windSpeedKt: number,
  windGustKt: number | null,
  runwayMagHeading: number,
  magVariationDeg: number,
  varFrom: number | null = null,
  varTo: number | null = null,
): WindComponents {
  if (windSpeedKt === 0) {
    return {
      headwindKt: 0,
      tailwindKt: 0,
      crosswindKt: 0,
      crosswindSide: "Netral",
      gustHeadwindKt: windGustKt ? 0 : null,
      gustTailwindKt: windGustKt ? 0 : null,
      gustCrosswindKt: windGustKt ? 0 : null,
      worstCaseCrosswindKt: 0,
      worstCaseTailwindKt: 0,
    };
  }

  if (trueWindDir === "VRB") {
    const maxSpd = windGustKt ?? windSpeedKt;
    return {
      headwindKt: 0,
      tailwindKt: windSpeedKt,
      crosswindKt: windSpeedKt,
      crosswindSide: "Netral",
      gustHeadwindKt: windGustKt ? 0 : null,
      gustTailwindKt: windGustKt ?? null,
      gustCrosswindKt: windGustKt ?? null,
      worstCaseCrosswindKt: maxSpd,
      worstCaseTailwindKt: maxSpd,
    };
  }

  const computeForDir = (tDir: number, spd: number) => {
    const magWindDir = normalizeHeading(tDir - magVariationDeg);
    let diffDeg = magWindDir - runwayMagHeading;
    while (diffDeg > 180) diffDeg -= 360;
    while (diffDeg < -180) diffDeg += 360;

    const rad = (diffDeg * Math.PI) / 180;
    const hw = spd * Math.cos(rad);
    const cw = spd * Math.sin(rad);
    return { hw, cw, diffDeg };
  };

  const steady = computeForDir(trueWindDir, windSpeedKt);
  const gust = windGustKt ? computeForDir(trueWindDir, windGustKt) : null;

  let worstCw = Math.abs(gust ? gust.cw : steady.cw);
  let worstTw = Math.max(0, -(gust ? gust.hw : steady.hw));

  if (varFrom !== null && varTo !== null) {
    const maxSpd = windGustKt ?? windSpeedKt;
    let cur = varFrom;
    for (let step = 0; step <= 360; step += 5) {
      const res = computeForDir(cur, maxSpd);
      worstCw = Math.max(worstCw, Math.abs(res.cw));
      worstTw = Math.max(worstTw, Math.max(0, -res.hw));
      if (cur === varTo) break;
      cur = (cur + 5) % 360;
    }
  }

  const side: "Kiri" | "Kanan" | "Netral" =
    Math.abs(steady.cw) < 0.1 ? "Netral" : steady.cw > 0 ? "Kanan" : "Kiri";

  return {
    headwindKt: steady.hw >= 0 ? steady.hw : 0,
    tailwindKt: steady.hw < 0 ? Math.abs(steady.hw) : 0,
    crosswindKt: Math.abs(steady.cw),
    crosswindSide: side,
    gustHeadwindKt: gust ? (gust.hw >= 0 ? gust.hw : 0) : null,
    gustTailwindKt: gust ? (gust.hw < 0 ? Math.abs(gust.hw) : 0) : null,
    gustCrosswindKt: gust ? Math.abs(gust.cw) : null,
    worstCaseCrosswindKt: worstCw,
    worstCaseTailwindKt: worstTw,
  };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RunwayWindTab() {
  // --- Input Sandi Mentah (Kosong / Netral di Awal) ---
  const [rawInput, setRawInput] = useState<string>("");
  const [parsedResult, setParsedResult] = useState(() =>
    parseAviationMessage(""),
  );
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState<number>(0);

  // --- Konfigurasi Landasan Mandiri (Netral / Kosong di Awal) ---
  const [showAipHelp, setShowAipHelp] = useState<boolean>(false);
  const [runwayNumberInput, setRunwayNumberInput] = useState<string>("");
  const [magHeadingPrimary, setMagHeadingPrimary] = useState<number>(360);
  const [activeEnd, setActiveEnd] = useState<"PRIMARY" | "RECIPROCAL">(
    "PRIMARY",
  );
  const [magVariation, setMagVariation] = useState<number>(0);
  const [elevationFt, setElevationFt] = useState<number>(0);
  const [runwayLengthM, setRunwayLengthM] = useState<string>("");

  // --- Parameter Cuaca & Simulasi Manual (Netral di Awal) ---
  const [windDir, setWindDir] = useState<number>(360);
  const [isVariableWind, setIsVariableWind] = useState<boolean>(false);
  const [windSpeedKt, setWindSpeedKt] = useState<number>(0);
  const [windGustKt, setWindGustKt] = useState<number>(0);
  const [varFrom, setVarFrom] = useState<number | null>(null);
  const [varTo, setVarTo] = useState<number | null>(null);
  const [oatCelsius, setOatCelsius] = useState<number>(30);
  const [qnhHpa, setQnhHpa] = useState<number>(1013);
  const [rwycc, setRwycc] = useState<RwyccCode>(6);
  const [baseTakeoffDistM, setBaseTakeoffDistM] = useState<string>("");

  // --- Handler: Auto-Heading dari Nomor Runway ---
  const handleRunwayNumberChange = (val: string) => {
    const cleaned = val.replace(/[^0-9]/g, "").slice(0, 2);
    setRunwayNumberInput(cleaned);
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num >= 1 && num <= 36) {
      setMagHeadingPrimary(num * 10);
    }
  };

  // --- Handler: Parse Sandi METAR / SPECI / TAF ---
  const applyPeriodToSimulator = (period: ParsedWeatherPeriod) => {
    if (period.windDir === "VRB") {
      setIsVariableWind(true);
    } else {
      setIsVariableWind(false);
      setWindDir(period.windDir || 360);
    }
    setWindSpeedKt(period.windSpeedKt);
    setWindGustKt(period.windGustKt ?? 0);
    setVarFrom(period.windVarFrom);
    setVarTo(period.windVarTo);
    if (period.tempC !== null) setOatCelsius(period.tempC);
    if (period.qnhHpa !== null) setQnhHpa(period.qnhHpa);
    setRwycc(period.suggestedRwycc);
  };

  const handleParseMessage = () => {
    const res = parseAviationMessage(rawInput);
    setParsedResult(res);
    setSelectedPeriodIdx(0);
    if (res.periods.length > 0) {
      applyPeriodToSimulator(res.periods[0]);
    }
  };

  const handleResetAll = () => {
    setRawInput("");
    setParsedResult(parseAviationMessage(""));
    setSelectedPeriodIdx(0);
    setWindDir(360);
    setIsVariableWind(false);
    setWindSpeedKt(0);
    setWindGustKt(0);
    setVarFrom(null);
    setVarTo(null);
    setOatCelsius(30);
    setQnhHpa(1013);
    setRwycc(6);
  };

  const handleSelectTafPeriod = (idx: number) => {
    setSelectedPeriodIdx(idx);
    if (parsedResult.periods[idx]) {
      applyPeriodToSimulator(parsedResult.periods[idx]);
    }
  };

  // --- Kalkulasi Vektor Angin Kedua Ujung Runway ---
  const primaryDesignator = formatRunwayDesignator(magHeadingPrimary);
  const reciprocalHeading = getReciprocalHeading(magHeadingPrimary);
  const reciprocalDesignator = formatRunwayDesignator(reciprocalHeading);

  const primaryWind = useMemo(
    () =>
      calculateWindComponents(
        isVariableWind ? "VRB" : windDir,
        windSpeedKt,
        windGustKt > windSpeedKt ? windGustKt : null,
        magHeadingPrimary,
        magVariation,
        varFrom,
        varTo,
      ),
    [
      isVariableWind,
      windDir,
      windSpeedKt,
      windGustKt,
      magHeadingPrimary,
      magVariation,
      varFrom,
      varTo,
    ],
  );

  const reciprocalWind = useMemo(
    () =>
      calculateWindComponents(
        isVariableWind ? "VRB" : windDir,
        windSpeedKt,
        windGustKt > windSpeedKt ? windGustKt : null,
        reciprocalHeading,
        magVariation,
        varFrom,
        varTo,
      ),
    [
      isVariableWind,
      windDir,
      windSpeedKt,
      windGustKt,
      reciprocalHeading,
      magVariation,
      varFrom,
      varTo,
    ],
  );

  const activeWind = activeEnd === "PRIMARY" ? primaryWind : reciprocalWind;
  const activeHeading =
    activeEnd === "PRIMARY" ? magHeadingPrimary : reciprocalHeading;
  const activeDesignator =
    activeEnd === "PRIMARY" ? primaryDesignator : reciprocalDesignator;

  const recommendedEnd: "PRIMARY" | "RECIPROCAL" =
    primaryWind.headwindKt >= reciprocalWind.headwindKt
      ? "PRIMARY"
      : "RECIPROCAL";

  // --- Kalkulasi Density Altitude & Takeoff Penalty (FAA-H-8083-25C / Koch Chart) ---
  const performanceMetrics = useMemo(() => {
    const pressureAltitudeFt = elevationFt + (1013.25 - qnhHpa) * 27.3;
    const isaTempC = 15 - 1.98 * (elevationFt / 1000);
    const isaDeviationC = oatCelsius - isaTempC;
    const densityAltitudeFt = pressureAltitudeFt + 120 * isaDeviationC;

    const takeoffPenaltyPct = Math.max(0, (densityAltitudeFt / 1000) * 10);

    const parsedBaseDist = Number(baseTakeoffDistM);
    const parsedRwyLen = Number(runwayLengthM);

    const requiredRunwayM =
      parsedBaseDist > 0
        ? Math.round(parsedBaseDist * (1 + takeoffPenaltyPct / 100))
        : null;

    const remainingMarginM =
      requiredRunwayM !== null && parsedRwyLen > 0
        ? parsedRwyLen - requiredRunwayM
        : null;

    return {
      pressureAltitudeFt: Math.round(pressureAltitudeFt),
      isaTempC: isaTempC.toFixed(1),
      isaDeviationC: isaDeviationC.toFixed(1),
      densityAltitudeFt: Math.round(densityAltitudeFt),
      takeoffPenaltyPct: takeoffPenaltyPct.toFixed(1),
      requiredRunwayM,
      remainingMarginM,
    };
  }, [elevationFt, qnhHpa, oatCelsius, baseTakeoffDistM, runwayLengthM]);

  const currentRwyccProfile = RWYCC_PROFILES[rwycc];

  const windArrowAngle = isVariableWind
    ? activeHeading
    : normalizeHeading(windDir - magVariation);

  return (
    <div className="space-y-6 text-slate-100">
      {/* ===================================================================== */}
      {/* HEADER MODUL                                                          */}
      {/* ===================================================================== */}
      <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-sky-500/20 border border-sky-400/30 rounded-xl text-sky-400">
                <Compass className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Runway Wind &amp; Performance Analyzer
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Kalkulator Operasional Angin Landasan, Skala Permukaan ICAO
                  GRF (RWYCC), &amp; Density Altitude
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300">
              Data Input: METAR / SPECI / TAF
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${currentRwyccProfile.badgeColor}`}
            >
              {currentRwyccProfile.label}
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MAIN 2-COLUMN WORKSPACE                                               */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ------------------------------------------------------------------- */}
        {/* KOLOM KIRI (5 KOLOM): INPUT SANDI, KONFIGURASI RUNWAY, & SIMULASI   */}
        {/* ------------------------------------------------------------------- */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. AUTO-PARSER SANDI METAR / SPECI / TAF */}
          <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                1. Paste Sandi METAR / SPECI / TAF
              </label>
              {parsedResult.icao && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  {parsedResult.reportType} • {parsedResult.icao}
                </span>
              )}
            </div>

            <textarea
              rows={3}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Paste sandi di sini..."
              className="w-full rounded-xl bg-slate-950/90 border border-slate-700 px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-sky-500"
            />

            {/* Badge Deteksi Otomatis Bandara & Stamet dari utils/stations.ts */}
            {parsedResult.icao && (
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2.5 text-xs">
                <Building2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                {parsedResult.stationInfo ? (
                  <div>
                    <div className="font-semibold text-white">
                      Bandar Udara {parsedResult.stationInfo.bandar_udara} (
                      {parsedResult.stationInfo.icao})
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Stasiun Meteorologi:{" "}
                      <span className="text-sky-300 font-medium">
                        {parsedResult.stationInfo.stasiun_meteorologi}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400">
                    Kode ICAO{" "}
                    <span className="font-mono font-semibold text-slate-200">
                      {parsedResult.icao}
                    </span>{" "}
                    tidak terdaftar pada daftar Stamet Indonesia.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleParseMessage}
                className="flex-1 py-2 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow cursor-pointer"
              >
                <Wind className="w-3.5 h-3.5" />
                Parse &amp; Terapkan Sandi
              </button>
              <button
                type="button"
                onClick={handleResetAll}
                title="Reset sandi dan simulasi"
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Lini Masa Multi-Periode TAF */}
            {parsedResult.periods.length > 1 && (
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  TAF Wind Shift Timeline ({parsedResult.periods.length}{" "}
                  Periode)
                </div>
                <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {parsedResult.periods.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectTafPeriod(idx)}
                      className={`text-left px-3 py-2 rounded-lg border text-xs transition flex items-center justify-between cursor-pointer ${
                        selectedPeriodIdx === idx
                          ? "bg-sky-500/20 border-sky-400 text-white"
                          : "bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <span className="font-mono font-semibold">{p.label}</span>
                      <span className="font-mono text-sky-300">
                        {p.windDir === "VRB"
                          ? "VRB"
                          : `${String(p.windDir).padStart(3, "0")}°`}{" "}
                        / {p.windSpeedKt}
                        {p.windGustKt ? `G${p.windGustKt}` : ""} kt
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. KONFIGURASI FISIK LANDASAN (MANDIRI + SMART DEFAULTS) */}
          <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <PlaneTakeoff className="w-4 h-4 text-amber-400" />
                2. Karakteristik Fisik Runway
              </span>
              <button
                type="button"
                onClick={() => setShowAipHelp((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-white bg-sky-950/70 hover:bg-sky-900/80 border border-sky-800/70 px-2.5 py-0.5 rounded-full transition cursor-pointer"
              >
                <Info className="w-3 h-3" />
                {showAipHelp ? "Tutup Panduan AIP" : "AIP ID: AD 2.2 & AD 2.12"}
              </button>
            </div>

            {showAipHelp && (
              <div className="p-3 rounded-xl bg-sky-950/50 border border-sky-800/70 text-[11px] text-slate-300 space-y-1.5">
                <div className="font-semibold text-sky-300">
                  Panduan Sumber Data Fisik Bandara (AIP Indonesia):
                </div>
                <ul className="list-disc pl-4 space-y-1 text-slate-300">
                  <li>
                    <strong>AD 2.2 (Aerodrome Geographical Data):</strong>{" "}
                    Memuat <em>Aerodrome Elevation</em> (ft) dan{" "}
                    <em>Magnetic Variation</em> (°).
                  </li>
                  <li>
                    <strong>AD 2.12 (Runway Physical Characteristics):</strong>{" "}
                    Memuat <em>Magnetic Bearing / Heading</em> (°M) dan panjang
                    landasan / <em>TORA</em> (m).
                  </li>
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Nomor Runway (Auto-tebak Heading) */}
              <div>
                <label className="block text-slate-400 mb-1">
                  Nomor Runway (01–36)
                </label>
                <input
                  type="text"
                  value={runwayNumberInput}
                  onChange={(e) => handleRunwayNumberChange(e.target.value)}
                  placeholder="Misal: 04"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">
                  Otomatis set arah {primaryDesignator}/{reciprocalDesignator}
                </span>
              </div>

              {/* Magnetic Heading Presisi */}
              <div>
                <label className="block text-slate-400 mb-1">
                  Magnetic Heading (°M)
                </label>
                <input
                  type="number"
                  min={1}
                  max={360}
                  value={magHeadingPrimary}
                  onChange={(e) =>
                    setMagHeadingPrimary(
                      normalizeHeading(Number(e.target.value) || 360),
                    )
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">
                  Reciprocal: {String(reciprocalHeading).padStart(3, "0")}°M
                </span>
              </div>

              {/* Magnetic Variation */}
              <div>
                <label className="block text-slate-400 mb-1">
                  Magnetic Variation (°)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={-30}
                  max={30}
                  value={magVariation}
                  onChange={(e) => setMagVariation(Number(e.target.value) || 0)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">
                  Default 0° (+East / -West)
                </span>
              </div>

              {/* Elevasi Bandara */}
              <div>
                <label className="block text-slate-400 mb-1">
                  Elevasi Bandara (ft)
                </label>
                <input
                  type="number"
                  min={-100}
                  max={15000}
                  value={elevationFt}
                  onChange={(e) => setElevationFt(Number(e.target.value) || 0)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white focus:border-sky-500 focus:outline-none"
                />
              </div>

              {/* Panjang Fisik Landasan */}
              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">
                  Panjang Fisik Landasan / TORA (Take-Off Run Available)
                </label>
                <input
                  type="number"
                  min={300}
                  max={5000}
                  step={50}
                  value={runwayLengthM}
                  onChange={(e) => setRunwayLengthM(e.target.value)}
                  placeholder="Isi TORA dari AIP (m), misal: 2250"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Pilih Ujung Landasan Aktif */}
            <div className="pt-2 border-t border-slate-800">
              <div className="mb-1.5">
                <span className="text-xs text-slate-400">
                  Ujung Landasan Dianalisis:
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveEnd("PRIMARY")}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    activeEnd === "PRIMARY"
                      ? "bg-sky-600 border-sky-400 text-white"
                      : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                  }`}
                >
                  RWY {primaryDesignator} (
                  {String(magHeadingPrimary).padStart(3, "0")}°)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveEnd("RECIPROCAL")}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    activeEnd === "RECIPROCAL"
                      ? "bg-sky-600 border-sky-400 text-white"
                      : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                  }`}
                >
                  RWY {reciprocalDesignator} (
                  {String(reciprocalHeading).padStart(3, "0")}°)
                </button>
              </div>
            </div>
          </div>

          {/* 3. SIMULASI MANUAL (WHAT-IF SLIDERS) */}
          <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                3. Simulasi Cuaca (What-If)
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isVariableWind}
                  onChange={(e) => setIsVariableWind(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-800 text-sky-500"
                />
                Angin VRB
              </label>
            </div>

            <div className="space-y-2.5 text-xs">
              {/* Arah Angin */}
              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span>Arah Angin (True North)</span>
                  <span className="font-mono font-bold text-sky-300">
                    {isVariableWind
                      ? "VRB (Variable)"
                      : `${String(windDir).padStart(3, "0")}°T`}
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={360}
                  step={5}
                  disabled={isVariableWind}
                  value={windDir}
                  onChange={(e) => setWindDir(Number(e.target.value))}
                  className="w-full accent-sky-500 disabled:opacity-40"
                />
              </div>

              {/* Kecepatan Steady */}
              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span>Kecepatan Angin (Steady)</span>
                  <span className="font-mono font-bold text-sky-300">
                    {windSpeedKt} kt
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={windSpeedKt}
                  onChange={(e) => setWindSpeedKt(Number(e.target.value))}
                  className="w-full accent-sky-500"
                />
              </div>

              {/* Kecepatan Gust */}
              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span>Kecepatan Gust (0 = Tanpa Gust)</span>
                  <span className="font-mono font-bold text-amber-300">
                    {windGustKt > windSpeedKt
                      ? `${windGustKt} kt`
                      : "Tidak Ada"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={65}
                  value={windGustKt}
                  onChange={(e) => setWindGustKt(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              {/* Suhu & QNH */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Suhu Udara / OAT (°C)
                  </label>
                  <input
                    type="number"
                    min={-10}
                    max={50}
                    value={oatCelsius}
                    onChange={(e) => setOatCelsius(Number(e.target.value) || 0)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Tekanan QNH (hPa)
                  </label>
                  <input
                    type="number"
                    min={950}
                    max={1050}
                    value={qnhHpa}
                    onChange={(e) => setQnhHpa(Number(e.target.value) || 1013)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* KOLOM KANAN (7 KOLOM): KOMPAS SVG, VEKTOR ANGIN, RWYCC, & DA        */}
        {/* ------------------------------------------------------------------- */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. DIAGRAM KOMPAS INTERAKTIF & KARTU KOMPONEN ANGIN */}
          <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Analisis Vektor Angin — RWY {activeDesignator} (Heading{" "}
                  {String(activeHeading).padStart(3, "0")}°M)
                </h3>
                <p className="text-xs text-slate-400">
                  Rekomendasi Operasional (Headwind Terbesar):{" "}
                  <span className="text-emerald-400 font-semibold">
                    RWY{" "}
                    {recommendedEnd === "PRIMARY"
                      ? primaryDesignator
                      : reciprocalDesignator}
                  </span>
                </p>
              </div>
              {varFrom !== null && varTo !== null && (
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Variasi Arah: {String(varFrom).padStart(3, "0")}°V
                  {String(varTo).padStart(3, "0")}°
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
              {/* SVG Kompas & Landasan */}
              <div className="md:col-span-5 flex justify-center">
                <svg viewBox="0 0 240 240" className="w-56 h-56 select-none">
                  <circle
                    cx="120"
                    cy="120"
                    r="102"
                    fill="#0f172a"
                    stroke="#334155"
                    strokeWidth="2"
                  />
                  <circle
                    cx="120"
                    cy="120"
                    r="82"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />

                  <text
                    x="120"
                    y="14"
                    textAnchor="middle"
                    fill="#f87171"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    N
                  </text>
                  <text
                    x="228"
                    y="124"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    E
                  </text>
                  <text
                    x="120"
                    y="234"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    S
                  </text>
                  <text
                    x="12"
                    y="124"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    W
                  </text>

                  {/* Garis Strip Landasan Pacu */}
                  <g transform={`rotate(${activeHeading}, 120, 120)`}>
                    <rect
                      x="107"
                      y="38"
                      width="26"
                      height="164"
                      rx="3"
                      fill="#334155"
                      stroke="#64748b"
                      strokeWidth="1.5"
                    />
                    <line
                      x1="120"
                      y1="52"
                      x2="120"
                      y2="188"
                      stroke="#e2e8f0"
                      strokeWidth="1.5"
                      strokeDasharray="6 6"
                    />
                    <text
                      x="120"
                      y="196"
                      textAnchor="middle"
                      fill="#38bdf8"
                      fontSize="10"
                      fontWeight="bold"
                    >
                      {activeDesignator}
                    </text>
                    <text
                      x="120"
                      y="50"
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9"
                    >
                      {activeEnd === "PRIMARY"
                        ? reciprocalDesignator
                        : primaryDesignator}
                    </text>
                  </g>

                  {/* Panah Arah Datang Angin */}
                  {windSpeedKt > 0 && !isVariableWind && (
                    <g transform={`rotate(${windArrowAngle}, 120, 120)`}>
                      <line
                        x1="120"
                        y1="22"
                        x2="120"
                        y2="76"
                        stroke="#f59e0b"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                      <polygon points="120,84 113,70 127,70" fill="#f59e0b" />
                    </g>
                  )}

                  <circle cx="120" cy="120" r="4" fill="#38bdf8" />
                </svg>
              </div>

              {/* Kartu Angka Headwind / Tailwind / Crosswind */}
              <div className="md:col-span-7 grid grid-cols-2 gap-3">
                <div
                  className={`p-3.5 rounded-xl border ${
                    activeWind.tailwindKt > currentRwyccProfile.maxTailwindKt
                      ? "bg-rose-950/40 border-rose-500/50"
                      : activeWind.tailwindKt > 0
                        ? "bg-amber-950/30 border-amber-500/40"
                        : "bg-emerald-950/30 border-emerald-500/40"
                  }`}
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    {activeWind.tailwindKt > 0
                      ? "Tailwind Component"
                      : "Headwind Component"}
                  </div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">
                    {activeWind.tailwindKt > 0
                      ? `${activeWind.tailwindKt.toFixed(1)} kt`
                      : `${activeWind.headwindKt.toFixed(1)} kt`}
                  </div>
                  <div className="text-xs text-slate-300 mt-1 font-mono">
                    {activeWind.gustTailwindKt !== null &&
                    activeWind.gustTailwindKt > 0
                      ? `Gust TW: ${activeWind.gustTailwindKt.toFixed(1)} kt`
                      : activeWind.gustHeadwindKt !== null
                        ? `Gust HW: ${activeWind.gustHeadwindKt.toFixed(1)} kt`
                        : "Tanpa Gust"}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1.5">
                    Batas Tailwind (
                    {currentRwyccProfile.label.split("—")[0].trim()}): ≤{" "}
                    {currentRwyccProfile.maxTailwindKt} kt
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-700">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    Crosswind ({activeWind.crosswindSide})
                  </div>
                  <div className="text-2xl font-bold font-mono text-sky-300 mt-1">
                    {activeWind.crosswindKt.toFixed(1)} kt
                  </div>
                  <div className="text-xs text-amber-300 mt-1 font-mono">
                    {activeWind.gustCrosswindKt !== null
                      ? `Gust CW: ${activeWind.gustCrosswindKt.toFixed(1)} kt`
                      : `Worst-Case: ${activeWind.worstCaseCrosswindKt.toFixed(1)} kt`}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1.5">
                    Faktor Permukaan:{" "}
                    {(currentRwyccProfile.crosswindFactor * 100).toFixed(0)}%
                    dari batas kering
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. SKALA KONDISI PERMUKAAN ICAO GRF (RWYCC 6, 5, 3, 2) & MATRIKS PESAWAT */}
          <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Droplets className="w-4 h-4 text-sky-400" />
                  Kondisi Permukaan Landasan — ICAO GRF (RWYCC Tropis)
                </h3>
                <p className="text-xs text-slate-400">
                  Otomatis terdeteksi dari grup cuaca METAR/TAF atau pilih
                  manual sesuai laporan RCR bandara
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([6, 5, 3, 2] as RwyccCode[]).map((code) => {
                const isSelected = rwycc === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setRwycc(code)}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      isSelected
                        ? "bg-sky-500/20 border-sky-400 text-white shadow"
                        : "bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    <div className="text-xs font-bold">RWYCC {code}</div>
                    <div className="text-[11px] font-medium truncate mt-0.5">
                      {code === 6
                        ? "Dry (Kering)"
                        : code === 5
                          ? "Wet ≤ 3 mm"
                          : code === 3
                            ? "Slippery Wet"
                            : "Standing Water"}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">
                      Kategori Referensi Pesawat
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      Batas Dry
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      Batas Aktif (RWYCC {rwycc})
                    </th>
                    <th className="py-2 pl-3 font-medium text-right">
                      Status (Gust/Max)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {AIRCRAFT_LIMIT_BENCHMARKS.map((item) => {
                    const effectiveLimit = +(
                      item.dryCrosswindLimit *
                      currentRwyccProfile.crosswindFactor
                    ).toFixed(1);
                    const checkVal = activeWind.worstCaseCrosswindKt;
                    const isExceeded = checkVal > effectiveLimit;
                    const isCaution =
                      !isExceeded && checkVal >= effectiveLimit * 0.85;

                    return (
                      <tr key={item.category}>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-slate-200">
                            {item.category}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {item.notes}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                          {item.dryCrosswindLimit} kt
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-sky-300">
                          {effectiveLimit} kt
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          {isExceeded ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              <AlertTriangle className="w-3 h-3" /> EXCEEDED
                            </span>
                          ) : isCaution ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              <AlertTriangle className="w-3 h-3" /> CAUTION
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              <CheckCircle2 className="w-3 h-3" /> WITHIN LIMIT
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. DENSITY ALTITUDE & ESTIMASI PENAMBAHAN JARAK LEPAS LANDAS */}
          <div className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-amber-400" />
                Density Altitude &amp; Takeoff Ground Roll Penalty
              </h3>
            </div>

            {/* 3 Metrik Murni Meteorologi & Aerodinamika (Tanpa Butuh Data Pesawat) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  Pressure Altitude (PA)
                </div>
                <div className="text-lg font-bold font-mono text-white mt-0.5">
                  {performanceMetrics.pressureAltitudeFt.toLocaleString()} ft
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  QNH {qnhHpa} hPa • Elev {elevationFt} ft
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  Density Altitude (DA)
                </div>
                <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
                  {performanceMetrics.densityAltitudeFt.toLocaleString()} ft
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  OAT {oatCelsius}°C (ISA{" "}
                  {Number(performanceMetrics.isaDeviationC) >= 0 ? "+" : ""}
                  {performanceMetrics.isaDeviationC}°C)
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  Takeoff Ground Roll Penalty
                </div>
                <div className="text-lg font-bold font-mono text-rose-300 mt-0.5">
                  +{performanceMetrics.takeoffPenaltyPct}%
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Tambahan panjang lari lepas landas
                </div>
              </div>
            </div>

            {/* Simulasi Opsional Jarak Pesawat dengan Quick-Fill Referensi Pabrikan */}
            <div className="pt-3 border-t border-slate-800/80 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Plane className="w-3.5 h-3.5 text-sky-400" />
                  Simulasi Jarak Pesawat (Referensi Sea Level MTOW):
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="number"
                    min={300}
                    max={4500}
                    step={50}
                    value={baseTakeoffDistM}
                    onChange={(e) => setBaseTakeoffDistM(e.target.value)}
                    placeholder="Jarak dasar (m)"
                    className="w-40 rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1 font-mono text-white text-right focus:border-sky-500 focus:outline-none"
                  />
                  {baseTakeoffDistM && (
                    <button
                      type="button"
                      onClick={() => setBaseTakeoffDistM("")}
                      className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>

              {/* Tombol Quick-Fill Referensi Pabrikan */}
              <div className="flex flex-wrap gap-1.5">
                {AIRCRAFT_TAKEOFF_PRESETS.map((ac) => (
                  <button
                    key={ac.label}
                    type="button"
                    onClick={() => setBaseTakeoffDistM(String(ac.distM))}
                    title={`Sumber: ${ac.source} (${ac.distM} m ISA Sea Level)`}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer ${
                      Number(baseTakeoffDistM) === ac.distM
                        ? "bg-sky-500/20 border-sky-400 text-sky-200"
                        : "bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {ac.label} ({ac.distM.toLocaleString()} m)
                  </button>
                ))}
              </div>

              {/* Hasil Estimasi Jarak & Sisa Margin (Muncul saat user mengisi/memilih pesawat) */}
              {performanceMetrics.requiredRunwayM !== null && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Estimasi Jarak Lepas Landas Efektif
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {Number(baseTakeoffDistM).toLocaleString()} m +{" "}
                        {performanceMetrics.takeoffPenaltyPct}%
                      </div>
                    </div>
                    <div className="text-base font-bold font-mono text-amber-300">
                      {performanceMetrics.requiredRunwayM.toLocaleString()} m
                    </div>
                  </div>

                  <div
                    className={`p-3 rounded-xl border flex items-center justify-between ${
                      performanceMetrics.remainingMarginM === null
                        ? "bg-slate-950/90 border-slate-800"
                        : performanceMetrics.remainingMarginM < 0
                          ? "bg-rose-950/40 border-rose-500/50"
                          : performanceMetrics.remainingMarginM < 300
                            ? "bg-amber-950/30 border-amber-500/40"
                            : "bg-emerald-950/30 border-emerald-500/40"
                    }`}
                  >
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Sisa Margin Aspal (TORA)
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {Number(runwayLengthM) > 0
                          ? `Dari TORA ${Number(runwayLengthM).toLocaleString()} m`
                          : "Isi TORA di kolom Runway"}
                      </div>
                    </div>
                    <div className="text-base font-bold font-mono text-white">
                      {performanceMetrics.remainingMarginM !== null
                        ? `${performanceMetrics.remainingMarginM >= 0 ? "+" : ""}${performanceMetrics.remainingMarginM.toLocaleString()} m`
                        : "—"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* PANEL SITASI REGULASI PENERBANGAN                                     */}
      {/* ===================================================================== */}
      <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
          <BookOpen className="w-4 h-4 text-sky-400" />
          Referensi Regulasi Penerbangan
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs text-slate-300">
          {/* 1. ICAO Doc 9837 */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="font-semibold text-sky-300">
              ICAO Doc 9837 (2nd Edition)
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              <em>
                Manual on Automatic Meteorological Observing Systems at
                Aerodromes
              </em>{" "}
              — Dekomposisi vektor angin permukaan terhadap orientasi landasan.
            </p>
          </div>

          {/* 2. ICAO Annex 14 */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="font-semibold text-sky-300">
              ICAO Annex 14, Vol. I (Amendment 18)
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              <em>Aerodrome Design and Operations</em> — Batas desain crosswind
              maksimum menurut Aerodrome Reference Code (Code A/B: 13 kt; Code
              C: 20 kt) &amp; format pelaporan GRF.
            </p>
          </div>

          {/* 3. ICAO Doc 10064 */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="font-semibold text-sky-300">ICAO Doc 10064</div>
            <p className="text-[11px] text-slate-400 mt-1">
              <em>Aeroplane Performance Manual</em> — Matriks Runway Condition
              Code (RWYCC 6, 5, 3, 2) dan faktor reduksi batas operasi pada
              permukaan basah/tergenang air.
            </p>
          </div>

          {/* 4. FAA AC 150/5300-13B */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="font-semibold text-amber-300">
              FAA AC 150/5300-13B (Change 1)
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              <em>Airport Design</em> — Konversi arah angin True North (METAR)
              ke Magnetic North sebelum dihitung terhadap magnetic heading
              runway.
            </p>
          </div>

          {/* 5. FAA AC 91-79B */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="font-semibold text-amber-300">FAA AC 91-79B</div>
            <p className="text-[11px] text-slate-400 mt-1">
              <em>Runway Overrun Prevention</em> — Pengetatan batas tailwind dan
              crosswind pada wet/contaminated runway untuk mitigasi risiko
              aquaplaning.
            </p>
          </div>

          {/* 6. FAA-H-8083-25C */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="font-semibold text-amber-300">
              FAA-H-8083-25C (Chapter 11)
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              <em>Pilot&apos;s Handbook of Aeronautical Knowledge</em> —
              Persamaan Pressure Altitude, Density Altitude, dan koreksi ground
              roll (+10% per 1.000 ft DA / Koch Chart).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
