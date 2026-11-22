export type ValidityCycle = "00" | "06" | "12" | "18";

export interface WeatherState {
  windDir: number | "VRB" | null; // 0 = Calm, 10..360 = deg, "VRB" = Variable
  windSpd: number; // in KT
  gustSpd: number; // 0 if no gust, >0 if gust
  hasGust: boolean;
  vis: number; // in meters (9999/CAVOK -> 10000)
  wxRaw: string; // e.g., "+RA", "RA", "-RA", "TSRA", "FG", ""
  hasSigPrecip: boolean; // moderate or heavy precipitation
  hasTsOrCb: boolean; // thunderstorm or CB
  cloudAmount: string; // "SKC", "NSC", "FEW", "SCT", "BKN", "OVC", "VV"
  cloudBaseFt: number | null; // lowest cloud height in feet, null if NSC/SKC/CAVOK
}

export interface TafChangeGroup {
  type: "GENERAL" | "BECMG" | "TEMPO" | "PROB" | "FM";
  rawType: string;
  startUtc: Date;
  endUtc: Date;
  changes: Partial<WeatherState>;
  changedElements: Set<
    "windDir" | "windSpd" | "gust" | "vis" | "wx" | "cloudAmount" | "cloudBase"
  >;
}

export interface ParsedTaf {
  station: string;
  issueTime: string;
  validStartUtc: Date;
  validEndUtc: Date;
  validityCycle: ValidityCycle;
  baseState: WeatherState;
  changeGroups: TafChangeGroup[];
  rawTaf: string;
}

export interface ParsedMetarObs {
  raw: string;
  obsTimeUtc: Date;
  state: WeatherState;
}

export interface VerificationRow {
  no: number;
  tanggal: number;
  waktuUtc: string; // "00:00", "00:30", etc.
  timestampMs: number;
  // Kolom (4) Prakiraan TAF
  changeGroup: string; // "GENERAL", "BECMG", "TEMPO", "PROB", "FM"
  fcstA: string; // Arah angin (0, 10..360, VRB)
  fcstB1: number; // Kecepatan angin
  fcstB2: number; // Gust (0 atau nilai gust)
  fcstC: number; // Visibilitas (m)
  fcstD: string; // Cuaca / presipitasi ("RA", "+RA", "TSRA", "0")
  fcstE: string; // Jumlah awan ("FEW", "SCT", "BKN", "OVC", "NSC")
  fcstF: number | string; // Tinggi dasar awan (ft) atau "-"
  // Kolom (5) Pengamatan METAR
  metarRaw: string;
  obsA: string | number; // 999 untuk VRB, 0 untuk Calm, atau derajat
  scoreA: 0 | 1;
  obsB1: number;
  scoreB1: 0 | 1;
  obsB2: number;
  scoreB2: 0 | 1;
  obsC: number;
  scoreC: 0 | 1;
  obsD: string;
  scoreD: 0 | 1;
  obsE: string;
  scoreE: 0 | 1;
  obsF: number | string;
  scoreF: 0 | 1;
}

export interface ElementScores {
  arahAngin: number; // (5-a) %
  kecepatanAngin: number; // (5-b) %
  gusty: number; // (5-c) %
  visibilitas: number; // (5-d) %
  presipitasi: number; // (5-e) %
  jumlahAwan: number; // (5-f) %
  tinggiAwan: number; // (5-g) %
}

export interface IndividualTafVerificationResult {
  tanggal: number;
  bulanIndex: number; // 0..11
  tahun: number;
  validityCycle: ValidityCycle;
  periodeValiditasStr: string;
  rawTaf: string;
  forecaster: string;
  verifikator: string;
  rows: VerificationRow[];
  scores: ElementScores;
  totalVerifiedRows: number;
}

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

// Cek apakah token cuaca mengandung presipitasi intensitas SEDANG atau LEBAT (termasuk TSRA, +TSRA, SHRA, +SHRA, dll.)
export function hasModerateOrHeavyPrecip(wxTokens: string[]): {
  hasSig: boolean;
  label: string;
} {
  const precipCodes = ["DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP"];
  let foundLabel = "";

  for (const raw of wxTokens) {
    const t = raw.trim().toUpperCase();
    if (!t || t === "NSW" || t === "NIL") continue;
    // Abaikan fenomena di sekitar bandara (VC), intensitas ringan (-), maupun Recent Weather (RE)
    if (t.startsWith("VC") || t.startsWith("-") || t.startsWith("RE")) continue;

    const hasPrecip = precipCodes.some((code) => t.includes(code));
    if (hasPrecip) {
      foundLabel = t;
      return { hasSig: true, label: foundLabel };
    }
  }

  return { hasSig: false, label: foundLabel };
}

function parseWeatherTokensToState(tokens: string[]): {
  state: WeatherState;
  changed: Set<
    "windDir" | "windSpd" | "gust" | "vis" | "wx" | "cloudAmount" | "cloudBase"
  >;
} {
  const state: WeatherState = {
    windDir: null,
    windSpd: 0,
    gustSpd: 0,
    hasGust: false,
    vis: 10000,
    wxRaw: "",
    hasSigPrecip: false,
    hasTsOrCb: false,
    cloudAmount: "NSC",
    cloudBaseFt: null,
  };

  const changed = new Set<
    "windDir" | "windSpd" | "gust" | "vis" | "wx" | "cloudAmount" | "cloudBase"
  >();

  const wxCollected: string[] = [];
  let lowestCloudFt: number | null = null;
  let lowestCloudAmt = "";
  let foundCloudToken = false;

  const wxKeywords = [
    "TS",
    "SH",
    "FZ",
    "MI",
    "PR",
    "BC",
    "DR",
    "BL",
    "DZ",
    "RA",
    "SN",
    "SG",
    "IC",
    "PL",
    "GR",
    "GS",
    "UP",
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
    "NSW",
  ];

  for (const rawTok of tokens) {
    const t = rawTok.trim().toUpperCase();
    if (!t) continue;

    // Angin: dddff(Gff)KT atau VRBff(Gff)KT
    const windMatch = t.match(
      /^(VRB|\d{3})P?(\d{2,3})(?:GP?(\d{2,3}))?(?:KT|MPS)$/,
    );
    if (windMatch) {
      const dirPart = windMatch[1];
      const spdVal = parseInt(windMatch[2], 10);
      const gustVal = windMatch[3] ? parseInt(windMatch[3], 10) : 0;

      if (dirPart === "VRB") {
        state.windDir = "VRB";
      } else {
        const deg = parseInt(dirPart, 10);
        state.windDir = spdVal === 0 && deg === 0 ? 0 : deg;
      }
      state.windSpd = spdVal;
      state.gustSpd = gustVal;
      state.hasGust = gustVal > 0;

      changed.add("windDir");
      changed.add("windSpd");
      changed.add("gust");
      continue;
    }

    // CAVOK
    if (t === "CAVOK") {
      state.vis = 10000;
      state.wxRaw = "NSW";
      state.hasSigPrecip = false;
      state.cloudAmount = "NSC";
      state.cloudBaseFt = null;
      changed.add("vis");
      changed.add("wx");
      changed.add("cloudAmount");
      changed.add("cloudBase");
      continue;
    }

    // Visibilitas 4 digit (misal 9999, 4000, 0800)
    if (/^\d{4}$/.test(t)) {
      const v = parseInt(t, 10);
      state.vis = v === 9999 ? 10000 : v;
      changed.add("vis");
      continue;
    }

    // Awan: FEW015, BKN010CB, OVC008, VV003, NSC, SKC, NCD
    if (t === "NSC" || t === "SKC" || t === "NCD") {
      foundCloudToken = true;
      lowestCloudAmt = "NSC";
      lowestCloudFt = null;
      changed.add("cloudAmount");
      changed.add("cloudBase");
      continue;
    }

    const cldMatch = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/);
    if (cldMatch) {
      foundCloudToken = true;
      const amt = cldMatch[1];
      const hRaw = cldMatch[2];
      const conv = cldMatch[3];
      if (conv === "CB") state.hasTsOrCb = true;

      const hFt = hRaw === "///" ? 0 : parseInt(hRaw, 10) * 100;
      // SOP: Verifikasi hanya dilakukan untuk lapisan awan terendah
      if (lowestCloudFt === null || hFt < lowestCloudFt) {
        lowestCloudFt = hFt;
        lowestCloudAmt = amt;
      }
      changed.add("cloudAmount");
      changed.add("cloudBase");
      continue;
    }

    // Abaikan grup Recent Weather (misal: RERA, RETS, RESHRA, REDZ, RETSRA) agar tidak masuk ke Kolom D
    if (/^RE[A-Z]{2,}$/.test(t)) {
      continue;
    }

    // Fenomena cuaca aktual (tanpa angka, bukan grup perubahan/suhu/QNH/recent weather)
    if (
      !/\d/.test(t) &&
      ![
        "METAR",
        "SPECI",
        "TAF",
        "COR",
        "AMD",
        "AUTO",
        "NOSIG",
        "TEMPO",
        "BECMG",
        "FM",
      ].includes(t) &&
      wxKeywords.some((kw) => t.includes(kw))
    ) {
      wxCollected.push(t);
      if (t.includes("TS")) state.hasTsOrCb = true;
      changed.add("wx");
      continue;
    }
  }

  if (wxCollected.length > 0) {
    state.wxRaw = wxCollected.join(" ");
    const precipEval = hasModerateOrHeavyPrecip(wxCollected);
    state.hasSigPrecip = precipEval.hasSig;
  }

  if (foundCloudToken) {
    state.cloudAmount = lowestCloudAmt || "NSC";
    state.cloudBaseFt = lowestCloudFt;
  }

  return { state, changed };
}

function resolveDayMonthYear(
  dd: number,
  anchorYear: number,
  anchorMonth: number,
  anchorDay: number,
): { year: number; month: number; day: number } {
  let y = anchorYear;
  let m = anchorMonth;

  if (anchorDay > 20 && dd < 10) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  } else if (anchorDay < 5 && dd > 25) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }

  return { year: y, month: m, day: dd };
}

function parseDdHhToUtc(
  ddhh: string,
  anchorYear: number,
  anchorMonth: number,
  anchorDay: number,
): Date {
  const dd = parseInt(ddhh.slice(0, 2), 10);
  const hh = parseInt(ddhh.slice(2, 4), 10);
  const { year, month, day } = resolveDayMonthYear(
    dd,
    anchorYear,
    anchorMonth,
    anchorDay,
  );
  return new Date(Date.UTC(year, month, day, hh, 0, 0, 0));
}

export function parseTafForVerification(
  rawTaf: string,
  anchorYear: number,
  anchorMonth: number,
  anchorDay: number,
  fallbackCycle: ValidityCycle,
): ParsedTaf | null {
  const clean = rawTaf.replace(/=/g, "").trim().toUpperCase();
  if (!clean) return null;

  const tokens = clean.split(/\s+/);
  let station = "";
  let issueTime = "";
  let validStartUtc: Date | null = null;
  let validEndUtc: Date | null = null;
  let validityCycle: ValidityCycle = fallbackCycle;

  const baseTokens: string[] = [];
  const rawGroups: {
    type: "BECMG" | "TEMPO" | "PROB" | "FM";
    rawType: string;
    periodStr: string;
    tokens: string[];
  }[] = [];

  let currentGrp: {
    type: "BECMG" | "TEMPO" | "PROB" | "FM";
    rawType: string;
    periodStr: string;
    tokens: string[];
  } | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "TAF" || t === "AMD" || t === "COR" || t === "RTD") continue;

    if (!station && /^[A-Z]{4}$/.test(t) && !validStartUtc) {
      station = t;
      continue;
    }

    if (!issueTime && /^\d{6}Z$/.test(t)) {
      issueTime = t;
      continue;
    }

    if (!validStartUtc && /^\d{4}\/\d{4}$/.test(t)) {
      const [sStr, eStr] = t.split("/");
      validStartUtc = parseDdHhToUtc(sStr, anchorYear, anchorMonth, anchorDay);
      validEndUtc = parseDdHhToUtc(eStr, anchorYear, anchorMonth, anchorDay);
      if (validEndUtc <= validStartUtc) {
        validEndUtc = new Date(validEndUtc.getTime() + 24 * 3600000);
      }
      const startHr = sStr.slice(2, 4);
      if (
        startHr === "00" ||
        startHr === "06" ||
        startHr === "12" ||
        startHr === "18"
      ) {
        validityCycle = startHr;
      }
      continue;
    }

    if (/^T[XN]M?\d{2}\/\d{4}Z$/.test(t)) continue;

    if (/^FM\d{6}$/.test(t)) {
      currentGrp = {
        type: "FM",
        rawType: "FM",
        periodStr: t.slice(2, 8),
        tokens: [],
      };
      rawGroups.push(currentGrp);
      continue;
    }

    if (/^PROB[34]0$/.test(t)) {
      const nextTok = tokens[i + 1] || "";
      if (nextTok === "TEMPO") {
        currentGrp = {
          type: "PROB",
          rawType: `${t} TEMPO`,
          periodStr: "",
          tokens: [],
        };
        i += 1;
      } else {
        currentGrp = {
          type: "PROB",
          rawType: t,
          periodStr: "",
          tokens: [],
        };
      }
      rawGroups.push(currentGrp);
      continue;
    }

    if (t === "BECMG" || t === "TEMPO") {
      currentGrp = {
        type: t,
        rawType: t,
        periodStr: "",
        tokens: [],
      };
      rawGroups.push(currentGrp);
      continue;
    }

    if (currentGrp) {
      if (!currentGrp.periodStr && /^\d{4}\/\d{4}$/.test(t)) {
        currentGrp.periodStr = t;
      } else {
        currentGrp.tokens.push(t);
      }
    } else {
      baseTokens.push(t);
    }
  }

  if (!validStartUtc || !validEndUtc) {
    const startH = parseInt(fallbackCycle, 10);
    validStartUtc = new Date(
      Date.UTC(anchorYear, anchorMonth, anchorDay, startH, 0, 0, 0),
    );
    validEndUtc = new Date(validStartUtc.getTime() + 24 * 3600000);
  }

  const { state: baseState } = parseWeatherTokensToState(baseTokens);

  const changeGroups: TafChangeGroup[] = [];
  for (const rg of rawGroups) {
    let gStart = validStartUtc;
    let gEnd = validEndUtc;

    if (rg.type === "FM" && rg.periodStr.length === 6) {
      const dd = parseInt(rg.periodStr.slice(0, 2), 10);
      const hh = parseInt(rg.periodStr.slice(2, 4), 10);
      const mm = parseInt(rg.periodStr.slice(4, 6), 10);
      const resolved = resolveDayMonthYear(
        dd,
        validStartUtc.getUTCFullYear(),
        validStartUtc.getUTCMonth(),
        validStartUtc.getUTCDate(),
      );
      gStart = new Date(
        Date.UTC(resolved.year, resolved.month, resolved.day, hh, mm, 0, 0),
      );
      gEnd = validEndUtc;
    } else if (rg.periodStr.includes("/")) {
      const [sStr, eStr] = rg.periodStr.split("/");
      gStart = parseDdHhToUtc(
        sStr,
        validStartUtc.getUTCFullYear(),
        validStartUtc.getUTCMonth(),
        validStartUtc.getUTCDate(),
      );
      gEnd = parseDdHhToUtc(
        eStr,
        gStart.getUTCFullYear(),
        gStart.getUTCMonth(),
        gStart.getUTCDate(),
      );
      if (gEnd < gStart) {
        gEnd = new Date(gEnd.getTime() + 24 * 3600000);
      }
    }

    const { state: parsedChanges, changed } = parseWeatherTokensToState(
      rg.tokens,
    );
    const changes: Partial<WeatherState> = {};
    if (changed.has("windDir")) changes.windDir = parsedChanges.windDir;
    if (changed.has("windSpd")) changes.windSpd = parsedChanges.windSpd;
    if (changed.has("gust")) {
      changes.gustSpd = parsedChanges.gustSpd;
      changes.hasGust = parsedChanges.hasGust;
    }
    if (changed.has("vis")) changes.vis = parsedChanges.vis;
    if (changed.has("wx")) {
      changes.wxRaw = parsedChanges.wxRaw;
      changes.hasSigPrecip = parsedChanges.hasSigPrecip;
      changes.hasTsOrCb = parsedChanges.hasTsOrCb;
    }
    if (changed.has("cloudAmount"))
      changes.cloudAmount = parsedChanges.cloudAmount;
    if (changed.has("cloudBase"))
      changes.cloudBaseFt = parsedChanges.cloudBaseFt;

    changeGroups.push({
      type: rg.type,
      rawType: rg.rawType,
      startUtc: gStart,
      endUtc: gEnd,
      changes,
      changedElements: changed,
    });
  }

  return {
    station,
    issueTime,
    validStartUtc,
    validEndUtc,
    validityCycle,
    baseState,
    changeGroups,
    rawTaf: rawTaf.trim(),
  };
}

export function parseMetarForVerification(
  rawMetar: string,
  fallbackUtc: Date,
): ParsedMetarObs | null {
  const clean = rawMetar.replace(/=/g, "").trim().toUpperCase();
  if (!clean || clean.includes(" NIL")) return null;

  // Potong bagian TREND (NOSIG/BECMG/TEMPO) dan RMK agar tidak mengganggu parsing observasi aktual
  const mainBody = clean.split(/\b(?:NOSIG|BECMG|TEMPO|RMK)\b/)[0].trim();
  const tokens = mainBody.split(/\s+/);

  let obsTimeUtc = new Date(fallbackUtc.getTime());
  for (const t of tokens) {
    const zMatch = t.match(/^(\d{2})(\d{2})(\d{2})Z$/);
    if (zMatch) {
      const dd = parseInt(zMatch[1], 10);
      const hh = parseInt(zMatch[2], 10);
      const mm = parseInt(zMatch[3], 10);
      const resolved = resolveDayMonthYear(
        dd,
        fallbackUtc.getUTCFullYear(),
        fallbackUtc.getUTCMonth(),
        fallbackUtc.getUTCDate(),
      );
      obsTimeUtc = new Date(
        Date.UTC(resolved.year, resolved.month, resolved.day, hh, mm, 0, 0),
      );
      break;
    }
  }

  const { state } = parseWeatherTokensToState(tokens);
  return {
    raw: rawMetar.trim(),
    obsTimeUtc,
    state,
  };
}

// ============================================================================
// FUNGSI PENILAIAN KRITERIA SOP/024/DM/X/2025 (TABEL II)
// ============================================================================

function shortestAngleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function isAngleBetween(
  obs: number,
  startDeg: number,
  endDeg: number,
): boolean {
  const totalArc = shortestAngleDiff(startDeg, endDeg);
  const d1 = shortestAngleDiff(startDeg, obs);
  const d2 = shortestAngleDiff(obs, endDeg);
  return Math.abs(d1 + d2 - totalArc) <= 1;
}

export function verifyWindDirection(
  fcst: WeatherState,
  obs: WeatherState,
): 0 | 1 {
  const fDir = fcst.windDir;
  const oDir = obs.windDir;

  if (fDir === "VRB" && oDir === "VRB") return 1;
  if (fDir === "VRB" && obs.hasTsOrCb) return 1;
  if (fDir === "VRB" && obs.windSpd < 10) return 1;
  if (fcst.windSpd < 10 && oDir === "VRB" && obs.windSpd < 10) return 1;

  if (typeof fDir === "number" && typeof oDir === "number") {
    const diff = shortestAngleDiff(fDir, oDir);
    if (diff <= 60) return 1;
    if (diff > 60 && obs.windSpd < 10) return 1;
  }

  return 0;
}

export function verifyWindSpeed(fcst: WeatherState, obs: WeatherState): 0 | 1 {
  return Math.abs(fcst.windSpd - obs.windSpd) <= 10 ? 1 : 0;
}

export function verifyGust(fcst: WeatherState, obs: WeatherState): 0 | 1 {
  return fcst.hasGust === obs.hasGust ? 1 : 0;
}

function getVisibilityClass(visMeters: number): number {
  if (visMeters <= 799) return 1;
  if (visMeters <= 1499) return 2;
  if (visMeters <= 2999) return 3;
  if (visMeters <= 5000) return 4;
  return 5;
}

export function verifyVisibility(fcst: WeatherState, obs: WeatherState): 0 | 1 {
  return getVisibilityClass(fcst.vis) === getVisibilityClass(obs.vis) ? 1 : 0;
}

export function verifyPrecipitation(
  fcst: WeatherState,
  obs: WeatherState,
): 0 | 1 {
  return fcst.hasSigPrecip === obs.hasSigPrecip ? 1 : 0;
}

function getCloudAmountClass(amount: string): 1 | 2 {
  if (amount === "BKN" || amount === "OVC" || amount === "VV") return 2;
  return 1;
}

export function verifyCloudAmount(
  fcst: WeatherState,
  obs: WeatherState,
): 0 | 1 {
  if (
    obs.cloudBaseFt === null ||
    obs.cloudAmount === "NSC" ||
    obs.cloudAmount === "SKC"
  ) {
    return 1;
  }
  const obsHeightMeters = obs.cloudBaseFt * 0.3048;
  if (obsHeightMeters > 1500) {
    return 1;
  }
  return getCloudAmountClass(fcst.cloudAmount) ===
    getCloudAmountClass(obs.cloudAmount)
    ? 1
    : 0;
}

export function verifyCloudBase(fcst: WeatherState, obs: WeatherState): 0 | 1 {
  const fNoCloud =
    fcst.cloudBaseFt === null ||
    fcst.cloudAmount === "NSC" ||
    fcst.cloudAmount === "SKC";
  const oNoCloud =
    obs.cloudBaseFt === null ||
    obs.cloudAmount === "NSC" ||
    obs.cloudAmount === "SKC";

  if (fNoCloud && oNoCloud) return 1;
  if (fNoCloud !== oNoCloud) return 0;

  const fH = fcst.cloudBaseFt as number;
  const oH = obs.cloudBaseFt as number;

  if (fH < 1000) {
    return Math.abs(fH - oH) <= 100 ? 1 : 0;
  }
  return Math.abs(fH - oH) <= 0.3 * fH ? 1 : 0;
}

function applyChanges(
  base: WeatherState,
  changes: Partial<WeatherState>,
): WeatherState {
  return {
    ...base,
    ...changes,
  };
}

export function evaluateSingleTaf(
  taf: ParsedTaf,
  allObservations: ParsedMetarObs[],
  forecaster: string,
  verifikator: string,
): IndividualTafVerificationResult {
  const windowStartMs = taf.validStartUtc.getTime();
  const windowEndMs = windowStartMs + 12 * 3600000;

  const obsBySlot = new Map<number, ParsedMetarObs>();
  for (const obs of allObservations) {
    const tMs = obs.obsTimeUtc.getTime();
    if (tMs >= windowStartMs && tMs <= windowEndMs) {
      const slotMs = Math.round(tMs / (30 * 60000)) * (30 * 60000);
      obsBySlot.set(slotMs, obs);
    }
  }

  interface TimelineSlot {
    slotMs: number;
    obs: ParsedMetarObs;
    groupLabel: string;
    activeState: WeatherState;
    prevState: WeatherState;
    becmgGroup: TafChangeGroup | null;
    tempoGroup: TafChangeGroup | null;
    rawScores: {
      A: 0 | 1;
      B1: 0 | 1;
      B2: 0 | 1;
      C: 0 | 1;
      D: 0 | 1;
      E: 0 | 1;
      F: 0 | 1;
    };
    tempoMatchFlags: {
      A: boolean;
      B1: boolean;
      B2: boolean;
      C: boolean;
      D: boolean;
      E: boolean;
      F: boolean;
    };
  }

  const timeline: TimelineSlot[] = [];

  for (let tMs = windowStartMs; tMs <= windowEndMs; tMs += 30 * 60000) {
    const obs = obsBySlot.get(tMs);
    if (!obs) continue;

    const currentDate = new Date(tMs);
    let prevailing: WeatherState = { ...taf.baseState };
    let groupLabel = "GENERAL";
    let activeBecmg: TafChangeGroup | null = null;
    let activeTempo: TafChangeGroup | null = null;

    for (const cg of taf.changeGroups) {
      if (cg.type === "FM" && currentDate >= cg.startUtc) {
        prevailing = applyChanges(prevailing, cg.changes);
        if (currentDate.getTime() === cg.startUtc.getTime()) {
          groupLabel = "FM";
        }
      } else if (cg.type === "BECMG" && currentDate >= cg.endUtc) {
        prevailing = applyChanges(prevailing, cg.changes);
      }
    }

    const preChangeState: WeatherState = { ...prevailing };

    for (const cg of taf.changeGroups) {
      if (
        cg.type === "BECMG" &&
        currentDate >= cg.startUtc &&
        currentDate < cg.endUtc
      ) {
        activeBecmg = cg;
        groupLabel = "BECMG";
        prevailing = applyChanges(prevailing, cg.changes);
      }
    }

    for (const cg of taf.changeGroups) {
      if (
        (cg.type === "TEMPO" || cg.type === "PROB") &&
        currentDate >= cg.startUtc &&
        currentDate <= cg.endUtc
      ) {
        activeTempo = cg;
        groupLabel = cg.rawType;
      }
    }

    const displayState = activeTempo
      ? applyChanges(prevailing, activeTempo.changes)
      : prevailing;

    const evalState = (st: WeatherState) => ({
      A: verifyWindDirection(st, obs.state),
      B1: verifyWindSpeed(st, obs.state),
      B2: verifyGust(st, obs.state),
      C: verifyVisibility(st, obs.state),
      D: verifyPrecipitation(st, obs.state),
      E: verifyCloudAmount(st, obs.state),
      F: verifyCloudBase(st, obs.state),
    });

    const targetScores = evalState(displayState);

    if (activeBecmg) {
      const prevScores = evalState(preChangeState);
      if (prevScores.A === 1) targetScores.A = 1;
      else if (
        typeof preChangeState.windDir === "number" &&
        typeof displayState.windDir === "number" &&
        typeof obs.state.windDir === "number" &&
        isAngleBetween(
          obs.state.windDir,
          preChangeState.windDir,
          displayState.windDir,
        )
      ) {
        targetScores.A = 1;
      }

      if (
        prevScores.B1 === 1 ||
        (obs.state.windSpd >=
          Math.min(preChangeState.windSpd, displayState.windSpd) &&
          obs.state.windSpd <=
            Math.max(preChangeState.windSpd, displayState.windSpd))
      ) {
        targetScores.B1 = 1;
      }

      if (prevScores.B2 === 1) targetScores.B2 = 1;

      if (
        prevScores.C === 1 ||
        (obs.state.vis >= Math.min(preChangeState.vis, displayState.vis) &&
          obs.state.vis <= Math.max(preChangeState.vis, displayState.vis))
      ) {
        targetScores.C = 1;
      }

      if (prevScores.D === 1) targetScores.D = 1;
      if (prevScores.E === 1) targetScores.E = 1;

      if (prevScores.F === 1) {
        targetScores.F = 1;
      } else if (
        preChangeState.cloudBaseFt !== null &&
        displayState.cloudBaseFt !== null &&
        obs.state.cloudBaseFt !== null &&
        obs.state.cloudBaseFt >=
          Math.min(preChangeState.cloudBaseFt, displayState.cloudBaseFt) &&
        obs.state.cloudBaseFt <=
          Math.max(preChangeState.cloudBaseFt, displayState.cloudBaseFt)
      ) {
        targetScores.F = 1;
      }
    }

    timeline.push({
      slotMs: tMs,
      obs,
      groupLabel,
      activeState: displayState,
      prevState: preChangeState,
      becmgGroup: activeBecmg,
      tempoGroup: activeTempo,
      rawScores: targetScores,
      tempoMatchFlags: {
        A: targetScores.A === 1,
        B1: targetScores.B1 === 1,
        B2: targetScores.B2 === 1,
        C: targetScores.C === 1,
        D: targetScores.D === 1,
        E: targetScores.E === 1,
        F: targetScores.F === 1,
      },
    });
  }

  const tempoGroupsSeen = new Set<TafChangeGroup>();
  for (const slot of timeline) {
    if (slot.tempoGroup) tempoGroupsSeen.add(slot.tempoGroup);
  }

  for (const tg of tempoGroupsSeen) {
    const groupSlots = timeline.filter((s) => s.tempoGroup === tg);
    const totalSlots = groupSlots.length;
    if (totalSlots === 0) continue;

    const totalHours = totalSlots * 0.5;
    const baseBeforeTempo = groupSlots[0].prevState;
    const tempoState = applyChanges(baseBeforeTempo, tg.changes);

    // Kuota durasi TEMPO hanya diterapkan pada unsur yang benar-benar berubah kelas/toleransi dibanding kondisi sebelum TEMPO
    const isElementChangedInTempo = (
      elKey: "A" | "B1" | "B2" | "C" | "D" | "E" | "F",
    ): boolean => {
      if (elKey === "A") {
        return (
          tg.changedElements.has("windDir") &&
          tg.changes.windDir !== baseBeforeTempo.windDir
        );
      }
      if (elKey === "B1") {
        return (
          tg.changedElements.has("windSpd") &&
          tg.changes.windSpd !== baseBeforeTempo.windSpd
        );
      }
      if (elKey === "B2") {
        return (
          tg.changedElements.has("gust") &&
          Boolean(tg.changes.hasGust) !== baseBeforeTempo.hasGust
        );
      }
      if (elKey === "C") {
        return (
          tg.changedElements.has("vis") &&
          tg.changes.vis !== undefined &&
          getVisibilityClass(tg.changes.vis) !==
            getVisibilityClass(baseBeforeTempo.vis)
        );
      }
      if (elKey === "D") {
        return (
          tg.changedElements.has("wx") &&
          Boolean(tg.changes.hasSigPrecip) !== baseBeforeTempo.hasSigPrecip
        );
      }
      if (elKey === "E") {
        return (
          tg.changedElements.has("cloudAmount") &&
          tg.changes.cloudAmount !== undefined &&
          getCloudAmountClass(tg.changes.cloudAmount) !==
            getCloudAmountClass(baseBeforeTempo.cloudAmount)
        );
      }
      if (elKey === "F") {
        return (
          tg.changedElements.has("cloudBase") &&
          verifyCloudBase(baseBeforeTempo, tempoState) === 0
        );
      }
      return false;
    };

    const applyTempoQuota = (
      elKey: "A" | "B1" | "B2" | "C" | "D" | "E" | "F",
    ) => {
      if (!isElementChangedInTempo(elKey)) return;

      const matchedSlots = groupSlots.filter(
        (s) => s.tempoMatchFlags[elKey],
      ).length;
      const obsHours = matchedSlots * 0.5;

      let validHours = 0;
      if (obsHours === 0) {
        validHours = Math.round(0.3 * totalHours);
      } else if (obsHours <= 0.5 * totalHours) {
        validHours = totalHours;
      } else if (obsHours >= totalHours) {
        validHours = Math.round(0.6 * totalHours);
      } else {
        if (obsHours <= 0.6 * totalHours) {
          validHours = obsHours;
        } else {
          validHours = Math.round(0.6 * totalHours);
        }
      }

      const validSlotQuota = Math.min(
        totalSlots,
        Math.max(0, Math.round(validHours / 0.5)),
      );

      // Prioritaskan pemberian skor 1 pada baris yang memang cocok terlebih dahulu,
      // baru sisanya (jika kuota > jumlah baris cocok) diisi dari urutan atas
      const selectedIndices = new Set<number>();
      groupSlots.forEach((s, idx) => {
        if (s.tempoMatchFlags[elKey] && selectedIndices.size < validSlotQuota) {
          selectedIndices.add(idx);
        }
      });
      groupSlots.forEach((_, idx) => {
        if (selectedIndices.size < validSlotQuota) {
          selectedIndices.add(idx);
        }
      });

      groupSlots.forEach((s, idx) => {
        s.rawScores[elKey] = selectedIndices.has(idx) ? 1 : 0;
      });
    };

    applyTempoQuota("A");
    applyTempoQuota("B1");
    applyTempoQuota("B2");
    applyTempoQuota("C");
    applyTempoQuota("D");
    applyTempoQuota("E");
    applyTempoQuota("F");
  }

  const rows: VerificationRow[] = timeline.map((slot, index) => {
    const dt = new Date(slot.slotMs);
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const mm = String(dt.getUTCMinutes()).padStart(2, "0");

    const fDirStr =
      slot.activeState.windDir === "VRB"
        ? "VRB"
        : slot.activeState.windDir !== null
          ? String(slot.activeState.windDir)
          : "0";

    const oDirVal =
      slot.obs.state.windDir === "VRB"
        ? 999
        : slot.obs.state.windDir !== null
          ? slot.obs.state.windDir
          : 0;

    return {
      no: index + 1,
      tanggal: dt.getUTCDate(),
      waktuUtc: `${hh}:${mm}`,
      timestampMs: slot.slotMs,
      changeGroup: slot.groupLabel,
      fcstA: fDirStr,
      fcstB1: slot.activeState.windSpd,
      fcstB2: slot.activeState.gustSpd,
      fcstC: slot.activeState.vis === 10000 ? 9999 : slot.activeState.vis,
      fcstD: slot.activeState.hasSigPrecip
        ? slot.activeState.wxRaw || "RA"
        : "0",
      fcstE: slot.activeState.cloudAmount,
      fcstF:
        slot.activeState.cloudBaseFt !== null
          ? slot.activeState.cloudBaseFt
          : "-",
      metarRaw: slot.obs.raw,
      obsA: oDirVal,
      scoreA: slot.rawScores.A,
      obsB1: slot.obs.state.windSpd,
      scoreB1: slot.rawScores.B1,
      obsB2: slot.obs.state.gustSpd,
      scoreB2: slot.rawScores.B2,
      obsC: slot.obs.state.vis === 10000 ? 9999 : slot.obs.state.vis,
      scoreC: slot.rawScores.C,
      obsD: slot.obs.state.hasSigPrecip ? slot.obs.state.wxRaw || "RA" : "0",
      scoreD: slot.rawScores.D,
      obsE: slot.obs.state.cloudAmount,
      scoreE: slot.rawScores.E,
      obsF:
        slot.obs.state.cloudBaseFt !== null ? slot.obs.state.cloudBaseFt : "-",
      scoreF: slot.rawScores.F,
    };
  });

  const total = rows.length;
  const calcPct = (sum: number) =>
    total > 0 ? Number(((sum / total) * 100).toFixed(2)) : 0;

  const scores: ElementScores = {
    arahAngin: calcPct(rows.reduce((acc, r) => acc + r.scoreA, 0)),
    kecepatanAngin: calcPct(rows.reduce((acc, r) => acc + r.scoreB1, 0)),
    gusty: calcPct(rows.reduce((acc, r) => acc + r.scoreB2, 0)),
    visibilitas: calcPct(rows.reduce((acc, r) => acc + r.scoreC, 0)),
    presipitasi: calcPct(rows.reduce((acc, r) => acc + r.scoreD, 0)),
    jumlahAwan: calcPct(rows.reduce((acc, r) => acc + r.scoreE, 0)),
    tinggiAwan: calcPct(rows.reduce((acc, r) => acc + r.scoreF, 0)),
  };

  const sDt = taf.validStartUtc;
  const eDt = taf.validEndUtc;
  const periodeValiditasStr = `tanggal ${sDt.getUTCDate()} ${MONTH_NAMES_ID[sDt.getUTCMonth()]} ${String(sDt.getUTCFullYear())} ${String(sDt.getUTCHours()).padStart(2, "0")}.00 UTC – ${eDt.getUTCDate()} ${MONTH_NAMES_ID[eDt.getUTCMonth()]} ${String(eDt.getUTCHours()).padStart(2, "0")}.00 UTC`;

  return {
    tanggal: taf.validStartUtc.getUTCDate(),
    bulanIndex: taf.validStartUtc.getUTCMonth(),
    tahun: taf.validStartUtc.getUTCFullYear(),
    validityCycle: taf.validityCycle,
    periodeValiditasStr,
    rawTaf: taf.rawTaf,
    forecaster,
    verifikator,
    rows,
    scores,
    totalVerifiedRows: total,
  };
}
