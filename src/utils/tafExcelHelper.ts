import XLSX from "xlsx-js-style";
import {
  ValidityCycle,
  ParsedTaf,
  ParsedMetarObs,
  IndividualTafVerificationResult,
  ElementScores,
  parseTafForVerification,
  parseMetarForVerification,
  evaluateSingleTaf,
} from "./tafVerification";

export const MONTH_SHEETS = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
] as const;

export const MONTH_SHORT_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MEI",
  "JUN",
  "JUL",
  "AGS",
  "SEP",
  "OKT",
  "NOV",
  "DES",
] as const;

export interface MonthlyRecapData {
  bulanIndex: number; // 0..11
  bulanNama: string;
  tahun: number;
  items: IndividualTafVerificationResult[];
  monthlyAverage: ElementScores | null;
}

export interface AnnualRecapRow {
  no: number;
  unsur: string;
  key: keyof ElementScores;
  monthlyValues: (number | null)[]; // length 12 (JAN..DES)
  annualAverage: number | null;
}

export interface FullVerificationWorkbookResult {
  tahun: number;
  detectedStationIcao: string;
  totalTafCount: number;
  totalMetarCount: number;
  individualResults: IndividualTafVerificationResult[];
  monthlyRecaps: MonthlyRecapData[];
  annualRows: AnnualRecapRow[];
  annualMonthlyOverall: (number | null)[]; // Rata-rata 1 tahun per kolom bulan
  annualGrandAverage: number | null;
}

export function calcIndividualOverallAverage(scores: ElementScores): number {
  const vals = [
    scores.arahAngin,
    scores.kecepatanAngin,
    scores.gusty,
    scores.visibilitas,
    scores.presipitasi,
    scores.jumlahAwan,
    scores.tinggiAwan,
  ];
  const sum = vals.reduce((acc, v) => acc + v, 0);
  return Number((sum / vals.length).toFixed(2));
}

function getDaysInMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// ============================================================================
// HELPER STYLING CELL EXCEL
// ============================================================================
const THIN_BORDER = {
  top: { style: "thin", color: { rgb: "64748B" } },
  bottom: { style: "thin", color: { rgb: "64748B" } },
  left: { style: "thin", color: { rgb: "64748B" } },
  right: { style: "thin", color: { rgb: "64748B" } },
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

// ============================================================================
// 1. GENERATOR TEMPLATE EXCEL 12 TAB (JANUARI - DESEMBER) — TAMPILAN RAPI
// ============================================================================
export function downloadTafVerificationTemplate(year: number): void {
  const wb = XLSX.utils.book_new();
  const cycles: ValidityCycle[] = ["00", "06", "12", "18"];

  const titleBannerStyle = {
    font: { name: "Calibri", sz: 13, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
  };

  const guideBannerStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "1E3A8A" } },
    fill: { fgColor: { rgb: "EFF6FF" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "BFDBFE" } },
      bottom: { style: "thin", color: { rgb: "BFDBFE" } },
      left: { style: "thin", color: { rgb: "BFDBFE" } },
      right: { style: "thin", color: { rgb: "BFDBFE" } },
    },
  };

  const legendBannerStyle = {
    font: { name: "Calibri", sz: 9.5, color: { rgb: "334155" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: {
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } },
    },
  };

  const tafSectionStyle = {
    font: { name: "Calibri", sz: 10.5, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1D4ED8" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const metarSectionStyle = {
    font: { name: "Calibri", sz: 10.5, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "047857" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const lockedHdrStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "1E293B" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const tafInputHdrStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "1E3A8A" } },
    fill: { fgColor: { rgb: "DBEAFE" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const metarInputHdrStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "065F46" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const getCycleFillRgb = (cyc: ValidityCycle) => {
    if (cyc === "00") return "ECFDF5";
    if (cyc === "06") return "FFFBEB";
    if (cyc === "12") return "EFF6FF";
    return "FFF7ED";
  };

  const buildRowBorder = (isDayEnd: boolean) => ({
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: isDayEnd
      ? { style: "medium", color: { rgb: "64748B" } }
      : { style: "thin", color: { rgb: "E2E8F0" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } },
  });

  const buildDateBlockBorder = () => ({
    top: { style: "medium", color: { rgb: "64748B" } },
    bottom: { style: "medium", color: { rgb: "64748B" } },
    left: { style: "thin", color: { rgb: "64748B" } },
    right: { style: "thin", color: { rgb: "64748B" } },
  });

  MONTH_SHEETS.forEach((monthName, monthIdx) => {
    const daysCount = getDaysInMonthUtc(year, monthIdx);
    const nextMonthName = MONTH_SHEETS[(monthIdx + 1) % 12];
    const dataStartRow = 6; // Baris ke-7 di Excel

    const aoa: StyledCell[][] = [];
    const merges: XLSX.Range[] = [];
    const rowsMeta: { hpt?: number }[] = [];

    // Row 0 (Excel Row 1): Judul Utama
    aoa.push(
      Array.from({ length: 9 }, (_, c) =>
        makeCell(
          c === 0
            ? `TEMPLATE INPUT VERIFIKASI TAF & METAR — ${monthName} ${year}`
            : "",
          titleBannerStyle,
        ),
      ),
    );
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } });
    rowsMeta.push({ hpt: 26 });

    // Row 1 (Excel Row 2): Petunjuk Singkat
    aoa.push(
      Array.from({ length: 9 }, (_, c) =>
        makeCell(
          c === 0
            ? "PETUNJUK: Isi / Paste sandi HANYA pada kolom putih (Sandi TAF, Forecaster, Verifikator, Sandi METAR). Kolom abu-abu jangan diubah."
            : "",
          guideBannerStyle,
        ),
      ),
    );
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 8 } });
    rowsMeta.push({ hpt: 21 });

    // Row 2 (Excel Row 3): Legenda Warna
    aoa.push(
      Array.from({ length: 9 }, (_, c) =>
        makeCell(
          c === 0
            ? "Keterangan:   [ Abu-abu = Jadwal Otomatis ]     [ Putih = Area Input / Paste Data ]     [ Kuning Lembut (Paling Bawah) = METAR Tgl 1 Bulan Berikutnya (00:00–06:00 UTC) ]"
            : "",
          legendBannerStyle,
        ),
      ),
    );
    merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 8 } });
    rowsMeta.push({ hpt: 19 });

    // Row 3 (Excel Row 4): Spasi Pemisah
    aoa.push([]);
    rowsMeta.push({ hpt: 8 });

    // Row 4 (Excel Row 5): Header Grup Kiri (TAF) & Kanan (METAR)
    aoa.push([
      makeCell("1. INPUT PRAKIRAAN (TAF)", tafSectionStyle),
      makeCell("", tafSectionStyle),
      makeCell("", tafSectionStyle),
      makeCell("", tafSectionStyle),
      makeCell("", tafSectionStyle),
      makeCell("", {}),
      makeCell("2. INPUT PENGAMATAN (METAR RUTIN 30 MENIT)", metarSectionStyle),
      makeCell("", metarSectionStyle),
      makeCell("", metarSectionStyle),
    ]);
    merges.push({ s: { r: 4, c: 0 }, e: { r: 4, c: 4 } });
    merges.push({ s: { r: 4, c: 6 }, e: { r: 4, c: 8 } });
    rowsMeta.push({ hpt: 24 });

    // Row 5 (Excel Row 6): Header Kolom Tabel
    aoa.push([
      makeCell("Tanggal", lockedHdrStyle),
      makeCell("Validitas\n(UTC)", lockedHdrStyle),
      makeCell("Sandi TAF (Raw)\n[Area Input / Paste]", tafInputHdrStyle),
      makeCell("Forecaster\n(AMF 1)", tafInputHdrStyle),
      makeCell("Verifikator\n(AMF 2)", tafInputHdrStyle),
      makeCell("", {}),
      makeCell("Tanggal", lockedHdrStyle),
      makeCell("Waktu\n(UTC)", lockedHdrStyle),
      makeCell("Sandi METAR (Raw)\n[Area Input / Paste]", metarInputHdrStyle),
    ]);
    rowsMeta.push({ hpt: 30 });

    // Bangun Data Kiri (TAF: 4 siklus per tanggal, merged per tanggal)
    const tafCellsList: StyledCell[][] = [];
    for (let d = 1; d <= daysCount; d++) {
      const startIdx = tafCellsList.length;
      const isEvenDay = d % 2 === 0;
      const dateBg = isEvenDay ? "E2E8F0" : "F1F5F9";
      const inputBg = isEvenDay ? "F8FAFC" : "FFFFFF";

      cycles.forEach((cyc, cIdx) => {
        const isLastOfDay = cIdx === cycles.length - 1;
        const rowBorder = buildRowBorder(isLastOfDay);
        const dateBorder = buildDateBlockBorder();

        tafCellsList.push([
          makeCell(cIdx === 0 ? d : "", {
            font: {
              name: "Calibri",
              sz: 11,
              bold: true,
              color: { rgb: "0F172A" },
            },
            fill: { fgColor: { rgb: dateBg } },
            alignment: { horizontal: "center", vertical: "center" },
            border: dateBorder,
          }),
          makeCell(cyc, {
            font: {
              name: "Consolas",
              sz: 10,
              bold: true,
              color: { rgb: "0F172A" },
            },
            fill: { fgColor: { rgb: getCycleFillRgb(cyc) } },
            alignment: { horizontal: "center", vertical: "center" },
            border: rowBorder,
          }),
          makeCell("", {
            font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
            fill: { fgColor: { rgb: inputBg } },
            alignment: { horizontal: "left", vertical: "center" },
            border: rowBorder,
          }),
          makeCell("", {
            font: { name: "Calibri", sz: 9.5, color: { rgb: "0F172A" } },
            fill: { fgColor: { rgb: inputBg } },
            alignment: { horizontal: "center", vertical: "center" },
            border: rowBorder,
          }),
          makeCell("", {
            font: { name: "Calibri", sz: 9.5, color: { rgb: "0F172A" } },
            fill: { fgColor: { rgb: inputBg } },
            alignment: { horizontal: "center", vertical: "center" },
            border: rowBorder,
          }),
        ]);
      });

      merges.push({
        s: { r: dataStartRow + startIdx, c: 0 },
        e: { r: dataStartRow + startIdx + 3, c: 0 },
      });
    }

    // Bangun Data Kanan (METAR: 48 slot/hari merged per tanggal + 13 slot lintas bulan)
    const metarCellsList: StyledCell[][] = [];
    for (let d = 1; d <= daysCount; d++) {
      const startIdx = metarCellsList.length;
      const isEvenDay = d % 2 === 0;
      const dateBg = isEvenDay ? "E2E8F0" : "F1F5F9";
      const timeBg = isEvenDay ? "F1F5F9" : "F8FAFC";
      const inputBg = isEvenDay ? "F8FAFC" : "FFFFFF";

      let slotCounter = 0;
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 30]) {
          const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const isLastOfDay = slotCounter === 47;
          const rowBorder = buildRowBorder(isLastOfDay);
          const dateBorder = buildDateBlockBorder();

          metarCellsList.push([
            makeCell(slotCounter === 0 ? d : "", {
              font: {
                name: "Calibri",
                sz: 11,
                bold: true,
                color: { rgb: "0F172A" },
              },
              fill: { fgColor: { rgb: dateBg } },
              alignment: { horizontal: "center", vertical: "center" },
              border: dateBorder,
            }),
            makeCell(timeStr, {
              font: {
                name: "Consolas",
                sz: 9.5,
                bold: m === 0,
                color: { rgb: m === 0 ? "0F172A" : "475569" },
              },
              fill: { fgColor: { rgb: timeBg } },
              alignment: { horizontal: "center", vertical: "center" },
              border: rowBorder,
            }),
            makeCell("", {
              font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
              fill: { fgColor: { rgb: inputBg } },
              alignment: { horizontal: "left", vertical: "center" },
              border: rowBorder,
            }),
          ]);
          slotCounter++;
        }
      }

      merges.push({
        s: { r: dataStartRow + startIdx, c: 6 },
        e: { r: dataStartRow + startIdx + 47, c: 6 },
      });
    }

    // 13 slot tambahan lintas bulan (Tgl 1 bulan berikutnya jam 00:00..06:00 UTC)
    const crossStartIdx = metarCellsList.length;
    let crossCounter = 0;
    for (let h = 0; h <= 6; h++) {
      for (const m of [0, 30]) {
        if (h === 6 && m === 30) continue;
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const isLastCross = crossCounter === 12;
        const rowBorder = buildRowBorder(isLastCross);
        const dateBorder = buildDateBlockBorder();

        metarCellsList.push([
          makeCell(crossCounter === 0 ? `1\n(${nextMonthName})` : "", {
            font: {
              name: "Calibri",
              sz: 9.5,
              bold: true,
              color: { rgb: "854D0E" },
            },
            fill: { fgColor: { rgb: "FEF9C3" } },
            alignment: {
              horizontal: "center",
              vertical: "center",
              wrapText: true,
            },
            border: dateBorder,
          }),
          makeCell(timeStr, {
            font: {
              name: "Consolas",
              sz: 9.5,
              bold: m === 0,
              color: { rgb: "854D0E" },
            },
            fill: { fgColor: { rgb: "FEFCE8" } },
            alignment: { horizontal: "center", vertical: "center" },
            border: rowBorder,
          }),
          makeCell("", {
            font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
            fill: { fgColor: { rgb: "FFFDF5" } },
            alignment: { horizontal: "left", vertical: "center" },
            border: rowBorder,
          }),
        ]);
        crossCounter++;
      }
    }
    merges.push({
      s: { r: dataStartRow + crossStartIdx, c: 6 },
      e: { r: dataStartRow + crossStartIdx + 12, c: 6 },
    });

    // Gabungkan tabel kiri & kanan
    const maxLen = Math.max(tafCellsList.length, metarCellsList.length);
    for (let i = 0; i < maxLen; i++) {
      const left = tafCellsList[i] || [
        makeCell("", {}),
        makeCell("", {}),
        makeCell("", {}),
        makeCell("", {}),
        makeCell("", {}),
      ];
      const right = metarCellsList[i] || [
        makeCell("", {}),
        makeCell("", {}),
        makeCell("", {}),
      ];
      aoa.push([...left, makeCell("", {}), ...right]);
      rowsMeta.push({ hpt: 20 });
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!rows"] = rowsMeta;
    ws["!cols"] = [
      { wch: 10 }, // A: Tanggal TAF
      { wch: 12 }, // B: Validitas UTC
      { wch: 58 }, // C: Sandi TAF
      { wch: 18 }, // D: Forecaster
      { wch: 18 }, // E: Verifikator
      { wch: 3 }, // F: Pemisah
      { wch: 16 }, // G: Tanggal METAR
      { wch: 12 }, // H: Waktu UTC
      { wch: 58 }, // I: Sandi METAR
    ];
    // Freeze 6 baris header teratas agar tidak hilang saat scroll
    ws["!views"] = [{ state: "frozen", ySplit: 6 }];

    XLSX.utils.book_append_sheet(wb, ws, monthName);
  });

  XLSX.writeFile(wb, `Template_Verifikasi_TAF_${year}_12Bulan.xlsx`);
}

// ============================================================================
// 2. PARSER & KALKULATOR WORKBOOK 12 TAB
// ============================================================================
export function processUploadedVerificationWorkbook(
  buffer: ArrayBuffer,
  overrideYear?: number,
): FullVerificationWorkbookResult {
  const wb = XLSX.read(buffer, { type: "array" });

  let detectedYear = overrideYear || new Date().getUTCFullYear();
  if (!overrideYear) {
    for (const sName of wb.SheetNames) {
      const ws = wb.Sheets[sName];
      if (!ws) continue;
      const b1 = ws["B1"]?.v;
      if (typeof b1 === "number" && b1 >= 2000 && b1 <= 2100) {
        detectedYear = b1;
        break;
      }
      const a1 = String(ws["A1"]?.v || "");
      const yrMatch = a1.match(/\b(20\d{2})\b/);
      if (yrMatch) {
        detectedYear = parseInt(yrMatch[1], 10);
        break;
      }
    }
  }

  interface RawTafEntry {
    monthIdx: number;
    day: number;
    cycle: ValidityCycle;
    rawTaf: string;
    forecaster: string;
    verifikator: string;
  }

  const rawTafEntries: RawTafEntry[] = [];
  const allMetarObs: ParsedMetarObs[] = [];
  let detectedStationIcao = "";

  MONTH_SHEETS.forEach((monthName, monthIdx) => {
    const actualSheetName = wb.SheetNames.find(
      (n) => n.trim().toUpperCase() === monthName,
    );
    if (!actualSheetName) return;

    const ws = wb.Sheets[actualSheetName];
    if (!ws) return;

    const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(ws, {
      header: 1,
      defval: "",
    });

    // Deteksi dinamis baris awal data (tepat setelah baris header "Tanggal")
    let startRowIdx = 6;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      if (
        String(rows[i]?.[0] ?? "")
          .trim()
          .toLowerCase() === "tanggal"
      ) {
        startRowIdx = i + 1;
        break;
      }
    }

    let lastValidTafDay = 1;
    let lastValidMetarDay = 1;
    let crossedToNextMonth = false;

    for (let r = startRowIdx; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const rawDayTaf = row[0];
      const rawCycle = String(row[1] ?? "")
        .trim()
        .padStart(2, "0");
      const rawTafStr = String(row[2] ?? "").trim();
      const forecaster = String(row[3] ?? "").trim() || "-";
      const verifikator = String(row[4] ?? "").trim() || "-";

      if (rawDayTaf !== "" && !isNaN(Number(rawDayTaf))) {
        lastValidTafDay = Number(rawDayTaf);
      }

      if (rawTafStr) {
        const cyc: ValidityCycle =
          rawCycle === "00" ||
          rawCycle === "06" ||
          rawCycle === "12" ||
          rawCycle === "18"
            ? rawCycle
            : "00";

        rawTafEntries.push({
          monthIdx,
          day: lastValidTafDay,
          cycle: cyc,
          rawTaf: rawTafStr,
          forecaster,
          verifikator,
        });
      }

      const rawDayMetar = String(row[6] ?? "").trim();
      const rawTimeMetar = String(row[7] ?? "").trim();
      const rawMetarStr = String(row[8] ?? "").trim();

      if (rawDayMetar !== "") {
        const dayNumMatch = rawDayMetar.match(/^(\d{1,2})/);
        if (dayNumMatch) {
          const parsedD = parseInt(dayNumMatch[1], 10);
          if (lastValidMetarDay > 20 && parsedD === 1) {
            crossedToNextMonth = true;
          }
          lastValidMetarDay = parsedD;
        }
      }

      if (rawMetarStr) {
        let hh = 0;
        let mm = 0;
        const timeMatch = rawTimeMetar.match(/^(\d{1,2})[:.](\d{2})/);
        if (timeMatch) {
          hh = parseInt(timeMatch[1], 10);
          mm = parseInt(timeMatch[2], 10);
        }

        let targetMonth = monthIdx;
        let targetYear = detectedYear;
        if (crossedToNextMonth) {
          targetMonth += 1;
          if (targetMonth > 11) {
            targetMonth = 0;
            targetYear += 1;
          }
        }

        const fallbackUtc = new Date(
          Date.UTC(targetYear, targetMonth, lastValidMetarDay, hh, mm, 0, 0),
        );

        const parsedObs = parseMetarForVerification(rawMetarStr, fallbackUtc);
        if (parsedObs) {
          allMetarObs.push(parsedObs);
          if (!detectedStationIcao) {
            const stMatch = rawMetarStr
              .toUpperCase()
              .match(/\b(?:METAR|SPECI)\s+([A-Z]{4})\b/);
            if (stMatch) detectedStationIcao = stMatch[1];
          }
        }
      }
    }
  });

  const uniqueMetarMap = new Map<number, ParsedMetarObs>();
  for (const obs of allMetarObs) {
    uniqueMetarMap.set(obs.obsTimeUtc.getTime(), obs);
  }
  const deduplicatedMetars = Array.from(uniqueMetarMap.values()).sort(
    (a, b) => a.obsTimeUtc.getTime() - b.obsTimeUtc.getTime(),
  );

  const individualResults: IndividualTafVerificationResult[] = [];
  const cycleOrder: Record<ValidityCycle, number> = {
    "00": 0,
    "06": 1,
    "12": 2,
    "18": 3,
  };

  for (const entry of rawTafEntries) {
    const parsedTaf: ParsedTaf | null = parseTafForVerification(
      entry.rawTaf,
      detectedYear,
      entry.monthIdx,
      entry.day,
      entry.cycle,
    );
    if (!parsedTaf) continue;

    if (!detectedStationIcao && parsedTaf.station) {
      detectedStationIcao = parsedTaf.station;
    }

    const evalRes = evaluateSingleTaf(
      parsedTaf,
      deduplicatedMetars,
      entry.forecaster,
      entry.verifikator,
    );

    evalRes.bulanIndex = entry.monthIdx;
    evalRes.tanggal = entry.day;
    evalRes.tahun = detectedYear;
    evalRes.validityCycle = entry.cycle;

    individualResults.push(evalRes);
  }

  individualResults.sort((a, b) => {
    if (a.bulanIndex !== b.bulanIndex) return a.bulanIndex - b.bulanIndex;
    if (a.tanggal !== b.tanggal) return a.tanggal - b.tanggal;
    return cycleOrder[a.validityCycle] - cycleOrder[b.validityCycle];
  });

  const monthlyRecaps: MonthlyRecapData[] = MONTH_SHEETS.map(
    (bulanNama, bulanIndex) => {
      const items = individualResults.filter(
        (res) => res.bulanIndex === bulanIndex && res.totalVerifiedRows > 0,
      );

      let monthlyAverage: ElementScores | null = null;
      if (items.length > 0) {
        const avgKey = (k: keyof ElementScores) =>
          Number(
            (
              items.reduce((acc, it) => acc + it.scores[k], 0) / items.length
            ).toFixed(2),
          );

        monthlyAverage = {
          arahAngin: avgKey("arahAngin"),
          kecepatanAngin: avgKey("kecepatanAngin"),
          gusty: avgKey("gusty"),
          visibilitas: avgKey("visibilitas"),
          presipitasi: avgKey("presipitasi"),
          jumlahAwan: avgKey("jumlahAwan"),
          tinggiAwan: avgKey("tinggiAwan"),
        };
      }

      return {
        bulanIndex,
        bulanNama,
        tahun: detectedYear,
        items,
        monthlyAverage,
      };
    },
  );

  const elementDefinitions: {
    no: number;
    unsur: string;
    key: keyof ElementScores;
  }[] = [
    { no: 1, unsur: "Arah angin", key: "arahAngin" },
    { no: 2, unsur: "Kecepatan angin", key: "kecepatanAngin" },
    { no: 3, unsur: "Gust", key: "gusty" },
    { no: 4, unsur: "Visibilitas", key: "visibilitas" },
    { no: 5, unsur: "Presipitasi", key: "presipitasi" },
    { no: 6, unsur: "Jumlah awan", key: "jumlahAwan" },
    { no: 7, unsur: "Tinggi dasar awan", key: "tinggiAwan" },
  ];

  const annualRows: AnnualRecapRow[] = elementDefinitions.map((def) => {
    const monthlyValues = monthlyRecaps.map((mr) =>
      mr.monthlyAverage ? mr.monthlyAverage[def.key] : null,
    );
    const validVals = monthlyValues.filter((v): v is number => v !== null);
    const annualAverage =
      validVals.length > 0
        ? Number(
            (
              validVals.reduce((acc, v) => acc + v, 0) / validVals.length
            ).toFixed(2),
          )
        : null;

    return {
      no: def.no,
      unsur: def.unsur,
      key: def.key,
      monthlyValues,
      annualAverage,
    };
  });

  const annualMonthlyOverall: (number | null)[] = MONTH_SHEETS.map(
    (_, mIdx) => {
      const colVals = annualRows
        .map((r) => r.monthlyValues[mIdx])
        .filter((v): v is number => v !== null);
      if (colVals.length === 0) return null;
      return Number(
        (colVals.reduce((acc, v) => acc + v, 0) / colVals.length).toFixed(2),
      );
    },
  );

  const validOverallCols = annualMonthlyOverall.filter(
    (v): v is number => v !== null,
  );
  const annualGrandAverage =
    validOverallCols.length > 0
      ? Number(
          (
            validOverallCols.reduce((acc, v) => acc + v, 0) /
            validOverallCols.length
          ).toFixed(2),
        )
      : null;

  return {
    tahun: detectedYear,
    detectedStationIcao,
    totalTafCount: individualResults.length,
    totalMetarCount: deduplicatedMetars.length,
    individualResults,
    monthlyRecaps,
    annualRows,
    annualMonthlyOverall,
    annualGrandAverage,
  };
}

// ============================================================================
// 3. PEMBANGUN WORKSHEET HASIL (DENGAN RUMUS AKTIF)
// ============================================================================

function buildIndividualDateWorksheet(
  dateItems: IndividualTafVerificationResult[],
  stationLabel: string,
): XLSX.WorkSheet {
  const first = dateItems[0];
  const monthName = MONTH_SHEETS[first.bulanIndex];
  const aoa: StyledCell[][] = [];
  const merges: XLSX.Range[] = [];
  const rowsMeta: { hpt?: number }[] = [];

  const titleStyle = {
    font: { name: "Calibri", sz: 13, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const subTitleStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "334155" } },
    alignment: { horizontal: "left", vertical: "center" },
  };

  aoa.push([
    makeCell(
      `Verifikasi Individu — Tanggal ${first.tanggal} ${monthName} ${first.tahun}`,
      titleStyle,
    ),
  ]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 25 } });
  rowsMeta.push({ hpt: 22 });

  aoa.push([makeCell(stationLabel || "Stasiun Meteorologi", subTitleStyle)]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 25 } });
  rowsMeta.push({ hpt: 18 });

  aoa.push([]);
  rowsMeta.push({ hpt: 10 });

  let curRow = 3;

  const bannerStyle = {
    font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1E3A8A" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: THIN_BORDER,
  };

  const hdrTopCenter = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const hdrMetaLeft = {
    font: { name: "Calibri", sz: 9, bold: false, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const hdrSub = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const hdrSubH = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const dataCenter = {
    font: { name: "Calibri", sz: 9, color: { rgb: "0F172A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const dataBoldCenter = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const dataGroupStyle = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "1E3A8A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const dataMetarLeft = {
    font: { name: "Consolas", sz: 8.5, color: { rgb: "172554" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };

  const scoreOneStyle = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "065F46" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const scoreZeroStyle = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "9F1239" } },
    fill: { fgColor: { rgb: "FFE4E6" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const yellowStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "FDE047" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const yellowLeftStyle = {
    font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "FDE047" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: THIN_BORDER,
  };

  const emeraldRightStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "064E3B" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: THIN_BORDER,
  };

  const emeraldCenterStyle = {
    font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "064E3B" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  for (const tafItem of dateItems) {
    const bannerRow: StyledCell[] = Array.from({ length: 26 }, (_, c) =>
      makeCell(
        c === 0
          ? `Verifikasi Individu — Validitas ${tafItem.validityCycle}.00 UTC`
          : "",
        bannerStyle,
      ),
    );
    aoa.push(bannerRow);
    merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: 25 } });
    rowsMeta.push({ hpt: 22 });
    curRow++;

    const metaText = [
      "(4) PRAKIRAAN (TAF)",
      `PERIODE VALIDITAS: ${tafItem.periodeValiditasStr}`,
      `PRAKIRAAN: ${tafItem.rawTaf}`,
      `FORECASTER: ${tafItem.forecaster}   |   VERIFIKATOR: ${tafItem.verifikator}`,
    ].join("\n");

    const hRow1: StyledCell[] = Array.from({ length: 26 }, (_, c) => {
      if (c === 0) return makeCell("(1)\nNo", hdrTopCenter);
      if (c === 1) return makeCell("(2)\nTanggal", hdrTopCenter);
      if (c === 2) return makeCell("(3)\nWaktu", hdrTopCenter);
      if (c === 3) return makeCell(metaText, hdrMetaLeft);
      if (c >= 4 && c <= 10) return makeCell("", hdrMetaLeft);
      if (c === 11) return makeCell("(5) PENGAMATAN (METAR)", hdrTopCenter);
      return makeCell("", hdrTopCenter);
    });
    aoa.push(hRow1);
    merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow + 1, c: 0 } });
    merges.push({ s: { r: curRow, c: 1 }, e: { r: curRow + 1, c: 1 } });
    merges.push({ s: { r: curRow, c: 2 }, e: { r: curRow + 1, c: 2 } });
    merges.push({ s: { r: curRow, c: 3 }, e: { r: curRow, c: 10 } });
    merges.push({ s: { r: curRow, c: 11 }, e: { r: curRow, c: 25 } });
    rowsMeta.push({ hpt: 66 });
    curRow++;

    const subLabels: { label: string; isH?: boolean }[] = [
      { label: "" },
      { label: "" },
      { label: "" },
      { label: "(4-1)\nChange Group" },
      { label: "(4-2)\nA" },
      { label: "(4-3)\nB1" },
      { label: "(4-4)\nB2" },
      { label: "(4-5)\nC" },
      { label: "(4-6)\nD" },
      { label: "(4-7)\nE" },
      { label: "(4-8)\nF" },
      { label: "(5-1)\nDATA METAR" },
      { label: "(5-2)\nA" },
      { label: "(5-3)\nH", isH: true },
      { label: "(5-4)\nB1" },
      { label: "(5-5)\nH", isH: true },
      { label: "(5-6)\nB2" },
      { label: "(5-7)\nH", isH: true },
      { label: "(5-8)\nC" },
      { label: "(5-9)\nH", isH: true },
      { label: "(5-10)\nD" },
      { label: "(5-11)\nH", isH: true },
      { label: "(5-12)\nE" },
      { label: "(5-13)\nH", isH: true },
      { label: "(5-14)\nF" },
      { label: "(5-15)\nH", isH: true },
    ];
    aoa.push(
      subLabels.map((item) =>
        makeCell(item.label, item.isH ? hdrSubH : hdrSub),
      ),
    );
    rowsMeta.push({ hpt: 30 });
    curRow++;

    const dataStartRow = curRow;
    if (tafItem.rows.length === 0) {
      const emptyRow = Array.from({ length: 26 }, (_, c) =>
        makeCell(
          c === 0
            ? "Tidak ada data METAR pengamatan yang cocok pada rentang 12 jam pertama TAF ini."
            : "",
          dataCenter,
        ),
      );
      aoa.push(emptyRow);
      merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: 25 } });
      rowsMeta.push({ hpt: 24 });
      curRow++;
    } else {
      let spanStart = 0;
      while (spanStart < tafItem.rows.length) {
        let spanEnd = spanStart;
        while (
          spanEnd + 1 < tafItem.rows.length &&
          tafItem.rows[spanEnd + 1].tanggal === tafItem.rows[spanStart].tanggal
        ) {
          spanEnd++;
        }
        if (spanEnd > spanStart) {
          merges.push({
            s: { r: dataStartRow + spanStart, c: 1 },
            e: { r: dataStartRow + spanEnd, c: 1 },
          });
        }
        spanStart = spanEnd + 1;
      }

      for (const r of tafItem.rows) {
        const rowCells: StyledCell[] = [
          makeCell(r.no, dataCenter),
          makeCell(r.tanggal, dataBoldCenter),
          makeCell(r.waktuUtc, dataBoldCenter),
          makeCell(r.changeGroup, dataGroupStyle),
          makeCell(r.fcstA, dataCenter),
          makeCell(r.fcstB1, dataCenter),
          makeCell(r.fcstB2, dataCenter),
          makeCell(r.fcstC, dataCenter),
          makeCell(r.fcstD, dataCenter),
          makeCell(r.fcstE, dataCenter),
          makeCell(r.fcstF, dataCenter),
          makeCell(r.metarRaw, dataMetarLeft),
          makeCell(r.obsA, dataCenter),
          makeCell(r.scoreA, r.scoreA === 1 ? scoreOneStyle : scoreZeroStyle),
          makeCell(r.obsB1, dataCenter),
          makeCell(r.scoreB1, r.scoreB1 === 1 ? scoreOneStyle : scoreZeroStyle),
          makeCell(r.obsB2, dataCenter),
          makeCell(r.scoreB2, r.scoreB2 === 1 ? scoreOneStyle : scoreZeroStyle),
          makeCell(r.obsC, dataCenter),
          makeCell(r.scoreC, r.scoreC === 1 ? scoreOneStyle : scoreZeroStyle),
          makeCell(r.obsD, dataCenter),
          makeCell(r.scoreD, r.scoreD === 1 ? scoreOneStyle : scoreZeroStyle),
          makeCell(r.obsE, dataCenter),
          makeCell(r.scoreE, r.scoreE === 1 ? scoreOneStyle : scoreZeroStyle),
          makeCell(r.obsF, dataCenter),
          makeCell(r.scoreF, r.scoreF === 1 ? scoreOneStyle : scoreZeroStyle),
        ];
        aoa.push(rowCells);
        rowsMeta.push({ hpt: 22 });
        curRow++;
      }
    }
    const dataEndRow = curRow - 1;

    const excelStart = dataStartRow + 1;
    const excelEnd = dataEndRow + 1;
    const hasRows = tafItem.rows.length > 0;

    const yellowRowIdx = curRow;
    const yellowExcelRow = yellowRowIdx + 1;

    const scoreCols: {
      startCol: number;
      hLetter: string;
      cached: number;
    }[] = [
      { startCol: 12, hLetter: "N", cached: tafItem.scores.arahAngin },
      { startCol: 14, hLetter: "P", cached: tafItem.scores.kecepatanAngin },
      { startCol: 16, hLetter: "R", cached: tafItem.scores.gusty },
      { startCol: 18, hLetter: "T", cached: tafItem.scores.visibilitas },
      { startCol: 20, hLetter: "V", cached: tafItem.scores.presipitasi },
      { startCol: 22, hLetter: "X", cached: tafItem.scores.jumlahAwan },
      { startCol: 24, hLetter: "Z", cached: tafItem.scores.tinggiAwan },
    ];

    const yellowCells: StyledCell[] = Array.from({ length: 26 }, (_, c) => {
      if (c === 0) return makeCell("HASIL VERIFIKASI (%)", yellowStyle);
      if (c === 11) {
        return makeCell(
          `Total Data: ${tafItem.totalVerifiedRows}`,
          yellowLeftStyle,
          hasRows
            ? {
                t: "s",
                f: `"Total Data: "&COUNT(N${excelStart}:N${excelEnd})`,
              }
            : undefined,
        );
      }
      return makeCell("", yellowStyle);
    });

    for (const sc of scoreCols) {
      yellowCells[sc.startCol] = makeCell(
        sc.cached,
        yellowStyle,
        hasRows
          ? {
              t: "n",
              f: `IFERROR(AVERAGE(${sc.hLetter}${excelStart}:${sc.hLetter}${excelEnd})*100, 0)`,
              z: '0.00"%"',
            }
          : { z: '0.00"%"' },
      );
      merges.push({
        s: { r: yellowRowIdx, c: sc.startCol },
        e: { r: yellowRowIdx, c: sc.startCol + 1 },
      });
    }

    merges.push({
      s: { r: yellowRowIdx, c: 0 },
      e: { r: yellowRowIdx, c: 10 },
    });
    aoa.push(yellowCells);
    rowsMeta.push({ hpt: 22 });
    curRow++;

    const overallAvg = calcIndividualOverallAverage(tafItem.scores);
    const avgRowIdx = curRow;
    const avgCells: StyledCell[] = Array.from({ length: 26 }, (_, c) => {
      if (c === 0) {
        return makeCell(
          "RATA-RATA TOTAL VERIFIKASI (7 UNSUR)",
          emeraldRightStyle,
        );
      }
      if (c === 12) {
        return makeCell(
          overallAvg,
          emeraldCenterStyle,
          hasRows
            ? {
                t: "n",
                f: `IFERROR(AVERAGE(M${yellowExcelRow},O${yellowExcelRow},Q${yellowExcelRow},S${yellowExcelRow},U${yellowExcelRow},W${yellowExcelRow},Y${yellowExcelRow}), 0)`,
                z: '0.00"%"',
              }
            : { z: '0.00"%"' },
        );
      }
      return makeCell("", c < 12 ? emeraldRightStyle : emeraldCenterStyle);
    });

    merges.push({ s: { r: avgRowIdx, c: 0 }, e: { r: avgRowIdx, c: 11 } });
    merges.push({ s: { r: avgRowIdx, c: 12 }, e: { r: avgRowIdx, c: 25 } });
    aoa.push(avgCells);
    rowsMeta.push({ hpt: 24 });
    curRow++;

    aoa.push([]);
    rowsMeta.push({ hpt: 12 });
    curRow++;

    aoa.push([]);
    rowsMeta.push({ hpt: 12 });
    curRow++;
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!rows"] = rowsMeta;
  ws["!cols"] = [
    { wch: 6 },
    { wch: 9 },
    { wch: 9 },
    { wch: 14 },
    { wch: 7 },
    { wch: 7 },
    { wch: 7 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 36 },
    { wch: 7 },
    { wch: 5 },
    { wch: 7 },
    { wch: 5 },
    { wch: 7 },
    { wch: 5 },
    { wch: 8 },
    { wch: 5 },
    { wch: 8 },
    { wch: 5 },
    { wch: 8 },
    { wch: 5 },
    { wch: 8 },
    { wch: 5 },
  ];

  return ws;
}

function buildMonthlyRecapWorksheet(
  mr: MonthlyRecapData,
  stationLabel: string,
): XLSX.WorkSheet {
  const aoa: StyledCell[][] = [];
  const merges: XLSX.Range[] = [];
  const rowsMeta: { hpt?: number }[] = [];

  const titleStyle = {
    font: { name: "Calibri", sz: 13, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const subTitleStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "334155" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const monthBannerStyle = {
    font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const colHdrStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };
  const colHdrAvgStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };
  const limeLeftStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "84CC16" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: THIN_BORDER,
  };
  const limeCenterStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "84CC16" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const yellowRightLabelStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "FDE047" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: THIN_BORDER,
  };
  const yellowNumStyle = {
    font: { name: "Consolas", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "FDE047" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: THIN_BORDER,
  };
  const emeraldRightLabelStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "064E3B" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: THIN_BORDER,
  };
  const emeraldCenterValStyle = {
    font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "064E3B" } },
    fill: { fgColor: { rgb: "D1FAE5" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  aoa.push([
    makeCell(`Rekap Bulanan — ${mr.bulanNama} ${mr.tahun}`, titleStyle),
  ]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } });
  rowsMeta.push({ hpt: 22 });

  aoa.push([makeCell(stationLabel || "Stasiun Meteorologi", subTitleStyle)]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 10 } });
  rowsMeta.push({ hpt: 18 });

  aoa.push([]);
  rowsMeta.push({ hpt: 10 });

  aoa.push(
    Array.from({ length: 11 }, (_, c) =>
      makeCell(c === 0 ? `${mr.bulanNama} ${mr.tahun}` : "", monthBannerStyle),
    ),
  );
  merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: 10 } });
  rowsMeta.push({ hpt: 22 });

  const headers = [
    "(1)\nTanggal TAF diterbitkan",
    "(2)\nJam validitas TAF",
    "(3)\nForecaster / Verifikator",
    "(4)\nA. Arah angin",
    "(5)\nB.1 Kecepatan Angin",
    "(6)\nB.2 Gusty",
    "(7)\nC. Visibilitas",
    "(8)\nD. Presipitasi",
    "(9)\nE. Jumlah Awan",
    "(10)\nF. Ketinggian Awan",
    "(11)\nRata-rata (%)",
  ];
  aoa.push(
    headers.map((h, idx) =>
      makeCell(h, idx === 10 ? colHdrAvgStyle : colHdrStyle),
    ),
  );
  rowsMeta.push({ hpt: 32 });

  const dataStartExcelRow = 7;
  const dataEndExcelRow = 6 + mr.items.length;
  const colLetters = ["D", "E", "F", "G", "H", "I", "J"];
  const avgKeys: (keyof ElementScores)[] = [
    "arahAngin",
    "kecepatanAngin",
    "gusty",
    "visibilitas",
    "presipitasi",
    "jumlahAwan",
    "tinggiAwan",
  ];

  const monthlyOverallVal = mr.monthlyAverage
    ? calcIndividualOverallAverage(mr.monthlyAverage)
    : 0;

  const limeRow: StyledCell[] = [
    makeCell("(B) rata-rata 1 bulan", limeLeftStyle),
    makeCell("", limeCenterStyle),
    makeCell("", limeCenterStyle),
    ...avgKeys.map((k, idx) => {
      const val = mr.monthlyAverage ? mr.monthlyAverage[k] : 0;
      const letter = colLetters[idx];
      return mr.items.length > 0
        ? makeCell(val, limeCenterStyle, {
            t: "n",
            f: `IFERROR(AVERAGE(${letter}${dataStartExcelRow}:${letter}${dataEndExcelRow}), 0)`,
            z: "0.00",
          })
        : makeCell("-", limeCenterStyle);
    }),
    mr.items.length > 0
      ? makeCell(monthlyOverallVal, limeCenterStyle, {
          t: "n",
          f: `IFERROR(AVERAGE(D6:J6), 0)`,
          z: "0.00",
        })
      : makeCell("-", limeCenterStyle),
  ];
  aoa.push(limeRow);
  rowsMeta.push({ hpt: 22 });

  const getCycleRgb = (cyc: string) => {
    if (cyc === "00") return "ECFDF5";
    if (cyc === "06") return "FFFBEB";
    if (cyc === "12") return "EFF6FF";
    return "FFF7ED";
  };

  if (mr.items.length === 0) {
    aoa.push(
      Array.from({ length: 11 }, (_, c) =>
        makeCell(
          c === 0
            ? `Belum ada TAF terverifikasi pada bulan ${mr.bulanNama}.`
            : "",
          {
            font: {
              name: "Calibri",
              sz: 9.5,
              italic: true,
              color: { rgb: "64748B" },
            },
            alignment: { horizontal: "center", vertical: "center" },
            border: THIN_BORDER,
          },
        ),
      ),
    );
    merges.push({ s: { r: 6, c: 0 }, e: { r: 6, c: 10 } });
    rowsMeta.push({ hpt: 24 });
  } else {
    let spanStart = 0;
    while (spanStart < mr.items.length) {
      let spanEnd = spanStart;
      while (
        spanEnd + 1 < mr.items.length &&
        mr.items[spanEnd + 1].tanggal === mr.items[spanStart].tanggal
      ) {
        spanEnd++;
      }
      if (spanEnd > spanStart) {
        merges.push({
          s: { r: 6 + spanStart, c: 0 },
          e: { r: 6 + spanEnd, c: 0 },
        });
      }
      spanStart = spanEnd + 1;
    }

    mr.items.forEach((item, idx) => {
      const excelRowNum = dataStartExcelRow + idx;
      const bgRgb = getCycleRgb(item.validityCycle);
      const rowAvg = calcIndividualOverallAverage(item.scores);

      const dateCellStyle = {
        font: {
          name: "Calibri",
          sz: 9.5,
          bold: true,
          color: { rgb: "0F172A" },
        },
        fill: { fgColor: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: THIN_BORDER,
      };
      const cycleCellStyle = {
        font: {
          name: "Consolas",
          sz: 9.5,
          bold: true,
          color: { rgb: "0F172A" },
        },
        fill: { fgColor: { rgb: bgRgb } },
        alignment: { horizontal: "center", vertical: "center" },
        border: THIN_BORDER,
      };
      const textCenterStyle = {
        font: { name: "Calibri", sz: 9.5, color: { rgb: "0F172A" } },
        fill: { fgColor: { rgb: bgRgb } },
        alignment: { horizontal: "center", vertical: "center" },
        border: THIN_BORDER,
      };
      const numRightStyle = {
        font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
        fill: { fgColor: { rgb: bgRgb } },
        alignment: { horizontal: "right", vertical: "center" },
        border: THIN_BORDER,
      };
      const rowAvgRightStyle = {
        font: {
          name: "Consolas",
          sz: 9.5,
          bold: true,
          color: { rgb: "0F172A" },
        },
        fill: { fgColor: { rgb: "F8FAFC" } },
        alignment: { horizontal: "right", vertical: "center" },
        border: THIN_BORDER,
      };

      aoa.push([
        makeCell(item.tanggal, dateCellStyle),
        makeCell(item.validityCycle, cycleCellStyle),
        makeCell(`${item.forecaster} / ${item.verifikator}`, textCenterStyle),
        makeCell(item.scores.arahAngin, numRightStyle, { z: "0.00" }),
        makeCell(item.scores.kecepatanAngin, numRightStyle, { z: "0.00" }),
        makeCell(item.scores.gusty, numRightStyle, { z: "0.00" }),
        makeCell(item.scores.visibilitas, numRightStyle, { z: "0.00" }),
        makeCell(item.scores.presipitasi, numRightStyle, { z: "0.00" }),
        makeCell(item.scores.jumlahAwan, numRightStyle, { z: "0.00" }),
        makeCell(item.scores.tinggiAwan, numRightStyle, { z: "0.00" }),
        makeCell(rowAvg, rowAvgRightStyle, {
          t: "n",
          f: `IFERROR(AVERAGE(D${excelRowNum}:J${excelRowNum}), 0)`,
          z: "0.00",
        }),
      ]);
      rowsMeta.push({ hpt: 20 });
    });

    const bottomAvgRowIdx = 6 + mr.items.length;
    const bottomAvgExcelRow = bottomAvgRowIdx + 1;

    const bottomElementAvgRow: StyledCell[] = [
      makeCell("RATA-RATA TIAP UNSUR (%)", yellowRightLabelStyle),
      makeCell("", yellowRightLabelStyle),
      makeCell("", yellowRightLabelStyle),
      ...avgKeys.map((k, idx) => {
        const val = mr.monthlyAverage ? mr.monthlyAverage[k] : 0;
        const letter = colLetters[idx];
        return makeCell(val, yellowNumStyle, {
          t: "n",
          f: `IFERROR(AVERAGE(${letter}${dataStartExcelRow}:${letter}${dataEndExcelRow}), 0)`,
          z: "0.00",
        });
      }),
      makeCell(monthlyOverallVal, yellowNumStyle, {
        t: "n",
        f: `IFERROR(AVERAGE(K${dataStartExcelRow}:K${dataEndExcelRow}), 0)`,
        z: "0.00",
      }),
    ];
    aoa.push(bottomElementAvgRow);
    merges.push({
      s: { r: bottomAvgRowIdx, c: 0 },
      e: { r: bottomAvgRowIdx, c: 2 },
    });
    rowsMeta.push({ hpt: 22 });

    const overallRowIdx = 6 + mr.items.length;
    const overallMonthRow: StyledCell[] = Array.from({ length: 11 }, (_, c) => {
      if (c === 0) {
        return makeCell(
          `RATA-RATA KESELURUHAN BULAN (${mr.bulanNama})`,
          emeraldRightLabelStyle,
        );
      }
      if (c === 3) {
        return makeCell(monthlyOverallVal, emeraldCenterValStyle, {
          t: "n",
          f: `IFERROR(AVERAGE(D6:J6), 0)`,
          z: '0.00"%"',
        });
      }
      return makeCell(
        "",
        c < 3 ? emeraldRightLabelStyle : emeraldCenterValStyle,
      );
    });
    aoa.push(overallMonthRow);
    merges.push({
      s: { r: overallRowIdx, c: 0 },
      e: { r: overallRowIdx, c: 2 },
    });
    merges.push({
      s: { r: overallRowIdx, c: 3 },
      e: { r: overallRowIdx, c: 10 },
    });
    rowsMeta.push({ hpt: 24 });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!rows"] = rowsMeta;
  ws["!cols"] = [
    { wch: 22 },
    { wch: 16 },
    { wch: 26 },
    { wch: 15 },
    { wch: 18 },
    { wch: 13 },
    { wch: 15 },
    { wch: 15 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
  ];

  return ws;
}

function buildAnnualRecapWorksheet(
  data: FullVerificationWorkbookResult,
  stationLabel: string,
  populatedMonthIndices: Set<number>,
): XLSX.WorkSheet {
  const aoa: StyledCell[][] = [];
  const merges: XLSX.Range[] = [];
  const rowsMeta: { hpt?: number }[] = [];

  const titleStyle = {
    font: { name: "Calibri", sz: 13, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const subTitleStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "334155" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const hdrStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F1F5F9" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };
  const hdrAvgStyle = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: THIN_BORDER,
  };
  const cellCenter = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const cellLeft = {
    font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: THIN_BORDER,
  };
  const cellNum = {
    font: { name: "Consolas", sz: 9.5, color: { rgb: "0F172A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const cellAvgCol = {
    font: { name: "Consolas", sz: 9.5, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };
  const yellowStyle = {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "FDE047" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  aoa.push([makeCell(`Rekap Tahunan — Tahun ${data.tahun}`, titleStyle)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } });
  rowsMeta.push({ hpt: 22 });

  aoa.push([makeCell(stationLabel || "Stasiun Meteorologi", subTitleStyle)]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 14 } });
  rowsMeta.push({ hpt: 18 });

  aoa.push([]);
  rowsMeta.push({ hpt: 10 });

  const hRow1: StyledCell[] = [
    makeCell("No", hdrStyle),
    makeCell("Unsur Cuaca", hdrStyle),
    ...Array.from({ length: 12 }, (_, idx) =>
      makeCell(idx === 0 ? "Hasil Verifikasi TAF (dalam %)" : "", hdrStyle),
    ),
    makeCell("Rata-rata\n1 Tahun (%)", hdrAvgStyle),
  ];
  aoa.push(hRow1);
  merges.push({ s: { r: 3, c: 0 }, e: { r: 4, c: 0 } });
  merges.push({ s: { r: 3, c: 1 }, e: { r: 4, c: 1 } });
  merges.push({ s: { r: 3, c: 2 }, e: { r: 3, c: 13 } });
  merges.push({ s: { r: 3, c: 14 }, e: { r: 4, c: 14 } });
  rowsMeta.push({ hpt: 22 });

  const hRow2: StyledCell[] = [
    makeCell("", hdrStyle),
    makeCell("", hdrStyle),
    ...MONTH_SHORT_LABELS.map((m) => makeCell(m, hdrStyle)),
    makeCell("", hdrAvgStyle),
  ];
  aoa.push(hRow2);
  rowsMeta.push({ hpt: 22 });

  const recapColLetters = ["D", "E", "F", "G", "H", "I", "J"];
  const monthColLetters = [
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
  ];

  data.annualRows.forEach((row, rIdx) => {
    const excelRowNum = 6 + rIdx;
    const recapCol = recapColLetters[rIdx];

    const monthCells: StyledCell[] = row.monthlyValues.map((val, mIdx) => {
      if (val !== null && populatedMonthIndices.has(mIdx)) {
        const sheetName = `REKAP - ${MONTH_SHEETS[mIdx]}`;
        return makeCell(val, cellNum, {
          t: "n",
          f: `IFERROR('${sheetName}'!${recapCol}6, "-")`,
          z: "0.00",
        });
      }
      return makeCell("-", cellNum);
    });

    const avgCell: StyledCell =
      row.annualAverage !== null
        ? makeCell(row.annualAverage, cellAvgCol, {
            t: "n",
            f: `IFERROR(AVERAGE(C${excelRowNum}:N${excelRowNum}), "-")`,
            z: "0.00",
          })
        : makeCell("-", cellAvgCol);

    aoa.push([
      makeCell(row.no, cellCenter),
      makeCell(row.unsur, cellLeft),
      ...monthCells,
      avgCell,
    ]);
    rowsMeta.push({ hpt: 21 });
  });

  const yellowMonthlyCells: StyledCell[] = data.annualMonthlyOverall.map(
    (val, mIdx) => {
      const colL = monthColLetters[mIdx];
      return val !== null
        ? makeCell(val, yellowStyle, {
            t: "n",
            f: `IFERROR(AVERAGE(${colL}6:${colL}12), "-")`,
            z: "0.00",
          })
        : makeCell("-", yellowStyle);
    },
  );

  const grandAvgCell: StyledCell =
    data.annualGrandAverage !== null
      ? makeCell(data.annualGrandAverage, yellowStyle, {
          t: "n",
          f: `IFERROR(AVERAGE(O6:O12), "-")`,
          z: '0.00"%"',
        })
      : makeCell("-", yellowStyle);

  aoa.push([
    makeCell("Rata - rata 1 tahun", yellowStyle),
    makeCell("", yellowStyle),
    ...yellowMonthlyCells,
    grandAvgCell,
  ]);
  merges.push({ s: { r: 12, c: 0 }, e: { r: 12, c: 1 } });
  rowsMeta.push({ hpt: 24 });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!rows"] = rowsMeta;
  ws["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    ...Array(12).fill({ wch: 10 }),
    { wch: 18 },
  ];

  return ws;
}

// ============================================================================
// 4. EXPORT HASIL BULANAN (.XLSX)
// ============================================================================
export function exportMonthlyVerificationExcel(
  data: FullVerificationWorkbookResult,
  monthIndex: number,
  stationLabel: string,
): void {
  const wb = XLSX.utils.book_new();
  const mr = data.monthlyRecaps[monthIndex];
  if (!mr) return;

  const wsRecap = buildMonthlyRecapWorksheet(mr, stationLabel);
  XLSX.utils.book_append_sheet(wb, wsRecap, "REKAP BULANAN");

  const monthItems = data.individualResults.filter(
    (it) => it.bulanIndex === monthIndex,
  );
  const byDateMap = new Map<number, IndividualTafVerificationResult[]>();
  for (const item of monthItems) {
    const arr = byDateMap.get(item.tanggal) || [];
    arr.push(item);
    byDateMap.set(item.tanggal, arr);
  }

  const sortedDates = Array.from(byDateMap.keys()).sort((a, b) => a - b);
  for (const d of sortedDates) {
    const itemsForDate = byDateMap.get(d) || [];
    if (itemsForDate.length === 0) continue;
    const wsDate = buildIndividualDateWorksheet(itemsForDate, stationLabel);
    XLSX.utils.book_append_sheet(wb, wsDate, `TGL ${d}`);
  }

  XLSX.writeFile(wb, `Hasil_Verifikasi_TAF_${mr.bulanNama}_${data.tahun}.xlsx`);
}

// ============================================================================
// 5. EXPORT HASIL TAHUNAN (.XLSX)
// ============================================================================
export function exportAnnualVerificationExcel(
  data: FullVerificationWorkbookResult,
  stationLabel: string,
): void {
  const wb = XLSX.utils.book_new();

  const populatedMonthIndices = new Set<number>();
  for (const mr of data.monthlyRecaps) {
    if (mr.items.length > 0) populatedMonthIndices.add(mr.bulanIndex);
  }

  const wsAnnual = buildAnnualRecapWorksheet(
    data,
    stationLabel,
    populatedMonthIndices,
  );
  XLSX.utils.book_append_sheet(wb, wsAnnual, "REKAP TAHUNAN");

  for (const mr of data.monthlyRecaps) {
    if (mr.items.length === 0) continue;
    const wsMonthly = buildMonthlyRecapWorksheet(mr, stationLabel);
    XLSX.utils.book_append_sheet(wb, wsMonthly, `REKAP - ${mr.bulanNama}`);
  }

  const byMonthDateMap = new Map<string, IndividualTafVerificationResult[]>();
  for (const item of data.individualResults) {
    const key = `${String(item.bulanIndex).padStart(2, "0")}-${String(item.tanggal).padStart(2, "0")}`;
    const arr = byMonthDateMap.get(key) || [];
    arr.push(item);
    byMonthDateMap.set(key, arr);
  }

  const sortedKeys = Array.from(byMonthDateMap.keys()).sort();
  for (const key of sortedKeys) {
    const itemsForDate = byMonthDateMap.get(key) || [];
    if (itemsForDate.length === 0) continue;
    const first = itemsForDate[0];
    const sheetTitle = `${String(first.tanggal).padStart(2, "0")} ${MONTH_SHORT_LABELS[first.bulanIndex]}`;
    const wsDate = buildIndividualDateWorksheet(itemsForDate, stationLabel);
    XLSX.utils.book_append_sheet(wb, wsDate, sheetTitle);
  }

  XLSX.writeFile(wb, `Hasil_Verifikasi_TAF_TAHUN_${data.tahun}.xlsx`);
}
