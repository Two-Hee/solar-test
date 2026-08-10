(function () {
  "use strict";

  const dataset = window.KMA_MONTHLY_DATA;
  const engine = window.SolarEngine;
  const importer = window.SolarDataImport;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const chartInstances = {};
  const PROTECTED_PASSWORD = "7777";
  let importedHourly = null;
  let currentResult = null;
  let currentHeatmap = null;
  let passwordResolver = null;

  const palette = {
    ink: "#17312b",
    green: "#1f7a5a",
    mint: "#72c39c",
    lime: "#d5e86b",
    amber: "#f2ad49",
    coral: "#df6d57",
    blue: "#4a86a8",
    grid: "rgba(23,49,43,.10)",
  };

  const officeColors = {
    ink: "17312B",
    green: "1F7A5A",
    mint: "72C39C",
    lime: "D5E86B",
    amber: "F2AD49",
    coral: "DF6D57",
    blue: "4A86A8",
    paper: "F7F8F4",
    pale: "EDF3EF",
    line: "D9E3DE",
    gray: "60766E",
    white: "FFFFFF",
  };

  function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(Number(value) || 0);
  }

  function formatEnergy(kwh, compact = true) {
    const value = Number(kwh) || 0;
    if (compact && Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)} GWh`;
    if (compact && Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, 1)} MWh`;
    return `${formatNumber(value, 0)} kWh`;
  }

  function formatPercent(value, digits = 1, signed = false) {
    const number = Number(value) || 0;
    return `${signed && number > 0 ? "+" : ""}${formatNumber(number * 100, digits)}%`;
  }

  function setText(selector, text) {
    const element = $(selector);
    if (element) element.textContent = text;
  }

  function toast(message, type = "info") {
    const element = $("#toast");
    element.textContent = message;
    element.className = `toast show ${type}`;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 3200);
  }

  function formNumber(id, divisor = 1) {
    return Number($(id).value) / divisor;
  }

  function safeFileName(name) {
    return String(name || "태양광_발전량분석").replace(/[\\/:*?"<>|]/g, "_").trim();
  }

  function getConfig() {
    return {
      siteName: $("#siteName").value.trim() || "태양광 발전소",
      region: $("#region").value,
      profileYear: $("#profileYear").value,
      latitude: formNumber("#latitude"),
      longitude: formNumber("#longitude"),
      timezone: formNumber("#timezone"),
      capacityKw: formNumber("#capacityKw"),
      tilt: formNumber("#tilt"),
      azimuth: formNumber("#azimuth"),
      albedo: formNumber("#albedo", 100),
      systemEfficiency: formNumber("#systemEfficiency", 100),
      initialDegradation: formNumber("#initialDegradation", 100),
      annualDegradation: formNumber("#annualDegradation", 100),
      projectionYears: formNumber("#projectionYears"),
      temperatureCoefficient: formNumber("#temperatureCoefficient", 100),
      noct: formNumber("#noct"),
      useTemperature: $("#useTemperature").checked,
    };
  }

  function setConfig(config) {
    const mappings = {
      siteName: "#siteName",
      region: "#region",
      profileYear: "#profileYear",
      latitude: "#latitude",
      longitude: "#longitude",
      timezone: "#timezone",
      capacityKw: "#capacityKw",
      tilt: "#tilt",
      azimuth: "#azimuth",
      projectionYears: "#projectionYears",
      noct: "#noct",
    };
    Object.entries(mappings).forEach(([key, selector]) => {
      if (config[key] !== undefined && $(selector)) $(selector).value = config[key];
    });
    if (config.albedo !== undefined) $("#albedo").value = config.albedo * 100;
    if (config.systemEfficiency !== undefined) $("#systemEfficiency").value = config.systemEfficiency * 100;
    if (config.initialDegradation !== undefined) $("#initialDegradation").value = config.initialDegradation * 100;
    if (config.annualDegradation !== undefined) $("#annualDegradation").value = config.annualDegradation * 100;
    if (config.temperatureCoefficient !== undefined) $("#temperatureCoefficient").value = config.temperatureCoefficient * 100;
    if (config.useTemperature !== undefined) $("#useTemperature").checked = Boolean(config.useTemperature);
    updateCompass();
  }

  function populateDatasetControls() {
    const regionSelect = $("#region");
    Object.keys(dataset.records).forEach((region) => {
      const option = document.createElement("option");
      option.value = region;
      option.textContent = region;
      regionSelect.appendChild(option);
    });
    const yearSelect = $("#profileYear");
    yearSelect.appendChild(new Option(`10년 평균 (${dataset.meta.period})`, "average"));
    [...dataset.years].reverse().forEach((year) => yearSelect.appendChild(new Option(`${year}년`, year)));
    regionSelect.value = "서울경기";
    yearSelect.value = "average";
    applyRegionDefaults();
    setText("#datasetMeta", `${dataset.meta.period} · ${formatNumber(dataset.meta.recordCount)}개 월자료`);
  }

  function applyRegionDefaults() {
    const defaults = dataset.regionDefaults[$("#region").value];
    if (!defaults) return;
    $("#latitude").value = defaults.latitude;
    $("#longitude").value = defaults.longitude;
    setText("#coordinateHint", `${defaults.label} 대표좌표 · 실제 설치지점 좌표로 수정 권장`);
  }

  function updateCompass() {
    const azimuth = Number($("#azimuth").value) || 0;
    const tilt = Number($("#tilt").value) || 0;
    $("#compassNeedle").style.transform = `translate(-50%, -88%) rotate(${azimuth}deg)`;
    setText("#azimuthReadout", `${formatNumber(azimuth)}°`);
    setText("#tiltReadout", `${formatNumber(tilt)}°`);
  }

  function dataMode() {
    return $("input[name=dataMode]:checked").value;
  }

  function updateModeUI() {
    const hourly = dataMode() === "hourly";
    $("#kmaControls").hidden = hourly;
    $("#hourlyControls").hidden = !hourly;
    $("#temperaturePanel").classList.toggle("disabled", !hourly);
    $("#useTemperature").disabled = !hourly;
    setText("#modeBadge", hourly ? "시간자료 정밀모드" : "KMA 월자료 표준모드");
  }

  function resultDays(result) {
    const days = result.metadata.equivalentDays || result.monthly.reduce((sum, row) => sum + (Number(row.days) || 0), 0);
    return days > 0 ? days : 365.25;
  }

  function selectedYearNumber() {
    const maximum = currentResult?.yearly?.length || 1;
    return Math.max(1, Math.min(maximum, Number($("#viewYear")?.value) || 1));
  }

  function selectedYearRows(result = currentResult, yearNumber = selectedYearNumber()) {
    if (!result) return { yearNumber: 1, annual: null, rows: [], days: 365.25, equivalentHoursDay: 0 };
    const annual = result.yearly[yearNumber - 1] || result.yearly[0];
    const days = resultDays(result);
    let cumulative = 0;
    const rows = result.monthly.map((row) => {
      const energyKwh = row.baseEnergyKwh * annual.factor;
      cumulative += energyKwh;
      return {
        ...row,
        energyKwh,
        share: annual.energyKwh > 0 ? energyKwh / annual.energyKwh : 0,
        equivalentHoursDay: result.config.capacityKw > 0 && row.days > 0
          ? energyKwh / result.config.capacityKw / row.days
          : 0,
        cumulativeKwh: cumulative,
      };
    });
    return {
      yearNumber,
      annual,
      rows,
      days,
      equivalentHoursDay: result.config.capacityKw > 0 ? annual.energyKwh / result.config.capacityKw / days : 0,
    };
  }

  function syncViewYearOptions(result) {
    const select = $("#viewYear");
    const previous = Math.max(1, Number(select.value) || 1);
    select.innerHTML = "";
    result.yearly.forEach((row) => select.appendChild(new Option(`${row.year}년차`, row.year)));
    select.value = String(Math.min(previous, result.yearly.length));
  }

  function calculate(showToast = true) {
    try {
      const config = getConfig();
      if (dataMode() === "hourly") {
        if (!importedHourly) throw new Error("먼저 KMA 또는 위성 시간자료를 가져오세요.");
        currentResult = engine.calculateFromHourly(config, importedHourly.rows, importedHourly.meta);
      } else {
        currentResult = engine.calculateFromKma(config, dataset);
      }
      renderResult(currentResult);
      if (showToast) toast("분석을 완료했습니다.", "success");
    } catch (error) {
      toast(error.message || "계산 중 오류가 발생했습니다.", "error");
    }
  }

  function renderResult(result) {
    const { summary, metadata, config } = result;
    const partial = metadata.mode === "hourly-import" && metadata.coverageRatio < 0.9;
    syncViewYearOptions(result);
    setText("#resultTitle", config.siteName);
    setText("#resultSubtitle", `${metadata.source} · ${metadata.period}`);
    setText("#qualityBadge", metadata.quality);
    setText("#annualPoaLabel", partial ? "분석기간 경사면 일사량" : "연간 경사면 일사량");
    setText("#lifetimeLabel", partial ? "부분자료 반복 가정 누적량" : "분석기간 누적발전량");
    setText("#annualPoa", `${formatNumber(summary.annualPoaKwhM2, 1)} kWh/m²`);
    setText("#lifetimeEnergy", formatEnergy(summary.cumulativeEnergyKwh));
    setText("#poaGain", formatPercent(summary.poaGain, 1, true));
    setText("#summaryFootnote", `${config.projectionYears}년 · 초기저하 ${(config.initialDegradation * 100).toFixed(1)}% · 연간저하 ${(config.annualDegradation * 100).toFixed(2)}%`);
    renderOverview(result);
    renderSelectedYear(result);
    renderDegradationChart(result);
    renderYearlyTable(result);
    renderHeatmap();
    updateInsight();
    $("#emptyState").hidden = true;
    $("#resultsContent").hidden = false;
    if (partial) toast("가져온 시간자료가 1년 미만이므로 연간·장기 결과로 사용하지 마세요.", "warning");
  }

  function renderOverview(result) {
    const { config, metadata } = result;
    setText("#analysisModeText", metadata.mode === "hourly-import" ? "시간자료 정밀모드" : "KMA 월자료 표준모드");
    const assumptions = [
      ["자료", `${metadata.source} · ${metadata.period}`],
      ["설치위치", `${config.region} · ${config.latitude.toFixed(4)}°, ${config.longitude.toFixed(4)}°`],
      ["설치용량", `${formatNumber(config.capacityKw, 1)} kW`],
      ["어레이", `경사 ${config.tilt}° · 방위각 ${config.azimuth}°`],
      ["지면반사율", `${formatNumber(config.albedo * 100, 1)}%`],
      ["시스템효율", `${formatNumber(config.systemEfficiency * 100, 1)}%`],
      ["모듈저하", `초기 ${formatNumber(config.initialDegradation * 100, 1)}% · 연간 ${formatNumber(config.annualDegradation * 100, 2)}%`],
      ["분석기간", `${config.projectionYears}년`],
    ];
    $("#assumptionGrid").innerHTML = assumptions.map(([label, value]) => `
      <div><span>${label}</span><strong>${value}</strong></div>`).join("");
  }

  function renderSelectedYear(result = currentResult) {
    if (!result) return;
    const selected = selectedYearRows(result);
    setText("#selectedYearEnergyLabel", `${selected.yearNumber}년차 예상발전량`);
    setText("#selectedYearEnergy", formatEnergy(selected.annual.energyKwh));
    setText("#selectedYearEnergyNote", `모듈 잔존율 ${formatPercent(selected.annual.factor, 1)}`);
    setText("#equivalentHours", `${formatNumber(selected.equivalentHoursDay, 2)} h/일`);
    setText("#equivalentHoursNote", `${selected.yearNumber}년차 · ${formatNumber(selected.days, 0)}일 기준`);
    setText("#monthlyTableTitle", `${selected.yearNumber}년차 월별 발전량`);
    renderMonthlyChart(selected);
    renderMonthlyTable(selected, result);
    updateInsight();
  }

  function destroyChart(key) {
    if (chartInstances[key]) chartInstances[key].destroy();
  }

  function commonChartOptions(yTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: { usePointStyle: true, boxWidth: 8, color: palette.ink, font: { family: "Pretendard, sans-serif" } },
        },
        tooltip: { padding: 12, backgroundColor: "rgba(18,43,37,.94)", titleFont: { weight: "600" } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#577068" } },
        y: {
          beginAtZero: true,
          grid: { color: palette.grid },
          ticks: { color: "#577068" },
          title: { display: true, text: yTitle, color: "#577068" },
        },
      },
    };
  }

  function renderMonthlyChart(selected) {
    destroyChart("monthlyEnergy");
    const options = commonChartOptions("월 발전량 (MWh)");
    options.scales.y1 = {
      position: "right",
      beginAtZero: true,
      suggestedMax: Math.max(5, ...selected.rows.map((row) => row.equivalentHoursDay)) * 1.15,
      grid: { display: false },
      ticks: { color: "#7d5a1b" },
      title: { display: true, text: "등가발전시간 (h/일)", color: "#7d5a1b" },
    };
    chartInstances.monthlyEnergy = new Chart($("#monthlyEnergyChart"), {
      data: {
        labels: selected.rows.map((row) => row.label),
        datasets: [
          {
            type: "bar",
            label: `${selected.yearNumber}년차 예상발전량`,
            data: selected.rows.map((row) => row.energyKwh / 1000),
            backgroundColor: "rgba(31,122,90,.78)",
            borderColor: palette.green,
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 42,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "월평균 등가발전시간",
            data: selected.rows.map((row) => row.equivalentHoursDay),
            borderColor: palette.amber,
            backgroundColor: palette.amber,
            pointBackgroundColor: "#fff",
            pointBorderColor: palette.amber,
            pointBorderWidth: 2,
            pointRadius: 3.5,
            borderWidth: 2.5,
            tension: 0.28,
            yAxisID: "y1",
          },
        ],
      },
      options,
    });
  }

  function renderDegradationChart(result) {
    destroyChart("degradation");
    const options = commonChartOptions("연간 발전량 (MWh)");
    options.scales.y1 = {
      position: "right",
      beginAtZero: true,
      grid: { display: false },
      ticks: { color: "#577068" },
      title: { display: true, text: "누적 발전량 (GWh)", color: "#577068" },
    };
    chartInstances.degradation = new Chart($("#degradationChart"), {
      data: {
        labels: result.yearly.map((row) => `${row.year}년차`),
        datasets: [
          {
            type: "line",
            label: "연간 발전량",
            data: result.yearly.map((row) => row.energyKwh / 1000),
            borderColor: palette.green,
            backgroundColor: palette.green,
            pointRadius: result.yearly.length > 30 ? 0 : 2,
            borderWidth: 2.3,
            tension: 0.18,
            yAxisID: "y",
          },
          {
            type: "bar",
            label: "누적 발전량",
            data: result.yearly.map((row) => row.cumulativeKwh / 1_000_000),
            backgroundColor: "rgba(213,232,107,.62)",
            borderRadius: 3,
            yAxisID: "y1",
          },
        ],
      },
      options,
    });
  }

  function renderMonthlyTable(selected, result) {
    const body = $("#monthlyTableBody");
    body.innerHTML = "";
    selected.rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <th scope="row">${row.label}</th>
        <td>${formatEnergy(row.energyKwh)}</td>
        <td>${formatPercent(row.share, 1)}</td>
        <td>${formatNumber(row.equivalentHoursDay, 2)}</td>
        <td>${formatEnergy(row.cumulativeKwh)}</td>`;
      body.appendChild(tr);
    });
    const total = document.createElement("tr");
    total.className = "total-row";
    total.innerHTML = `
      <th scope="row">합계·평균</th>
      <td>${formatEnergy(selected.annual.energyKwh)}</td>
      <td>100.0%</td>
      <td>${formatNumber(selected.equivalentHoursDay, 2)}</td>
      <td>${formatEnergy(selected.annual.energyKwh)}</td>`;
    body.appendChild(total);
  }

  function renderYearlyTable(result) {
    const body = $("#yearlyTableBody");
    body.innerHTML = "";
    const days = resultDays(result);
    result.yearly.forEach((row, index) => {
      const previous = result.yearly[index - 1];
      const yearOverYear = previous ? row.energyKwh / previous.energyKwh - 1 : null;
      const equivalent = result.config.capacityKw > 0 ? row.energyKwh / result.config.capacityKw / days : 0;
      const tr = document.createElement("tr");
      tr.classList.toggle("selected-year-row", row.year === selectedYearNumber());
      tr.innerHTML = `
        <th scope="row">${row.year}년차</th>
        <td>${formatPercent(row.factor, 2)}</td>
        <td>${formatEnergy(row.energyKwh)}</td>
        <td>${yearOverYear === null ? "기준" : formatPercent(yearOverYear, 2, true)}</td>
        <td>${formatNumber(equivalent, 2)}</td>
        <td>${formatEnergy(row.cumulativeKwh)}</td>`;
      body.appendChild(tr);
    });
    setText("#yearlyTableTag", `${result.config.projectionYears}년 분석`);
  }

  function renderHeatmap() {
    if (!currentResult) return;
    const baseConfig = getConfig();
    const tilts = [0, 15, 25, 35, 45];
    const azimuths = [90, 135, 180, 225, 270];
    const values = [];
    azimuths.forEach((azimuth) => {
      tilts.forEach((tilt) => {
        const config = { ...baseConfig, azimuth, tilt };
        const result = dataMode() === "hourly" && importedHourly
          ? engine.calculateFromHourly(config, importedHourly.rows, importedHourly.meta)
          : engine.calculateFromKma(config, dataset);
        values.push({ azimuth, tilt, energy: result.summary.firstYearEnergyKwh });
      });
    });
    const min = Math.min(...values.map((row) => row.energy));
    const max = Math.max(...values.map((row) => row.energy));
    const table = $("#heatmapTable");
    table.innerHTML = `<thead><tr><th>방위각＼경사</th>${tilts.map((tilt) => `<th>${tilt}°</th>`).join("")}</tr></thead>`;
    const body = document.createElement("tbody");
    const azimuthLabel = { 90: "동 90°", 135: "남동 135°", 180: "남 180°", 225: "남서 225°", 270: "서 270°" };
    azimuths.forEach((azimuth) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th>${azimuthLabel[azimuth]}</th>`;
      values.filter((row) => row.azimuth === azimuth).forEach((row) => {
        const ratio = max === min ? 1 : (row.energy - min) / (max - min);
        const td = document.createElement("td");
        td.style.setProperty("--heat", ratio.toFixed(3));
        td.innerHTML = `<strong>${formatNumber(row.energy / 1000, 1)}</strong><span>MWh</span>`;
        td.title = `${azimuthLabel[azimuth]}, 경사 ${row.tilt}°: ${formatEnergy(row.energy)}`;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    const best = values.reduce((winner, row) => (row.energy > winner.energy ? row : winner), values[0]);
    currentHeatmap = { tilts, azimuths, values, min, max, best, azimuthLabel };
    setText("#heatmapBest", `검토 범위 최댓값: 경사 ${best.tilt}° · 방위각 ${best.azimuth}° · ${formatEnergy(best.energy)}`);
  }

  function updateInsight() {
    if (!currentResult) return;
    const selected = selectedYearRows(currentResult);
    const best = currentHeatmap?.best;
    const comparison = best
      ? ` 비교 범위에서는 경사 ${best.tilt}°·방위각 ${best.azimuth}°가 1년차 발전량이 가장 높습니다.`
      : "";
    setText(
      "#resultInsight",
      `${selected.yearNumber}년차 예상발전량은 ${formatEnergy(selected.annual.energyKwh)}이며, 연평균 등가발전시간은 ${formatNumber(selected.equivalentHoursDay, 2)} h/일입니다.${comparison}`,
    );
  }

  async function handleImport(file) {
    if (!file) return;
    try {
      $("#importStatus").className = "import-status loading";
      $("#importStatus").innerHTML = `<strong>자료를 읽는 중…</strong><span>${file.name}</span>`;
      importedHourly = await importer.importHourlyFile(file, $("#importUnit").value);
      const meta = importedHourly.meta;
      $("#importStatus").className = "import-status success";
      $("#importStatus").innerHTML = `
        <strong>${formatNumber(importedHourly.rows.length)}행 가져옴</strong>
        <span>${meta.period} · ${meta.unit.toUpperCase()} · ${formatNumber(meta.typicalInterval, 2)}시간 간격</span>
        <small>${Object.entries(meta.mapping).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" · ")}</small>`;
      $("#useTemperature").checked = Boolean(meta.mapping.temperature);
      if (meta.warnings.length) toast(meta.warnings.join(" "), "warning");
      else toast("시간별 자료를 정상적으로 가져왔습니다.", "success");
      calculate(false);
    } catch (error) {
      importedHourly = null;
      $("#importStatus").className = "import-status error";
      $("#importStatus").innerHTML = `<strong>가져오기 실패</strong><span>${error.message}</span>`;
      toast(error.message, "error");
    }
  }

  function chartImage(key) {
    const chart = chartInstances[key];
    if (!chart) return null;
    try {
      if (typeof chart.toBase64Image === "function") return chart.toBase64Image("image/png", 1);
      const canvas = chart.canvas || chart.ctx?.canvas;
      return canvas && typeof canvas.toDataURL === "function" ? canvas.toDataURL("image/png", 1) : null;
    } catch (_) {
      return null;
    }
  }

  function argb(hex) {
    return `FF${hex}`;
  }

  function excelFill(hex) {
    return { type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } };
  }

  function excelBorder(color = officeColors.line) {
    const edge = { style: "thin", color: { argb: argb(color) } };
    return { top: edge, left: edge, bottom: edge, right: edge };
  }

  function prepareWorksheet(ws, widths, endColumn) {
    ws.views = [{ state: "frozen", ySplit: 6, showGridLines: false }];
    ws.properties.defaultRowHeight = 20;
    widths.forEach((width, index) => { ws.getColumn(index + 1).width = width; });
    ws.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    };
    ws.headerFooter.oddFooter = "&L태양광 일사량·발전량 분석&C&P / &N&R&F";
    ws.mergeCells(1, 1, 2, endColumn);
    const title = ws.getCell(1, 1);
    title.fill = excelFill(officeColors.ink);
    title.font = { name: "맑은 고딕", size: 21, bold: true, color: { argb: argb(officeColors.white) } };
    title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 28;
  }

  function styleExcelHeader(row) {
    row.height = 27;
    row.eachCell((cell) => {
      cell.fill = excelFill(officeColors.ink);
      cell.font = { name: "맑은 고딕", size: 10, bold: true, color: { argb: argb(officeColors.white) } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = excelBorder(officeColors.ink);
    });
  }

  function styleExcelData(row, even = false) {
    row.eachCell((cell) => {
      cell.font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.ink) } };
      cell.fill = excelFill(even ? "F4F7F4" : officeColors.white);
      cell.border = excelBorder();
      cell.alignment = { vertical: "middle", horizontal: "right" };
    });
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  }

  function addExcelImage(workbook, worksheet, dataUrl, range) {
    if (!dataUrl) return;
    const id = workbook.addImage({ base64: dataUrl, extension: "png" });
    worksheet.addImage(id, range);
  }

  async function buildExcelWorkbook(result = currentResult) {
    if (!result || !window.ExcelJS) throw new Error("Excel 보고서를 만들 수 없습니다.");
    const selected = selectedYearRows(result);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Solar Design Lab";
    workbook.lastModifiedBy = "Solar Design Lab";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = "경사면 일사량 및 태양광 예상발전량 분석";
    workbook.title = `${result.config.siteName} 발전량 분석`;
    workbook.company = "Solar Design Lab";
    workbook.calcProperties.fullCalcOnLoad = true;

    const summary = workbook.addWorksheet("분석요약", { properties: { tabColor: { argb: argb(officeColors.green) } } });
    prepareWorksheet(summary, [16, 18, 16, 18, 16, 18, 16, 18], 8);
    summary.getCell("A1").value = "태양광 일사량·예상발전량 분석 보고서";
    summary.mergeCells("A3:H3");
    summary.getCell("A3").value = `${result.config.siteName}  |  ${result.metadata.source}  |  ${result.metadata.period}`;
    summary.getCell("A3").font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.gray) } };
    summary.getCell("A3").alignment = { horizontal: "left", indent: 1 };

    const kpis = [
      ["경사면 일사량", `${formatNumber(result.summary.annualPoaKwhM2, 1)} kWh/m²`, officeColors.green],
      [`${selected.yearNumber}년차 발전량`, formatEnergy(selected.annual.energyKwh), officeColors.amber],
      ["등가발전시간", `${formatNumber(selected.equivalentHoursDay, 2)} h/일`, officeColors.lime],
      [`${result.config.projectionYears}년 누적`, formatEnergy(result.summary.cumulativeEnergyKwh), officeColors.blue],
    ];
    kpis.forEach(([label, value, color], index) => {
      const start = index * 2 + 1;
      summary.mergeCells(5, start, 5, start + 1);
      summary.mergeCells(6, start, 7, start + 1);
      const labelCell = summary.getCell(5, start);
      const valueCell = summary.getCell(6, start);
      labelCell.value = label;
      valueCell.value = value;
      labelCell.fill = excelFill(color);
      labelCell.font = { name: "맑은 고딕", size: 9, bold: true, color: { argb: argb(color === officeColors.lime ? officeColors.ink : officeColors.white) } };
      labelCell.alignment = { horizontal: "center", vertical: "middle" };
      valueCell.fill = excelFill(officeColors.paper);
      valueCell.font = { name: "맑은 고딕", size: 16, bold: true, color: { argb: argb(officeColors.ink) } };
      valueCell.alignment = { horizontal: "center", vertical: "middle" };
      [labelCell, valueCell].forEach((cell) => { cell.border = excelBorder(); });
    });
    summary.getRow(5).height = 24;
    summary.getRow(6).height = 27;
    summary.getRow(7).height = 27;

    summary.mergeCells("A9:H9");
    summary.getCell("A9").value = "분석 조건";
    summary.getCell("A9").fill = excelFill(officeColors.pale);
    summary.getCell("A9").font = { name: "맑은 고딕", size: 12, bold: true, color: { argb: argb(officeColors.ink) } };
    summary.getCell("A9").alignment = { indent: 1, vertical: "middle" };
    const assumptions = [
      ["프로젝트", result.config.siteName, "분석등급", result.metadata.quality],
      ["지역·좌표", `${result.config.region} / ${result.config.latitude.toFixed(4)}, ${result.config.longitude.toFixed(4)}`, "설치용량", result.config.capacityKw],
      ["경사·방위각", `${result.config.tilt}° / ${result.config.azimuth}°`, "지면반사율", result.config.albedo],
      ["시스템효율", result.config.systemEfficiency, "분석기간", result.config.projectionYears],
      ["초기 모듈저하", result.config.initialDegradation, "연간 모듈저하", result.config.annualDegradation],
      ["자료", result.metadata.source, "자료기간", result.metadata.period],
    ];
    assumptions.forEach((values, index) => {
      const row = summary.getRow(10 + index);
      row.values = [values[0], values[1], "", "", values[2], values[3], "", ""];
      summary.mergeCells(10 + index, 2, 10 + index, 4);
      summary.mergeCells(10 + index, 6, 10 + index, 8);
      row.eachCell((cell) => {
        cell.border = excelBorder();
        cell.font = { name: "맑은 고딕", size: 9, color: { argb: argb(officeColors.ink) } };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      [1, 5].forEach((column) => {
        row.getCell(column).fill = excelFill(officeColors.pale);
        row.getCell(column).font = { name: "맑은 고딕", size: 9, bold: true, color: { argb: argb(officeColors.green) } };
      });
      if (index === 1) row.getCell(6).numFmt = "#,##0.0\" kW\"";
      if (index === 2) row.getCell(6).numFmt = "0.0%";
      if (index === 3) {
        row.getCell(2).numFmt = "0.0%";
        row.getCell(6).numFmt = "0\"년\"";
      }
      if (index === 4) {
        row.getCell(2).numFmt = "0.00%";
        row.getCell(6).numFmt = "0.00%";
      }
    });
    summary.mergeCells("A17:H18");
    summary.getCell("A17").value = `해석: ${$("#resultInsight")?.textContent || "선택한 조건의 발전 프로파일입니다."}`;
    summary.getCell("A17").fill = excelFill("F6F8E8");
    summary.getCell("A17").font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.ink) } };
    summary.getCell("A17").alignment = { wrapText: true, vertical: "middle", indent: 1 };
    summary.getCell("A17").border = excelBorder(officeColors.lime);
    addExcelImage(workbook, summary, chartImage("monthlyEnergy"), { tl: { col: 0, row: 20 }, ext: { width: 790, height: 310 } });
    addExcelImage(workbook, summary, chartImage("degradation"), { tl: { col: 0, row: 38 }, ext: { width: 790, height: 310 } });
    summary.mergeCells("A55:H56");
    summary.getCell("A55").value = "주의: 지역 월자료 결과는 초기 사업성 및 설계 비교용입니다. 실시설계에는 실제 좌표의 시간자료, 현장 음영, 모듈·인버터 상세조건을 반영해 재검토하세요.";
    summary.getCell("A55").font = { name: "맑은 고딕", size: 9, italic: true, color: { argb: argb(officeColors.gray) } };
    summary.getCell("A55").alignment = { wrapText: true, vertical: "middle" };
    summary.pageSetup.printArea = "A1:H56";
    summary.pageSetup.fitToHeight = 2;

    const monthly = workbook.addWorksheet("월별발전량", { properties: { tabColor: { argb: argb(officeColors.amber) } } });
    prepareWorksheet(monthly, [12, 18, 14, 18, 18, 10, 3, 14, 14, 14, 14, 14, 14, 14], 14);
    monthly.getCell("A1").value = `${selected.yearNumber}년차 월별 예상발전량`;
    monthly.mergeCells("A3:N3");
    monthly.getCell("A3").value = `${result.config.siteName} · 설치용량 ${formatNumber(result.config.capacityKw, 1)} kW · 모듈 잔존율 ${formatPercent(selected.annual.factor, 2)}`;
    monthly.getCell("A3").font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.gray) } };
    monthly.getCell("A4").value = "설치용량(kW)";
    monthly.getCell("B4").value = result.config.capacityKw;
    monthly.getCell("C4").value = "조회년차";
    monthly.getCell("D4").value = selected.yearNumber;
    monthly.getCell("E4").value = "기준일수";
    monthly.getCell("F4").value = selected.days;
    ["A4", "C4", "E4"].forEach((address) => {
      monthly.getCell(address).fill = excelFill(officeColors.pale);
      monthly.getCell(address).font = { name: "맑은 고딕", size: 9, bold: true, color: { argb: argb(officeColors.green) } };
    });
    monthly.getRow(6).values = ["월", "예상발전량(kWh)", "연간 비중", "등가발전시간(h/일)", "누적발전량(kWh)", "일수"];
    styleExcelHeader(monthly.getRow(6));
    selected.rows.forEach((row, index) => {
      const rowNumber = 7 + index;
      const excelRow = monthly.getRow(rowNumber);
      excelRow.values = [row.label, row.energyKwh, null, null, null, row.days];
      excelRow.getCell(3).value = { formula: `B${rowNumber}/$B$19`, result: row.share };
      excelRow.getCell(4).value = { formula: `B${rowNumber}/$B$4/F${rowNumber}`, result: row.equivalentHoursDay };
      excelRow.getCell(5).value = { formula: `SUM($B$7:B${rowNumber})`, result: row.cumulativeKwh };
      styleExcelData(excelRow, index % 2 === 1);
      excelRow.getCell(2).numFmt = "#,##0";
      excelRow.getCell(3).numFmt = "0.0%";
      excelRow.getCell(4).numFmt = "0.00";
      excelRow.getCell(5).numFmt = "#,##0";
      excelRow.getCell(6).numFmt = "0.0";
    });
    const monthlyTotal = monthly.getRow(19);
    monthlyTotal.values = ["합계·평균", null, null, null, null, null];
    monthlyTotal.getCell(2).value = { formula: "SUM(B7:B18)", result: selected.annual.energyKwh };
    monthlyTotal.getCell(3).value = { formula: "SUM(C7:C18)", result: 1 };
    monthlyTotal.getCell(4).value = { formula: "B19/$B$4/SUM(F7:F18)", result: selected.equivalentHoursDay };
    monthlyTotal.getCell(5).value = { formula: "SUM(B7:B18)", result: selected.annual.energyKwh };
    styleExcelData(monthlyTotal);
    monthlyTotal.eachCell((cell) => { cell.fill = excelFill(officeColors.pale); cell.font = { name: "맑은 고딕", size: 10, bold: true, color: { argb: argb(officeColors.ink) } }; });
    monthlyTotal.getCell(2).numFmt = "#,##0";
    monthlyTotal.getCell(3).numFmt = "0.0%";
    monthlyTotal.getCell(4).numFmt = "0.00";
    monthlyTotal.getCell(5).numFmt = "#,##0";
    monthly.getColumn(6).hidden = true;
    addExcelImage(workbook, monthly, chartImage("monthlyEnergy"), { tl: { col: 7, row: 5 }, ext: { width: 640, height: 355 } });
    monthly.mergeCells("A22:F24");
    monthly.getCell("A22").value = "등가발전시간(h/일)은 월 발전량을 설치용량과 해당 월의 일수로 나눈 값입니다. 표의 수식은 원자료 셀과 연결되어 있어 계산 근거를 확인할 수 있습니다.";
    monthly.getCell("A22").alignment = { wrapText: true, vertical: "middle" };
    monthly.getCell("A22").font = { name: "맑은 고딕", size: 9, color: { argb: argb(officeColors.gray) } };
    monthly.getCell("A22").fill = excelFill(officeColors.paper);
    monthly.pageSetup.printArea = "A1:N25";
    monthly.pageSetup.fitToHeight = 1;

    const matrix = workbook.addWorksheet("경사방위비교", { properties: { tabColor: { argb: argb(officeColors.lime) } } });
    prepareWorksheet(matrix, [18, 16, 16, 16, 16, 16, 3, 20], 8);
    matrix.getCell("A1").value = "경사각·방위각별 1년차 발전량 비교";
    matrix.mergeCells("A3:H3");
    matrix.getCell("A3").value = currentHeatmap
      ? `검토 범위 최댓값: 경사 ${currentHeatmap.best.tilt}° · 방위각 ${currentHeatmap.best.azimuth}° · ${formatEnergy(currentHeatmap.best.energy)}`
      : "분석 화면의 5×5 비교 결과";
    matrix.getCell("A3").font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.gray) } };
    const heatmap = currentHeatmap || { tilts: [], azimuths: [], values: [], azimuthLabel: {} };
    matrix.getRow(6).values = ["방위각＼경사", ...heatmap.tilts.map((tilt) => `${tilt}°`)];
    styleExcelHeader(matrix.getRow(6));
    heatmap.azimuths.forEach((azimuth, index) => {
      const row = matrix.getRow(7 + index);
      row.values = [heatmap.azimuthLabel[azimuth], ...heatmap.values.filter((value) => value.azimuth === azimuth).map((value) => value.energy)];
      styleExcelData(row, index % 2 === 1);
      for (let column = 2; column <= 6; column += 1) {
        row.getCell(column).numFmt = "#,##0\" kWh\"";
        row.getCell(column).alignment = { horizontal: "center", vertical: "middle" };
      }
    });
    if (heatmap.values.length) {
      matrix.addConditionalFormatting({
        ref: "B7:F11",
        rules: [{
          type: "colorScale",
          cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
          color: [{ argb: "FFF5F3E9" }, { argb: "FFE6EBA9" }, { argb: argb(officeColors.lime) }],
        }],
      });
    }
    matrix.mergeCells("A14:H16");
    matrix.getCell("A14").value = "비교표는 경사각 0·15·25·35·45°와 방위각 동·남동·남·남서·서를 동일한 시스템 조건으로 재계산한 결과입니다. 실제 최적점은 행간·음영·구조·지형 제약을 함께 검토해야 합니다.";
    matrix.getCell("A14").alignment = { wrapText: true, vertical: "middle" };
    matrix.getCell("A14").font = { name: "맑은 고딕", size: 9, color: { argb: argb(officeColors.gray) } };
    matrix.pageSetup.printArea = "A1:H17";
    matrix.pageSetup.fitToHeight = 1;

    const yearly = workbook.addWorksheet("년차별발전량", { properties: { tabColor: { argb: argb(officeColors.blue) } } });
    prepareWorksheet(yearly, [10, 15, 20, 14, 18, 22, 3, 14, 14, 14, 14, 14, 14, 14, 14], 15);
    yearly.getCell("A1").value = `${result.config.projectionYears}년 년차별 예상발전량`;
    yearly.mergeCells("A3:O3");
    yearly.getCell("A3").value = `초기저하 ${formatPercent(result.config.initialDegradation, 2)} · 연간저하 ${formatPercent(result.config.annualDegradation, 2)} · 조회년차 ${selected.yearNumber}년차`;
    yearly.getCell("A3").font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.gray) } };
    yearly.getRow(6).values = ["년차", "모듈 잔존율", "연간 예상발전량(kWh)", "전년 대비", "등가발전시간(h/일)", "누적발전량(kWh)"];
    styleExcelHeader(yearly.getRow(6));
    result.yearly.forEach((row, index) => {
      const rowNumber = 7 + index;
      const previous = result.yearly[index - 1];
      const yoy = previous ? row.energyKwh / previous.energyKwh - 1 : null;
      const equivalent = result.config.capacityKw > 0 ? row.energyKwh / result.config.capacityKw / selected.days : 0;
      const excelRow = yearly.getRow(rowNumber);
      excelRow.values = [row.year, row.factor, row.energyKwh, yoy === null ? "기준" : yoy, equivalent, row.cumulativeKwh];
      styleExcelData(excelRow, index % 2 === 1);
      excelRow.getCell(1).numFmt = "0\"년차\"";
      excelRow.getCell(2).numFmt = "0.00%";
      excelRow.getCell(3).numFmt = "#,##0";
      if (yoy !== null) excelRow.getCell(4).numFmt = "0.00%;[Red]-0.00%";
      excelRow.getCell(5).numFmt = "0.00";
      excelRow.getCell(6).numFmt = "#,##0";
      if (row.year === selected.yearNumber) {
        excelRow.eachCell((cell) => { cell.fill = excelFill("F6F8E8"); cell.font = { ...cell.font, bold: true }; });
      }
    });
    addExcelImage(workbook, yearly, chartImage("degradation"), { tl: { col: 7, row: 5 }, ext: { width: 650, height: 355 } });
    yearly.pageSetup.printArea = `A1:O${Math.max(34, result.yearly.length + 8)}`;
    yearly.pageSetup.fitToHeight = 1;

    const method = workbook.addWorksheet("계산방법", { properties: { tabColor: { argb: argb(officeColors.gray) } } });
    prepareWorksheet(method, [22, 28, 28, 28, 28, 28], 6);
    method.getCell("A1").value = "계산 방법·해석·주의사항";
    method.getRow(5).values = ["구분", "내용"];
    method.mergeCells("B5:F5");
    styleExcelHeader(method.getRow(5));
    const methods = [
      ["수평면 → 경사면", "월자료는 Erbs 상관식으로 직달·산란 성분을 분리하고 Hay-Davies 모델로 경사면 일사량을 계산합니다. 시간자료는 각 시각의 태양 고도·방위와 입사각을 적용합니다."],
      ["발전량", "경사면 일사량 × 설치용량 × 시스템효율 × 온도보정 × 모듈잔존율로 계산합니다. 시스템효율에는 인버터·배선·오염·음영·불일치·가동률 손실을 종합해 입력합니다."],
      ["등가발전시간", "조회년차 예상발전량을 설치용량과 해당 분석기간의 일수로 나눈 h/일 값입니다. 정격용량으로 매일 몇 시간 발전한 것과 같은 에너지인지 보여줍니다."],
      ["정확도와 활용범위", "지역 월자료는 초기 사업성·설계 비교용입니다. 실시설계에는 실제 좌표의 시간자료, 현장 음영, 모듈·인버터 상세정보, 계통제약을 반영해야 합니다."],
      ["자료 보안", "계산과 보고서 생성은 브라우저에서 수행됩니다. 비밀번호 잠금은 사용자 인터페이스 수준의 오작동 방지 기능이며 암호화 저장 기능은 아닙니다."],
    ];
    methods.forEach(([label, text], index) => {
      const rowNumber = 6 + index * 3;
      method.mergeCells(rowNumber, 1, rowNumber + 2, 1);
      method.mergeCells(rowNumber, 2, rowNumber + 2, 6);
      method.getCell(rowNumber, 1).value = label;
      method.getCell(rowNumber, 2).value = text;
      method.getCell(rowNumber, 1).fill = excelFill(index % 2 ? officeColors.pale : "F6F8E8");
      method.getCell(rowNumber, 1).font = { name: "맑은 고딕", size: 10, bold: true, color: { argb: argb(officeColors.green) } };
      method.getCell(rowNumber, 1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      method.getCell(rowNumber, 2).font = { name: "맑은 고딕", size: 10, color: { argb: argb(officeColors.ink) } };
      method.getCell(rowNumber, 2).alignment = { vertical: "middle", wrapText: true, indent: 1 };
      method.getCell(rowNumber, 1).border = excelBorder();
      method.getCell(rowNumber, 2).border = excelBorder();
    });
    method.pageSetup.printArea = "A1:F22";
    method.pageSetup.fitToHeight = 1;

    return workbook;
  }

  async function exportWorkbook() {
    if (!currentResult) return toast("먼저 분석을 실행하세요.", "warning");
    if (!window.ExcelJS) return toast("Excel 출력 모듈을 불러오지 못했습니다.", "error");
    const button = $("#exportExcel");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Excel 생성 중…";
    try {
      const workbook = await buildExcelWorkbook(currentResult);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      downloadBlob(blob, `${safeFileName(currentResult.config.siteName)}_발전량분석_${selectedYearNumber()}년차.xlsx`);
      toast("디자인과 그래프를 포함한 Excel 보고서를 만들었습니다.", "success");
    } catch (error) {
      toast(`Excel 생성 실패: ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function downloadBlob(blob, fileName) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function pptCell(text, options = {}) {
    return { text: String(text), options };
  }

  function heatColor(ratio) {
    const start = [245, 243, 233];
    const end = [213, 232, 107];
    return start.map((value, index) => Math.round(value + (end[index] - value) * ratio).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function addSlideFrame(pptx, slide, title, kicker, page) {
    slide.background = { color: officeColors.paper };
    slide.addShape(pptx.ShapeType.line, { x: 0.72, y: 0.62, w: 0.42, h: 0, line: { color: officeColors.lime, width: 4 } });
    slide.addText(kicker, { x: 1.26, y: 0.43, w: 3.2, h: 0.25, fontFace: "Aptos", fontSize: 9, bold: true, color: officeColors.green, charSpacing: 1.4, margin: 0 });
    slide.addText(title, { x: 0.72, y: 0.72, w: 11.8, h: 0.62, fontFace: "Malgun Gothic", fontSize: 35, bold: true, color: officeColors.ink, margin: 0, breakLine: false, fit: "shrink" });
    slide.addShape(pptx.ShapeType.line, { x: 0.72, y: 7.1, w: 11.88, h: 0, line: { color: officeColors.line, width: 0.8 } });
    slide.addText("SOLAR DESIGN LAB", { x: 0.72, y: 7.18, w: 2.2, h: 0.18, fontFace: "Aptos", fontSize: 8, color: officeColors.gray, margin: 0 });
    slide.addText(String(page), { x: 12.15, y: 7.16, w: 0.45, h: 0.18, fontFace: "Aptos", fontSize: 8, color: officeColors.gray, align: "right", margin: 0 });
  }

  function addPptImageOrMessage(slide, dataUrl, position, message) {
    if (dataUrl) slide.addImage({ data: dataUrl, ...position });
    else {
      slide.addShape("rect", { ...position, fill: { color: officeColors.pale }, line: { color: officeColors.line, width: 1 } });
      slide.addText(message, { ...position, fontFace: "Malgun Gothic", fontSize: 16, color: officeColors.gray, align: "center", valign: "mid", margin: 0.15 });
    }
  }

  function buildPowerPoint(result = currentResult) {
    if (!result || !window.PptxGenJS) throw new Error("PPT 보고서를 만들 수 없습니다.");
    const selected = selectedYearRows(result);
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Solar Design Lab";
    pptx.company = "Solar Design Lab";
    pptx.subject = "경사면 일사량 및 태양광 예상발전량 분석";
    pptx.title = `${result.config.siteName} 발전량 분석`;
    pptx.lang = "ko-KR";
    pptx.theme = {
      headFontFace: "Malgun Gothic",
      bodyFontFace: "Malgun Gothic",
      lang: "ko-KR",
    };
    let page = 1;

    let slide = pptx.addSlide();
    slide.background = { color: officeColors.ink };
    slide.addShape(pptx.ShapeType.arc, { x: 9.4, y: -0.6, w: 4.7, h: 4.7, adjustPoint: 0.2, rotate: 10, line: { color: officeColors.lime, transparency: 10, width: 2 }, fill: { color: officeColors.ink, transparency: 100 } });
    slide.addShape(pptx.ShapeType.ellipse, { x: 10.55, y: 0.55, w: 1.35, h: 1.35, line: { color: officeColors.lime, transparency: 100 }, fill: { color: officeColors.lime } });
    slide.addText("SOLAR DESIGN LAB", { x: 0.82, y: 0.66, w: 3.4, h: 0.3, fontFace: "Aptos", fontSize: 12, bold: true, color: officeColors.lime, charSpacing: 2, margin: 0 });
    slide.addText("태양광 일사량·\n예상발전량 분석", { x: 0.82, y: 1.42, w: 8.7, h: 1.9, fontFace: "Malgun Gothic", fontSize: 50, bold: true, color: officeColors.white, margin: 0, breakLine: false, fit: "shrink" });
    slide.addText(result.config.siteName, { x: 0.86, y: 3.55, w: 8.5, h: 0.55, fontFace: "Malgun Gothic", fontSize: 23, color: officeColors.lime, bold: true, margin: 0 });
    slide.addText(`${result.metadata.source}\n${result.metadata.period} · ${result.metadata.quality}`, { x: 0.86, y: 4.38, w: 7.8, h: 0.82, fontFace: "Malgun Gothic", fontSize: 16, color: "D7E1DD", breakLine: false, margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 0.86, y: 6.32, w: 11.6, h: 0, line: { color: "54736A", width: 1 } });
    slide.addText(`조회년차 ${selected.yearNumber}년차  |  생성 ${new Date().toLocaleDateString("ko-KR")}`, { x: 0.86, y: 6.52, w: 8.5, h: 0.25, fontFace: "Malgun Gothic", fontSize: 11, color: "A9BBB5", margin: 0 });

    slide = pptx.addSlide(); page += 1;
    addSlideFrame(pptx, slide, `${selected.yearNumber}년차 발전량과 장기 누적량을 한눈에 확인`, "EXECUTIVE SUMMARY", page);
    const summaryMetrics = [
      ["경사면 일사량", `${formatNumber(result.summary.annualPoaKwhM2, 1)} kWh/m²`, `수평면 대비 ${formatPercent(result.summary.poaGain, 1, true)}`],
      [`${selected.yearNumber}년차 예상발전량`, formatEnergy(selected.annual.energyKwh), `모듈 잔존율 ${formatPercent(selected.annual.factor, 1)}`],
      ["예상 등가발전시간", `${formatNumber(selected.equivalentHoursDay, 2)} h/일`, `${formatNumber(selected.days, 0)}일 기준`],
      [`${result.config.projectionYears}년 누적발전량`, formatEnergy(result.summary.cumulativeEnergyKwh), `연간저하 ${formatPercent(result.config.annualDegradation, 2)}`],
    ];
    summaryMetrics.forEach(([label, value, note], index) => {
      const x = 0.78 + index * 3.08;
      if (index > 0) slide.addShape(pptx.ShapeType.line, { x: x - 0.22, y: 1.65, w: 0, h: 1.55, line: { color: officeColors.line, width: 1 } });
      slide.addText(label, { x, y: 1.62, w: 2.75, h: 0.35, fontFace: "Malgun Gothic", fontSize: 14, bold: true, color: officeColors.green, margin: 0 });
      slide.addText(value, { x, y: 2.1, w: 2.75, h: 0.52, fontFace: "Malgun Gothic", fontSize: 23, bold: true, color: officeColors.ink, margin: 0, fit: "shrink" });
      slide.addText(note, { x, y: 2.82, w: 2.75, h: 0.28, fontFace: "Malgun Gothic", fontSize: 11, color: officeColors.gray, margin: 0 });
    });
    slide.addShape(pptx.ShapeType.line, { x: 0.78, y: 3.55, w: 11.8, h: 0, line: { color: officeColors.green, width: 1.2 } });
    const assumptionRows = [
      ["자료", `${result.metadata.source} · ${result.metadata.period}`],
      ["지역·좌표", `${result.config.region} · ${result.config.latitude.toFixed(4)}°, ${result.config.longitude.toFixed(4)}°`],
      ["설치용량", `${formatNumber(result.config.capacityKw, 1)} kW`],
      ["어레이", `경사 ${result.config.tilt}° · 방위각 ${result.config.azimuth}°`],
      ["지면반사율", formatPercent(result.config.albedo, 1)],
      ["시스템효율", formatPercent(result.config.systemEfficiency, 1)],
      ["모듈저하", `초기 ${formatPercent(result.config.initialDegradation, 1)} · 연간 ${formatPercent(result.config.annualDegradation, 2)}`],
      ["분석기간", `${result.config.projectionYears}년`],
    ];
    assumptionRows.forEach(([label, value], index) => {
      const column = index < 4 ? 0 : 1;
      const row = index % 4;
      const x = column === 0 ? 0.82 : 6.8;
      const y = 3.92 + row * 0.57;
      slide.addText(label, { x, y, w: 1.25, h: 0.25, fontFace: "Malgun Gothic", fontSize: 12, bold: true, color: officeColors.green, margin: 0 });
      slide.addText(value, { x: x + 1.38, y, w: 4.48, h: 0.25, fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.ink, margin: 0, fit: "shrink" });
    });
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.82, y: 6.23, w: 11.7, h: 0.58, rectRadius: 0.05, fill: { color: "F4F7DD" }, line: { color: officeColors.lime, width: 0.8 } });
    slide.addText($("#resultInsight")?.textContent || "선택한 조건의 발전 프로파일입니다.", { x: 1.08, y: 6.38, w: 11.2, h: 0.25, fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.ink, margin: 0, fit: "shrink" });

    slide = pptx.addSlide(); page += 1;
    addSlideFrame(pptx, slide, `${selected.yearNumber}년차 발전량은 계절별 일사량 변화를 따라 움직입니다`, "MONTHLY PROFILE", page);
    addPptImageOrMessage(slide, chartImage("monthlyEnergy"), { x: 0.72, y: 1.48, w: 8.55, h: 4.95 }, "월별 발전량 그래프를 표시할 수 없습니다.");
    const peak = selected.rows.reduce((winner, row) => row.energyKwh > winner.energyKwh ? row : winner, selected.rows[0]);
    const low = selected.rows.reduce((winner, row) => row.energyKwh < winner.energyKwh ? row : winner, selected.rows[0]);
    slide.addText("프로파일 해석", { x: 9.62, y: 1.58, w: 2.75, h: 0.35, fontFace: "Malgun Gothic", fontSize: 18, bold: true, color: officeColors.green, margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 9.62, y: 2.08, w: 2.7, h: 0, line: { color: officeColors.lime, width: 2 } });
    const profileNotes = [
      ["연간 발전량", formatEnergy(selected.annual.energyKwh)],
      ["최대 월", `${peak.label} · ${formatEnergy(peak.energyKwh)}`],
      ["최소 월", `${low.label} · ${formatEnergy(low.energyKwh)}`],
      ["연평균 등가시간", `${formatNumber(selected.equivalentHoursDay, 2)} h/일`],
    ];
    profileNotes.forEach(([label, value], index) => {
      const y = 2.42 + index * 0.86;
      slide.addText(label, { x: 9.62, y, w: 2.7, h: 0.24, fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.gray, margin: 0 });
      slide.addText(value, { x: 9.62, y: y + 0.3, w: 2.7, h: 0.34, fontFace: "Malgun Gothic", fontSize: 18, bold: true, color: officeColors.ink, margin: 0, fit: "shrink" });
    });

    slide = pptx.addSlide(); page += 1;
    addSlideFrame(pptx, slide, `${selected.yearNumber}년차 월별 발전량과 등가발전시간`, "MONTHLY DATA", page);
    const monthlyTableRows = [
      ["월", "예상발전량", "연간 비중", "등가시간", "누적발전량"].map((text) => pptCell(text, { bold: true, color: officeColors.white, fill: officeColors.ink, align: "center" })),
      ...selected.rows.map((row) => [row.label, formatEnergy(row.energyKwh), formatPercent(row.share, 1), `${formatNumber(row.equivalentHoursDay, 2)} h/일`, formatEnergy(row.cumulativeKwh)]),
      ["합계·평균", formatEnergy(selected.annual.energyKwh), "100.0%", `${formatNumber(selected.equivalentHoursDay, 2)} h/일`, formatEnergy(selected.annual.energyKwh)].map((text) => pptCell(text, { bold: true, fill: officeColors.pale })),
    ];
    slide.addTable(monthlyTableRows, {
      x: 0.78, y: 1.5, w: 11.78, h: 5.28,
      colW: [1.45, 2.55, 1.8, 2.1, 2.65],
      fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.ink,
      border: { type: "solid", color: officeColors.line, pt: 0.7 },
      fill: officeColors.white, margin: 0.08, valign: "mid",
      rowH: 0.37, autoFit: false,
    });

    slide = pptx.addSlide(); page += 1;
    addSlideFrame(pptx, slide, "경사각과 방위각 조합에 따라 1년차 발전량이 달라집니다", "DESIGN MATRIX", page);
    const heatmap = currentHeatmap;
    if (heatmap) {
      const heatRows = [
        ["방위각＼경사", ...heatmap.tilts.map((tilt) => `${tilt}°`)].map((text) => pptCell(text, { bold: true, color: officeColors.white, fill: officeColors.ink, align: "center" })),
        ...heatmap.azimuths.map((azimuth) => [
          pptCell(heatmap.azimuthLabel[azimuth], { bold: true, fill: officeColors.pale }),
          ...heatmap.values.filter((value) => value.azimuth === azimuth).map((value) => {
            const ratio = heatmap.max === heatmap.min ? 1 : (value.energy - heatmap.min) / (heatmap.max - heatmap.min);
            return pptCell(`${formatNumber(value.energy / 1000, 1)} MWh`, { fill: heatColor(ratio), align: "center", bold: ratio > 0.88 });
          }),
        ]),
      ];
      slide.addTable(heatRows, {
        x: 0.78, y: 1.62, w: 8.5, h: 3.75, colW: [1.8, 1.34, 1.34, 1.34, 1.34, 1.34],
        fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.ink,
        border: { type: "solid", color: officeColors.line, pt: 0.7 }, margin: 0.08, valign: "mid", rowH: 0.57,
      });
      slide.addText("검토 범위 최댓값", { x: 9.65, y: 1.78, w: 2.5, h: 0.3, fontFace: "Malgun Gothic", fontSize: 14, bold: true, color: officeColors.green, margin: 0 });
      slide.addText(`경사 ${heatmap.best.tilt}°\n방위각 ${heatmap.best.azimuth}°`, { x: 9.65, y: 2.34, w: 2.5, h: 1.05, fontFace: "Malgun Gothic", fontSize: 25, bold: true, color: officeColors.ink, margin: 0, breakLine: false });
      slide.addText(formatEnergy(heatmap.best.energy), { x: 9.65, y: 3.62, w: 2.5, h: 0.45, fontFace: "Malgun Gothic", fontSize: 20, bold: true, color: officeColors.amber, margin: 0 });
      slide.addShape(pptx.ShapeType.line, { x: 9.65, y: 4.35, w: 2.45, h: 0, line: { color: officeColors.line, width: 1 } });
      slide.addText("실제 최적점은 행간, 음영, 구조, 지형 제약을 함께 검토해야 합니다.", { x: 9.65, y: 4.62, w: 2.55, h: 1.05, fontFace: "Malgun Gothic", fontSize: 13, color: officeColors.gray, margin: 0, breakLine: false });
    }

    slide = pptx.addSlide(); page += 1;
    addSlideFrame(pptx, slide, "모듈저하가 진행될수록 연간 발전량은 감소하고 누적량은 증가합니다", "LIFETIME PROFILE", page);
    addPptImageOrMessage(slide, chartImage("degradation"), { x: 0.72, y: 1.48, w: 9.1, h: 4.95 }, "년차별 발전량 그래프를 표시할 수 없습니다.");
    const last = result.yearly.at(-1);
    slide.addText("장기 분석", { x: 10.1, y: 1.62, w: 2.2, h: 0.35, fontFace: "Malgun Gothic", fontSize: 18, bold: true, color: officeColors.green, margin: 0 });
    slide.addText(`${result.config.projectionYears}년`, { x: 10.1, y: 2.2, w: 2.2, h: 0.55, fontFace: "Malgun Gothic", fontSize: 28, bold: true, color: officeColors.ink, margin: 0 });
    slide.addText("최종년차 발전량", { x: 10.1, y: 3.12, w: 2.2, h: 0.25, fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.gray, margin: 0 });
    slide.addText(formatEnergy(last.energyKwh), { x: 10.1, y: 3.48, w: 2.2, h: 0.42, fontFace: "Malgun Gothic", fontSize: 19, bold: true, color: officeColors.ink, margin: 0, fit: "shrink" });
    slide.addText("누적 발전량", { x: 10.1, y: 4.35, w: 2.2, h: 0.25, fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.gray, margin: 0 });
    slide.addText(formatEnergy(last.cumulativeKwh), { x: 10.1, y: 4.72, w: 2.2, h: 0.42, fontFace: "Malgun Gothic", fontSize: 19, bold: true, color: officeColors.amber, margin: 0, fit: "shrink" });

    const yearlyChunks = [];
    for (let index = 0; index < result.yearly.length; index += 13) yearlyChunks.push(result.yearly.slice(index, index + 13));
    yearlyChunks.forEach((chunk, chunkIndex) => {
      slide = pptx.addSlide(); page += 1;
      addSlideFrame(pptx, slide, `년차별 예상발전량 ${chunk[0].year}–${chunk.at(-1).year}년차`, "YEARLY DATA", page);
      const rows = [
        ["년차", "잔존율", "연간 발전량", "전년 대비", "등가시간", "누적 발전량"].map((text) => pptCell(text, { bold: true, color: officeColors.white, fill: officeColors.ink, align: "center" })),
        ...chunk.map((row) => {
          const previous = result.yearly[row.year - 2];
          const yoy = previous ? row.energyKwh / previous.energyKwh - 1 : null;
          const equivalent = row.energyKwh / result.config.capacityKw / selected.days;
          const fill = row.year === selected.yearNumber ? "F4F7DD" : officeColors.white;
          return [
            pptCell(`${row.year}년차`, { bold: row.year === selected.yearNumber, fill }),
            pptCell(formatPercent(row.factor, 2), { fill, align: "right" }),
            pptCell(formatEnergy(row.energyKwh), { fill, align: "right" }),
            pptCell(yoy === null ? "기준" : formatPercent(yoy, 2, true), { fill, align: "right" }),
            pptCell(`${formatNumber(equivalent, 2)} h/일`, { fill, align: "right" }),
            pptCell(formatEnergy(row.cumulativeKwh), { fill, align: "right" }),
          ];
        }),
      ];
      slide.addTable(rows, {
        x: 0.78, y: 1.52, w: 11.78, h: 5.28,
        colW: [1.25, 1.5, 2.35, 1.55, 1.85, 2.45],
        fontFace: "Malgun Gothic", fontSize: 12, color: officeColors.ink,
        border: { type: "solid", color: officeColors.line, pt: 0.7 },
        fill: officeColors.white, margin: 0.08, valign: "mid", rowH: 0.37,
      });
    });

    slide = pptx.addSlide(); page += 1;
    addSlideFrame(pptx, slide, "결과는 모델의 가정과 활용범위를 함께 읽어야 합니다", "METHOD & LIMITATIONS", page);
    const methods = [
      ["01", "수평면 → 경사면", "월자료는 Erbs 상관식으로 직달·산란 성분을 분리하고 Hay-Davies 모델로 경사면 일사량을 계산합니다."],
      ["02", "발전량", "경사면 일사량 × 설치용량 × 시스템효율 × 온도보정 × 모듈잔존율로 계산합니다."],
      ["03", "등가발전시간", "조회년차 발전량을 설치용량과 분석일수로 나눈 값으로, 정격용량 발전시간에 해당하는 h/일 지표입니다."],
      ["04", "정확도와 활용범위", "월자료는 초기 사업성·설계 비교용입니다. 실시설계에는 실제 좌표 시간자료, 현장 음영, 상세 기자재와 계통제약을 반영해야 합니다."],
    ];
    methods.forEach(([number, title, text], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 0.82 + column * 6.02;
      const y = 1.62 + row * 2.25;
      slide.addText(number, { x, y, w: 0.55, h: 0.36, fontFace: "Aptos", fontSize: 18, bold: true, color: officeColors.amber, margin: 0 });
      slide.addText(title, { x: x + 0.72, y, w: 4.95, h: 0.38, fontFace: "Malgun Gothic", fontSize: 18, bold: true, color: officeColors.ink, margin: 0 });
      slide.addShape(pptx.ShapeType.line, { x: x + 0.72, y: y + 0.58, w: 4.9, h: 0, line: { color: officeColors.line, width: 1 } });
      slide.addText(text, { x: x + 0.72, y: y + 0.78, w: 4.9, h: 0.95, fontFace: "Malgun Gothic", fontSize: 14, color: officeColors.gray, margin: 0, breakLine: false, valign: "top" });
    });
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.82, y: 6.22, w: 11.7, h: 0.58, fill: { color: officeColors.ink }, line: { color: officeColors.ink } });
    slide.addText("다음 단계: 실제 설치좌표의 시간자료와 현장 음영·기자재 조건으로 정밀 재분석", { x: 1.08, y: 6.38, w: 11.15, h: 0.24, fontFace: "Malgun Gothic", fontSize: 14, bold: true, color: officeColors.white, margin: 0, align: "center" });

    return pptx;
  }

  async function exportPowerPoint() {
    if (!currentResult) return toast("먼저 분석을 실행하세요.", "warning");
    if (!window.PptxGenJS) return toast("PPT 출력 모듈을 불러오지 못했습니다.", "error");
    const button = $("#exportPpt");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "PPT 생성 중…";
    try {
      const pptx = buildPowerPoint(currentResult);
      await pptx.writeFile({ fileName: `${safeFileName(currentResult.config.siteName)}_전체분석보고서_${selectedYearNumber()}년차.pptx` });
      toast("HTML 분석 내용을 반영한 PPT 보고서를 만들었습니다.", "success");
    } catch (error) {
      toast(`PPT 생성 실패: ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function exportProfile() {
    const payload = {
      app: "태양광 일사량·발전량 분석 V01",
      savedAt: new Date().toISOString(),
      mode: dataMode(),
      viewYear: selectedYearNumber(),
      config: getConfig(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${safeFileName(payload.config.siteName)}_분석설정.json`);
  }

  function loadProfileFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const profile = JSON.parse(reader.result);
        if (!profile.config) throw new Error("설정 정보가 없습니다.");
        setConfig(profile.config);
        if (profile.mode) {
          const radio = $(`input[name=dataMode][value=${profile.mode}]`);
          if (radio) radio.checked = true;
        }
        updateModeUI();
        calculate(false);
        if (profile.viewYear && $("#viewYear option[value='" + profile.viewYear + "']")) {
          $("#viewYear").value = profile.viewYear;
          renderSelectedYear();
          renderYearlyTable(currentResult);
        }
        toast("분석 설정을 불러왔습니다.", "success");
      } catch (error) {
        toast(`설정 파일을 읽지 못했습니다: ${error.message}`, "error");
      } finally {
        $("#loadProfileFile").value = "";
      }
    };
    reader.readAsText(file);
  }

  function saveLocalProfile() {
    const name = window.prompt("저장할 설계안 이름을 입력하세요.", $("#siteName").value || "설계안 1");
    if (!name) return;
    const profiles = JSON.parse(localStorage.getItem("solarYieldProfiles") || "{}");
    profiles[name] = { config: getConfig(), mode: dataMode(), viewYear: selectedYearNumber(), savedAt: new Date().toISOString() };
    localStorage.setItem("solarYieldProfiles", JSON.stringify(profiles));
    refreshProfileSelect(name);
    toast(`“${name}” 설계안을 이 기기에 저장했습니다.`, "success");
  }

  function refreshProfileSelect(selected = "") {
    const select = $("#savedProfiles");
    const profiles = JSON.parse(localStorage.getItem("solarYieldProfiles") || "{}");
    select.innerHTML = `<option value="">저장된 설계안</option>`;
    Object.keys(profiles).sort().forEach((name) => select.appendChild(new Option(name, name)));
    if (selected) select.value = selected;
  }

  function loadLocalProfile(name) {
    if (!name) return;
    const profiles = JSON.parse(localStorage.getItem("solarYieldProfiles") || "{}");
    const profile = profiles[name];
    if (!profile) return;
    setConfig(profile.config);
    const radio = $(`input[name=dataMode][value=${profile.mode || "kma"}]`);
    if (radio) radio.checked = true;
    updateModeUI();
    calculate(false);
    if (profile.viewYear && $("#viewYear option[value='" + profile.viewYear + "']")) {
      $("#viewYear").value = profile.viewYear;
      renderSelectedYear();
      renderYearlyTable(currentResult);
    }
    toast(`“${name}” 설계안을 불러왔습니다.`, "success");
  }

  function requestPassword(actionName) {
    if (passwordResolver) passwordResolver(false);
    const modal = $("#passwordModal");
    setText("#passwordAction", actionName);
    setText("#passwordError", "");
    $("#passwordInput").value = "";
    modal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => $("#passwordInput").focus(), 0);
    return new Promise((resolve) => { passwordResolver = resolve; });
  }

  function closePasswordModal(result) {
    if (!passwordResolver) return;
    const resolve = passwordResolver;
    passwordResolver = null;
    $("#passwordModal").hidden = true;
    document.body.classList.remove("modal-open");
    resolve(result);
  }

  function confirmPassword() {
    if ($("#passwordInput").value === PROTECTED_PASSWORD) {
      closePasswordModal(true);
      return;
    }
    setText("#passwordError", "비밀번호가 올바르지 않습니다.");
    $("#passwordInput").value = "";
    $("#passwordInput").focus();
  }

  function applyPreset(name) {
    const presets = {
      conservative: { systemEfficiency: 0.75, initialDegradation: 0.015, annualDegradation: 0.007 },
      standard: { systemEfficiency: 0.82, initialDegradation: 0.01, annualDegradation: 0.005 },
      optimistic: { systemEfficiency: 0.87, initialDegradation: 0.005, annualDegradation: 0.0035 },
    };
    setConfig({ ...getConfig(), ...presets[name] });
    $$(".preset-button").forEach((button) => button.classList.toggle("active", button.dataset.preset === name));
  }

  function bindEvents() {
    $("#region").addEventListener("change", applyRegionDefaults);
    $$("input[name=dataMode]").forEach((radio) => radio.addEventListener("change", updateModeUI));
    $("#tilt").addEventListener("input", updateCompass);
    $("#azimuth").addEventListener("input", updateCompass);
    $$('[data-azimuth]').forEach((button) => button.addEventListener("click", () => {
      $("#azimuth").value = button.dataset.azimuth;
      updateCompass();
    }));
    $$(".preset-button").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
    $("#calculateButton").addEventListener("click", () => calculate(true));
    $("#viewYear").addEventListener("change", () => {
      renderSelectedYear();
      renderYearlyTable(currentResult);
    });
    $("#hourlyFile").addEventListener("change", (event) => handleImport(event.target.files[0]));
    $("#dropZone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
    $("#dropZone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
    $("#dropZone").addEventListener("drop", (event) => {
      event.preventDefault();
      event.currentTarget.classList.remove("dragging");
      handleImport(event.dataTransfer.files[0]);
    });
    $("#exportExcel").addEventListener("click", exportWorkbook);
    $("#exportPpt").addEventListener("click", async () => {
      if (await requestPassword("PPT 보고서 출력")) exportPowerPoint();
    });
    $("#exportProfile").addEventListener("click", async () => {
      if (await requestPassword("설정 파일 저장")) exportProfile();
    });
    $("#printReport").addEventListener("click", () => window.print());
    $("#saveProfile").addEventListener("click", async () => {
      if (await requestPassword("설계안 저장")) saveLocalProfile();
    });
    $("#savedProfiles").addEventListener("change", async (event) => {
      const name = event.target.value;
      if (!name) return;
      if (await requestPassword("저장된 설계안 불러오기")) loadLocalProfile(name);
      else event.target.value = "";
    });
    $("#loadProfileButton").addEventListener("click", async () => {
      if (await requestPassword("설정 파일 불러오기")) $("#loadProfileFile").click();
    });
    $("#loadProfileFile").addEventListener("change", (event) => loadProfileFile(event.target.files[0]));
    $("#passwordConfirm").addEventListener("click", confirmPassword);
    $("#passwordCancel").addEventListener("click", () => closePasswordModal(false));
    $("#passwordInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") confirmPassword();
      if (event.key === "Escape") closePasswordModal(false);
    });
    $("#passwordModal").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closePasswordModal(false);
    });
    $("#methodToggle").addEventListener("click", () => {
      const panel = $("#methodPanel");
      panel.classList.toggle("open");
      $("#methodToggle i").textContent = panel.classList.contains("open") ? "−" : "＋";
    });
  }

  function initOffline() {
    setText("#connectionState", navigator.onLine ? "로컬·호스팅 호환" : "오프라인 사용 중");
    window.addEventListener("online", () => setText("#connectionState", "로컬·호스팅 호환"));
    window.addEventListener("offline", () => setText("#connectionState", "오프라인 사용 중"));
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function init() {
    populateDatasetControls();
    refreshProfileSelect();
    bindEvents();
    updateModeUI();
    updateCompass();
    initOffline();
    calculate(false);
  }

  window.SolarExports = {
    buildExcelWorkbook,
    buildPowerPoint,
    selectedYearRows: () => selectedYearRows(currentResult),
    requestPassword,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
