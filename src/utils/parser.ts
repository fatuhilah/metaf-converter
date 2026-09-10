export interface MetarParsedData {
  type: string;
  station: string;
  rawZulu: string | null;
  waktuZ: string;
  day: string;
  windDir: string;
  windSpd: string;
  windUnit: string;
  rawDir: number | null;
  rawSpd: number | null;
  windVar: string;
  visMetar: string;
  visAngka: number;
  wxTokens: string[];
  cloudTokens: string[];
  tt: string;
  td: string;
  qnh: string;
  trendTokens: string[];
  rmkTokens: string[];
}

export function parseSingleMetar(metarStr: string): MetarParsedData {
  let matchMetar = metarStr.match(/(METAR|SPECI)\s+/);
  let cleanStr = metarStr;
  let reportType = "METAR";

  if (matchMetar) {
    cleanStr = cleanStr.substring(cleanStr.indexOf(matchMetar[0]));
    reportType = matchMetar[1];
  }
  const tokens = cleanStr.replace(/=.*$/g, "").split(/\s+/);

  let data: MetarParsedData = {
    type: reportType,
    station: "WALS",
    rawZulu: null,
    waktuZ: "-",
    day: "01",
    windDir: "",
    windSpd: "",
    windUnit: "",
    rawDir: null,
    rawSpd: null,
    windVar: "-",
    visMetar: "-",
    visAngka: 0,
    wxTokens: [],
    cloudTokens: [],
    tt: "",
    td: "",
    qnh: "",
    trendTokens: [],
    rmkTokens: [],
  };

  let inTrend = false,
    inRmk = false;
  const windRegex = /^(\d{3}|VRB)P?(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/;
  const weatherRegex =
    /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)$/;
  const cloudRegex = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/;

  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i];
    if (t === "METAR" || t === "SPECI") continue;
    if (t === "RMK") {
      inRmk = true;
      inTrend = false;
      continue;
    }
    if (t === "NOSIG" || t === "BECMG" || t === "TEMPO") {
      inTrend = true;
      inRmk = false;
    }
    if (inRmk) {
      data.rmkTokens.push(t);
      continue;
    }
    if (inTrend) {
      data.trendTokens.push(t);
      continue;
    }

    if (t.endsWith("Z") && t.length >= 7) {
      data.rawZulu = t;
      data.day = t.slice(0, 2);
      data.waktuZ = t.slice(-5);
    } else if (
      t.length === 4 &&
      /^[A-Z]{4}$/.test(t) &&
      !data.rawZulu &&
      i < 3
    ) {
      data.station = t;
    } else if (windRegex.test(t)) {
      let match = t.match(windRegex);
      if (match) {
        data.windDir = match[1];
        data.windSpd = match[2];
        data.windUnit = match[4];
        if (data.windDir !== "VRB") {
          data.rawDir = parseInt(data.windDir, 10);
          data.rawSpd = parseInt(data.windSpd, 10);
        }
      }
    } else if (/^\d{3}V\d{3}$/.test(t)) {
      data.windVar = t;
    } else if (t === "9999" || t === "CAVOK") {
      data.visMetar = t;
      data.visAngka = 10000;
    } else if (/^\d{4}$/.test(t) && !data.qnh && data.visAngka === 0) {
      data.visMetar = t;
      data.visAngka = parseInt(t, 10);
    } else if (weatherRegex.test(t)) {
      data.wxTokens.push(t);
    } else if (cloudRegex.test(t) || t === "NSC" || t === "NCD") {
      data.cloudTokens.push(t);
    } else if (/^M?\d{2}\/M?\d{2}$/.test(t)) {
      let parts = t.split("/");
      data.tt = parts[0];
      data.td = parts[1];
    } else if (/^[QA]\d{4}$/.test(t)) {
      data.qnh = t.substring(1);
    }
  }
  return data;
}

export function getCommonWeatherDesc(code: string) {
  let desc = "";
  if (code.includes("TS")) desc += "Thunderstorm ";
  if (code.includes("SH")) desc += "Showers ";
  if (code.includes("RA")) desc += "Rain ";
  if (code.includes("DZ")) desc += "Drizzle ";
  if (code.includes("FG")) desc += "Fog ";
  if (code.includes("BR")) desc += "Mist ";
  if (code.includes("HZ")) desc += "Haze ";
  if (code.includes("FU")) desc += "Asap ";
  if (code.includes("SN")) desc += "Snow ";
  if (code.includes("VCTS")) return "Thunderstorm di Sekitar";
  if (code.includes("VCSH")) return "Hujan di Sekitar";
  if (code.startsWith("-")) desc = "Light " + desc;
  if (code.startsWith("+")) desc = "Heavy " + desc;
  return desc.trim() || code;
}

export function translateWxToMetReport(wx: string) {
  let prefix = "",
    core = wx;
  if (wx.startsWith("-")) {
    prefix = "FBL ";
    core = wx.substring(1);
  } else if (wx.startsWith("+")) {
    prefix = "HVY ";
    core = wx.substring(1);
  } else if (wx.startsWith("VC")) {
    prefix = "VC";
    core = wx.substring(2);
  } else if (/RA|DZ|SN|SH|TS|GR|GS|PL/.test(wx)) prefix = "MOD ";
  return prefix + core;
}

export function translateCldToMetReport(cld: string) {
  if (cld === "NSC" || cld === "NCD" || cld === "CAVOK") return "NIL";
  let match = cld.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/);
  if (match) {
    let type = match[1],
      heightRaw = match[2],
      cbTcu = match[3] ? " " + match[3] : "";
    let height =
      heightRaw === "///" ? "/// FT" : parseInt(heightRaw, 10) * 100 + " FT";
    return `${type}${cbTcu} ${height}`;
  }
  return cld;
}
