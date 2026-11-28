"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  FileSpreadsheet,
  Plane,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  TrendingUp,
  Clock,
  Copy,
  Check,
  Printer,
  RotateCcw,
  Building2,
  UserCheck,
  Sparkles,
  Wind,
  Thermometer,
  CalendarClock,
  Satellite,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { DAFTAR_STAMET_BANDARA, StametBandara } from "@/utils/stations";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";
type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "SEVERE";
type SynopticCycle = "00" | "06" | "12" | "18";

interface ParsedMetarObs {
  id: string;
  type: "METAR" | "SPECI";
  icao: string;
  timeUtc: string;
  day: number;
  hour: number;
  minute: number;
  sortKey: number;
  raw: string;
  windDir: number | "VRB" | null;
  windSpeedKt: number;
  windGustKt: number | null;
  visibilityM: number;
  weatherCodes: string[];
  clouds: { cover: string; baseFt: number; type: string | null }[];
  ceilingFt: number | null;
  tempC: number | null;
  dewPointC: number | null;
  spreadC: number | null;
  qnhHpa: number | null;
  flightCategory: FlightCategory;
}

interface ParsedTafPeriod {
  id: string;
  changeType: "BASE" | "FM" | "BECMG" | "TEMPO" | "PROB";
  headerLabel: string;
  timeRangeUtc: string;
  rawSegment: string;
  windDir: number | "VRB" | null;
  windSpeedKt: number;
  windGustKt: number | null;
  visibilityM: number;
  weatherCodes: string[];
  clouds: { cover: string; baseFt: number; type: string | null }[];
  ceilingFt: number | null;
  flightCategory: FlightCategory;
  isHazard: boolean;
  hazardReasonsId: string[];
  hazardReasonsEn: string[];
}

interface ParsedTafReport {
  icao: string;
  issueTimeUtc: string;
  validPeriodUtc: string;
  raw: string;
  periods: ParsedTafPeriod[];
}

interface RiskDimension {
  key: string;
  titleId: string;
  titleEn: string;
  level: RiskLevel;
  score: number;
  summaryId: string;
  summaryEn: string;
  operationalImpactId: string;
  operationalImpactEn: string;
}

// ============================================================================
// CONSTANTS (WIND/TEMP LEVELS & CYCLES)
// ============================================================================

const WINDTEMP_LEVELS = [
  { code: "850", label: "FL050 850 hPa" },
  { code: "700", label: "FL100 700 hPa" },
  { code: "600", label: "FL140 600 hPa" },
  { code: "500", label: "FL180 500 hPa" },
  { code: "400", label: "FL240 400 hPa" },
  { code: "300", label: "FL300 300 hPa" },
  { code: "250", label: "FL340 250 hPa" },
  { code: "200", label: "FL390 200 hPa" },
  { code: "150", label: "FL450 150 hPa" },
  { code: "100", label: "FL530 100 hPa" },
];

const PDF_WINDTEMP_LEVELS = WINDTEMP_LEVELS.filter((lvl) =>
  ["850", "700", "600", "500", "400", "300", "250", "200", "150"].includes(
    lvl.code,
  ),
);

const SYNOPTIC_CYCLES: { code: SynopticCycle; label: string }[] = [
  { code: "00", label: "00 UTC" },
  { code: "06", label: "06 UTC" },
  { code: "12", label: "12 UTC" },
  { code: "18", label: "18 UTC" },
];

// ============================================================================
// HELPER FUNCTIONS (ICAO ANNEX 3 PARSING, DATE SYNC & CLASSIFICATION)
// ============================================================================

function findStationByIcao(icaoCode: string): StametBandara | null {
  if (!icaoCode) return null;
  const upper = icaoCode.trim().toUpperCase();
  return (
    DAFTAR_STAMET_BANDARA.find((item) => item.icao.toUpperCase() === upper) ??
    null
  );
}

function getNearestSynopticCycle(hourUtc: number): SynopticCycle {
  if (hourUtc < 6) return "00";
  if (hourUtc < 12) return "06";
  if (hourUtc < 18) return "12";
  return "18";
}

function buildUtcDateStamp(obsDay?: number): string {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let day = now.getUTCDate();

  if (obsDay && obsDay >= 1 && obsDay <= 31) {
    if (obsDay > day + 5) {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
    day = obsDay;
  }

  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}${mm}${dd}`;
}

function classifyFlightCategory(
  visibilityM: number,
  ceilingFt: number | null,
): FlightCategory {
  const ceil = ceilingFt ?? 99999;
  if (visibilityM < 1600 || ceil < 500) return "LIFR";
  if (visibilityM < 5000 || ceil <= 1500) return "IFR";
  if (visibilityM <= 8000 || ceil <= 3000) return "MVFR";
  return "VFR";
}

function getFlightCategoryBadge(cat: FlightCategory): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  switch (cat) {
    case "VFR":
      return {
        label: "VFR (VMC)",
        bg: "bg-emerald-500/20",
        text: "text-emerald-300",
        border: "border-emerald-500/40",
      };
    case "MVFR":
      return {
        label: "MVFR",
        bg: "bg-sky-500/20",
        text: "text-sky-300",
        border: "border-sky-500/40",
      };
    case "IFR":
      return {
        label: "IFR (IMC)",
        bg: "bg-amber-500/20",
        text: "text-amber-300",
        border: "border-amber-500/40",
      };
    case "LIFR":
      return {
        label: "LIFR (LOW IMC)",
        bg: "bg-rose-500/20",
        text: "text-rose-300",
        border: "border-rose-500/40",
      };
  }
}

function getRiskBadge(level: RiskLevel): {
  bg: string;
  text: string;
  border: string;
} {
  switch (level) {
    case "LOW":
      return {
        bg: "bg-emerald-500/15",
        text: "text-emerald-300",
        border: "border-emerald-500/40",
      };
    case "MODERATE":
      return {
        bg: "bg-sky-500/15",
        text: "text-sky-300",
        border: "border-sky-500/40",
      };
    case "HIGH":
      return {
        bg: "bg-amber-500/15",
        text: "text-amber-300",
        border: "border-amber-500/40",
      };
    case "SEVERE":
      return {
        bg: "bg-rose-500/20",
        text: "text-rose-300",
        border: "border-rose-500/50",
      };
  }
}

function parseCloudAndVisibility(segment: string): {
  visibilityM: number;
  clouds: { cover: string; baseFt: number; type: string | null }[];
  ceilingFt: number | null;
  weatherCodes: string[];
} {
  const isCavok = /\bCAVOK\b/.test(segment);

  let visibilityM = 9999;
  if (!isCavok) {
    const stripped = segment
      .replace(/\b\d{6}Z\b/g, "")
      .replace(/\b\d{4}\/\d{4}\b/g, "")
      .replace(/\bFM\d{6}\b/g, "")
      .replace(/\bQ\d{4}\b/g, "")
      .replace(/\bA\d{4}\b/g, "")
      .replace(/\bR\d{2}[LRC]?\/[PM]?\d{4}(?:V[PM]?\d{4})?[UDN]?\b/g, "");

    const visMatch = stripped.match(/\b(\d{4})(?:NDV|[NSEW]{1,2})?\b/);
    if (visMatch) {
      visibilityM = parseInt(visMatch[1], 10);
    }
  }

  const clouds: { cover: string; baseFt: number; type: string | null }[] = [];
  if (!isCavok) {
    const cloudRegex = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/g;
    let m: RegExpExecArray | null;
    while ((m = cloudRegex.exec(segment)) !== null) {
      clouds.push({
        cover: m[1],
        baseFt: parseInt(m[2], 10) * 100,
        type: m[3] ?? null,
      });
    }
  }

  const ceilingLayers = clouds.filter((c) =>
    ["BKN", "OVC", "VV"].includes(c.cover),
  );
  const ceilingFt =
    ceilingLayers.length > 0
      ? Math.min(...ceilingLayers.map((c) => c.baseFt))
      : null;

  const mainBody = segment.split(/\bRMK\b/)[0];
  const weatherCodes =
    mainBody.match(
      /\b(?:\+|-|VC)?(?:TS|SH|FZ)?(?:RA|DZ|SN|SG|IC|PL|GR|GS|BR|FG|FU|VA|DU|SA|HZ|SQ|FC|SS|DS)+\b/g,
    ) || [];

  return { visibilityM, clouds, ceilingFt, weatherCodes };
}

function parseMetarBlock(rawText: string): ParsedMetarObs[] {
  if (!rawText.trim()) return [];

  const normalized = rawText.toUpperCase().replace(/\r\n/g, "\n").trim();

  const rawEntries = normalized
    .split(/=|\n(?=(?:METAR|SPECI|[A-Z]{4}\s+\d{6}Z))/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 10 && !/^TAF\b/.test(s));

  const results: ParsedMetarObs[] = [];

  rawEntries.forEach((entry, index) => {
    const type: "METAR" | "SPECI" = /\bSPECI\b/.test(entry) ? "SPECI" : "METAR";
    const icaoMatch =
      entry.match(/\b(?:METAR|SPECI)(?:\s+COR)?\s+([A-Z]{4})\b/) ||
      entry.match(/^([A-Z]{4})\s+\d{6}Z/);
    const icao = icaoMatch ? icaoMatch[1] : "";

    const timeMatch = entry.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
    const day = timeMatch ? parseInt(timeMatch[1], 10) : 0;
    const hour = timeMatch ? parseInt(timeMatch[2], 10) : index;
    const minute = timeMatch ? parseInt(timeMatch[3], 10) : 0;
    const timeUtc = timeMatch
      ? `${timeMatch[1]}${timeMatch[2]}${timeMatch[3]}Z`
      : `OBS-${index + 1}`;
    const sortKey = day * 1440 + hour * 60 + minute;

    const windMatch = entry.match(
      /\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/,
    );
    const unitFactor = windMatch && windMatch[4] === "MPS" ? 1.94384 : 1;
    const windDir: number | "VRB" | null = !windMatch
      ? null
      : windMatch[1] === "VRB"
        ? "VRB"
        : parseInt(windMatch[1], 10);
    const windSpeedKt = windMatch
      ? Math.round(parseInt(windMatch[2], 10) * unitFactor)
      : 0;
    const windGustKt =
      windMatch && windMatch[3]
        ? Math.round(parseInt(windMatch[3], 10) * unitFactor)
        : null;

    const { visibilityM, clouds, ceilingFt, weatherCodes } =
      parseCloudAndVisibility(entry);

    const tempMatch = entry.match(/\b(M?\d{2})\/(M?\d{2})\b/);
    const tempC = tempMatch
      ? parseInt(tempMatch[1].replace("M", "-"), 10)
      : null;
    const dewPointC = tempMatch
      ? parseInt(tempMatch[2].replace("M", "-"), 10)
      : null;
    const spreadC =
      tempC !== null && dewPointC !== null ? tempC - dewPointC : null;

    const qnhMatch = entry.match(/\bQ(\d{4})\b/);
    const altimMatch = entry.match(/\bA(\d{4})\b/);
    const qnhHpa = qnhMatch
      ? parseInt(qnhMatch[1], 10)
      : altimMatch
        ? Math.round(parseInt(altimMatch[1], 10) * 0.01 * 33.8639)
        : null;

    const flightCategory = classifyFlightCategory(visibilityM, ceilingFt);

    results.push({
      id: `obs-${index}-${timeUtc}`,
      type,
      icao,
      timeUtc,
      day,
      hour,
      minute,
      sortKey,
      raw: entry,
      windDir,
      windSpeedKt,
      windGustKt,
      visibilityM,
      weatherCodes,
      clouds,
      ceilingFt,
      tempC,
      dewPointC,
      spreadC,
      qnhHpa,
      flightCategory,
    });
  });

  return results.sort((a, b) => a.sortKey - b.sortKey);
}

function parseTafMessage(rawText: string): ParsedTafReport | null {
  const clean = rawText
    .toUpperCase()
    .replace(/=/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;

  const icaoMatch =
    clean.match(/\bTAF(?:\s+AMD|\s+COR)?\s+([A-Z]{4})\b/) ||
    clean.match(/\b([W|A|K|E|R|O|Z|V|Y][A-Z]{3})\b/);
  const icao = icaoMatch ? icaoMatch[1] : "";

  const issueMatch = clean.match(/\b(\d{6}Z)\b/);
  const issueTimeUtc = issueMatch ? issueMatch[1] : "—";

  const validMatch = clean.match(/\b(\d{4}\/\d{4})\b/);
  const validPeriodUtc = validMatch ? `${validMatch[1]} UTC` : "—";

  const segmentRegex =
    /(?=\b(?:FM\d{6}|BECMG|TEMPO|PROB[34]0\s+TEMPO|PROB[34]0)\b)/g;
  const segments = clean.split(segmentRegex).filter(Boolean);

  const periods: ParsedTafPeriod[] = segments.map((seg, idx) => {
    let changeType: ParsedTafPeriod["changeType"] = "BASE";
    let headerLabel = "Base Forecast";
    let timeRangeUtc = validPeriodUtc;

    if (idx > 0) {
      const fmMatch = seg.match(/^FM(\d{2})(\d{2})(\d{2})/);
      const becmgMatch = seg.match(/^BECMG\s+(\d{4}\/\d{4})/);
      const tempoMatch = seg.match(/^TEMPO\s+(\d{4}\/\d{4})/);
      const probMatch = seg.match(/^(PROB[34]0(?:\s+TEMPO)?)\s+(\d{4}\/\d{4})/);

      if (fmMatch) {
        changeType = "FM";
        headerLabel = `FM ${fmMatch[2]}:${fmMatch[3]} UTC`;
        timeRangeUtc = `Mulai Tgl ${fmMatch[1]} ${fmMatch[2]}:${fmMatch[3]}Z`;
      } else if (becmgMatch) {
        changeType = "BECMG";
        headerLabel = `BECMG ${becmgMatch[1]}`;
        timeRangeUtc = `${becmgMatch[1]} UTC`;
      } else if (tempoMatch) {
        changeType = "TEMPO";
        headerLabel = `TEMPO ${tempoMatch[1]}`;
        timeRangeUtc = `${tempoMatch[1]} UTC`;
      } else if (probMatch) {
        changeType = "PROB";
        headerLabel = `${probMatch[1]} ${probMatch[2]}`;
        timeRangeUtc = `${probMatch[2]} UTC`;
      }
    }

    const windMatch = seg.match(
      /\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/,
    );
    const unitFactor = windMatch && windMatch[4] === "MPS" ? 1.94384 : 1;
    const windDir: number | "VRB" | null = !windMatch
      ? null
      : windMatch[1] === "VRB"
        ? "VRB"
        : parseInt(windMatch[1], 10);
    const windSpeedKt = windMatch
      ? Math.round(parseInt(windMatch[2], 10) * unitFactor)
      : 0;
    const windGustKt =
      windMatch && windMatch[3]
        ? Math.round(parseInt(windMatch[3], 10) * unitFactor)
        : null;

    const { visibilityM, clouds, ceilingFt, weatherCodes } =
      parseCloudAndVisibility(seg);
    const flightCategory = classifyFlightCategory(visibilityM, ceilingFt);

    const hazardReasonsId: string[] = [];
    const hazardReasonsEn: string[] = [];

    const hasConvective =
      weatherCodes.some((w) => /(TS|SQ)/.test(w)) ||
      clouds.some((c) => c.type === "CB" || c.type === "TCU");
    if (hasConvective) {
      hazardReasonsId.push("Aktivitas Konvektif / Badai Guntur / Awan CB");
      hazardReasonsEn.push("Convective Activity / Thunderstorm / CB Clouds");
    }
    if (visibilityM < 5000) {
      hazardReasonsId.push(`Penurunan Jarak Pandang (${visibilityM} m)`);
      hazardReasonsEn.push(`Reduced Visibility (${visibilityM} m)`);
    }
    if (ceilingFt !== null && ceilingFt <= 1500) {
      hazardReasonsId.push(`Dasar Awan Rendah (${ceilingFt} ft)`);
      hazardReasonsEn.push(`Low Cloud Ceiling (${ceilingFt} ft)`);
    }
    if (windSpeedKt >= 20 || (windGustKt !== null && windGustKt >= 25)) {
      const wStr = `${windSpeedKt}${windGustKt ? `G${windGustKt}` : ""} kt`;
      hazardReasonsId.push(`Angin Permukaan Kencang (${wStr})`);
      hazardReasonsEn.push(`Strong Surface Winds (${wStr})`);
    }
    if (weatherCodes.some((w) => /(\+RA|FG)/.test(w))) {
      hazardReasonsId.push("Hujan Lebat / Kabut");
      hazardReasonsEn.push("Heavy Rain / Fog");
    }

    return {
      id: `taf-period-${idx}`,
      changeType,
      headerLabel,
      timeRangeUtc,
      rawSegment: seg.trim(),
      windDir,
      windSpeedKt,
      windGustKt,
      visibilityM,
      weatherCodes,
      clouds,
      ceilingFt,
      flightCategory,
      isHazard:
        hazardReasonsId.length > 0 ||
        flightCategory === "IFR" ||
        flightCategory === "LIFR",
      hazardReasonsId,
      hazardReasonsEn,
    };
  });

  return {
    icao,
    issueTimeUtc,
    validPeriodUtc,
    raw: clean,
    periods,
  };
}

function describeWeatherCodeId(code: string): string {
  const map: Record<string, string> = {
    TS: "badai guntur (thunderstorm)",
    TSRA: "hujan sedang disertai badai guntur",
    "+TSRA": "hujan lebat disertai badai guntur",
    "-TSRA": "hujan ringan disertai badai guntur",
    VCTS: "aktivitas badai guntur di sekitar area bandara",
    RA: "hujan dengan intensitas sedang",
    "-RA": "hujan dengan intensitas ringan",
    "+RA": "hujan dengan intensitas lebat",
    SHRA: "hujan lokal (shower) intensitas sedang",
    "-SHRA": "hujan lokal (shower) intensitas ringan",
    "+SHRA": "hujan lokal (shower) intensitas lebat",
    DZ: "gerimis intensitas sedang",
    "-DZ": "gerimis intensitas ringan",
    BR: "halimun (mist)",
    FG: "kabut (fog)",
    HZ: "udara kabur (haze)",
    FU: "asap (smoke)",
    SQ: "hembusan angin kencang mendadak (squall)",
  };
  return map[code] ?? code;
}

function describeWeatherCodeEn(code: string): string {
  const map: Record<string, string> = {
    TS: "thunderstorm",
    TSRA: "moderate thunderstorm with rain",
    "+TSRA": "heavy thunderstorm with rain",
    "-TSRA": "light thunderstorm with rain",
    VCTS: "thunderstorm in the vicinity of the aerodrome",
    RA: "moderate rain",
    "-RA": "light rain",
    "+RA": "heavy rain",
    SHRA: "moderate rain showers",
    "-SHRA": "light rain showers",
    "+SHRA": "heavy rain showers",
    DZ: "moderate drizzle",
    "-DZ": "light drizzle",
    BR: "mist",
    FG: "fog",
    HZ: "haze",
    FU: "smoke",
    SQ: "squalls",
  };
  return map[code] ?? code;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============================================================================
// SUB-COMPONENT: FULL-SCALE RESPONSIVE SVG TREND CHART
// ============================================================================

interface TrendPoint {
  label: string;
  value: number | null;
  displayValue: string;
  alert?: boolean;
}

function SvgTrendChart({
  title,
  subBadge,
  latestDisplay,
  latestAlert,
  points,
  strokeColor,
  fillId,
  minOverride,
  icon,
}: {
  title: string;
  subBadge?: string;
  latestDisplay: string;
  latestAlert?: boolean;
  points: TrendPoint[];
  strokeColor: string;
  fillId: string;
  minOverride?: number;
  icon?: React.ReactNode;
}) {
  const svgW = 300;
  const svgH = 165; // <-- Sebelumnya 165
  const padLeft = 20;
  const padRight = 20;
  const padTop = 25; // <-- Sebelumnya 26
  const padBottom = 20; // <-- Sebelumnya 22
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const validPoints = points
    .map((p, idx) => ({ ...p, idx }))
    .filter(
      (p): p is TrendPoint & { idx: number; value: number } => p.value !== null,
    );

  const rawMin =
    validPoints.length > 0 ? Math.min(...validPoints.map((p) => p.value)) : 0;
  const rawMax =
    validPoints.length > 0 ? Math.max(...validPoints.map((p) => p.value)) : 10;

  const minVal =
    minOverride !== undefined ? Math.min(minOverride, rawMin) : rawMin - 0.5;
  const maxVal = rawMax === minVal ? rawMax + 1 : rawMax + 0.5;
  const span = Math.max(1, maxVal - minVal);

  const getX = (index: number) => {
    if (points.length <= 1) return svgW / 2;
    return padLeft + (index / (points.length - 1)) * plotW;
  };

  const getY = (val: number) => {
    const ratio = (val - minVal) / span;
    return padTop + plotH - ratio * plotH;
  };

  const coords = validPoints.map((p) => ({
    ...p,
    x: getX(p.idx),
    y: getY(p.value),
  }));

  const polylineStr = coords
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const baselineY = padTop + plotH;
  const areaStr =
    coords.length > 1
      ? `${coords[0].x.toFixed(1)},${baselineY} ${polylineStr} ${coords[coords.length - 1].x.toFixed(1)},${baselineY}`
      : "";

  const totalPts = points.length;
  const maxLabels = 5;
  const xStep =
    totalPts <= maxLabels ? 1 : Math.ceil((totalPts - 1) / (maxLabels - 1));
  const valStep =
    coords.length <= maxLabels
      ? 1
      : Math.ceil((coords.length - 1) / (maxLabels - 1));

  const showXLabel = (idx: number) => {
    if (totalPts <= maxLabels) return true;
    if (idx === 0 || idx === totalPts - 1) return true;
    return idx % xStep === 0 && totalPts - 1 - idx >= Math.floor(xStep * 0.65);
  };

  const showValLabel = (arrIdx: number, item: (typeof coords)[0]) => {
    if (coords.length <= maxLabels) return true;
    if (arrIdx === 0 || arrIdx === coords.length - 1) return true;
    if (item.alert) return true;
    return (
      arrIdx % valStep === 0 &&
      coords.length - 1 - arrIdx >= Math.floor(valStep * 0.65)
    );
  };

  return (
    <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-1.5 text-[11px]">
        <span className="text-slate-300 font-semibold flex items-center gap-1.5 truncate">
          {icon}
          {title}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {subBadge && (
            <span className="text-[10px] font-mono text-slate-400">
              ({subBadge})
            </span>
          )}
          <span
            className={`font-mono font-bold ${
              latestAlert ? "text-rose-400" : "text-white"
            }`}
          >
            {latestDisplay}
          </span>
        </div>
      </div>

      <div className="w-full bg-slate-900/65 rounded-lg border border-slate-800/80 overflow-hidden">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          className="block w-full h-40 select-none"
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.38" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((g) => {
            const gy = padTop + g * plotH;
            return (
              <line
                key={g}
                x1={padLeft}
                y1={gy}
                x2={svgW - padRight}
                y2={gy}
                stroke="#1e293b"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            );
          })}

          {coords.length > 1 && (
            <polygon points={areaStr} fill={`url(#${fillId})`} />
          )}

          {coords.length > 1 && (
            <polyline
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polylineStr}
            />
          )}

          {coords.map((c, arrIdx) => {
            const visible = showValLabel(arrIdx, c);
            return (
              <g key={c.idx}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={visible ? 4 : 2.5}
                  fill="#020617"
                  stroke={c.alert ? "#fb7185" : strokeColor}
                  strokeWidth="2"
                />
                {visible && (
                  <text
                    x={c.x}
                    y={c.y - 8}
                    textAnchor="middle"
                    fill={c.alert ? "#fda4af" : "#f8fafc"}
                    fontSize="10.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {c.displayValue}
                  </text>
                )}
              </g>
            );
          })}

          {points.map((p, idx) =>
            showXLabel(idx) ? (
              <text
                key={idx}
                x={getX(idx)}
                y={svgH - 5}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="9.5"
                fontFamily="monospace"
              >
                {p.label}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function WeatherBriefTab() {
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  // --- State Input (Netral di Awal) ---
  const [metarInput, setMetarInput] = useState<string>("");
  const [tafInput, setTafInput] = useState<string>("");
  const [forecasterName, setForecasterName] = useState<string>("");
  const [synopticNote, setSynopticNote] = useState<string>("");

  // --- State Kontrol Produk Citra Penerbangan BMKG ---
  const [manualCycle, setManualCycle] = useState<SynopticCycle | "AUTO">(
    "AUTO",
  );
  const [windTempLevel, setWindTempLevel] = useState<string>("850");
  const [activeChartTab, setActiveChartTab] = useState<
    "HIGH_SIGWX" | "MED_SIGWX" | "WIND_TEMP" | "SATELLITE"
  >("HIGH_SIGWX");
  const [imgRefreshKey, setImgRefreshKey] = useState<number>(0);

  // --- State UI Narasi ---
  const [activeLang, setActiveLang] = useState<"ID" | "EN">("ID");
  const [copiedLang, setCopiedLang] = useState<"ID" | "EN" | null>(null);

  // --- Parsing & Analisis Otomatis ---
  const metarList = useMemo(() => parseMetarBlock(metarInput), [metarInput]);
  const tafReport = useMemo(() => parseTafMessage(tafInput), [tafInput]);

  const latestObs =
    metarList.length > 0 ? metarList[metarList.length - 1] : null;
  const firstObs = metarList.length > 0 ? metarList[0] : null;

  // Deteksi Otomatis Bandara & Stamet dari utils/stations.ts
  const detectedIcao = latestObs?.icao || tafReport?.icao || "";
  const stationInfo = useMemo(
    () => findStationByIcao(detectedIcao),
    [detectedIcao],
  );

  // --- Sinkronisasi Tanggal & Jam Siklus UTC untuk Produk Citra BMKG ---
  const chartParams = useMemo(() => {
    const now = new Date();
    const refHour = latestObs ? latestObs.hour : now.getUTCHours();
    const refDay = latestObs && latestObs.day > 0 ? latestObs.day : undefined;
    const dateStamp = buildUtcDateStamp(refDay);
    const activeCycle: SynopticCycle =
      manualCycle === "AUTO" ? getNearestSynopticCycle(refHour) : manualCycle;

    const refreshSuffix = imgRefreshKey > 0 ? `?r=${imgRefreshKey}` : "";

    const highSigwxUrl = `https://web-aviation.bmkg.go.id/model/highsigwx/${dateStamp}_${activeCycle}00_PGGE05_EGRR.png${refreshSuffix}`;
    const medSigwxUrl = `https://web-aviation.bmkg.go.id/storage/photos/2/sigwx_${dateStamp}${activeCycle}00.png${refreshSuffix}`;
    const windTempUrl = `https://web-aviation.bmkg.go.id/model/windtemp/${windTempLevel}_${activeCycle}.png${refreshSuffix}`;
    const satelliteUrl = `https://inderaja.bmkg.go.id/IMAGE/HIMA/H08_EH_Indonesia.png${refreshSuffix}`;

    const allWindTempCharts = PDF_WINDTEMP_LEVELS.map((lvl) => ({
      code: lvl.code,
      label: lvl.label,
      url: `https://web-aviation.bmkg.go.id/model/windtemp/${lvl.code}_${activeCycle}.png${refreshSuffix}`,
    }));

    const selectedLevelObj = WINDTEMP_LEVELS.find(
      (l) => l.code === windTempLevel,
    );

    return {
      dateStamp,
      activeCycle,
      highSigwxUrl,
      medSigwxUrl,
      windTempUrl,
      satelliteUrl,
      allWindTempCharts,
      selectedLevelLabel:
        selectedLevelObj?.label ?? `FL (${windTempLevel} hPa)`,
    };
  }, [latestObs, manualCycle, windTempLevel, imgRefreshKey]);

  // --- Statistik & Tren Antar-Observasi METAR/SPECI ---
  const trendStats = useMemo(() => {
    const qnhValues = metarList
      .map((m) => m.qnhHpa)
      .filter((v): v is number => v !== null);
    const tempValues = metarList
      .map((m) => m.tempC)
      .filter((v): v is number => v !== null);
    const windValues = metarList.map((m) => m.windGustKt ?? m.windSpeedKt);

    const qnhMin = qnhValues.length > 0 ? Math.min(...qnhValues) : null;
    const qnhMax = qnhValues.length > 0 ? Math.max(...qnhValues) : null;
    const qnhDelta =
      metarList.length >= 2 &&
      firstObs?.qnhHpa !== null &&
      latestObs?.qnhHpa !== null &&
      firstObs?.qnhHpa !== undefined &&
      latestObs?.qnhHpa !== undefined
        ? latestObs.qnhHpa - firstObs.qnhHpa
        : null;

    const tempMin = tempValues.length > 0 ? Math.min(...tempValues) : null;
    const tempMax = tempValues.length > 0 ? Math.max(...tempValues) : null;
    const windMax = windValues.length > 0 ? Math.max(...windValues) : null;

    return {
      qnhMin,
      qnhMax,
      qnhDelta,
      tempMin,
      tempMax,
      windMax,
    };
  }, [metarList, firstObs, latestObs]);

  // --- Aerodrome Operational Risk Matrix ---
  const riskMatrix = useMemo<{
    overallLevel: RiskLevel;
    dimensions: RiskDimension[];
  }>(() => {
    const allWx = [
      ...(latestObs?.weatherCodes ?? []),
      ...(tafReport?.periods.flatMap((p) => p.weatherCodes) ?? []),
    ];
    const allClouds = [
      ...(latestObs?.clouds ?? []),
      ...(tafReport?.periods.flatMap((p) => p.clouds) ?? []),
    ];

    const hasTsOrSq = allWx.some((w) => /(TS|SQ)/.test(w));
    const hasCbOrTcu = allClouds.some(
      (c) => c.type === "CB" || c.type === "TCU",
    );
    const convLevel: RiskLevel = hasTsOrSq
      ? "SEVERE"
      : hasCbOrTcu
        ? "HIGH"
        : "LOW";
    const convDim: RiskDimension = {
      key: "convection",
      titleId: "Konveksi (CB / TS / SQ)",
      titleEn: "Convection (CB / TS / SQ)",
      level: convLevel,
      score: convLevel === "SEVERE" ? 4 : convLevel === "HIGH" ? 3 : 1,
      summaryId: hasTsOrSq
        ? "Terdeteksi badai guntur (TS) pada observasi maupun periode prakiraan TAF."
        : hasCbOrTcu
          ? "Terdeteksi pertumbuhan awan Cumulonimbus (CB) atau Towering Cumulus (TCU)."
          : "Tidak terdeteksi aktivitas awan konvektif signifikan.",
      summaryEn: hasTsOrSq
        ? "Active thunderstorm (TS) or squall activity detected in current observation or TAF periods."
        : hasCbOrTcu
          ? "Cumulonimbus (CB) or Towering Cumulus (TCU) development detected."
          : "No significant convective cloud activity detected.",
      operationalImpactId:
        convLevel === "SEVERE"
          ? "Berpotensi memicu holding, go-around, pengalihan pendaratan (divert), serta penghentian sementara layanan ground handling di apron."
          : convLevel === "HIGH"
            ? "Waspada potensi geser angin (wind shear), arus turun (downdraft), dan perubahan arah angin mendadak di sekitar jalur pendekatan."
            : "Operasi pendekatan, pendaratan, dan lepas landas berjalan normal.",
      operationalImpactEn:
        convLevel === "SEVERE"
          ? "High potential for airborne holding, go-arounds, flight diversions, and temporary suspension of apron ground handling."
          : convLevel === "HIGH"
            ? "Exercise caution for low-level wind shear, downdrafts, and sudden wind shifts along approach and departure paths."
            : "Normal approach, landing, and takeoff operations expected.",
    };

    const worstCat: FlightCategory = latestObs?.flightCategory ?? "VFR";
    const visLevel: RiskLevel =
      worstCat === "LIFR"
        ? "SEVERE"
        : worstCat === "IFR"
          ? "HIGH"
          : worstCat === "MVFR"
            ? "MODERATE"
            : "LOW";
    const visDim: RiskDimension = {
      key: "visibility",
      titleId: "Visibilitas & Ceiling",
      titleEn: "Visibility & Cloud Ceiling",
      level: visLevel,
      score:
        visLevel === "SEVERE"
          ? 4
          : visLevel === "HIGH"
            ? 3
            : visLevel === "MODERATE"
              ? 2
              : 1,
      summaryId: latestObs
        ? `Kategori penerbangan aktual ${worstCat} (jarak pandang ${latestObs.visibilityM >= 9999 ? "≥ 10 km" : `${latestObs.visibilityM.toLocaleString()} m`}${latestObs.ceilingFt !== null ? `, ceiling ${latestObs.ceilingFt.toLocaleString()} ft` : ", tanpa ceiling rendah"}).`
        : "Menunggu input data pengamatan METAR/SPECI.",
      summaryEn: latestObs
        ? `Current flight category ${worstCat} (prevailing visibility ${latestObs.visibilityM >= 9999 ? "10 km or more" : `${latestObs.visibilityM} m`}${latestObs.ceilingFt !== null ? `, ceiling ${latestObs.ceilingFt} ft` : ", no low ceiling"}).`
        : "Awaiting METAR/SPECI surface observation input.",
      operationalImpactId:
        visLevel === "SEVERE" || visLevel === "HIGH"
          ? "Kondisi cuaca instrumen (IMC); operasi penerbangan wajib mengacu pada prosedur pendekatan instrumen (ILS/RNP) dan minima bandara."
          : visLevel === "MODERATE"
            ? "Jarak pandang atau ketinggian dasar awan berada pada batas marginal; awak pesawat perlu memantau minima visual."
            : "Kondisi meteorologi visual (VMC) optimal untuk seluruh fase penerbangan.",
      operationalImpactEn:
        visLevel === "SEVERE" || visLevel === "HIGH"
          ? "Instrument Meteorological Conditions (IMC) prevail; instrument approach procedures and strict aerodrome operating minima apply."
          : visLevel === "MODERATE"
            ? "Marginal visual conditions; aircrew should monitor aerodrome visual operating minima."
            : "Optimal Visual Meteorological Conditions (VMC) for all flight phases.",
    };

    const maxSpd = Math.max(
      latestObs?.windSpeedKt ?? 0,
      ...(tafReport?.periods.map((p) => p.windSpeedKt) ?? [0]),
    );
    const maxGust = Math.max(
      latestObs?.windGustKt ?? 0,
      ...(tafReport?.periods.map((p) => p.windGustKt ?? 0) ?? [0]),
    );
    const windLevel: RiskLevel =
      maxGust >= 30 || maxSpd >= 25
        ? "SEVERE"
        : maxGust >= 20 || maxSpd >= 18
          ? "HIGH"
          : maxSpd >= 12 || latestObs?.windDir === "VRB"
            ? "MODERATE"
            : "LOW";
    const windDim: RiskDimension = {
      key: "wind",
      titleId: "Angin Permukaan & Gust",
      titleEn: "Surface Wind & Gusts",
      level: windLevel,
      score:
        windLevel === "SEVERE"
          ? 4
          : windLevel === "HIGH"
            ? 3
            : windLevel === "MODERATE"
              ? 2
              : 1,
      summaryId:
        maxGust > 0
          ? `Kecepatan angin permukaan mencapai ${maxSpd} kt dengan hembusan maksimum (gust) hingga ${maxGust} kt.`
          : `Kecepatan angin permukaan maksimum ${maxSpd} kt${latestObs?.windDir === "VRB" ? " dengan arah berubah-ubah (VRB)" : ""}.`,
      summaryEn:
        maxGust > 0
          ? `Surface wind speed reaches ${maxSpd} kt with peak gusts up to ${maxGust} kt.`
          : `Maximum surface wind speed ${maxSpd} kt${latestObs?.windDir === "VRB" ? " with variable direction (VRB)" : ""}.`,
      operationalImpactId:
        windLevel === "SEVERE" || windLevel === "HIGH"
          ? "Komponen crosswind atau tailwind berpotensi melampaui batas operasional pesawat ringan hingga menengah; perlu evaluasi arah landasan aktif."
          : windLevel === "MODERATE"
            ? "Diperlukan pemantauan komponen angin samping (crosswind) saat fase pendaratan dan lepas landas."
            : "Kecepatan angin permukaan berada dalam batas aman operasional.",
      operationalImpactEn:
        windLevel === "SEVERE" || windLevel === "HIGH"
          ? "Crosswind or tailwind components may exceed limits for light-to-medium aircraft; evaluate active runway selection."
          : windLevel === "MODERATE"
            ? "Monitor crosswind components during takeoff and landing roll."
            : "Surface winds remain well within safe operational limits.",
    };

    const spread = latestObs?.spreadC ?? null;
    const hasFogOrMist = allWx.some((w) => /(FG|BR)/.test(w));
    const fogLevel: RiskLevel =
      hasFogOrMist || (spread !== null && spread <= 1)
        ? "HIGH"
        : spread !== null && spread <= 2
          ? "MODERATE"
          : "LOW";
    const fogDim: RiskDimension = {
      key: "fog",
      titleId: "Stabilitas & Potensi Kabut",
      titleEn: "Thermal Stability & Fog Potential",
      level: fogLevel,
      score: fogLevel === "HIGH" ? 3 : fogLevel === "MODERATE" ? 2 : 1,
      summaryId:
        spread !== null
          ? `Selisih suhu dan titik embun (T − Td) tercatat ${spread}°C${hasFogOrMist ? " disertai fenomena kabut/halimun" : ""}.`
          : "Data suhu udara dan titik embun belum tersedia.",
      summaryEn:
        spread !== null
          ? `Temperature–dew point spread (T − Td) is ${spread}°C${hasFogOrMist ? " accompanied by mist/fog" : ""}.`
          : "Temperature and dew point data unavailable.",
      operationalImpactId:
        fogLevel === "HIGH"
          ? "Tingkat kejenuhan udara sangat tinggi; berisiko menurunkan jarak pandang landasan secara cepat akibat kabut atau halimun tebal."
          : fogLevel === "MODERATE"
            ? "Massa udara mendekati titik jenuh; perlu kewaspadaan terhadap pembentukan kabut radiasi pada dini hingga pagi hari."
            : "Massa udara permukaan relatif tidak jenuh sehingga potensi pembentukan kabut rendah.",
      operationalImpactEn:
        fogLevel === "HIGH"
          ? "Near-saturated surface air poses a high risk of rapid visibility reduction due to fog or thick mist."
          : fogLevel === "MODERATE"
            ? "Air mass approaching saturation; monitor for radiation fog formation during late night and early morning hours."
            : "Surface air mass remains unsaturated with low fog formation potential.",
    };

    const dimensions = [convDim, visDim, windDim, fogDim];
    const maxScore = Math.max(...dimensions.map((d) => d.score));
    const overallLevel: RiskLevel =
      maxScore >= 4
        ? "SEVERE"
        : maxScore === 3
          ? "HIGH"
          : maxScore === 2
            ? "MODERATE"
            : "LOW";

    return { overallLevel, dimensions };
  }, [latestObs, tafReport]);

  // --- Narasi Briefing Lengkap Bahasa Indonesia & Bahasa Inggris ---
  const briefingTexts = useMemo(() => {
    const airportNameId = stationInfo
      ? `Bandar Udara ${stationInfo.bandar_udara} (${stationInfo.icao})`
      : detectedIcao
        ? `Bandar Udara (${detectedIcao})`
        : "Bandar Udara [Kode ICAO]";
    const airportNameEn = stationInfo
      ? `${stationInfo.bandar_udara} Airport (${stationInfo.icao})`
      : detectedIcao
        ? `Aerodrome (${detectedIcao})`
        : "Aerodrome [ICAO Code]";

    const stametNameId = stationInfo
      ? `Stasiun Meteorologi ${stationInfo.stasiun_meteorologi}`
      : "Stasiun Meteorologi Penerbangan";
    const stametNameEn = stationInfo
      ? `${stationInfo.stasiun_meteorologi} Meteorological Station`
      : "Aviation Meteorological Station";

    const obsTime = latestObs ? `${latestObs.timeUtc} (UTC)` : "—";
    const catCode = latestObs?.flightCategory ?? "—";

    let currentObsId =
      "Belum terdapat data pengamatan METAR atau SPECI yang dimasukkan ke dalam sistem.";
    if (latestObs) {
      const wxId =
        latestObs.weatherCodes.length > 0
          ? `teramati fenomena ${latestObs.weatherCodes.map(describeWeatherCodeId).join(" serta ")}`
          : "tidak teramati adanya fenomena cuaca signifikan (kondisi cerah hingga berawan)";
      const visId =
        latestObs.visibilityM >= 9999
          ? "10 kilometer atau lebih"
          : `${latestObs.visibilityM.toLocaleString()} meter`;
      const windId =
        latestObs.windSpeedKt === 0
          ? "Angin permukaan berada dalam kondisi tenang (calm)."
          : `Angin permukaan bertiup dari ${
              latestObs.windDir === "VRB"
                ? "arah yang berubah-ubah (variable)"
                : `arah ${String(latestObs.windDir).padStart(3, "0")}°`
            } dengan kecepatan ${latestObs.windSpeedKt} knot${
              latestObs.windGustKt
                ? ` disertai hembusan maksimum (gust) hingga ${latestObs.windGustKt} knot`
                : ""
            }.`;
      const cloudId =
        latestObs.clouds.length > 0
          ? `Kondisi perawanan terdiri atas lapisan ${latestObs.clouds
              .map(
                (c) =>
                  `${c.cover} pada ketinggian dasar awan ${c.baseFt.toLocaleString()} kaki${
                    c.type ? ` (jenis awan ${c.type})` : ""
                  }`,
              )
              .join(", ")}.`
          : "Tidak terdeteksi adanya lapisan awan rendah yang signifikan di atas area bandara.";
      const thermoId =
        latestObs.tempC !== null && latestObs.dewPointC !== null
          ? `Suhu udara permukaan tercatat sebesar ${latestObs.tempC}°C dengan titik embun ${latestObs.dewPointC}°C (selisih suhu dan titik embun sebesar ${latestObs.spreadC}°C), sedangkan tekanan udara QNH berada pada nilai ${latestObs.qnhHpa ?? "—"} hPa.`
          : `Tekanan udara QNH tercatat pada nilai ${latestObs.qnhHpa ?? "—"} hPa.`;

      currentObsId = `Berdasarkan laporan pengamatan cuaca permukaan terakhir pada pukul ${obsTime}, kondisi cuaca di ${airportNameId} ${wxId} dengan jarak pandang mendatar (prevailing visibility) mencapai ${visId}. ${windId} ${cloudId} ${thermoId} Secara keseluruhan, status operasi penerbangan aktual berada pada kategori ${catCode}.`;
    }

    let trendNarrativeId =
      "Evaluasi tren perubahan parameter cuaca memerlukan minimal dua data pengamatan METAR/SPECI yang berurutan.";
    if (metarList.length >= 2 && firstObs && latestObs) {
      const spanText = `Selama rentang pengamatan dari pukul ${firstObs.timeUtc} hingga ${latestObs.timeUtc}`;
      const qnhPart =
        trendStats.qnhDelta !== null
          ? trendStats.qnhDelta <= -2
            ? `tekanan udara QNH mengalami penurunan cukup tajam sebesar ${Math.abs(trendStats.qnhDelta)} hPa (dari ${firstObs.qnhHpa} hPa menjadi ${latestObs.qnhHpa} hPa), yang mengindikasikan meningkatnya ketidakstabilan massa udara dan potensi pertumbuhan awan konvektif`
            : trendStats.qnhDelta >= 2
              ? `tekanan udara QNH mengalami peningkatan sebesar +${trendStats.qnhDelta} hPa (dari ${firstObs.qnhHpa} hPa menjadi ${latestObs.qnhHpa} hPa), yang mencerminkan kondisi atmosfer cenderung lebih stabil`
              : `tekanan udara QNH bergerak relatif stabil di kisaran ${trendStats.qnhMin}–${trendStats.qnhMax} hPa (selisih bersih ${trendStats.qnhDelta >= 0 ? `+${trendStats.qnhDelta}` : trendStats.qnhDelta} hPa)`
          : "data tekanan udara QNH tidak lengkap untuk perbandingan tren";

      const spreadPart =
        latestObs.spreadC !== null
          ? latestObs.spreadC <= 2
            ? `Selain itu, selisih suhu dan titik embun (T − Td) menyempit hingga ${latestObs.spreadC}°C sehingga perlu diwaspadai potensi terbentuknya halimun (BR) atau kabut (FG) yang dapat menurunkan jarak pandang secara tiba-tiba.`
            : `Sementara itu, selisih suhu dan titik embun (T − Td) berada pada nilai ${latestObs.spreadC}°C yang menunjukkan kondisi udara permukaan masih cukup jauh dari titik jenuh.`
          : "";

      trendNarrativeId = `${spanText}, ${qnhPart}. Kecepatan angin maksimum yang tercatat selama periode pengamatan ini mencapai ${trendStats.windMax ?? 0} knot${
        trendStats.tempMin !== null && trendStats.tempMax !== null
          ? ` dengan variasi suhu udara permukaan berkisar antara ${trendStats.tempMin}°C hingga ${trendStats.tempMax}°C`
          : ""
      }. ${spreadPart}`;
    }

    let tafNarrativeId =
      "Data prakiraan cuaca bandara (TAF) belum dimasukkan sehingga analisis prospek cuaca ke depan belum dapat ditampilkan.";
    if (tafReport) {
      const periodLines = tafReport.periods.map((p, idx) => {
        const wStr =
          p.windDir === null
            ? "angin mengikuti periode sebelumnya"
            : p.windSpeedKt === 0
              ? "angin tenang (calm)"
              : `angin dari ${
                  p.windDir === "VRB"
                    ? "arah berubah-ubah"
                    : `arah ${String(p.windDir).padStart(3, "0")}°`
                } dengan kecepatan ${p.windSpeedKt} knot${
                  p.windGustKt ? ` (gust ${p.windGustKt} knot)` : ""
                }`;
        const vStr =
          p.visibilityM >= 9999
            ? "jarak pandang 10 km atau lebih"
            : `jarak pandang ${p.visibilityM.toLocaleString()} meter`;
        const wxStr =
          p.weatherCodes.length > 0
            ? `disertai ${p.weatherCodes.map(describeWeatherCodeId).join(", ")}`
            : "tanpa fenomena cuaca signifikan";
        const cldStr =
          p.clouds.length > 0
            ? `perawanan ${p.clouds
                .map(
                  (c) =>
                    `${c.cover} ${c.baseFt.toLocaleString()} ft${
                      c.type ? ` (${c.type})` : ""
                    }`,
                )
                .join(", ")}`
            : "tanpa awan rendah signifikan";
        const hazardNote = p.isHazard
          ? ` [PERHATIAN OPERASIONAL: ${p.hazardReasonsId.join("; ")}]`
          : " [Kondisi kondusif / VFR]";

        return `   ${idx + 1}) ${p.headerLabel} (${p.timeRangeUtc}): Diprakirakan ${wStr}, ${vStr}, ${wxStr}, serta ${cldStr} (Kategori ${p.flightCategory}).${hazardNote}`;
      });

      tafNarrativeId =
        `Berdasarkan Terminal Aerodrome Forecast (TAF) yang diterbitkan pada pukul ${tafReport.issueTimeUtc} dengan masa berlaku ${tafReport.validPeriodUtc}, evolusi kondisi cuaca diprakirakan sebagai berikut:\n` +
        periodLines.join("\n");
    }

    const synopticBlockId = synopticNote.trim()
      ? `\n\n4. Analisis Sinoptik & Penginderaan Jauh (SIGWX / Wind-Temp / Satelit):\n${synopticNote.trim()}`
      : "";

    const fullId =
      `WEATHER BRIEFING — ${airportNameId.toUpperCase()}\n` +
      `Unit Pelayanan: ${stametNameId}\n` +
      `Waktu Observasi Terakhir: ${obsTime} | Kategori Operasi Aktual: ${catCode} | Tingkat Risiko Operasional: ${riskMatrix.overallLevel}\n\n` +
      `1. Kondisi Cuaca Permukaan Terkini (METAR/SPECI):\n${currentObsId}\n\n` +
      `2. Analisis Tren & Evolusi Parameter Meteorologi:\n${trendNarrativeId}\n\n` +
      `3. Prospek Prakiraan Cuaca Bandara (TAF):\n${tafNarrativeId}` +
      synopticBlockId +
      `\n\nDisusun oleh: ${forecasterName.trim() || "Forecaster on Duty"} | ${stametNameId}`;

    // ========================================================================
    // ENGLISH AVIATION BRIEFING (PURE STANDARD ICAO PHRASEOLOGY)
    // ========================================================================
    let currentObsEn =
      "No METAR or SPECI surface observation reports have been entered into the system.";
    if (latestObs) {
      const wxEn =
        latestObs.weatherCodes.length > 0
          ? `reports ${latestObs.weatherCodes.map(describeWeatherCodeEn).join(" and ")}`
          : "indicates no significant weather phenomena";
      const visEn =
        latestObs.visibilityM >= 9999
          ? "10 kilometers or more"
          : `${latestObs.visibilityM} meters`;
      const windEn =
        latestObs.windSpeedKt === 0
          ? "Surface wind is calm."
          : `Surface wind is from ${
              latestObs.windDir === "VRB"
                ? "variable directions"
                : `${String(latestObs.windDir).padStart(3, "0")} degrees`
            } at ${latestObs.windSpeedKt} knots${
              latestObs.windGustKt
                ? `, gusting up to ${latestObs.windGustKt} knots`
                : ""
            }.`;
      const cloudEn =
        latestObs.clouds.length > 0
          ? `Cloud layers consist of ${latestObs.clouds
              .map(
                (c) =>
                  `${c.cover} at ${c.baseFt} feet${
                    c.type ? ` (${c.type})` : ""
                  }`,
              )
              .join(", ")}.`
          : "No significant low-level cloud layers are reported over the aerodrome.";
      const thermoEn =
        latestObs.tempC !== null && latestObs.dewPointC !== null
          ? `Ambient air temperature is ${latestObs.tempC}°C with a dew point of ${latestObs.dewPointC}°C (temperature–dew point spread of ${latestObs.spreadC}°C), and QNH altimeter setting is ${latestObs.qnhHpa ?? "—"} hPa.`
          : `QNH altimeter setting is ${latestObs.qnhHpa ?? "—"} hPa.`;

      currentObsEn = `According to the latest surface meteorological observation at ${obsTime}, ${airportNameEn} ${wxEn} with prevailing horizontal visibility of ${visEn}. ${windEn} ${cloudEn} ${thermoEn} Current aerodrome operating conditions correspond to ${catCode} flight category.`;
    }

    let trendNarrativeEn =
      "Meteorological parameter trend evaluation requires at least two consecutive METAR or SPECI observations.";
    if (metarList.length >= 2 && firstObs && latestObs) {
      const spanEn = `Over the observation sequence from ${firstObs.timeUtc} to ${latestObs.timeUtc}`;
      const qnhPartEn =
        trendStats.qnhDelta !== null
          ? trendStats.qnhDelta <= -2
            ? `QNH atmospheric pressure exhibited a notable falling trend of ${Math.abs(trendStats.qnhDelta)} hPa (from ${firstObs.qnhHpa} hPa to ${latestObs.qnhHpa} hPa), indicating increasing atmospheric instability and enhanced convective potential`
            : trendStats.qnhDelta >= 2
              ? `QNH atmospheric pressure rose by +${trendStats.qnhDelta} hPa (from ${firstObs.qnhHpa} hPa to ${latestObs.qnhHpa} hPa), reflecting gradually stabilizing atmospheric conditions`
              : `QNH atmospheric pressure remained relatively steady between ${trendStats.qnhMin} and ${trendStats.qnhMax} hPa (net change ${trendStats.qnhDelta >= 0 ? `+${trendStats.qnhDelta}` : trendStats.qnhDelta} hPa)`
          : "QNH pressure readings were incomplete for trend comparison";

      const spreadPartEn =
        latestObs.spreadC !== null
          ? latestObs.spreadC <= 2
            ? `Furthermore, the temperature–dew point spread narrowed to ${latestObs.spreadC}°C, signaling elevated potential for mist (BR) or fog (FG) development that may rapidly degrade runway visibility.`
            : `Meanwhile, the temperature–dew point spread stands at ${latestObs.spreadC}°C, indicating that surface air remains sufficiently unsaturated with low fog risk.`
          : "";

      trendNarrativeEn = `${spanEn}, ${qnhPartEn}. Peak surface wind speed recorded during this period reached ${trendStats.windMax ?? 0} knots${
        trendStats.tempMin !== null && trendStats.tempMax !== null
          ? `, while surface air temperature ranged between ${trendStats.tempMin}°C and ${trendStats.tempMax}°C`
          : ""
      }. ${spreadPartEn}`;
    }

    let tafNarrativeEn =
      "Terminal Aerodrome Forecast (TAF) data has not been provided; therefore, the forward forecast outlook cannot be generated.";
    if (tafReport) {
      const periodLinesEn = tafReport.periods.map((p, idx) => {
        const wStrEn =
          p.windDir === null
            ? "winds continuing from the preceding period"
            : p.windSpeedKt === 0
              ? "calm surface winds"
              : `surface winds from ${
                  p.windDir === "VRB"
                    ? "variable directions"
                    : `${String(p.windDir).padStart(3, "0")} degrees`
                } at ${p.windSpeedKt} knots${
                  p.windGustKt ? ` (gusting ${p.windGustKt} knots)` : ""
                }`;
        const vStrEn =
          p.visibilityM >= 9999
            ? "prevailing visibility 10 km or more"
            : `prevailing visibility ${p.visibilityM} meters`;
        const wxStrEn =
          p.weatherCodes.length > 0
            ? `accompanied by ${p.weatherCodes.map(describeWeatherCodeEn).join(", ")}`
            : "no significant weather";
        const cldStrEn =
          p.clouds.length > 0
            ? `clouds ${p.clouds
                .map(
                  (c) =>
                    `${c.cover} at ${c.baseFt} ft${
                      c.type ? ` (${c.type})` : ""
                    }`,
                )
                .join(", ")}`
            : "no significant low clouds";
        const hazardNoteEn = p.isHazard
          ? ` [OPERATIONAL ALERT: ${p.hazardReasonsEn.join("; ")}]`
          : " [Favorable / VFR conditions]";

        return `   ${idx + 1}) ${p.headerLabel}: Forecast ${wStrEn}, ${vStrEn}, ${wxStrEn}, and ${cldStrEn} (${p.flightCategory} category).${hazardNoteEn}`;
      });

      tafNarrativeEn =
        `Based on the Terminal Aerodrome Forecast (TAF) issued at ${tafReport.issueTimeUtc} for the validity period ${tafReport.validPeriodUtc}, expected weather evolution is detailed below:\n` +
        periodLinesEn.join("\n");
    }

    const synopticBlockEn = synopticNote.trim()
      ? `\n\n4. Synoptic & Remote Sensing Remarks (SIGWX / Wind-Temp / Satellite):\n${synopticNote.trim()}`
      : "";

    const fullEn =
      `WEATHER BRIEFING — ${airportNameEn.toUpperCase()}\n` +
      `Issuing Office: ${stametNameEn}\n` +
      `Latest Observation: ${obsTime} | Flight Category: ${catCode} | Operational Risk Level: ${riskMatrix.overallLevel}\n\n` +
      `1. Current Aerodrome Surface Conditions (METAR/SPECI):\n${currentObsEn}\n\n` +
      `2. Meteorological Trend & Parameter Evolution:\n${trendNarrativeEn}\n\n` +
      `3. Terminal Aerodrome Forecast Outlook (TAF):\n${tafNarrativeEn}` +
      synopticBlockEn +
      `\n\nPrepared by: ${forecasterName.trim() || "Forecaster on Duty"} | ${stametNameEn}`;

    return {
      ID: fullId,
      EN: fullEn,
    };
  }, [
    stationInfo,
    detectedIcao,
    latestObs,
    firstObs,
    metarList,
    trendStats,
    tafReport,
    riskMatrix,
    synopticNote,
    forecasterName,
  ]);

  const handleCopyText = async (lang: "ID" | "EN") => {
    try {
      await navigator.clipboard.writeText(briefingTexts[lang]);
      setCopiedLang(lang);
      setTimeout(() => setCopiedLang(null), 2000);
    } catch {
      // Fallback jika clipboard API dibatasi
    }
  };

  // --- Cetak / Simpan PDF via Hidden Iframe (Tanpa about:blank & Tanpa Print Ganda) ---
  const handlePrintBrief = () => {
    const iframe = printFrameRef.current;
    if (!iframe || !iframe.contentWindow) return;

    const stametLine = stationInfo
      ? `Stasiun Meteorologi ${escapeHtml(stationInfo.stasiun_meteorologi)}`
      : "Stasiun Meteorologi Penerbangan";
    const airportLine = stationInfo
      ? `Bandar Udara ${escapeHtml(stationInfo.bandar_udara)} (${escapeHtml(stationInfo.icao)}) • Referensi Waktu UTC`
      : `Kode ICAO: ${escapeHtml(detectedIcao || "—")} • Referensi Waktu UTC`;

    const metarRowsHtml =
      metarList.length === 0
        ? `<tr><td colspan="6" style="text-align:center;color:#64748b;">Tidak ada data METAR/SPECI yang diinput.</td></tr>`
        : metarList
            .map((obs) => {
              const wDir =
                obs.windDir === "VRB"
                  ? "VRB"
                  : obs.windDir !== null
                    ? `${String(obs.windDir).padStart(3, "0")}°`
                    : "—";
              const wStr = `${wDir}/${obs.windSpeedKt}${obs.windGustKt ? `G${obs.windGustKt}` : ""} kt`;
              const vStr =
                obs.visibilityM >= 9999 ? "≥ 10 km" : `${obs.visibilityM} m`;
              const tStr =
                obs.tempC !== null && obs.dewPointC !== null
                  ? `${obs.tempC}°C / ${obs.dewPointC}°C`
                  : "—";
              const qStr = obs.qnhHpa ? `${obs.qnhHpa} hPa` : "—";
              return `<tr>
                <td class="mono">${escapeHtml(obs.timeUtc)}</td>
                <td><strong>${escapeHtml(obs.flightCategory)}</strong></td>
                <td class="mono">${escapeHtml(wStr)}</td>
                <td>${escapeHtml(vStr)}</td>
                <td class="mono">${escapeHtml(tStr)}</td>
                <td class="mono">${escapeHtml(qStr)}</td>
              </tr>`;
            })
            .join("");

    const riskRowsHtml = riskMatrix.dimensions
      .map((dim) => {
        const title = activeLang === "ID" ? dim.titleId : dim.titleEn;
        const summary = activeLang === "ID" ? dim.summaryId : dim.summaryEn;
        const impact =
          activeLang === "ID"
            ? `Dampak: ${dim.operationalImpactId}`
            : `Impact: ${dim.operationalImpactEn}`;
        return `<tr>
          <td><strong>${escapeHtml(title)}</strong></td>
          <td style="text-align:center;"><strong>${escapeHtml(dim.level)}</strong></td>
          <td>
            <div>${escapeHtml(summary)}</div>
            <div style="color:#475569;font-style:italic;margin-top:2px;">${escapeHtml(impact)}</div>
          </td>
        </tr>`;
      })
      .join("");

    const windTempCardsHtml = chartParams.allWindTempCharts
      .map(
        (wt) => `
        <div class="wt-card">
          <div class="img-title">${escapeHtml(wt.label)} (${chartParams.activeCycle} UTC)</div>
          <img src="${wt.url}" alt="${escapeHtml(wt.label)}" />
        </div>`,
      )
      .join("");

    const fodDisplayName = forecasterName.trim() || "Forecaster on Duty";

    const htmlDoc = `<!DOCTYPE html>
<html lang="${activeLang === "ID" ? "id" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>WEATHER BRIEFING</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 10.5px;
      line-height: 1.45;
    }
    .doc-banner {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      color: #ffffff;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .doc-title {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 0.6px;
      color: #ffffff;
    }
    .doc-sub {
      font-size: 11px;
      font-weight: 700;
      color: #dbeafe;
      margin-top: 2px;
    }
    .doc-meta {
      font-size: 10px;
      color: #eff6ff;
      margin-top: 2px;
    }
    .doc-right {
      text-align: right;
      font-size: 10.5px;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.14);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      padding: 6px 10px;
    }
    .section {
      margin-bottom: 14px;
    }
    .sec-title {
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-left: 4px solid #1d4ed8;
      padding: 5px 8px;
      margin-bottom: 8px;
      color: #1e3a8a;
    }
    .narrative-box {
      white-space: pre-wrap;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      line-height: 1.5;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px;
      margin: 0;
      background: #ffffff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 7px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f1f5f9;
      font-weight: 700;
      color: #0f172a;
    }
    .mono {
      font-family: "Courier New", Courier, monospace;
    }
    .raw-box {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 10px;
      font-family: "Courier New", Courier, monospace;
      font-size: 9.5px;
      white-space: pre-wrap;
    }
    .page-break {
      page-break-before: always;
      break-before: page;
    }
    .no-break {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sigwx-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .img-card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 6px;
      background: #ffffff;
    }
    .img-card.full {
      grid-column: span 2;
    }
    .img-title {
      font-size: 9.5px;
      font-weight: 700;
      margin-bottom: 4px;
      color: #0f172a;
    }
    .img-card img {
      width: 100%;
      height: 215px;
      object-fit: contain;
      display: block;
      background: #f8fafc;
    }
    .img-card.full img {
      height: 245px;
    }
    .wt-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .wt-card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 5px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .wt-card img {
      width: 100%;
      height: 150px;
      object-fit: contain;
      display: block;
      background: #f8fafc;
    }
    .sign-wrap {
      margin-top: 22px;
      display: flex;
      justify-content: flex-end;
    }
    .sign-box {
      width: 260px;
      text-align: center;
      font-size: 10.5px;
    }
    .sign-role {
      font-weight: 700;
      color: #0f172a;
    }
    .sign-space {
      height: 46px;
    }
    .sign-name {
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 3px;
      color: #0f172a;
    }
    .sign-station {
      font-size: 10px;
      color: #334155;
      margin-top: 3px;
    }
  </style>
</head>
<body>
  <div class="doc-banner">
    <div>
      <div class="doc-title">WEATHER BRIEFING</div>
      <div class="doc-sub">${stametLine}</div>
      <div class="doc-meta">${airportLine}</div>
    </div>
    <div class="doc-right">
      <div>Obs Terakhir: <strong>${escapeHtml(latestObs?.timeUtc ?? "—")} (UTC)</strong></div>
      <div style="margin-top:3px;">Kategori: <strong>${escapeHtml(latestObs?.flightCategory ?? "—")}</strong> | Risiko: <strong>${escapeHtml(riskMatrix.overallLevel)}</strong></div>
    </div>
  </div>

  <div class="section no-break">
    <div class="sec-title">I. Narasi Analisis &amp; Prakiraan Cuaca Penerbangan (${activeLang === "ID" ? "Bahasa Indonesia" : "English ICAO"})</div>
    <pre class="narrative-box">${escapeHtml(briefingTexts[activeLang])}</pre>
  </div>

  <div class="section">
    <div class="sec-title">II. Ringkasan Tren Parameter Observasi (${metarList.length} Laporan METAR/SPECI)</div>
    <table>
      <thead>
        <tr>
          <th>Jam (UTC)</th>
          <th>Kategori</th>
          <th>Angin</th>
          <th>Visibilitas</th>
          <th>Suhu / Dew Point</th>
          <th>QNH</th>
        </tr>
      </thead>
      <tbody>${metarRowsHtml}</tbody>
    </table>
  </div>

  <div class="section no-break">
    <div class="sec-title">III. Aerodrome Operational Risk Matrix</div>
    <table>
      <thead>
        <tr>
          <th style="width:24%;">Dimensi Bahaya</th>
          <th style="width:14%;text-align:center;">Tingkat Risiko</th>
          <th>Evaluasi Kondisi &amp; Dampak Operasional</th>
        </tr>
      </thead>
      <tbody>${riskRowsHtml}</tbody>
    </table>
  </div>

  <div class="section no-break">
    <div class="sec-title">IV. Lampiran Data Sandi Mentah (METAR / SPECI / TAF)</div>
    <div class="raw-box"><strong>METAR / SPECI:</strong>
${escapeHtml(metarInput.trim() || "—")}

<strong>TAF:</strong>
${escapeHtml(tafInput.trim() || "—")}</div>
  </div>

  <div class="section page-break">
    <div class="sec-title">V. Lampiran Peta SIGWX &amp; Citra Satelit (Siklus ${chartParams.dateStamp} • ${chartParams.activeCycle} UTC)</div>
    <div class="sigwx-grid">
      <div class="img-card no-break">
        <div class="img-title">1. High Level SIGWX (${chartParams.dateStamp} ${chartParams.activeCycle}:00 UTC)</div>
        <img src="${chartParams.highSigwxUrl}" alt="High Level SIGWX" />
      </div>
      <div class="img-card no-break">
        <div class="img-title">2. Medium Level SIGWX (${chartParams.dateStamp} ${chartParams.activeCycle}:00 UTC)</div>
        <img src="${chartParams.medSigwxUrl}" alt="Medium Level SIGWX" />
      </div>
      <div class="img-card full no-break">
        <div class="img-title">3. Citra Satelit Himawari (Enhanced IR Indonesia)</div>
        <img src="${chartParams.satelliteUrl}" alt="Citra Satelit Himawari" />
      </div>
    </div>
  </div>

  <div class="section page-break">
    <div class="sec-title">VI. Lampiran Wind / Temp Chart FL050 – FL450 (Siklus ${chartParams.activeCycle} UTC)</div>
    <div class="wt-grid">${windTempCardsHtml}</div>

    <div class="sign-wrap no-break">
      <div class="sign-box">
        <div class="sign-role">Forecaster on Duty</div>
        <div class="sign-space"></div>
        <div class="sign-name">${escapeHtml(fodDisplayName)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

    const frameDoc = iframe.contentWindow.document;
    frameDoc.open();
    frameDoc.write(htmlDoc);
    frameDoc.close();

    // Tunggu seluruh gambar di iframe selesai dimuat lalu cetak satu kali
    const images = Array.from(frameDoc.images);
    Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
      ),
    ).then(() => {
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      }, 250);
    });
  };

  const handleClearAll = () => {
    setMetarInput("");
    setTafInput("");
    setSynopticNote("");
  };

  const overallRiskStyle = getRiskBadge(riskMatrix.overallLevel);

  // --- Data Points untuk 3 Grafik SVG ---
  const qnhChartPoints: TrendPoint[] = metarList.map((obs) => ({
    label:
      obs.timeUtc.length >= 6 ? `${obs.timeUtc.slice(2, 6)}Z` : obs.timeUtc,
    value: obs.qnhHpa,
    displayValue: obs.qnhHpa !== null ? `${obs.qnhHpa}` : "—",
  }));

  const spreadChartPoints: TrendPoint[] = metarList.map((obs) => ({
    label:
      obs.timeUtc.length >= 6 ? `${obs.timeUtc.slice(2, 6)}Z` : obs.timeUtc,
    value: obs.spreadC,
    displayValue: obs.spreadC !== null ? `${obs.spreadC}°` : "—",
    alert: obs.spreadC !== null && obs.spreadC <= 2,
  }));

  const windChartPoints: TrendPoint[] = metarList.map((obs) => {
    const val = obs.windGustKt ?? obs.windSpeedKt;
    return {
      label:
        obs.timeUtc.length >= 6 ? `${obs.timeUtc.slice(2, 6)}Z` : obs.timeUtc,
      value: val,
      displayValue: `${val}kt`,
      alert: val >= 20,
    };
  });

  // Active Chart Metadata (Preview di Layar)
  const activeChartMeta = useMemo(() => {
    if (activeChartTab === "HIGH_SIGWX") {
      return {
        title: `High Level SIGWX (${chartParams.dateStamp} • ${chartParams.activeCycle}:00 UTC)`,
        subtitle:
          "Peta Cuaca Signifikan Lapisan Atas (FL250 – FL630) • BMKG / WAFC",
        url: chartParams.highSigwxUrl,
      };
    }
    if (activeChartTab === "MED_SIGWX") {
      return {
        title: `Medium Level SIGWX (${chartParams.dateStamp} • ${chartParams.activeCycle}:00 UTC)`,
        subtitle:
          "Peta Cuaca Signifikan Lapisan Menengah (FL100 – FL250) • BMKG",
        url: chartParams.medSigwxUrl,
      };
    }
    if (activeChartTab === "WIND_TEMP") {
      return {
        title: `Wind / Temp Chart — ${chartParams.selectedLevelLabel} (${chartParams.activeCycle} UTC)`,
        subtitle: "Prakiraan Angin & Suhu Lapisan Atas • BMKG Aviation",
        url: chartParams.windTempUrl,
      };
    }
    return {
      title: "Citra Satelit Himawari-8/9 (Enhanced IR Indonesia)",
      subtitle: "Penginderaan Jauh Tutupan Awan Konvektif Real-Time • BMKG",
      url: chartParams.satelliteUrl,
    };
  }, [activeChartTab, chartParams]);

  return (
    <div className="space-y-6 text-slate-100">
      {/* Hidden Iframe Khusus Cetak PDF (Tanpa about:blank & Tanpa Print Ganda) */}
      <iframe
        ref={printFrameRef}
        src="javascript:void(0)"
        title="Print Weather Briefing Frame"
        className="fixed -left-[9999px] top-0 w-0 h-0 border-0 opacity-0 pointer-events-none"
      />

      {/* ===================================================================== */}
      {/* HEADER MODUL (TAMPILAN LAYAR)                                         */}
      {/* ===================================================================== */}
      <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500/20 border border-sky-400/30 rounded-xl text-sky-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Weather Brief &amp; Aerodrome Risk Monitor
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Klasifikasi VMC/IMC, Grafik Tren Observasi METAR/SPECI, SIGWX
                &amp; Wind/Temp BMKG, Matriks Risiko, &amp; Dokumen Briefing
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {latestObs && (
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border ${getFlightCategoryBadge(latestObs.flightCategory).bg} ${getFlightCategoryBadge(latestObs.flightCategory).text} ${getFlightCategoryBadge(latestObs.flightCategory).border}`}
              >
                {getFlightCategoryBadge(latestObs.flightCategory).label}
              </span>
            )}
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold border ${overallRiskStyle.bg} ${overallRiskStyle.text} ${overallRiskStyle.border}`}
            >
              RISK: {riskMatrix.overallLevel}
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* WORKSPACE UTAMA (2 KOLOM)                                             */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ------------------------------------------------------------------- */}
        {/* KOLOM KIRI (5 KOLOM): INPUT METAR/SPECI, TAF, & CITRA BMKG          */}
        {/* ------------------------------------------------------------------- */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. INPUT DERETAN METAR / SPECI */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                1. Deretan METAR / SPECI (3–6 Jam Terakhir)
              </label>
              {metarList.length > 0 && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  {metarList.length} Observasi
                </span>
              )}
            </div>

            <textarea
              rows={4}
              value={metarInput}
              onChange={(e) => setMetarInput(e.target.value)}
              placeholder="Paste 1 atau beberapa baris sandi METAR/SPECI berurutan (pisahkan dengan '=' atau baris baru)..."
              className="w-full rounded-xl bg-slate-950/90 border border-slate-700 px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-sky-500"
            />

            {/* Auto-Deteksi Bandara & Stamet dari utils/stations.ts */}
            {detectedIcao && (
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2.5 text-xs">
                <Building2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                {stationInfo ? (
                  <div>
                    <div className="font-semibold text-white">
                      Bandar Udara {stationInfo.bandar_udara} (
                      {stationInfo.icao})
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Stasiun Meteorologi:{" "}
                      <span className="text-sky-300 font-medium">
                        {stationInfo.stasiun_meteorologi}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400">
                    Kode ICAO{" "}
                    <span className="font-mono font-semibold text-slate-200">
                      {detectedIcao}
                    </span>{" "}
                    tidak terdaftar pada daftar Stamet Indonesia.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. INPUT TAF AKTIF */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-amber-400" />
                2. Sandi TAF Aktif (24–30 Jam)
              </label>
              {tafReport && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {tafReport.validPeriodUtc}
                </span>
              )}
            </div>

            <textarea
              rows={3}
              value={tafInput}
              onChange={(e) => setTafInput(e.target.value)}
              placeholder="Paste sandi TAF aktif di sini (termasuk grup FM, BECMG, TEMPO, PROB)..."
              className="w-full rounded-xl bg-slate-950/90 border border-slate-700 px-3 py-2 text-xs font-mono text-amber-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* 3. FORECASTER NOTE & ANALISIS SINOPTIK */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                3. Forecaster Note &amp; Analisis Sinoptik
              </span>
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Bersihkan Input
              </button>
            </div>

            <div className="text-xs">
              <label className="block text-slate-400 mb-1">
                Nama Forecaster on Duty
              </label>
              <input
                type="text"
                value={forecasterName}
                onChange={(e) => setForecasterName(e.target.value)}
                placeholder="Isi nama prakirawan yang bertugas..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="text-xs">
              <label className="block text-slate-400 mb-1">
                Catatan Analisis Sinoptik / SIGWX / Satelit (Opsional)
              </label>
              <textarea
                rows={3}
                value={synopticNote}
                onChange={(e) => setSynopticNote(e.target.value)}
                placeholder="Contoh: Terpantau pertumbuhan sel awan Cumulonimbus di sektor timur bandara berdasarkan citra satelit Himawari dan peta Medium Level SIGWX..."
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* 4. PANEL CITRA SIGWX (HIGH & MEDIUM LEVEL), WIND/TEMP, & SATELIT BMKG */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Satellite className="w-4 h-4 text-sky-400" />
                4. SIGWX, Wind/Temp &amp; Satelit BMKG
              </span>
              <button
                type="button"
                onClick={() => setImgRefreshKey((k) => k + 1)}
                title="Muat ulang citra terbaru"
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>

            {/* Kontrol Jam Siklus UTC & Level Ketinggian */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Siklus Jam (UTC)
                </label>
                <select
                  value={manualCycle}
                  onChange={(e) =>
                    setManualCycle(e.target.value as SynopticCycle | "AUTO")
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="AUTO">
                    Auto ({chartParams.activeCycle} UTC)
                  </option>
                  {SYNOPTIC_CYCLES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Level Wind / Temp (Preview)
                </label>
                <select
                  value={windTempLevel}
                  onChange={(e) => setWindTempLevel(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-white focus:border-sky-500 focus:outline-none"
                >
                  {WINDTEMP_LEVELS.map((lvl) => (
                    <option key={lvl.code} value={lvl.code}>
                      {lvl.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tab Pemilih Jenis Citra */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setActiveChartTab("HIGH_SIGWX")}
                className={`py-1.5 px-2 rounded-lg font-semibold border transition cursor-pointer ${
                  activeChartTab === "HIGH_SIGWX"
                    ? "bg-sky-600 border-sky-400 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                High SIGWX
              </button>
              <button
                type="button"
                onClick={() => setActiveChartTab("MED_SIGWX")}
                className={`py-1.5 px-2 rounded-lg font-semibold border transition cursor-pointer ${
                  activeChartTab === "MED_SIGWX"
                    ? "bg-sky-600 border-sky-400 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Medium SIGWX
              </button>
              <button
                type="button"
                onClick={() => setActiveChartTab("WIND_TEMP")}
                className={`py-1.5 px-2 rounded-lg font-semibold border transition cursor-pointer ${
                  activeChartTab === "WIND_TEMP"
                    ? "bg-sky-600 border-sky-400 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Wind/Temp
              </button>
              <button
                type="button"
                onClick={() => setActiveChartTab("SATELLITE")}
                className={`py-1.5 px-2 rounded-lg font-semibold border transition cursor-pointer ${
                  activeChartTab === "SATELLITE"
                    ? "bg-sky-600 border-sky-400 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Satelit HIMA
              </button>
            </div>

            {/* Preview Citra + Tautan Buka Fullscreen */}
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white">
                    {activeChartMeta.title}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {activeChartMeta.subtitle}
                  </div>
                </div>
                <a
                  href={activeChartMeta.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-sky-300 shrink-0"
                >
                  Buka Full <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-800 min-h-44 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={activeChartMeta.url}
                  src={activeChartMeta.url}
                  alt={activeChartMeta.title}
                  className="w-full h-auto max-h-64 object-contain"
                />
              </div>
              <div className="text-[10px] text-slate-500">
                Saat Cetak / Simpan PDF, seluruh level Wind/Temp (FL050–FL450)
                otomatis dilampirkan lengkap.
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* KOLOM KANAN (7 KOLOM): VMC/IMC, GRAFIK TREN SVG, RISK, & BRIEFING   */}
        {/* ------------------------------------------------------------------- */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. KLASIFIKASI FLIGHT CATEGORY (VMC / IMC) & GRAFIK TREN SVG */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-400" />
                Klasifikasi Flight Category (VMC/IMC) &amp; Grafik Tren
                Observasi
              </h3>
              <p className="text-xs text-slate-400">
                Evaluasi otomatis kombinasi Visibility &amp; Ceiling
                (BKN/OVC/VV) serta grafik evolusi QNH, Spread (T − Td), dan
                Angin
              </p>
            </div>

            {metarList.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center text-xs text-slate-400">
                Masukkan satu atau lebih sandi METAR/SPECI di panel kiri untuk
                menampilkan klasifikasi VFR/MVFR/IFR/LIFR dan grafik tren
                parameter meteorologi.
              </div>
            ) : (
              <>
                {/* Strip Timeline Flight Category per Jam Observasi */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {metarList.map((obs) => {
                    const badge = getFlightCategoryBadge(obs.flightCategory);
                    return (
                      <div
                        key={obs.id}
                        className={`p-2.5 rounded-xl border ${badge.bg} ${badge.border}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-white">
                            {obs.timeUtc}
                          </span>
                          <span
                            className={`text-[10px] font-extrabold ${badge.text}`}
                          >
                            {obs.flightCategory}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-200 mt-1 font-mono">
                          Vis:{" "}
                          {obs.visibilityM >= 9999
                            ? "≥10km"
                            : `${obs.visibilityM}m`}
                        </div>
                        <div className="text-[10px] text-slate-300 font-mono">
                          Ceil:{" "}
                          {obs.ceilingFt !== null
                            ? `${obs.ceilingFt}ft`
                            : "No Ceil"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 3 Grafik Garis SVG Interaktif */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <SvgTrendChart
                    title="QNH (hPa)"
                    subBadge={
                      trendStats.qnhDelta !== null
                        ? `${trendStats.qnhDelta >= 0 ? "+" : ""}${trendStats.qnhDelta} hPa`
                        : undefined
                    }
                    latestDisplay={
                      latestObs?.qnhHpa ? `${latestObs.qnhHpa} hPa` : "—"
                    }
                    latestAlert={
                      trendStats.qnhDelta !== null && trendStats.qnhDelta <= -2
                    }
                    points={qnhChartPoints}
                    strokeColor="#38bdf8"
                    fillId="qnhGrad"
                  />

                  <SvgTrendChart
                    title="Spread (T − Td)"
                    icon={
                      <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                    }
                    latestDisplay={
                      latestObs?.spreadC !== null &&
                      latestObs?.spreadC !== undefined
                        ? `${latestObs.spreadC}°C`
                        : "—"
                    }
                    latestAlert={
                      latestObs?.spreadC !== null &&
                      latestObs?.spreadC !== undefined &&
                      latestObs.spreadC <= 2
                    }
                    points={spreadChartPoints}
                    strokeColor="#34d399"
                    fillId="spreadGrad"
                    minOverride={0}
                  />

                  <SvgTrendChart
                    title="Angin (kt)"
                    subBadge={
                      trendStats.windMax !== null
                        ? `Max ${trendStats.windMax}kt`
                        : undefined
                    }
                    icon={<Wind className="w-3.5 h-3.5 text-amber-400" />}
                    latestDisplay={
                      latestObs
                        ? `${latestObs.windSpeedKt}${latestObs.windGustKt ? `G${latestObs.windGustKt}` : ""} kt`
                        : "—"
                    }
                    latestAlert={
                      latestObs !== null &&
                      (latestObs.windGustKt ?? latestObs.windSpeedKt) >= 20
                    }
                    points={windChartPoints}
                    strokeColor="#fbbf24"
                    fillId="windGrad"
                    minOverride={0}
                  />
                </div>
              </>
            )}
          </div>

          {/* 2. AERODROME OPERATIONAL RISK MATRIX */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Aerodrome Operational Risk Matrix
                </h3>
                <p className="text-xs text-slate-400">
                  Evaluasi bahaya cuaca penerbangan beserta dampak
                  operasionalnya
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${overallRiskStyle.bg} ${overallRiskStyle.text} ${overallRiskStyle.border}`}
              >
                OVERALL: {riskMatrix.overallLevel}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {riskMatrix.dimensions.map((dim) => {
                const st = getRiskBadge(dim.level);
                return (
                  <div
                    key={dim.key}
                    className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-200">
                        {dim.titleId}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${st.bg} ${st.text} ${st.border}`}
                      >
                        {dim.level}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      {dim.summaryId}
                    </p>
                    <p className="text-[10px] text-slate-400 italic">
                      Dampak: {dim.operationalImpactId}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. WINDOW OF OPPORTUNITY (JENDELA WAKTU AMAN vs HAZARD TAF) */}
          <div className="bg-slate-900/85 border border-slate-700/70 rounded-2xl p-5 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plane className="w-4 h-4 text-emerald-400" />
                Window of Opportunity (Lini Masa Operasional TAF)
              </h3>
              <p className="text-xs text-slate-400">
                Pemetaan jendela waktu kondusif (Optimal Window) vs periode
                cuaca signifikan (Hazard Window)
              </p>
            </div>

            {!tafReport ? (
              <div className="p-5 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center text-xs text-slate-400">
                Tempelkan sandi TAF di panel kiri untuk memetakan jendela waktu
                aman terbang dan jadwal ground handling / refueling.
              </div>
            ) : (
              <div className="space-y-2">
                {tafReport.periods.map((p) => {
                  const catBadge = getFlightCategoryBadge(p.flightCategory);
                  return (
                    <div
                      key={p.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                        p.isHazard
                          ? "bg-amber-950/25 border-amber-500/40"
                          : "bg-emerald-950/20 border-emerald-500/35"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          {p.isHazard ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          )}
                          <span className="font-mono text-xs font-bold text-white">
                            {p.headerLabel}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${catBadge.bg} ${catBadge.text} ${catBadge.border}`}
                          >
                            {p.flightCategory}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-300 pl-5">
                          {p.isHazard
                            ? `Hazard Window: ${p.hazardReasonsId.join(" • ")}`
                            : "Optimal Window: Kondusif untuk operasi penerbangan & ground handling."}
                        </div>
                      </div>

                      <div className="text-[11px] font-mono text-slate-400 pl-5 sm:pl-0 shrink-0">
                        {p.windDir === "VRB"
                          ? "VRB"
                          : p.windDir !== null
                            ? `${String(p.windDir).padStart(3, "0")}°`
                            : "—"}
                        /{p.windSpeedKt}
                        {p.windGustKt ? `G${p.windGustKt}` : ""}kt • Vis{" "}
                        {p.visibilityM >= 9999 ? "≥10km" : `${p.visibilityM}m`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. DOKUMEN BRIEFING CUACA PENERBANGAN (BAHASA INDONESIA & ENGLISH ICAO) */}
          <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-5 space-y-4 shadow-lg">
            {/* Kop Resmi Stasiun */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-sky-400 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {stationInfo
                      ? `Stasiun Meteorologi ${stationInfo.stasiun_meteorologi}`
                      : "Dokumen Briefing Cuaca Penerbangan"}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {stationInfo
                      ? `Bandar Udara ${stationInfo.bandar_udara} (${stationInfo.icao}) • Referensi Waktu UTC`
                      : "Narasi Baku Bahasa Indonesia & English ICAO Phraseology"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handlePrintBrief}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-white transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-sky-400" />
                Cetak / Simpan PDF
              </button>
            </div>

            {/* Selector Bahasa + Tombol Salin */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveLang("ID")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeLang === "ID"
                      ? "bg-sky-600 text-white"
                      : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                  }`}
                >
                  Bahasa Indonesia
                </button>
                <button
                  type="button"
                  onClick={() => setActiveLang("EN")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeLang === "EN"
                      ? "bg-sky-600 text-white"
                      : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                  }`}
                >
                  English (ICAO Phraseology)
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleCopyText(activeLang)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-xs font-semibold text-sky-200 transition cursor-pointer"
              >
                {copiedLang === activeLang ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Tersalin!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Salin Teks
                  </>
                )}
              </button>
            </div>

            {/* Area Teks Hasil Briefing */}
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200 bg-slate-950/90 border border-slate-800 rounded-xl p-4">
              {briefingTexts[activeLang]}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
