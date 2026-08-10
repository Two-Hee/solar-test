/*
 * Solar Yield V01 calculation engine
 * - Monthly GHI decomposition: Erbs correlation
 * - Plane-of-array transposition: Hay-Davies anisotropic sky model
 * - Solar position: compact NOAA-style local-solar-time formulation
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;
  const SOLAR_CONSTANT = 1367;
  const MONTH_NAMES = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function daysInMonth(year, month) {
    return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function dayOfYear(year, month, day) {
    let total = day;
    for (let current = 1; current < month; current += 1) total += daysInMonth(year, current);
    return total;
  }

  function solarDeclination(dayNumber) {
    return 23.45 * Math.sin(((360 * (284 + dayNumber)) / 365) * DEG);
  }

  function equationOfTime(dayNumber) {
    const b = ((360 / 365) * (dayNumber - 81)) * DEG;
    return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  }

  function extraterrestrialNormal(dayNumber) {
    return SOLAR_CONSTANT * (1 + 0.033 * Math.cos(((360 * dayNumber) / 365) * DEG));
  }

  function sunVector(latitude, declination, hourAngle) {
    const phi = latitude * DEG;
    const delta = declination * DEG;
    const omega = hourAngle * DEG;
    const east = -Math.cos(delta) * Math.sin(omega);
    const north = Math.cos(phi) * Math.sin(delta) - Math.sin(phi) * Math.cos(delta) * Math.cos(omega);
    const up = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(omega);
    return { east, north, up };
  }

  function surfaceVector(tilt, azimuth) {
    const beta = tilt * DEG;
    const gamma = azimuth * DEG;
    return {
      east: Math.sin(beta) * Math.sin(gamma),
      north: Math.sin(beta) * Math.cos(gamma),
      up: Math.cos(beta),
    };
  }

  function incidenceCosine(sun, surface) {
    return sun.east * surface.east + sun.north * surface.north + sun.up * surface.up;
  }

  function solarGeometryLocal(parts, latitude, longitude, timezone = 9) {
    const n = dayOfYear(parts.year, parts.month, parts.day);
    const clockHour = parts.hour + parts.minute / 60 + (parts.second || 0) / 3600;
    const standardMeridian = 15 * timezone;
    const correctionMinutes = 4 * (longitude - standardMeridian) + equationOfTime(n);
    const solarTime = clockHour + correctionMinutes / 60;
    const hourAngle = 15 * (solarTime - 12);
    const declination = solarDeclination(n);
    const sun = sunVector(latitude, declination, hourAngle);
    const zenith = Math.acos(clamp(sun.up, -1, 1)) / DEG;
    const azimuth = (Math.atan2(sun.east, sun.north) / DEG + 360) % 360;
    return {
      dayNumber: n,
      declination,
      hourAngle,
      zenith,
      azimuth,
      cosZenith: Math.max(0, sun.up),
      extraterrestrialNormal: extraterrestrialNormal(n),
      sun,
    };
  }

  function erbsDiffuseFraction(clearnessIndex) {
    const kt = clamp(clearnessIndex, 0, 1.2);
    if (kt <= 0.22) return clamp(1 - 0.09 * kt, 0, 1);
    if (kt <= 0.8) {
      return clamp(
        0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4,
        0,
        1,
      );
    }
    return 0.165;
  }

  function representativeDay(month) {
    return [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344][month - 1];
  }

  function integratedGeometry(latitude, tilt, azimuth, month) {
    const dayNumber = representativeDay(month);
    const declination = solarDeclination(dayNumber);
    const surface = surfaceVector(tilt, azimuth);
    const e0n = extraterrestrialNormal(dayNumber);
    const stepMinutes = 5;
    let horizontalWh = 0;
    let tiltedWh = 0;

    for (let minute = 0; minute < 24 * 60; minute += stepMinutes) {
      const solarTime = (minute + stepMinutes / 2) / 60;
      const hourAngle = 15 * (solarTime - 12);
      const sun = sunVector(latitude, declination, hourAngle);
      const cosZenith = Math.max(0, sun.up);
      if (cosZenith <= 0) continue;
      horizontalWh += e0n * cosZenith * (stepMinutes / 60);
      tiltedWh += e0n * Math.max(0, incidenceCosine(sun, surface)) * (stepMinutes / 60);
    }

    return {
      h0MjM2Day: (horizontalWh / 1000) * 3.6,
      beamRatio: clamp(horizontalWh > 0 ? tiltedWh / horizontalWh : 0, 0, 8),
    };
  }

  function monthlyPlaneOfArray(ghiMjM2, days, month, config) {
    const dailyGhi = ghiMjM2 / days;
    const geometry = integratedGeometry(config.latitude, config.tilt, config.azimuth, month);
    const kt = clamp(dailyGhi / Math.max(geometry.h0MjM2Day, 0.001), 0, 1.2);
    const diffuseFraction = erbsDiffuseFraction(kt);
    const diffuseHorizontal = dailyGhi * diffuseFraction;
    const beamHorizontal = Math.max(0, dailyGhi - diffuseHorizontal);
    const anisotropy = clamp(beamHorizontal / Math.max(geometry.h0MjM2Day, 0.001), 0, 0.95);
    const beta = config.tilt * DEG;
    const skyFactor = anisotropy * geometry.beamRatio + (1 - anisotropy) * (1 + Math.cos(beta)) / 2;
    const groundFactor = config.albedo * (1 - Math.cos(beta)) / 2;
    const dailyPoa =
      beamHorizontal * geometry.beamRatio + diffuseHorizontal * skyFactor + dailyGhi * groundFactor;

    return {
      poaMjM2: Math.max(0, dailyPoa * days),
      kt,
      diffuseFraction,
      beamRatio: geometry.beamRatio,
    };
  }

  function getMonthlyProfile(dataset, region, profileYear) {
    const regionData = dataset.records[region];
    if (!regionData) throw new Error("선택한 지역의 KMA 자료를 찾을 수 없습니다.");

    if (String(profileYear) !== "average") {
      const selected = regionData[String(profileYear)];
      if (!selected) throw new Error("선택한 연도의 KMA 자료를 찾을 수 없습니다.");
      return selected.map((row) => ({ ...row }));
    }

    const years = Object.keys(regionData);
    return Array.from({ length: 12 }, (_, index) => {
      const rows = years.map((year) => regionData[year][index]);
      const average = (key) => rows.reduce((sum, row) => sum + toNumber(row[key]), 0) / rows.length;
      return {
        month: index + 1,
        sunshineHours: average("sunshineHours"),
        ghiMjM2: average("ghiMjM2"),
        days: average("days"),
        dailyGhiMjM2: average("dailyGhiMjM2"),
      };
    });
  }

  function projection(baseAnnualEnergy, years, initialDegradation, annualDegradation) {
    const rows = [];
    let cumulative = 0;
    for (let year = 1; year <= years; year += 1) {
      const factor = (1 - initialDegradation) * (1 - annualDegradation) ** (year - 1);
      const energy = baseAnnualEnergy * factor;
      cumulative += energy;
      rows.push({ year, factor, energyKwh: energy, cumulativeKwh: cumulative });
    }
    return rows;
  }

  function summarize(monthly, config, metadata = {}) {
    const annualGhi = monthly.reduce((sum, row) => sum + row.ghiKwhM2, 0);
    const annualPoa = monthly.reduce((sum, row) => sum + row.poaKwhM2, 0);
    const baseAnnualEnergy = monthly.reduce((sum, row) => sum + row.baseEnergyKwh, 0);
    const years = projection(
      baseAnnualEnergy,
      config.projectionYears,
      config.initialDegradation,
      config.annualDegradation,
    );
    const firstYearEnergy = years[0]?.energyKwh || 0;
    const analysisDays = monthly.reduce((sum, row) => sum + toNumber(row.days), 0) || 365.25;
    const equivalentGenerationHoursDay = config.capacityKw > 0
      ? firstYearEnergy / config.capacityKw / analysisDays
      : 0;

    const firstYearFactor = 1 - config.initialDegradation;
    const adjustedMonthly = monthly.map((row) => ({
      ...row,
      energyKwh: row.baseEnergyKwh * firstYearFactor,
    }));

    return {
      metadata,
      config: { ...config },
      monthly: adjustedMonthly,
      yearly: years,
      summary: {
        annualGhiKwhM2: annualGhi,
        annualPoaKwhM2: annualPoa,
        firstYearEnergyKwh: firstYearEnergy,
        cumulativeEnergyKwh: years.at(-1)?.cumulativeKwh || 0,
        equivalentGenerationHoursDay,
        poaGain: annualGhi > 0 ? annualPoa / annualGhi - 1 : 0,
      },
    };
  }

  function normalizeConfig(input) {
    return {
      siteName: String(input.siteName || "태양광 발전소"),
      region: String(input.region || "서울경기"),
      profileYear: input.profileYear || "average",
      latitude: clamp(toNumber(input.latitude, 37.5665), -66, 66),
      longitude: clamp(toNumber(input.longitude, 126.978), -180, 180),
      timezone: clamp(toNumber(input.timezone, 9), -12, 14),
      capacityKw: Math.max(0.001, toNumber(input.capacityKw, 1000)),
      tilt: clamp(toNumber(input.tilt, 25), 0, 90),
      azimuth: ((toNumber(input.azimuth, 180) % 360) + 360) % 360,
      albedo: clamp(toNumber(input.albedo, 0.2), 0, 1),
      systemEfficiency: clamp(toNumber(input.systemEfficiency, 0.82), 0.01, 1),
      initialDegradation: clamp(toNumber(input.initialDegradation, 0.01), 0, 0.25),
      annualDegradation: clamp(toNumber(input.annualDegradation, 0.005), 0, 0.05),
      projectionYears: Math.round(clamp(toNumber(input.projectionYears, 25), 1, 50)),
      temperatureCoefficient: clamp(toNumber(input.temperatureCoefficient, -0.0035), -0.01, 0),
      noct: clamp(toNumber(input.noct, 45), 30, 60),
      useTemperature: Boolean(input.useTemperature),
    };
  }

  function calculateFromKma(inputConfig, dataset) {
    const config = normalizeConfig(inputConfig);
    const sourceRows = getMonthlyProfile(dataset, config.region, config.profileYear);
    const monthly = sourceRows.map((source) => {
      const poa = monthlyPlaneOfArray(source.ghiMjM2, source.days, source.month, config);
      const ghiKwhM2 = source.ghiMjM2 / 3.6;
      const poaKwhM2 = poa.poaMjM2 / 3.6;
      return {
        month: source.month,
        label: MONTH_NAMES[source.month - 1],
        days: source.days,
        sunshineHours: source.sunshineHours,
        ghiKwhM2,
        poaKwhM2,
        baseEnergyKwh: poaKwhM2 * config.capacityKw * config.systemEfficiency,
        diffuseFraction: poa.diffuseFraction,
        clearnessIndex: poa.kt,
        beamRatio: poa.beamRatio,
        dataPoints: 1,
      };
    });

    return summarize(monthly, config, {
      mode: "kma-monthly",
      source: dataset.meta.source,
      period: String(config.profileYear) === "average" ? dataset.meta.period + " 평균" : String(config.profileYear),
      quality: "표준(지역 월자료)",
    });
  }

  function hourlyPoa(ghi, dni, dhi, geometry, config) {
    if (geometry.cosZenith <= 0 || ghi <= 0) return 0;
    const surface = surfaceVector(config.tilt, config.azimuth);
    const cosIncidence = Math.max(0, incidenceCosine(geometry.sun, surface));
    const beam = Math.max(0, dni) * cosIncidence;
    const rb = cosIncidence / Math.max(geometry.cosZenith, 0.065);
    const anisotropy = clamp(dni / Math.max(geometry.extraterrestrialNormal, 1), 0, 1);
    const beta = config.tilt * DEG;
    const sky = Math.max(0, dhi) * (anisotropy * rb + (1 - anisotropy) * (1 + Math.cos(beta)) / 2);
    const ground = Math.max(0, ghi) * config.albedo * (1 - Math.cos(beta)) / 2;
    return Math.max(0, beam + sky + ground);
  }

  function splitGhi(ghi, geometry) {
    if (geometry.cosZenith <= 0 || ghi <= 0) return { dni: 0, dhi: 0 };
    const extraterrestrialHorizontal = geometry.extraterrestrialNormal * geometry.cosZenith;
    const kt = clamp(ghi / Math.max(extraterrestrialHorizontal, 1), 0, 1.2);
    const diffuseFraction = erbsDiffuseFraction(kt);
    const dhi = ghi * diffuseFraction;
    const dni = Math.max(0, (ghi - dhi) / Math.max(geometry.cosZenith, 0.065));
    return { dni, dhi };
  }

  function calculateFromHourly(inputConfig, rows, sourceMeta = {}) {
    const config = normalizeConfig(inputConfig);
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("시간별 입력자료가 없습니다.");
    const periodBuckets = new Map();

    rows.forEach((row) => {
      const parts = row.parts;
      if (!parts || parts.month < 1 || parts.month > 12) return;
      const geometry = solarGeometryLocal(parts, config.latitude, config.longitude, config.timezone);
      const ghi = Math.max(0, toNumber(row.ghiWm2, 0));
      const split = Number.isFinite(row.dniWm2) && Number.isFinite(row.dhiWm2)
        ? { dni: Math.max(0, row.dniWm2), dhi: Math.max(0, row.dhiWm2) }
        : splitGhi(ghi, geometry);
      const poa = hourlyPoa(ghi, split.dni, split.dhi, geometry, config);
      const duration = clamp(toNumber(row.durationHours, 1), 1 / 60, 6);
      const ghiEnergy = (ghi * duration) / 1000;
      const poaEnergy = (poa * duration) / 1000;
      let temperatureFactor = 1;
      if (config.useTemperature && Number.isFinite(row.temperatureC)) {
        const cellTemperature = row.temperatureC + ((config.noct - 20) / 800) * poa;
        temperatureFactor = clamp(1 + config.temperatureCoefficient * (cellTemperature - 25), 0.65, 1.1);
      }
      const periodKey = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
      if (!periodBuckets.has(periodKey)) {
        periodBuckets.set(periodKey, {
          year: parts.year,
          month: parts.month,
          sunshineHours: 0,
          ghiKwhM2: 0,
          poaKwhM2: 0,
          baseEnergyKwh: 0,
          dataPoints: 0,
          temperaturePoints: 0,
          dates: new Set(),
        });
      }
      const bucket = periodBuckets.get(periodKey);
      bucket.ghiKwhM2 += ghiEnergy;
      bucket.poaKwhM2 += poaEnergy;
      bucket.baseEnergyKwh += poaEnergy * config.capacityKw * config.systemEfficiency * temperatureFactor;
      bucket.sunshineHours += ghi > 120 ? duration : 0;
      bucket.dataPoints += 1;
      if (Number.isFinite(row.temperatureC)) bucket.temperaturePoints += 1;
      bucket.dates.add(`${parts.year}-${parts.month}-${parts.day}`);
    });

    const buckets = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const periods = Array.from(periodBuckets.values()).filter((period) => period.month === month);
      const average = (key) => periods.length
        ? periods.reduce((sum, period) => sum + toNumber(period[key]), 0) / periods.length
        : 0;
      return {
        month,
        label: MONTH_NAMES[index],
        days: periods.length ? periods.reduce((sum, period) => sum + period.dates.size, 0) / periods.length : 0,
        sunshineHours: average("sunshineHours"),
        ghiKwhM2: average("ghiKwhM2"),
        poaKwhM2: average("poaKwhM2"),
        baseEnergyKwh: average("baseEnergyKwh"),
        dataPoints: periods.reduce((sum, period) => sum + period.dataPoints, 0),
        temperaturePoints: periods.reduce((sum, period) => sum + period.temperaturePoints, 0),
        profileYears: periods.length,
      };
    });

    const equivalentDays = buckets.reduce((sum, bucket) => sum + bucket.days, 0);
    const coverageRatio = clamp(equivalentDays / 365.25, 0, 1);
    return summarize(buckets, config, {
      mode: "hourly-import",
      source: sourceMeta.source || "사용자 시간별 자료",
      period: sourceMeta.period || "가져온 자료 기간",
      quality: coverageRatio >= 0.9 ? "정밀(시간자료)" : `부분기간(${Math.round(equivalentDays)}일 상당)`,
      importedRows: rows.length,
      unit: sourceMeta.unit || "W/m²",
      coverageRatio,
      equivalentDays,
    });
  }

  global.SolarEngine = {
    calculateFromKma,
    calculateFromHourly,
    normalizeConfig,
    solarGeometryLocal,
    monthlyPlaneOfArray,
    erbsDiffuseFraction,
    daysInMonth,
  };
})(window);
