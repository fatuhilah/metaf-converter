import XLSX from "xlsx-js-style";
import { MONTH_SHEETS, MONTH_SHORT_LABELS } from "./tafExcelHelper";

export type AcsDivisorMode = "auto" | "days" | "tno";

export interface AcsMetadata {
  aerodrome: string;
  icao: string;
  latitude: string;
  longitude: string;
  elevationM: string;
  observationTime: string;
}

export interface ParsedAcsHourlyObs {
  year: number;
  monthIndex: number; // 0..11
  day: number;
  hourUtc: number; // 0..23 (hanya jam penuh :00 UTC)
  rawMetar: string;
  rvrMeters: number | null; // nilai RVR (meter) jika dilaporkan di METAR
  visMeters: number; // jarak pandang mendatar (meter), 9999/CAVOK = 10000
  lowestBknOvcFt: number | null; // tinggi dasar awan terendah khusus BKN/OVC/VV (feet)
  windDir: number | "VRB" | null; // 0 = Calm, 10..360 = derajat, "VRB" = Variable
  windSpdKt: number; // kecepatan angin (knot)
  tempC: number | null; // suhu udara permukaan (°C)
}

export interface AcsMonthlyAggregated {
  monthIndex: number;
  monthName: string;
  yearsIncluded: number[];
  periodOfRecordStr: string;
  totalDays: number; // Σ jumlah hari pada bulan tsb lintas tahun
  tno: number; // Total Number of Observation (total jam pengamatan valid)
  activeHoursCount: number; // jumlah jam operasional per hari (misal 24)
  detectedObsTimeStr: string; // misal "00.00 - 23.00 UTC"
  hourlyObsCounts: number[]; // panjang 24 (jumlah observasi valid pada tiap jam 00..23)

  // MODEL A: 24 jam x 8 kolom kumulatif (sub-baris atas = RVR/VIS, sub-baris bawah = Hs BKN/OVC)
  modelA_VisFreq: number[][]; // [24][8]
  modelA_CloudFreq: number[][]; // [24][8]

  // MODEL B: 24 jam x 8 kolom kumulatif Visibility (<200 .. <8000 m)
  modelB_Freq: number[][]; // [24][8]

  // MODEL C: 24 jam x 6 kolom kumulatif Hs BKN/OVC (<150 .. <1500 ft)
  modelC_Freq: number[][]; // [24][6]

  // MODEL D: 14 baris arah x 9 kolom kecepatan (1-5 .. >40 KT)
  modelD_Freq: number[][]; // [14][9]
  modelD_CalmTotal: number; // khusus baris CALM (masuk langsung ke kolom TOTAL)

  // MODEL E: 24 jam x 9 kolom interval suhu (-5-0 .. >35 °C)
  modelE_Freq: number[][]; // [24][9]

  // Remarks otomatis (kejadian ekstrem)
  remarksModelA: string;
  remarksModelB: string;
  remarksModelC: string;
  remarksModelD: string;
  remarksModelE: string;
}

export interface FullAcsWorkbookResult {
  detectedIcao: string;
  yearsProcessed: number[];
  periodOfRecordStr: string;
  totalHourlyObsCount: number;
  monthlyData: AcsMonthlyAggregated[]; // 12 bulan (JANUARI - DESEMBER)
}

// Konstanta Label Kolom & Baris Baku Sesuai Lampiran III SOP ACS
export const MODEL_A_VIS_HEADERS = [
  "< 100",
  "< 200",
  "< 400",
  "< 800",
  "< 1500",
  "< 3000",
  "< 5000",
  "< 8000",
] as const;

export const MODEL_A_CLOUD_HEADERS = [
  "-",
  "-",
  "< 150",
  "< 200",
  "< 300",
  "< 1000",
  "< 1500",
  "< 2000",
] as const;

export const MODEL_B_HEADERS = [
  "< 200",
  "< 400",
  "< 600",
  "< 800",
  "< 1500",
  "< 3000",
  "< 5000",
  "< 8000",
] as const;

export const MODEL_C_HEADERS = [
  "< 150",
  "< 200",
  "< 300",
  "< 500",
  "< 1000",
  "< 1500",
] as const;

export const MODEL_D_DIR_ROWS = [
  "CALM",
  "VARIABEL",
  "35-36-01",
  "02-03-04",
  "05-06-07",
  "08-09-10",
  "11-12-13",
  "14-15-16",
  "17-18-19",
  "20-21-22",
  "23-24-25",
  "26-27-28",
  "29-30-31",
  "32-33-34",
] as const;

export const MODEL_D_SPEED_COLS = [
  "1-5",
  "6-10",
  "11-15",
  "16-20",
  "21-25",
  "26-30",
  "31-35",
  "36-40",
  ">40",
] as const;

export const MODEL_E_TEMP_COLS = [
  "-5-0",
  "0-5",
  "5-10",
  "10-15",
  "15-20",
  "20-25",
  "25-30",
  "30-35",
  ">35",
] as const;

const MODEL_A_VIS_THRESHOLDS = [100, 200, 400, 800, 1500, 3000, 5000, 8000];
const MODEL_A_CLOUD_THRESHOLDS = [null, null, 150, 200, 300, 1000, 1500, 2000];
const MODEL_B_THRESHOLDS = [200, 400, 600, 800, 1500, 3000, 5000, 8000];
const MODEL_C_THRESHOLDS = [150, 200, 300, 500, 1000, 1500];

function getDaysInMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// ============================================================================
// 1. GENERATOR TEMPLATE EXCEL 12 TAB BULAN (RAPI & MERGE TANGGAL PRESISI)
// ============================================================================
export function downloadAcsTemplate(year: number): void {
  const wb = XLSX.utils.book_new();

  const titleStyle = {
    font: { name: "Calibri", sz: 13, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const guideStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "065F46" } },
    fill: { fgColor: { rgb: "ECFDF5" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "A7F3D0" } },
      bottom: { style: "thin", color: { rgb: "A7F3D0" } },
      left: { style: "thin", color: { rgb: "A7F3D0" } },
      right: { style: "thin", color: { rgb: "A7F3D0" } },
    },
  };
  const legendStyle = {
    font: { name: "Calibri", sz: 9.5, color: { rgb: "334155" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: {
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } },
    },
  };
  const hdrLockedStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "1E293B" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "medium", color: { rgb: "475569" } },
      bottom: { style: "medium", color: { rgb: "475569" } },
      left: { style: "thin", color: { rgb: "64748B" } },
      right: { style: "thin", color: { rgb: "64748B" } },
    },
  };
  const hdrInputStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "065F46" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "medium", color: { rgb: "475569" } },
      bottom: { style: "medium", color: { rgb: "475569" } },
      left: { style: "thin", color: { rgb: "64748B" } },
      right: { style: "thin", color: { rgb: "64748B" } },
    },
  };

  MONTH_SHEETS.forEach((monthName, monthIdx) => {
    const daysCount = getDaysInMonthUtc(year, monthIdx);
    const aoa: Record<string, unknown>[][] = [];
    const merges: XLSX.Range[] = [];
    const rowsMeta: { hpt?: number }[] = [];

    // Row 0 (Excel Row 1): Judul + Tahun di B1
    aoa.push([
      {
        v: `TEMPLATE DATA METAR UNTUK ACS — ${monthName} ${year}`,
        t: "s",
        s: titleStyle,
      },
      { v: year, t: "n", s: titleStyle },
      { v: "", t: "s", s: titleStyle },
    ]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
    rowsMeta.push({ hpt: 26 });

    // Row 1 (Excel Row 2): Petunjuk
    aoa.push([
      {
        v: "PETUNJUK: Paste seluruh sandi METAR (rutin 30-menitan maupun jam penuh) di Kolom C. Sistem otomatis menyaring jam penuh (00:00–23:00 UTC).",
        t: "s",
        s: guideStyle,
      },
      { v: "", t: "s", s: guideStyle },
      { v: "", t: "s", s: guideStyle },
    ]);
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
    rowsMeta.push({ hpt: 21 });

    // Row 2 (Excel Row 3): Legenda Warna
    aoa.push([
      {
        v: "Keterangan:   [ Kolom A & B = Jadwal Tanggal & Jam (Jangan Diubah) ]     [ Baris Biru = Jam Penuh (:00 UTC) yang Dihitung ACS ]     [ Kolom C = Area Paste Sandi METAR ]",
        t: "s",
        s: legendStyle,
      },
      { v: "", t: "s", s: legendStyle },
      { v: "", t: "s", s: legendStyle },
    ]);
    merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 2 } });
    rowsMeta.push({ hpt: 19 });

    // Row 3 (Excel Row 4): Spasi
    aoa.push([]);
    rowsMeta.push({ hpt: 8 });

    // Row 4 (Excel Row 5): Header Kolom
    aoa.push([
      { v: "Tanggal", t: "s", s: hdrLockedStyle },
      { v: "Waktu (UTC)", t: "s", s: hdrLockedStyle },
      {
        v: "Sandi METAR (Raw) — Area Paste Data",
        t: "s",
        s: hdrInputStyle,
      },
    ]);
    rowsMeta.push({ hpt: 26 });

    // Data dimulai tepat pada index aoa.length (Row 5 / Excel Row 6)
    for (let d = 1; d <= daysCount; d++) {
      const dayBlockStartRow = aoa.length;
      const isEvenDay = d % 2 === 0;
      const dateBg = isEvenDay ? "E2E8F0" : "F1F5F9";
      const timeHalfBg = isEvenDay ? "F8FAFC" : "FFFFFF";
      const inputBg = isEvenDay ? "F8FAFC" : "FFFFFF";

      let slotIdx = 0;
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 30]) {
          const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const isFirstSlot = slotIdx === 0;
          const isLastSlot = slotIdx === 47;
          const isFullHour = m === 0;

          const rowBorder = {
            top: isFirstSlot
              ? { style: "medium", color: { rgb: "475569" } }
              : { style: "thin", color: { rgb: "CBD5E1" } },
            bottom: isLastSlot
              ? { style: "medium", color: { rgb: "475569" } }
              : { style: "thin", color: { rgb: "E2E8F0" } },
            left: { style: "thin", color: { rgb: "94A3B8" } },
            right: { style: "thin", color: { rgb: "94A3B8" } },
          };

          const dateBlockBorder = {
            top: { style: "medium", color: { rgb: "475569" } },
            bottom: { style: "medium", color: { rgb: "475569" } },
            left: { style: "medium", color: { rgb: "475569" } },
            right: { style: "medium", color: { rgb: "475569" } },
          };

          aoa.push([
            {
              v: isFirstSlot ? d : "",
              t: isFirstSlot ? "n" : "s",
              s: {
                font: {
                  name: "Calibri",
                  sz: 12,
                  bold: true,
                  color: { rgb: "0F172A" },
                },
                fill: { fgColor: { rgb: dateBg } },
                alignment: {
                  horizontal: "center",
                  vertical: "top",
                },
                border: dateBlockBorder,
              },
            },
            {
              v: timeStr,
              t: "s",
              s: {
                font: {
                  name: "Consolas",
                  sz: 9.5,
                  bold: isFullHour,
                  color: { rgb: isFullHour ? "1E3A8A" : "64748B" },
                },
                fill: {
                  fgColor: { rgb: isFullHour ? "DBEAFE" : timeHalfBg },
                },
                alignment: { horizontal: "center", vertical: "center" },
                border: rowBorder,
              },
            },
            {
              v: "",
              t: "s",
              s: {
                font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
                fill: { fgColor: { rgb: inputBg } },
                alignment: { horizontal: "left", vertical: "center" },
                border: rowBorder,
              },
            },
          ]);

          rowsMeta.push({ hpt: 19 });
          slotIdx++;
        }
      }

      // Merge kolom Tanggal tepat dari slot 00:00 (dayBlockStartRow) sampai slot 23:30 (dayBlockStartRow + 47)
      merges.push({
        s: { r: dayBlockStartRow, c: 0 },
        e: { r: dayBlockStartRow + 47, c: 0 },
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!rows"] = rowsMeta;
    ws["!cols"] = [{ wch: 13 }, { wch: 14 }, { wch: 70 }];
    // Freeze 5 baris header teratas agar judul & nama kolom tidak ikut tergulung
    ws["!views"] = [{ state: "frozen", ySplit: 5 }];

    XLSX.utils.book_append_sheet(wb, ws, monthName);
  });

  XLSX.writeFile(wb, `Template_ACS_METAR_${year}_12Bulan.xlsx`);
}

// ============================================================================
// 2. PARSER SANDI METAR KHUSUS JAM PENUH (:00 UTC) UNTUK ACS
// ============================================================================
function parseSingleMetarForAcs(
  rawMetar: string,
  year: number,
  monthIndex: number,
  fallbackDay: number,
  fallbackHour: number,
  fallbackMinute: number,
): ParsedAcsHourlyObs | null {
  const clean = rawMetar.replace(/=/g, "").trim().toUpperCase();
  if (!clean || clean.includes(" NIL")) return null;

  // Potong bagian TREND / RMK agar tidak mencemari data observasi utama
  const mainBody = clean.split(/\b(?:NOSIG|BECMG|TEMPO|RMK)\b/)[0].trim();
  const tokens = mainBody.split(/\s+/);

  let day = fallbackDay;
  let hourUtc = fallbackHour;
  let minuteUtc = fallbackMinute;

  for (const t of tokens) {
    const zMatch = t.match(/^(\d{2})(\d{2})(\d{2})Z$/);
    if (zMatch) {
      day = parseInt(zMatch[1], 10);
      hourUtc = parseInt(zMatch[2], 10);
      minuteUtc = parseInt(zMatch[3], 10);
      break;
    }
  }

  // SOP ACS Pasal 1 & Pasal 4: Hanya ambil JAM PENUH (:00 UTC)
  if (minuteUtc !== 0) return null;

  let windDir: number | "VRB" | null = null;
  let windSpdKt = 0;
  let visMeters = 10000;
  let rvrMeters: number | null = null;
  let lowestBknOvcFt: number | null = null;
  let tempC: number | null = null;

  for (const t of tokens) {
    // Angin: dddff(Gff)KT atau VRBff(Gff)KT
    const windMatch = t.match(
      /^(VRB|\d{3})P?(\d{2,3})(?:GP?\d{2,3})?(?:KT|MPS)$/,
    );
    if (windMatch) {
      const dirPart = windMatch[1];
      const spdVal = parseInt(windMatch[2], 10);
      windSpdKt = spdVal;
      if (dirPart === "VRB") {
        windDir = spdVal === 0 ? 0 : "VRB";
      } else {
        const deg = parseInt(dirPart, 10);
        windDir = spdVal === 0 && deg === 0 ? 0 : deg;
      }
      continue;
    }

    // CAVOK
    if (t === "CAVOK") {
      visMeters = 10000;
      continue;
    }

    // Visibilitas 4 digit
    if (/^\d{4}$/.test(t)) {
      const v = parseInt(t, 10);
      visMeters = v === 9999 ? 10000 : v;
      continue;
    }

    // RVR: R21/0800 atau R09L/P1500 atau R18/0400V0800
    const rvrMatch = t.match(
      /^R\d{2}[LCR]?\/([PM])?(\d{4})(?:V[PM]?\d{4})?(?:FT|[UDN])?$/,
    );
    if (rvrMatch) {
      const modifier = rvrMatch[1];
      let val = parseInt(rvrMatch[2], 10);
      if (modifier === "P") val += 1;
      if (modifier === "M") val = Math.max(0, val - 1);
      if (rvrMeters === null || val < rvrMeters) {
        rvrMeters = val;
      }
      continue;
    }

    // Awan: Khusus BKN, OVC, atau VV terendah (FEW/SCT tidak dihitung di ACS Model A & C)
    const cldMatch = t.match(/^(BKN|OVC|VV)(\d{3}|\/\/\/)(?:CB|TCU)?$/);
    if (cldMatch) {
      const hRaw = cldMatch[2];
      const hFt = hRaw === "///" ? 0 : parseInt(hRaw, 10) * 100;
      if (lowestBknOvcFt === null || hFt < lowestBknOvcFt) {
        lowestBknOvcFt = hFt;
      }
      continue;
    }

    // Suhu Udara / Titik Embun: TT/TdTd (misal 28/24 atau M02/M05)
    const tempMatch = t.match(/^(M?\d{2})\/(M?\d{2}|\/\/)$/);
    if (tempMatch) {
      const rawT = tempMatch[1];
      tempC = rawT.startsWith("M")
        ? -parseInt(rawT.slice(1), 10)
        : parseInt(rawT, 10);
      continue;
    }
  }

  return {
    year,
    monthIndex,
    day,
    hourUtc,
    rawMetar: rawMetar.trim(),
    rvrMeters,
    visMeters,
    lowestBknOvcFt,
    windDir,
    windSpdKt,
    tempC,
  };
}

// Klasifikasi sektor arah angin 30 derajat (Lampiran III Model D)
function getWindDirectionRowIndex(
  dir: number | "VRB" | null,
  spdKt: number,
): number {
  if (spdKt === 0 || dir === 0 || dir === null) return 0; // CALM
  if (dir === "VRB") return 1; // VARIABEL

  let deg = dir % 360;
  if (deg <= 0) deg += 360;

  if (deg >= 345 || deg <= 15) return 2; // 35-36-01
  if (deg <= 45) return 3; // 02-03-04
  if (deg <= 75) return 4; // 05-06-07
  if (deg <= 105) return 5; // 08-09-10
  if (deg <= 135) return 6; // 11-12-13
  if (deg <= 165) return 7; // 14-15-16
  if (deg <= 195) return 8; // 17-18-19
  if (deg <= 225) return 9; // 20-21-22
  if (deg <= 255) return 10; // 23-24-25
  if (deg <= 285) return 11; // 26-27-28
  if (deg <= 315) return 12; // 29-30-31
  return 13; // 32-33-34 (316..344)
}

function getWindSpeedColIndex(spdKt: number): number {
  if (spdKt <= 5) return 0; // 1-5
  if (spdKt <= 10) return 1; // 6-10
  if (spdKt <= 15) return 2; // 11-15
  if (spdKt <= 20) return 3; // 16-20
  if (spdKt <= 25) return 4; // 21-25
  if (spdKt <= 30) return 5; // 26-30
  if (spdKt <= 35) return 6; // 31-35
  if (spdKt <= 40) return 7; // 36-40
  return 8; // >40
}

function getTemperatureColIndex(tempC: number): number {
  if (tempC <= 0) return 0; // -5-0
  if (tempC <= 5) return 1; // 0-5
  if (tempC <= 10) return 2; // 5-10
  if (tempC <= 15) return 3; // 10-15
  if (tempC <= 20) return 4; // 15-20
  if (tempC <= 25) return 5; // 20-25
  if (tempC <= 30) return 6; // 25-30
  if (tempC <= 35) return 7; // 30-35
  return 8; // >35
}

// ============================================================================
// 3. PARSER MULTI-FILE WORKBOOK TAHUNAN & AGREGATOR 12 BULAN ACS
// ============================================================================
export function processAcsWorkbooks(
  files: { name: string; buffer: ArrayBuffer }[],
): FullAcsWorkbookResult {
  const uniqueObsMap = new Map<string, ParsedAcsHourlyObs>();
  const yearsSet = new Set<number>();
  let detectedIcao = "";

  for (const f of files) {
    const wb = XLSX.read(f.buffer, { type: "array" });

    let fileYear = new Date().getUTCFullYear();
    const fnYearMatch = f.name.match(/\b(20\d{2})\b/);
    if (fnYearMatch) fileYear = parseInt(fnYearMatch[1], 10);

    for (const sName of wb.SheetNames) {
      const ws = wb.Sheets[sName];
      if (!ws) continue;
      const b1 = ws["B1"]?.v;
      if (typeof b1 === "number" && b1 >= 2000 && b1 <= 2100) {
        fileYear = b1;
        break;
      }
      const a1 = String(ws["A1"]?.v || "");
      const yrMatch = a1.match(/\b(20\d{2})\b/);
      if (yrMatch) {
        fileYear = parseInt(yrMatch[1], 10);
        break;
      }
    }

    MONTH_SHEETS.forEach((monthName, monthIdx) => {
      const actualSheetName = wb.SheetNames.find(
        (n) => n.trim().toUpperCase() === monthName,
      );
      if (!actualSheetName) return;

      const ws = wb.Sheets[actualSheetName];
      if (!ws) return;

      const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(
        ws,
        { header: 1, defval: "" },
      );

      let startRow = 5;
      let dayCol = 0;
      let timeCol = 1;
      let metarCol = 2;

      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const row = rows[r] || [];
        const c0 = String(row[0] ?? "")
          .trim()
          .toLowerCase();
        const c6 = String(row[6] ?? "")
          .trim()
          .toLowerCase();
        if (
          c6 === "tanggal" &&
          String(row[8] ?? "")
            .toLowerCase()
            .includes("metar")
        ) {
          startRow = r + 1;
          dayCol = 6;
          timeCol = 7;
          metarCol = 8;
          break;
        }
        if (c0 === "tanggal") {
          startRow = r + 1;
          dayCol = 0;
          timeCol = 1;
          metarCol = 2;
          break;
        }
      }

      let lastDay = 1;
      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;

        const rawDay = String(row[dayCol] ?? "").trim();
        const rawTime = String(row[timeCol] ?? "").trim();
        const rawMetar = String(row[metarCol] ?? "").trim();

        if (rawDay.includes("(")) break;

        if (rawDay !== "" && !isNaN(Number(rawDay))) {
          lastDay = Number(rawDay);
        }

        if (!rawMetar) continue;

        let hh = 0;
        let mm = 0;
        const tMatch = rawTime.match(/^(\d{1,2})[:.](\d{2})/);
        if (tMatch) {
          hh = parseInt(tMatch[1], 10);
          mm = parseInt(tMatch[2], 10);
        }

        const parsed = parseSingleMetarForAcs(
          rawMetar,
          fileYear,
          monthIdx,
          lastDay,
          hh,
          mm,
        );

        if (parsed) {
          if (!detectedIcao) {
            const stMatch = rawMetar
              .toUpperCase()
              .match(/\b(?:METAR|SPECI)\s+([A-Z]{4})\b/);
            if (stMatch) detectedIcao = stMatch[1];
          }
          yearsSet.add(parsed.year);
          const slotKey = `${parsed.year}-${String(parsed.monthIndex).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}-${String(parsed.hourUtc).padStart(2, "0")}`;
          uniqueObsMap.set(slotKey, parsed);
        }
      }
    });
  }

  const allHourlyObs = Array.from(uniqueObsMap.values());
  const yearsProcessed = Array.from(yearsSet).sort((a, b) => a - b);
  const overallPeriodStr =
    yearsProcessed.length === 0
      ? "-"
      : yearsProcessed.length === 1
        ? String(yearsProcessed[0])
        : `${yearsProcessed[0]}–${yearsProcessed[yearsProcessed.length - 1]}`;

  const monthlyData: AcsMonthlyAggregated[] = MONTH_SHEETS.map(
    (monthName, monthIndex) => {
      const monthObs = allHourlyObs.filter((o) => o.monthIndex === monthIndex);
      const monthYears = Array.from(new Set(monthObs.map((o) => o.year))).sort(
        (a, b) => a - b,
      );

      const totalDays = monthYears.reduce(
        (acc, yr) => acc + getDaysInMonthUtc(yr, monthIndex),
        0,
      );

      const periodOfRecordStr =
        monthYears.length === 0
          ? overallPeriodStr
          : monthYears.length === 1
            ? String(monthYears[0])
            : `${monthYears[0]}–${monthYears[monthYears.length - 1]}`;

      const hourlyObsCounts = Array(24).fill(0);
      const modelA_VisFreq = Array.from({ length: 24 }, () => Array(8).fill(0));
      const modelA_CloudFreq = Array.from({ length: 24 }, () =>
        Array(8).fill(0),
      );
      const modelB_Freq = Array.from({ length: 24 }, () => Array(8).fill(0));
      const modelC_Freq = Array.from({ length: 24 }, () => Array(6).fill(0));
      const modelD_Freq = Array.from({ length: 14 }, () => Array(9).fill(0));
      let modelD_CalmTotal = 0;
      const modelE_Freq = Array.from({ length: 24 }, () => Array(9).fill(0));

      const hotHoursSet = new Set<number>();
      const lowVisHoursSet = new Set<number>();
      const lowCeilingHoursSet = new Set<number>();

      for (const obs of monthObs) {
        const h = obs.hourUtc;
        if (h < 0 || h > 23) continue;

        hourlyObsCounts[h] += 1;

        MODEL_A_VIS_THRESHOLDS.forEach((limit, colIdx) => {
          const effectiveVal =
            colIdx <= 1
              ? obs.rvrMeters
              : obs.rvrMeters !== null
                ? obs.rvrMeters
                : obs.visMeters;
          if (effectiveVal !== null && effectiveVal < limit) {
            modelA_VisFreq[h][colIdx] += 1;
          }
        });

        if (obs.lowestBknOvcFt !== null) {
          MODEL_A_CLOUD_THRESHOLDS.forEach((limit, colIdx) => {
            if (limit !== null && obs.lowestBknOvcFt! < limit) {
              modelA_CloudFreq[h][colIdx] += 1;
            }
          });
        }

        MODEL_B_THRESHOLDS.forEach((limit, colIdx) => {
          if (obs.visMeters < limit) {
            modelB_Freq[h][colIdx] += 1;
          }
        });
        if (obs.visMeters < 1500) lowVisHoursSet.add(h);

        if (obs.lowestBknOvcFt !== null) {
          MODEL_C_THRESHOLDS.forEach((limit, colIdx) => {
            if (obs.lowestBknOvcFt! < limit) {
              modelC_Freq[h][colIdx] += 1;
            }
          });
          if (obs.lowestBknOvcFt < 500) lowCeilingHoursSet.add(h);
        }

        const dirIdx = getWindDirectionRowIndex(obs.windDir, obs.windSpdKt);
        if (dirIdx === 0) {
          modelD_CalmTotal += 1;
        } else {
          const spdIdx = getWindSpeedColIndex(obs.windSpdKt);
          modelD_Freq[dirIdx][spdIdx] += 1;
        }

        if (obs.tempC !== null) {
          const tIdx = getTemperatureColIndex(obs.tempC);
          modelE_Freq[h][tIdx] += 1;
          if (obs.tempC > 35) hotHoursSet.add(h);
        }
      }

      const activeHours = hourlyObsCounts
        .map((cnt, hr) => (cnt > 0 ? hr : -1))
        .filter((hr) => hr >= 0);

      const activeHoursCount = activeHours.length > 0 ? activeHours.length : 24;

      const detectedObsTimeStr =
        activeHours.length === 0
          ? "00.00 – 23.00 UTC"
          : `${String(activeHours[0]).padStart(2, "0")}.00 – ${String(activeHours[activeHours.length - 1]).padStart(2, "0")}.00 UTC`;

      const formatHourList = (s: Set<number>) =>
        Array.from(s)
          .sort((a, b) => a - b)
          .map((hr) => String(hr).padStart(2, "0"))
          .join(", ");

      const remarksModelE =
        hotHoursSet.size > 0
          ? `Suhu udara > 35°C terjadi pada jam ${formatHourList(hotHoursSet)} UTC`
          : "-";

      const remarksModelB =
        lowVisHoursSet.size > 0
          ? `Visibility < 1500 m terjadi pada jam ${formatHourList(lowVisHoursSet)} UTC`
          : "-";

      const remarksModelC =
        lowCeilingHoursSet.size > 0
          ? `Tinggi dasar awan BKN/OVC < 500 ft terjadi pada jam ${formatHourList(lowCeilingHoursSet)} UTC`
          : "-";

      const remarksModelA =
        lowVisHoursSet.size > 0 || lowCeilingHoursSet.size > 0
          ? [
              lowVisHoursSet.size > 0
                ? `Vis/RVR < 1500 m pada jam ${formatHourList(lowVisHoursSet)} UTC`
                : "",
              lowCeilingHoursSet.size > 0
                ? `Hs < 500 ft pada jam ${formatHourList(lowCeilingHoursSet)} UTC`
                : "",
            ]
              .filter(Boolean)
              .join("; ")
          : "-";

      return {
        monthIndex,
        monthName,
        yearsIncluded: monthYears,
        periodOfRecordStr,
        totalDays,
        tno: monthObs.length,
        activeHoursCount,
        detectedObsTimeStr,
        hourlyObsCounts,
        modelA_VisFreq,
        modelA_CloudFreq,
        modelB_Freq,
        modelC_Freq,
        modelD_Freq,
        modelD_CalmTotal,
        modelE_Freq,
        remarksModelA,
        remarksModelB,
        remarksModelC,
        remarksModelD: "-",
        remarksModelE,
      };
    },
  );

  return {
    detectedIcao,
    yearsProcessed,
    periodOfRecordStr: overallPeriodStr,
    totalHourlyObsCount: allHourlyObs.length,
    monthlyData,
  };
}

// ============================================================================
// 4. KALKULATOR PERSENTASE & PEMBANGUN WORKBOOK EXCEL ACS (LAMPIRAN III)
// ============================================================================

export function resolveAcsDivisor(
  mData: AcsMonthlyAggregated,
  divisorMode: AcsDivisorMode,
): number {
  if (divisorMode === "days") return Math.max(1, mData.totalDays);
  if (divisorMode === "tno") return Math.max(1, mData.tno);
  return mData.yearsIncluded.length <= 1
    ? Math.max(1, mData.totalDays)
    : Math.max(1, mData.tno);
}

const THIN_BORDER = {
  top: { style: "thin", color: { rgb: "334155" } },
  bottom: { style: "thin", color: { rgb: "334155" } },
  left: { style: "thin", color: { rgb: "334155" } },
  right: { style: "thin", color: { rgb: "334155" } },
};

const MED_BOX = {
  top: { style: "medium", color: { rgb: "0F172A" } },
  bottom: { style: "medium", color: { rgb: "0F172A" } },
  left: { style: "medium", color: { rgb: "0F172A" } },
  right: { style: "medium", color: { rgb: "0F172A" } },
};

type StyledCell = {
  v?: string | number;
  t?: "s" | "n";
  f?: string;
  z?: string;
  s?: Record<string, unknown>;
};

function makeCell(
  v: string | number,
  style: Record<string, unknown>,
  options?: { f?: string; z?: string; t?: "s" | "n" },
): StyledCell {
  const cell: StyledCell = {
    v,
    t: options?.t ?? (typeof v === "number" ? "n" : "s"),
    s: style,
  };
  if (options?.f) cell.f = options.f;
  if (options?.z) cell.z = options.z;
  return cell;
}

function appendKopBlock(
  aoa: StyledCell[][],
  merges: XLSX.Range[],
  rowsMeta: { hpt?: number }[],
  totalCols: number,
  modelLabel: string,
  mData: AcsMonthlyAggregated,
  meta: AcsMetadata,
  divisorValue: number,
): { tnoCellRef: string; divisorCellRef: string } {
  const lastCol = totalCols - 1;
  const midCol = Math.floor(totalCols / 2);

  const kopBold = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const kopVal = {
    font: { name: "Calibri", sz: 10, bold: false, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const kopNumVal = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left", vertical: "center" },
  };

  const padRow = (cells: StyledCell[]) => {
    while (cells.length < totalCols) {
      cells.push(makeCell("", kopVal));
    }
    return cells;
  };

  aoa.push(
    padRow([
      makeCell("AERODROME CLIMATOLOGICAL SUMMARY", {
        ...kopBold,
        sz: 11,
      }),
    ]),
  );
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } });
  rowsMeta.push({ hpt: 20 });

  aoa.push(
    padRow([
      makeCell("TABULAR FORM", kopBold),
      makeCell("", kopBold),
      makeCell(`MODEL ${modelLabel}`, kopBold),
    ]),
  );
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: lastCol } });
  rowsMeta.push({ hpt: 18 });

  const r2 = padRow([]);
  r2[0] = makeCell(`AERODROME : ${meta.aerodrome || "-"}`, kopBold);
  r2[midCol] = makeCell(
    `MONTH : ${mData.monthName}   |   PERIODE OF RECORD : ${mData.periodOfRecordStr}`,
    kopBold,
  );
  aoa.push(r2);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: midCol - 1 } });
  merges.push({ s: { r: 2, c: midCol }, e: { r: 2, c: lastCol } });
  rowsMeta.push({ hpt: 18 });

  const r3 = padRow([]);
  r3[0] = makeCell("TOTAL NUMBER OF OBSERVATION :", kopBold);
  r3[2] = makeCell(mData.tno, kopNumVal);
  r3[midCol] = makeCell(
    `OBSERVATION TIME : ${meta.observationTime || mData.detectedObsTimeStr}`,
    kopBold,
  );
  r3[lastCol - 1] = makeCell("DIVISOR (n) :", kopBold);
  r3[lastCol] = makeCell(divisorValue, kopNumVal);
  aoa.push(r3);
  merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: 1 } });
  merges.push({ s: { r: 3, c: midCol }, e: { r: 3, c: lastCol - 2 } });
  rowsMeta.push({ hpt: 18 });

  const r4 = padRow([]);
  r4[0] = makeCell(
    `LATITUDE : ${meta.latitude || "-"}   |   LONGITUDE : ${meta.longitude || "-"}`,
    kopBold,
  );
  r4[midCol] = makeCell(
    `ELEVATION ABOVE MSL : ${meta.elevationM ? `${meta.elevationM} M` : "-"}`,
    kopBold,
  );
  aoa.push(r4);
  merges.push({ s: { r: 4, c: 0 }, e: { r: 4, c: midCol - 1 } });
  merges.push({ s: { r: 4, c: midCol }, e: { r: 4, c: lastCol } });
  rowsMeta.push({ hpt: 18 });

  for (let r = 0; r <= 4; r++) {
    for (let c = 0; c <= lastCol; c++) {
      const cell = aoa[r][c];
      const existingStyle = cell.s || {};
      const bdr: Record<string, unknown> = {};
      if (r === 0) bdr.top = MED_BOX.top;
      if (r === 4) bdr.bottom = MED_BOX.bottom;
      if (c === 0) bdr.left = MED_BOX.left;
      if (c === lastCol) bdr.right = MED_BOX.right;
      cell.s = { ...existingStyle, border: bdr };
    }
  }

  aoa.push([]);
  rowsMeta.push({ hpt: 8 });

  const lastColLetter = XLSX.utils.encode_col(lastCol);
  return {
    tnoCellRef: "$C$4",
    divisorCellRef: `$${lastColLetter}$4`,
  };
}

// ============================================================================
// 5. EKSPOR FILE EXCEL ACS LENGKAP (DENGAN RUMUS AKTIF)
// ============================================================================
export function exportAcsExcelWorkbook(
  result: FullAcsWorkbookResult,
  monthIndex: number,
  hasRvr: boolean,
  divisorMode: AcsDivisorMode,
  meta: AcsMetadata,
): void {
  const mData = result.monthlyData[monthIndex];
  if (!mData) return;

  const wb = XLSX.utils.book_new();
  const divisorVal = resolveAcsDivisor(mData, divisorMode);

  const tblTitleStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };
  const hdrStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };
  const timeCellStyle = {
    font: { name: "Consolas", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const numCellStyle = {
    font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const subCloudCellStyle = {
    font: { name: "Consolas", sz: 9.5, italic: true, color: { rgb: "1E3A8A" } },
    fill: { fgColor: { rgb: "EFF6FF" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const meanStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "FDE047" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const remarksStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const buildModelASheet = () => {
    const aoa: StyledCell[][] = [];
    const merges: XLSX.Range[] = [];
    const rowsMeta: { hpt?: number }[] = [];

    const { divisorCellRef } = appendKopBlock(
      aoa,
      merges,
      rowsMeta,
      9,
      "A",
      mData,
      meta,
      divisorVal,
    );

    aoa.push(
      Array.from({ length: 9 }, (_, c) =>
        makeCell(
          c === 0
            ? "FREQUENCIES (PER CENT) OF THE OCCURRENCE OF RUNWAY VISUAL RANGE / VISIBILITY (BOTH IN METRES) AND/OR HEIGHT OF THE BASE OF THE LOWEST CLOUD LAYER (IN FEET) OF BKN OR OVC EXTENT BELOW SPECIFIED VALUES AT SPECIFIED TIMES"
            : "",
          tblTitleStyle,
        ),
      ),
    );
    merges.push({ s: { r: 6, c: 0 }, e: { r: 6, c: 8 } });
    rowsMeta.push({ hpt: 34 });

    aoa.push([
      makeCell("TIME\n(UTC)", hdrStyle),
      makeCell("RVR / Hs", hdrStyle),
      makeCell("", hdrStyle),
      makeCell("", hdrStyle),
      makeCell("", hdrStyle),
      makeCell("", hdrStyle),
      makeCell("VIS / Hs", hdrStyle),
      makeCell("", hdrStyle),
      makeCell("", hdrStyle),
    ]);
    merges.push({ s: { r: 7, c: 0 }, e: { r: 9, c: 0 } });
    merges.push({ s: { r: 7, c: 1 }, e: { r: 7, c: 5 } });
    merges.push({ s: { r: 7, c: 6 }, e: { r: 7, c: 8 } });
    rowsMeta.push({ hpt: 20 });

    aoa.push([
      makeCell("", hdrStyle),
      ...MODEL_A_VIS_HEADERS.map((h) => makeCell(h, hdrStyle)),
    ]);
    rowsMeta.push({ hpt: 20 });

    aoa.push([
      makeCell("", hdrStyle),
      ...MODEL_A_CLOUD_HEADERS.map((h) => makeCell(h, hdrStyle)),
    ]);
    rowsMeta.push({ hpt: 20 });

    const startDataRow = 10;
    for (let h = 0; h < 24; h++) {
      const rVis = startDataRow + h * 2;
      const rCld = rVis + 1;
      const hrStr = String(h).padStart(2, "0");

      const rowVisCells: StyledCell[] = [makeCell(hrStr, timeCellStyle)];
      const rowCldCells: StyledCell[] = [makeCell("", timeCellStyle)];

      for (let c = 0; c < 8; c++) {
        const visFreq = mData.modelA_VisFreq[h][c];
        const visPct = Number(((visFreq / divisorVal) * 100).toFixed(1));
        rowVisCells.push(
          makeCell(visPct, numCellStyle, {
            t: "n",
            f: `IF(${visFreq}=0, 0, ROUND((${visFreq}/${divisorCellRef})*100, 1))`,
            z: "0.0",
          }),
        );

        if (c <= 1) {
          rowCldCells.push(makeCell("-", subCloudCellStyle));
        } else {
          const cldFreq = mData.modelA_CloudFreq[h][c];
          const cldPct = Number(((cldFreq / divisorVal) * 100).toFixed(1));
          rowCldCells.push(
            makeCell(cldPct, subCloudCellStyle, {
              t: "n",
              f: `IF(${cldFreq}=0, 0, ROUND((${cldFreq}/${divisorCellRef})*100, 1))`,
              z: "0.0",
            }),
          );
        }
      }

      aoa.push(rowVisCells);
      aoa.push(rowCldCells);
      merges.push({ s: { r: rVis, c: 0 }, e: { r: rCld, c: 0 } });
      rowsMeta.push({ hpt: 19 }, { hpt: 19 });
    }

    const meanVisRow = startDataRow + 48;
    const meanCldRow = meanVisRow + 1;
    const meanVisCells: StyledCell[] = [makeCell("Mean", meanStyle)];
    const meanCldCells: StyledCell[] = [makeCell("", meanStyle)];

    for (let c = 0; c < 8; c++) {
      const colLetter = XLSX.utils.encode_col(c + 1);
      const visRefs = Array.from(
        { length: 24 },
        (_, h) => `${colLetter}${startDataRow + h * 2 + 1}`,
      ).join(",");
      const visSumPct = Array.from(
        { length: 24 },
        (_, h) => (mData.modelA_VisFreq[h][c] / divisorVal) * 100,
      ).reduce((a, b) => a + b, 0);

      meanVisCells.push(
        makeCell(
          Number((visSumPct / mData.activeHoursCount).toFixed(1)),
          meanStyle,
          {
            t: "n",
            f: `ROUND(SUM(${visRefs})/${mData.activeHoursCount}, 1)`,
            z: "0.0",
          },
        ),
      );

      if (c <= 1) {
        meanCldCells.push(makeCell("-", meanStyle));
      } else {
        const cldRefs = Array.from(
          { length: 24 },
          (_, h) => `${colLetter}${startDataRow + h * 2 + 2}`,
        ).join(",");
        const cldSumPct = Array.from(
          { length: 24 },
          (_, h) => (mData.modelA_CloudFreq[h][c] / divisorVal) * 100,
        ).reduce((a, b) => a + b, 0);

        meanCldCells.push(
          makeCell(
            Number((cldSumPct / mData.activeHoursCount).toFixed(1)),
            meanStyle,
            {
              t: "n",
              f: `ROUND(SUM(${cldRefs})/${mData.activeHoursCount}, 1)`,
              z: "0.0",
            },
          ),
        );
      }
    }

    aoa.push(meanVisCells);
    aoa.push(meanCldCells);
    merges.push({ s: { r: meanVisRow, c: 0 }, e: { r: meanCldRow, c: 0 } });
    rowsMeta.push({ hpt: 20 }, { hpt: 20 });

    const remRow = meanCldRow + 1;
    aoa.push(
      Array.from({ length: 9 }, (_, c) =>
        makeCell(
          c === 0 ? `Remarks : ${mData.remarksModelA}` : "",
          remarksStyle,
        ),
      ),
    );
    merges.push({ s: { r: remRow, c: 0 }, e: { r: remRow, c: 8 } });
    rowsMeta.push({ hpt: 24 });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!rows"] = rowsMeta;
    ws["!cols"] = [{ wch: 12 }, ...Array(8).fill({ wch: 11 })];
    return ws;
  };

  const buildCumulativeSheet = (
    modelCode: "B" | "C",
    bannerTitle: string,
    groupHeader: string,
    colHeaders: readonly string[],
    freqMatrix: number[][],
    remarksText: string,
  ) => {
    const colCount = colHeaders.length + 1;
    const lastCol = colCount - 1;
    const aoa: StyledCell[][] = [];
    const merges: XLSX.Range[] = [];
    const rowsMeta: { hpt?: number }[] = [];

    const { divisorCellRef } = appendKopBlock(
      aoa,
      merges,
      rowsMeta,
      colCount,
      modelCode,
      mData,
      meta,
      divisorVal,
    );

    aoa.push(
      Array.from({ length: colCount }, (_, c) =>
        makeCell(c === 0 ? bannerTitle : "", tblTitleStyle),
      ),
    );
    merges.push({ s: { r: 6, c: 0 }, e: { r: 6, c: lastCol } });
    rowsMeta.push({ hpt: 30 });

    aoa.push([
      makeCell("TIME\n(GMT)", hdrStyle),
      makeCell(groupHeader, hdrStyle),
      ...Array.from({ length: colHeaders.length - 1 }, () =>
        makeCell("", hdrStyle),
      ),
    ]);
    merges.push({ s: { r: 7, c: 0 }, e: { r: 8, c: 0 } });
    merges.push({ s: { r: 7, c: 1 }, e: { r: 7, c: lastCol } });
    rowsMeta.push({ hpt: 20 });

    aoa.push([
      makeCell("", hdrStyle),
      ...colHeaders.map((h) => makeCell(h, hdrStyle)),
    ]);
    rowsMeta.push({ hpt: 20 });

    const startDataRow = 9;
    for (let h = 0; h < 24; h++) {
      const hrStr = String(h).padStart(2, "0");
      const rowCells: StyledCell[] = [makeCell(hrStr, timeCellStyle)];

      for (let c = 0; c < colHeaders.length; c++) {
        const freq = freqMatrix[h][c];
        const pct = Number(((freq / divisorVal) * 100).toFixed(1));
        rowCells.push(
          makeCell(pct, numCellStyle, {
            t: "n",
            f: `IF(${freq}=0, 0, ROUND((${freq}/${divisorCellRef})*100, 1))`,
            z: "0.0",
          }),
        );
      }
      aoa.push(rowCells);
      rowsMeta.push({ hpt: 20 });
    }

    const meanRow = startDataRow + 24;
    const meanCells: StyledCell[] = [makeCell("MEAN (%)", meanStyle)];
    for (let c = 0; c < colHeaders.length; c++) {
      const colLetter = XLSX.utils.encode_col(c + 1);
      const sumPct = Array.from(
        { length: 24 },
        (_, h) => (freqMatrix[h][c] / divisorVal) * 100,
      ).reduce((a, b) => a + b, 0);

      meanCells.push(
        makeCell(
          Number((sumPct / mData.activeHoursCount).toFixed(1)),
          meanStyle,
          {
            t: "n",
            f: `ROUND(SUM(${colLetter}${startDataRow + 1}:${colLetter}${meanRow})/${mData.activeHoursCount}, 1)`,
            z: "0.0",
          },
        ),
      );
    }
    aoa.push(meanCells);
    rowsMeta.push({ hpt: 21 });

    const remRow = meanRow + 1;
    aoa.push(
      Array.from({ length: colCount }, (_, c) =>
        makeCell(c === 0 ? `Remarks : ${remarksText}` : "", remarksStyle),
      ),
    );
    merges.push({ s: { r: remRow, c: 0 }, e: { r: remRow, c: lastCol } });
    rowsMeta.push({ hpt: 24 });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!rows"] = rowsMeta;
    ws["!cols"] = [{ wch: 12 }, ...Array(colHeaders.length).fill({ wch: 11 })];
    return ws;
  };

  const buildModelDSheet = () => {
    const colCount = 11;
    const lastCol = colCount - 1;
    const aoa: StyledCell[][] = [];
    const merges: XLSX.Range[] = [];
    const rowsMeta: { hpt?: number }[] = [];

    const { tnoCellRef } = appendKopBlock(
      aoa,
      merges,
      rowsMeta,
      colCount,
      "D",
      mData,
      meta,
      divisorVal,
    );

    aoa.push(
      Array.from({ length: colCount }, (_, c) =>
        makeCell(
          c === 0
            ? "FREQUENCIES (PERCENT) OF OCCURRENCE OF CONCURRENT WIND DIRECTION (IN SECTOR 30°) AND SPEED (IN KNOTS) WITHIN SPECIFIED RANGES"
            : "",
          tblTitleStyle,
        ),
      ),
    );
    merges.push({ s: { r: 6, c: 0 }, e: { r: 6, c: lastCol } });
    rowsMeta.push({ hpt: 30 });

    aoa.push([
      makeCell("WIND\nDIRECTION", hdrStyle),
      makeCell("WIND SPEED", hdrStyle),
      ...Array.from({ length: 8 }, () => makeCell("", hdrStyle)),
      makeCell("", hdrStyle),
    ]);
    merges.push({ s: { r: 7, c: 0 }, e: { r: 8, c: 0 } });
    merges.push({ s: { r: 7, c: 1 }, e: { r: 7, c: 9 } });
    merges.push({ s: { r: 7, c: 10 }, e: { r: 8, c: 10 } });
    rowsMeta.push({ hpt: 20 });

    aoa.push([
      makeCell("", hdrStyle),
      ...MODEL_D_SPEED_COLS.map((s) => makeCell(s, hdrStyle)),
      makeCell("TOTAL", hdrStyle),
    ]);
    rowsMeta.push({ hpt: 20 });

    const blockedStyle = {
      fill: { fgColor: { rgb: "94A3B8" } },
      border: THIN_BORDER,
    };

    const startDataRow = 9;
    const tnoSafe = Math.max(1, mData.tno);

    MODEL_D_DIR_ROWS.forEach((dirLabel, rIdx) => {
      const excelRow = startDataRow + rIdx + 1;
      if (rIdx === 0) {
        const calmPct = Number(
          ((mData.modelD_CalmTotal / tnoSafe) * 100).toFixed(1),
        );
        aoa.push([
          makeCell(dirLabel, timeCellStyle),
          ...Array.from({ length: 9 }, () => makeCell("", blockedStyle)),
          makeCell(calmPct, meanStyle, {
            t: "n",
            f: `IF(${mData.modelD_CalmTotal}=0, 0, ROUND((${mData.modelD_CalmTotal}/${tnoCellRef})*100, 1))`,
            z: "0.0",
          }),
        ]);
      } else {
        const rowCells: StyledCell[] = [makeCell(dirLabel, timeCellStyle)];
        let rowSum = 0;
        for (let c = 0; c < 9; c++) {
          const freq = mData.modelD_Freq[rIdx][c];
          rowSum += freq;
          const pct = Number(((freq / tnoSafe) * 100).toFixed(1));
          rowCells.push(
            makeCell(pct, numCellStyle, {
              t: "n",
              f: `IF(${freq}=0, 0, ROUND((${freq}/${tnoCellRef})*100, 1))`,
              z: "0.0",
            }),
          );
        }
        const rowTotalPct = Number(((rowSum / tnoSafe) * 100).toFixed(1));
        rowCells.push(
          makeCell(rowTotalPct, meanStyle, {
            t: "n",
            f: `ROUND(SUM(B${excelRow}:J${excelRow}), 1)`,
            z: "0.0",
          }),
        );
        aoa.push(rowCells);
      }
      rowsMeta.push({ hpt: 20 });
    });

    const totalRowIdx = startDataRow + MODEL_D_DIR_ROWS.length;
    const totalCells: StyledCell[] = [makeCell("TOTAL", meanStyle)];

    for (let c = 0; c < 9; c++) {
      const colLetter = XLSX.utils.encode_col(c + 1);
      const colFreqSum = Array.from(
        { length: 13 },
        (_, idx) => mData.modelD_Freq[idx + 1][c],
      ).reduce((a, b) => a + b, 0);
      const colPct = Number(((colFreqSum / tnoSafe) * 100).toFixed(1));
      totalCells.push(
        makeCell(colPct, meanStyle, {
          t: "n",
          f: `ROUND(SUM(${colLetter}${startDataRow + 2}:${colLetter}${totalRowIdx}), 1)`,
          z: "0.0",
        }),
      );
    }

    totalCells.push(
      makeCell(mData.tno > 0 ? 100.0 : 0.0, meanStyle, {
        t: "n",
        f: `ROUND(SUM(K${startDataRow + 1}:K${totalRowIdx}), 1)`,
        z: "0.0",
      }),
    );
    aoa.push(totalCells);
    rowsMeta.push({ hpt: 21 });

    const remRow = totalRowIdx + 1;
    aoa.push(
      Array.from({ length: colCount }, (_, c) =>
        makeCell(
          c === 0 ? `Remarks : ${mData.remarksModelD}` : "",
          remarksStyle,
        ),
      ),
    );
    merges.push({ s: { r: remRow, c: 0 }, e: { r: remRow, c: lastCol } });
    rowsMeta.push({ hpt: 24 });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!rows"] = rowsMeta;
    ws["!cols"] = [{ wch: 15 }, ...Array(9).fill({ wch: 10 }), { wch: 11 }];
    return ws;
  };

  const buildModelESheet = () => {
    const colCount = 10;
    const lastCol = colCount - 1;
    const aoa: StyledCell[][] = [];
    const merges: XLSX.Range[] = [];
    const rowsMeta: { hpt?: number }[] = [];

    appendKopBlock(
      aoa,
      merges,
      rowsMeta,
      colCount,
      "E",
      mData,
      meta,
      divisorVal,
    );

    aoa.push(
      Array.from({ length: colCount }, (_, c) =>
        makeCell(
          c === 0
            ? "FREQUENCIES (PERCENT) OF SURFACE TEMPERATURE (SCREEN) IN SPECIFIED RANGES OF 5°C AT SPECIFIED TIMES"
            : "",
          tblTitleStyle,
        ),
      ),
    );
    merges.push({ s: { r: 6, c: 0 }, e: { r: 6, c: lastCol } });
    rowsMeta.push({ hpt: 30 });

    aoa.push([
      makeCell("TIME\n(GMT)", hdrStyle),
      makeCell("TEMPERATURE", hdrStyle),
      ...Array.from({ length: 8 }, () => makeCell("", hdrStyle)),
    ]);
    merges.push({ s: { r: 7, c: 0 }, e: { r: 8, c: 0 } });
    merges.push({ s: { r: 7, c: 1 }, e: { r: 7, c: lastCol } });
    rowsMeta.push({ hpt: 20 });

    aoa.push([
      makeCell("", hdrStyle),
      ...MODEL_E_TEMP_COLS.map((t) => makeCell(t, hdrStyle)),
    ]);
    rowsMeta.push({ hpt: 20 });

    const startDataRow = 9;
    for (let h = 0; h < 24; h++) {
      const hrStr = String(h).padStart(2, "0");
      const rowTotalTempObs = mData.modelE_Freq[h].reduce((a, b) => a + b, 0);
      const rowDenom = Math.max(1, rowTotalTempObs);

      const rowCells: StyledCell[] = [makeCell(hrStr, timeCellStyle)];
      for (let c = 0; c < 9; c++) {
        const freq = mData.modelE_Freq[h][c];
        const pct =
          rowTotalTempObs > 0
            ? Number(((freq / rowDenom) * 100).toFixed(1))
            : 0;
        rowCells.push(
          makeCell(pct, numCellStyle, {
            t: "n",
            f:
              rowTotalTempObs > 0
                ? `IF(${freq}=0, 0, ROUND((${freq}/${rowTotalTempObs})*100, 1))`
                : "0",
            z: "0.0",
          }),
        );
      }
      aoa.push(rowCells);
      rowsMeta.push({ hpt: 20 });
    }

    const meanRow = startDataRow + 24;
    const meanCells: StyledCell[] = [makeCell("MEAN (%)", meanStyle)];
    for (let c = 0; c < 9; c++) {
      const colLetter = XLSX.utils.encode_col(c + 1);
      const colPctSum = Array.from({ length: 24 }, (_, h) => {
        const rTot = mData.modelE_Freq[h].reduce((a, b) => a + b, 0);
        return rTot > 0 ? (mData.modelE_Freq[h][c] / rTot) * 100 : 0;
      }).reduce((a, b) => a + b, 0);

      meanCells.push(
        makeCell(
          Number((colPctSum / mData.activeHoursCount).toFixed(1)),
          meanStyle,
          {
            t: "n",
            f: `ROUND(SUM(${colLetter}${startDataRow + 1}:${colLetter}${meanRow})/${mData.activeHoursCount}, 1)`,
            z: "0.0",
          },
        ),
      );
    }
    aoa.push(meanCells);
    rowsMeta.push({ hpt: 21 });

    const remRow = meanRow + 1;
    aoa.push(
      Array.from({ length: colCount }, (_, c) =>
        makeCell(
          c === 0 ? `REMARKS : ${mData.remarksModelE}` : "",
          remarksStyle,
        ),
      ),
    );
    merges.push({ s: { r: remRow, c: 0 }, e: { r: remRow, c: lastCol } });
    rowsMeta.push({ hpt: 24 });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!rows"] = rowsMeta;
    ws["!cols"] = [{ wch: 12 }, ...Array(9).fill({ wch: 11 })];
    return ws;
  };

  // Susun tab Excel: Dengan RVR = lengkap Model A, B, C, D, E; Tanpa RVR = Model B, C, D, E
  if (hasRvr) {
    XLSX.utils.book_append_sheet(
      wb,
      buildModelASheet(),
      "MODEL A (RVR-VIS-HS)",
    );
  }

  XLSX.utils.book_append_sheet(
    wb,
    buildCumulativeSheet(
      "B",
      "FREQUENCIES (PER CENT) OF VISIBILITY BELOW SPECIFIED VALUES (IN METRES) AT SPECIFIED TIMES",
      "VISIBILITY",
      MODEL_B_HEADERS,
      mData.modelB_Freq,
      mData.remarksModelB,
    ),
    "MODEL B (VISIBILITY)",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildCumulativeSheet(
      "C",
      "FREQUENCIES (PER CENT) OF THE HEIGHT OF THE BASE OF THE LOWEST CLOUD LAYER (FEET) OF BKN OR OVC EXTENT BELOW SPECIFIED VALUES AT SPECIFIED TIMES",
      "Hs",
      MODEL_C_HEADERS,
      mData.modelC_Freq,
      mData.remarksModelC,
    ),
    "MODEL C (CLOUD BASE)",
  );

  XLSX.utils.book_append_sheet(wb, buildModelDSheet(), "MODEL D (WIND)");
  XLSX.utils.book_append_sheet(wb, buildModelESheet(), "MODEL E (TEMP)");

  const cleanPeriod = mData.periodOfRecordStr.replace(/[^\w-]/g, "_");
  const shortMonth = MONTH_SHORT_LABELS[monthIndex];
  XLSX.writeFile(
    wb,
    `ACS_${meta.icao || "STASIUN"}_${shortMonth}_${cleanPeriod}.xlsx`,
  );
}
