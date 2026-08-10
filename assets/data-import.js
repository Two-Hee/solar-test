(function (global) {
  "use strict";

  const HEADER_RULES = {
    datetime: ["일시", "관측일시", "datetime", "timestamp", "date_time", "tm"],
    date: ["날짜", "일자", "date", "ymd"],
    clock: ["시각", "시간", "hour", "clock"],
    ghi: ["수평면일사", "전천일사", "일사량", "일사", "ghi", "global_horizontal", "allsky_sfc_sw_dwn", "g(h)"],
    dni: ["직달일사", "직달", "dni", "beam_normal", "gb(n)"],
    dhi: ["산란일사", "산란", "dhi", "diffuse_horizontal", "gd(h)"],
    temperature: ["기온", "외기온", "temperature", "temp_air", "t2m", "temp"],
    wind: ["풍속", "wind_speed", "windspeed", "ws"],
  };

  function normalizeHeader(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_\-./()[\]{}°㎡²]+/g, "");
  }

  function findHeader(headers, rules, excluded = []) {
    const normalizedRules = rules.map(normalizeHeader);
    const candidates = headers.filter((header) => !excluded.includes(header));
    for (const rule of normalizedRules) {
      const exact = candidates.find((header) => normalizeHeader(header) === rule);
      if (exact) return exact;
    }
    for (const rule of normalizedRules) {
      const partial = candidates.find((header) => normalizeHeader(header).includes(rule));
      if (partial) return partial;
    }
    return null;
  }

  function mapHeaders(headers) {
    const datetime = findHeader(headers, HEADER_RULES.datetime);
    const date = datetime ? null : findHeader(headers, HEADER_RULES.date);
    const clock = datetime ? null : findHeader(headers, HEADER_RULES.clock, date ? [date] : []);
    const dni = findHeader(headers, HEADER_RULES.dni);
    const dhi = findHeader(headers, HEADER_RULES.dhi);
    const ghi = findHeader(headers, HEADER_RULES.ghi, [dni, dhi].filter(Boolean));
    return {
      datetime,
      date,
      clock,
      ghi,
      dni,
      dhi,
      temperature: findHeader(headers, HEADER_RULES.temperature),
      wind: findHeader(headers, HEADER_RULES.wind),
    };
  }

  function excelDateParts(value) {
    const parsed = global.XLSX?.SSF?.parse_date_code(value);
    if (!parsed) return null;
    return {
      year: parsed.y,
      month: parsed.m,
      day: parsed.d,
      hour: parsed.H || 0,
      minute: parsed.M || 0,
      second: Math.round(parsed.S || 0),
    };
  }

  function parseDateParts(value, clockValue = null) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return {
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        day: value.getDate(),
        hour: value.getHours(),
        minute: value.getMinutes(),
        second: value.getSeconds(),
      };
    }
    if (typeof value === "number") {
      const base = excelDateParts(value);
      if (!base) return null;
      if (clockValue !== null && typeof clockValue === "number" && clockValue >= 0 && clockValue < 1) {
        const seconds = Math.round(clockValue * 86400);
        base.hour = Math.floor(seconds / 3600);
        base.minute = Math.floor((seconds % 3600) / 60);
        base.second = seconds % 60;
      }
      return base;
    }

    let text = String(value ?? "").trim();
    if (!text) return null;
    if (clockValue !== null && clockValue !== undefined && String(clockValue).trim()) text += ` ${clockValue}`;
    text = text
      .replace(/[년/.]/g, "-")
      .replace(/[월]/g, "-")
      .replace(/[일]/g, " ")
      .replace(/T/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const match = text.match(/(\d{4})[-]?(\d{1,2})[-]?(\d{1,2})(?:\s+(\d{1,2})(?::?(\d{1,2}))?(?::?(\d{1,2}))?)?/);
    if (!match) return null;
    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] || 0),
      minute: Number(match[5] || 0),
      second: Number(match[6] || 0),
    };
    if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23) return null;
    return parts;
  }

  function timestampKey(parts) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  }

  function numeric(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function median(values) {
    if (!values.length) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function inferUnit(header, values, requested) {
    if (requested && requested !== "auto") return requested;
    const normalized = normalizeHeader(header);
    if (normalized.includes("mj")) return "mj";
    if (normalized.includes("kwh")) return "kwh";
    const finite = values.filter(Number.isFinite);
    const upper = finite.length ? Math.max(...finite.slice(0, 2000)) : 0;
    return upper <= 8 ? "mj" : "wm2";
  }

  function convertToWm2(value, unit, durationHours) {
    if (!Number.isFinite(value)) return 0;
    if (unit === "mj") return ((value / 3.6) * 1000) / durationHours;
    if (unit === "kwh") return (value * 1000) / durationHours;
    return value;
  }

  async function readRows(file) {
    if (!global.XLSX) throw new Error("엑셀 읽기 모듈을 불러오지 못했습니다.");
    const buffer = await file.arrayBuffer();
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    let workbook;
    if (extension === "csv" || extension === "tsv" || extension === "txt") {
      const bytes = new Uint8Array(buffer);
      let sourceText = new TextDecoder("utf-8").decode(bytes);
      if (sourceText.includes("�")) sourceText = new TextDecoder("euc-kr").decode(bytes);
      workbook = global.XLSX.read(sourceText, { type: "string", cellDates: false, raw: true, FS: extension === "tsv" ? "\t" : undefined });
    } else {
      workbook = global.XLSX.read(buffer, { type: "array", cellDates: false });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = global.XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    return { rows, sheetName: workbook.SheetNames[0] };
  }

  async function importHourlyFile(file, requestedUnit = "auto") {
    const { rows: rawRows, sheetName } = await readRows(file);
    if (!rawRows.length) throw new Error("파일에서 데이터 행을 찾지 못했습니다.");
    const headers = Object.keys(rawRows[0]);
    const mapping = mapHeaders(headers);
    if (!mapping.ghi) throw new Error("수평면 일사량 열(GHI/일사/전천일사)을 찾지 못했습니다.");
    if (!mapping.datetime && !mapping.date) throw new Error("일시 또는 날짜 열을 찾지 못했습니다.");

    const parsed = rawRows
      .map((row) => {
        const parts = mapping.datetime
          ? parseDateParts(row[mapping.datetime])
          : parseDateParts(row[mapping.date], mapping.clock ? row[mapping.clock] : null);
        if (!parts) return null;
        return {
          parts,
          timestamp: timestampKey(parts),
          rawGhi: numeric(row[mapping.ghi]),
          rawDni: mapping.dni ? numeric(row[mapping.dni]) : NaN,
          rawDhi: mapping.dhi ? numeric(row[mapping.dhi]) : NaN,
          temperatureC: mapping.temperature ? numeric(row[mapping.temperature]) : NaN,
          windSpeed: mapping.wind ? numeric(row[mapping.wind]) : NaN,
        };
      })
      .filter((row) => row && Number.isFinite(row.rawGhi))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!parsed.length) throw new Error("유효한 일시와 일사량 값을 찾지 못했습니다.");
    const intervals = [];
    for (let index = 1; index < parsed.length; index += 1) {
      const hours = (parsed[index].timestamp - parsed[index - 1].timestamp) / 3600000;
      if (hours >= 1 / 60 && hours <= 6) intervals.push(hours);
    }
    const typicalInterval = Math.max(1 / 60, Math.min(6, median(intervals)));
    const unit = inferUnit(mapping.ghi, parsed.map((row) => row.rawGhi), requestedUnit);

    parsed.forEach((row, index) => {
      const next = parsed[index + 1];
      const delta = next ? (next.timestamp - row.timestamp) / 3600000 : typicalInterval;
      row.durationHours = delta >= 1 / 60 && delta <= 6 ? delta : typicalInterval;
      row.ghiWm2 = convertToWm2(row.rawGhi, unit, row.durationHours);
      row.dniWm2 = Number.isFinite(row.rawDni) ? convertToWm2(row.rawDni, unit, row.durationHours) : NaN;
      row.dhiWm2 = Number.isFinite(row.rawDhi) ? convertToWm2(row.rawDhi, unit, row.durationHours) : NaN;
    });

    const first = parsed[0].parts;
    const last = parsed.at(-1).parts;
    const fmt = (parts) => `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const warnings = [];
    if (typicalInterval > 1.5) warnings.push("자료 간격이 1시간보다 큽니다. 시간별 자료인지 확인하세요.");
    if (!mapping.dni || !mapping.dhi) warnings.push("DNI/DHI가 없어 GHI에서 Erbs 모델로 분리했습니다.");

    return {
      rows: parsed,
      meta: {
        source: file.name,
        period: `${fmt(first)} ~ ${fmt(last)}`,
        quality: "정밀(가져온 시간자료)",
        unit,
        sheetName,
        mapping,
        typicalInterval,
        warnings,
      },
    };
  }

  global.SolarDataImport = { importHourlyFile, mapHeaders, parseDateParts };
})(window);
