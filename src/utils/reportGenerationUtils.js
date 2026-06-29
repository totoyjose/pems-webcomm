// src/utils/reportGenerationUtils.js
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Chart } from "chart.js/auto";
import { getMonthlyData } from "../thingspeak/fetch_chartdata";
import { fetchMonthlyHourlyPattern } from "../thingspeak/fetch_bardata";
import {
    getChartStats,
    analyzeLineChartData,
    analyzeBarChartData,
    analyzeAnnualTableData,
    generateOverallSummary,
} from "./descriptiveAnalysis";

const logo = "/logo.webp";

const THEME_COLOR = {
  primary: '#167327', // Dark Green
  primary_rgb: [22, 115, 39],
  secondary: '#E9F3EB',
  secondary_rgb: [233, 243, 235],
  text_light_rgb: [255, 255, 255],
  text_dark: '#333333',
};

const CHART_COLORS = {
    ammonia: {
        border: '#167327', // Green
        background_line: 'rgba(22, 115, 39, 0.1)',
        background_bar: 'rgba(22, 115, 39, 0.6)',
    },
    temp: {
        border: '#FFA500', // Orange
        background_line: 'rgba(255, 165, 0, 0.1)',
        background_bar: 'rgba(255, 165, 0, 0.6)',
    }
};

const cToF = c => c * 9 / 5 + 32;

// Draws formatted text with bolding, wrapping, and newline support.
function drawFormattedText(doc, segments, x, y, maxWidth) {
    let currentX = x;
    let currentY = y;
    const lineHeight = (doc.getLineHeight() / doc.internal.scaleFactor) * 1.15;
    const spaceWidth = doc.getTextWidth(' ');

    segments.forEach(segment => {
        doc.setFont('helvetica', segment.type === 'bold' ? 'bold' : 'normal');
        
        const lines = segment.text.split('\n');

        lines.forEach((line, lineIndex) => {
            if (lineIndex > 0) {
                currentX = x;
                currentY += lineHeight;
            }
            const words = line.split(' ').filter(w => w);

            words.forEach(word => {
                const wordWidth = doc.getTextWidth(word);
                if (currentX > x && (currentX + wordWidth > x + maxWidth)) {
                    currentX = x;
                    currentY += lineHeight;
                }
                doc.text(word, currentX, currentY);
                currentX += wordWidth + spaceWidth;
            });
        });
    });
    return currentY + lineHeight;
}

// Calculates summary statistics based on daily and hourly averages.
export async function calculateMonthlySummary(channels, year, month, tempUnit = 'C') {
    if (!Array.isArray(channels)) channels = [channels];

    const fetchDataForField = async (fieldId, fieldName) => {
        const dailyAvgFeeds = (await Promise.all(
            channels.map(ch => getMonthlyData(ch.CHANNEL_ID, ch.READ_API_KEY, fieldId, month, year))
        )).flat().filter(f => f.value !== null);

        let overallAvg = 'N/A';
        if (dailyAvgFeeds.length > 0) {
            const sum = dailyAvgFeeds.reduce((acc, feed) => acc + feed.value, 0);
            overallAvg = (sum / dailyAvgFeeds.length).toFixed(2);
        }

        const hourlyPatterns = (await Promise.all(
            channels.map(ch => fetchMonthlyHourlyPattern(ch.CHANNEL_ID, ch.READ_API_KEY, fieldId, year, month))
        ));

        const combinedHourly = {};
        for (const pattern of hourlyPatterns) {
            for (const [hour, value] of Object.entries(pattern)) {
                if (value !== null) {
                    if (!combinedHourly[hour]) combinedHourly[hour] = [];
                    combinedHourly[hour].push(value);
                }
            }
        }
        
        const avgHourly = {};
        for (const [hour, values] of Object.entries(combinedHourly)) {
            avgHourly[hour] = values.reduce((s, v) => s + v, 0) / values.length;
        }

        let peakValue = -Infinity;
        for (const value of Object.values(avgHourly)) {
            if (value > peakValue) peakValue = value;
        }
        
        const units = fieldName === 'temp' ? (tempUnit === 'C' ? '°C' : '°F') : ' ppm';
        let displayAvg = overallAvg;
        let displayPeak = peakValue;

        if (fieldName === 'temp' && tempUnit === 'F') {
            if (overallAvg !== 'N/A') displayAvg = cToF(parseFloat(overallAvg)).toFixed(2);
            if (peakValue !== -Infinity) displayPeak = cToF(peakValue);
        }
        
        return {
            avg: dailyAvgFeeds.length > 0 ? `${displayAvg}${units}` : 'N/A',
            peakValue: peakValue !== -Infinity ? `${displayPeak.toFixed(2)}${units}` : 'N/A',
        };
    };
    
    const [tempSummary, ammoniaSummary] = await Promise.all([
        fetchDataForField(channels[0].tempField, 'temp'),
        fetchDataForField(channels[0].ammoniaField, 'ammonia'),
    ]);

    return { tempSummary, ammoniaSummary };
}

// Core PDF creation logic.
export async function createPdfDocument(channelOrBranch, selectedMonth, reportData, tempUnit = 'C') {
    const { isBranch, branchName, coopName, ammoniaField, tempField, currentYear, alertThreshold } = preparePdfData(channelOrBranch, selectedMonth);
    const doc = new jsPDF();
    const { summary, observationPeriod } = reportData;

    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 20;
    const topMargin = 45;
    const CHART_BLOCK_HEIGHT = 120;

    const [ammoniaChartResult, tempChartResult, hourlyAmmoniaChartResult, hourlyTempChartResult] = await Promise.all([
        fetchMonthlyChartImage(channelOrBranch, ammoniaField, currentYear, selectedMonth, 'Ammonia', CHART_COLORS.ammonia),
        fetchMonthlyChartImage(channelOrBranch, tempField, currentYear, selectedMonth, 'Temperature', CHART_COLORS.temp, tempUnit),
        fetchHourlyBarChartImage(channelOrBranch, ammoniaField, currentYear, selectedMonth, 'Ammonia', CHART_COLORS.ammonia),
        fetchHourlyBarChartImage(channelOrBranch, tempField, currentYear, selectedMonth, 'Temperature', CHART_COLORS.temp, tempUnit),
    ]);
    
    if (!ammoniaChartResult.imageDataUrl && !tempChartResult.imageDataUrl) {
        throw new Error(ammoniaChartResult.error || tempChartResult.error || "Failed to generate charts due to missing data.");
    }
 
    await drawPdfHeader(doc, selectedMonth, currentYear);
    let currentY = topMargin;

    const poultryInfoBody = [["Branch", branchName]];
    if (!isBranch) poultryInfoBody.push(["Poultry House", coopName]);
    poultryInfoBody.push(["Observation Period", observationPeriod]);

    autoTable(doc, {
        head: [[{ content: "Report Information", colSpan: 2, styles: { halign: "left" } }]],
        body: poultryInfoBody,
        startY: currentY, margin: { left: 10 }, tableWidth: 93, theme: "grid",
        styles: { lineWidth: 0.1, lineColor: THEME_COLOR.secondary_rgb, font: "helvetica", cellPadding: 2 },
        headStyles: { fillColor: THEME_COLOR.primary_rgb, textColor: THEME_COLOR.text_light_rgb, fontStyle: "bold" },
        bodyStyles: { textColor: THEME_COLOR.text_dark },
        alternateRowStyles: { fillColor: THEME_COLOR.secondary_rgb }
    });
    
    const summaryBody = [
        ["Average Temperature", summary.tempSummary.avg],
        ["Average Ammonia", summary.ammoniaSummary.avg],
        ["Peak Temperature", summary.tempSummary.peakValue],
        ["Peak Ammonia", summary.ammoniaSummary.peakValue],
    ];
    if (!isBranch && alertThreshold) {
        const tempUnitSymbol = tempUnit === 'F' ? '°F' : '°C';
        const createTempThresholdString = (value) => {
            const num = parseFloat(value);
            if (isNaN(num)) return 'N/A';
            const displayTemp = tempUnit === 'F' ? cToF(num) : num;
            return `${displayTemp.toFixed(1)} ${tempUnitSymbol}`;
        };
        const highTemp = createTempThresholdString(alertThreshold.tempHigh);
        const lowTemp = createTempThresholdString(alertThreshold.tempLow);
        
        summaryBody.push(
            [{ content: 'Alert Thresholds', colSpan: 2, styles: { halign: 'left', fillColor: THEME_COLOR.secondary_rgb, fontStyle: 'bold' } }],
            ["High Temperature", `High (>) ${highTemp}`],
            ["Low Temperature", `Low (<) ${lowTemp}`],
            ["High Ammonia", `High (>) ${alertThreshold.ammoniaHigh || 'N/A'} ppm`]
        );
    }
    autoTable(doc, {
        head: [[{ content: "Environmental Summary", colSpan: 2, styles: { halign: "left" } }]],
        body: summaryBody,
        startY: currentY, margin: { left: 107 }, tableWidth: 93, theme: "grid",
        styles: { lineWidth: 0.1, lineColor: THEME_COLOR.secondary_rgb, font: "helvetica", cellPadding: 2 },
        headStyles: { fillColor: THEME_COLOR.primary_rgb, textColor: THEME_COLOR.text_light_rgb, fontStyle: "bold" },
        bodyStyles: { textColor: THEME_COLOR.text_dark },
        alternateRowStyles: { fillColor: THEME_COLOR.secondary_rgb }
    });

    currentY = doc.lastAutoTable.finalY + 8;
    drawDivider(doc, currentY); currentY += 8;
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(THEME_COLOR.text_dark);
    doc.text("Overview", 10, currentY); currentY += 6;
    doc.setFontSize(10.5);
    const overviewText = generateOverallSummary(summary, !isBranch ? alertThreshold : null, ammoniaChartResult.stats, tempChartResult.stats);
    currentY = drawFormattedText(doc, overviewText, 10, currentY, 190);

    // --- Force page break to ensure charts start on page 2 ---
    const hasCharts = ammoniaChartResult.imageDataUrl || tempChartResult.imageDataUrl || hourlyAmmoniaChartResult.imageDataUrl || hourlyTempChartResult.imageDataUrl;
    if (hasCharts) {
        doc.addPage();
        await drawPdfHeader(doc, selectedMonth, currentYear);
        currentY = topMargin; // Reset Y position for the new page
    }

    const checkAndAddPage = async (y) => {
        if (y + CHART_BLOCK_HEIGHT > pageHeight - bottomMargin) {
            doc.addPage();
            await drawPdfHeader(doc, selectedMonth, currentYear);
            return topMargin;
        }
        return y;
    };

    const drawSingleChartRow = (y, title, chart, analysis) => {
        if (!chart.imageDataUrl) return y;
        doc.setFontSize(12).setFont("helvetica", "bold").setTextColor(THEME_COLOR.text_dark);
        doc.text(title, 10, y);
        doc.addImage(chart.imageDataUrl, "PNG", 10, y + 5, 190, 70, undefined, 'FAST');
        doc.setFontSize(10.5);
        const finalY = drawFormattedText(doc, analysis, 10, y + 80, 190);
        return finalY;
    };
    
    currentY = await checkAndAddPage(currentY);
    drawDivider(doc, currentY); currentY += 8;
    const ammoniaTrendAnalysis = analyzeLineChartData(ammoniaChartResult.dataPoints, 'ammonia', 'ppm');
    currentY = drawSingleChartRow(currentY, "Monthly Ammonia Trend", ammoniaChartResult, ammoniaTrendAnalysis);
    
    currentY = await checkAndAddPage(currentY);
    drawDivider(doc, currentY); currentY += 8;
    const tempTrendAnalysis = analyzeLineChartData(tempChartResult.dataPoints, 'temperature', '°C', tempUnit);
    currentY = drawSingleChartRow(currentY, "Monthly Temperature Trend", tempChartResult, tempTrendAnalysis);

    currentY = await checkAndAddPage(currentY);
    drawDivider(doc, currentY); currentY += 8;
    const ammoniaHourlyAnalysis = analyzeBarChartData(hourlyAmmoniaChartResult.dataPoints, 'ppm');
    currentY = drawSingleChartRow(currentY, "Hourly Ammonia Pattern", hourlyAmmoniaChartResult, ammoniaHourlyAnalysis);

    currentY = await checkAndAddPage(currentY);
    drawDivider(doc, currentY); currentY += 8;
    const tempHourlyAnalysis = analyzeBarChartData(hourlyTempChartResult.dataPoints, '°C', tempUnit, 'temperature');
    currentY = drawSingleChartRow(currentY, "Hourly Temperature Pattern", hourlyTempChartResult, tempHourlyAnalysis);

    drawPdfFooter(doc);
    return doc;
}

// Draws a themed horizontal line divider.
function drawDivider(doc, y) {
    doc.setDrawColor(THEME_COLOR.primary_rgb[0], THEME_COLOR.primary_rgb[1], THEME_COLOR.primary_rgb[2]);
    doc.setLineWidth(0.3);
    doc.line(10, y, 200, y);
}

// Prepares data used throughout the PDF generation process.
function preparePdfData(channelOrBranch, selectedMonth) {
  const isBranch = Array.isArray(channelOrBranch);
  const channels = isBranch ? channelOrBranch : [channelOrBranch];
  if (!channels || channels.length === 0) throw new Error("Missing channel information.");
  const firstChannel = channels[0];
  return {
    isBranch, channels,
    branchName: firstChannel.BRANCH_NAME,
    coopName: isBranch ? 'All Houses with Sensor' : firstChannel.COOP_NAME,
    ammoniaField: firstChannel.ammoniaField,
    tempField: firstChannel.tempField,
    alertThreshold: isBranch ? null : firstChannel.alertThreshold,
    currentYear: new Date().getFullYear(),
    selectedMonth
  };
}

// Draws the header section for each page of the PDF.
async function drawPdfHeader(doc, selectedMonth, currentYear) {
  const logoBase64 = await toBase64(logo);
  const monthName = new Date(currentYear, selectedMonth - 1, 1).toLocaleString('default', { month: 'long' });
  doc.setProperties({
    title: `PEMS Report - ${monthName} ${currentYear}`, subject: "Sensor Data Analysis",
    author: "PEMS System", creator: "PEMS Web App",
  });
  doc.addImage(logoBase64, "PNG", 10, 10, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(THEME_COLOR.text_dark);
  doc.text("PEMS Report", 35, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(`Monthly Environmental Summary for ${monthName} ${currentYear}`, 35, 27);
  doc.setDrawColor(THEME_COLOR.primary);
  doc.setLineWidth(0.5);
  doc.line(10, 36, 200, 36);
}

// Draws the header section for the Annual PDF.
async function drawAnnualPdfHeader(doc, year, coopName) {
  const logoBase64 = await toBase64(logo);
  doc.setProperties({
    title: `PEMS Annual Report - ${year}`, subject: `Annual Sensor Data Analysis for ${coopName}`,
    author: "PEMS System", creator: "PEMS Web App",
  });
  doc.addImage(logoBase64, "PNG", 10, 10, 20, 20);
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(THEME_COLOR.text_dark);
  doc.text("PEMS Annual Report", 35, 20);
  doc.setFont("helvetica", "normal"); doc.setFontSize(12);
  doc.text(`Annual Environmental Summary for ${year}`, 35, 27);
  doc.setDrawColor(THEME_COLOR.primary); doc.setLineWidth(0.5);
  doc.line(10, 36, 200, 36);
}

// Creates the Annual Report PDF document.
export async function createAnnualPdfDocument(channelInfo, year, annualData, tempUnit = 'C') {
    const doc = new jsPDF();
    await drawAnnualPdfHeader(doc, year, channelInfo.COOP_NAME);
    let currentY = 45;

    const reportInfoBody = [
        ["Branch", channelInfo.BRANCH_NAME],
        ["Poultry House", channelInfo.COOP_NAME],
    ];
    if (channelInfo.isBranch) {
        reportInfoBody.push(["Number of Houses", channelInfo.houseCount.toString()]);
    } else if (channelInfo.alertThreshold) {
        const { tempHigh, tempLow, ammoniaHigh } = channelInfo.alertThreshold;
        const tempUnitSymbol = tempUnit === 'F' ? '°F' : '°C';
        const formatTempThresholdValue = (value) => {
            const num = parseFloat(value);
            if (isNaN(num)) return 'N/A';
            const displayTemp = tempUnit === 'F' ? cToF(num) : num;
            return displayTemp.toFixed(1);
        };
        const highTemp = formatTempThresholdValue(tempHigh);
        const lowTemp = formatTempThresholdValue(tempLow);

        reportInfoBody.push(["Alert Thresholds", `Temperature: <${lowTemp}${tempUnitSymbol}, >${highTemp}${tempUnitSymbol} | Ammonia: >${ammoniaHigh || 'N/A'} ppm`]);
    }
    reportInfoBody.push(["Report Year", year.toString()]);

    autoTable(doc, {
        head: [[{ content: "Report Information", colSpan: 2, styles: { halign: "left" } }]],
        body: reportInfoBody,
        startY: currentY, margin: { left: 10, right: 10 }, theme: "grid",
        styles: { lineWidth: 0.1, lineColor: THEME_COLOR.secondary_rgb, font: "helvetica", cellPadding: 3 },
        headStyles: { fillColor: THEME_COLOR.primary_rgb, textColor: THEME_COLOR.text_light_rgb, fontStyle: "bold" },
        bodyStyles: { textColor: THEME_COLOR.text_dark, fontStyle: 'bold' }, 
        alternateRowStyles: { fillColor: THEME_COLOR.secondary_rgb },
        columnStyles: { 1: { fontStyle: 'normal' } }
    });
    
    currentY = doc.lastAutoTable.finalY + 8;
    drawDivider(doc, currentY); currentY += 8;
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(THEME_COLOR.text_dark);
    doc.text("Overview", 10, currentY); currentY += 6;
    doc.setFontSize(10.5);
    const analysisText = analyzeAnnualTableData(annualData, channelInfo.isBranch ? null : channelInfo.alertThreshold, tempUnit);
    currentY = drawFormattedText(doc, analysisText, 10, currentY, 190);

    const head = [
      [{ content: 'Month', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } }, { content: 'Ammonia (ppm)', colSpan: 3, styles: { halign: 'center' } }, { content: `Temperature (${tempUnit === 'F' ? '°F' : '°C'})`, colSpan: 3, styles: { halign: 'center' } }],
      [{ content: 'High', styles: { halign: 'center' } }, { content: 'Low', styles: { halign: 'center' } }, { content: 'Avg', styles: { halign: 'center' } }, { content: 'High', styles: { halign: 'center' } }, { content: 'Low', styles: { halign: 'center' } }, { content: 'Avg', styles: { halign: 'center' } }]
    ];
    const body = annualData.map(row => {
      const tempMax = row.tempMax ? (tempUnit === 'F' ? cToF(parseFloat(row.tempMax)).toFixed(1) : row.tempMax) : 'N/A';
      const tempMin = row.tempMin ? (tempUnit === 'F' ? cToF(parseFloat(row.tempMin)).toFixed(1) : row.tempMin) : 'N/A';
      const tempAvg = row.tempAvg ? (tempUnit === 'F' ? cToF(parseFloat(row.tempAvg)).toFixed(1) : row.tempAvg) : 'N/A';

      return [
        row.month, row.ammoniaMax || 'N/A', row.ammoniaMin || 'N/A', row.ammoniaAvg || 'N/A', 
        tempMax, tempMin, tempAvg
      ]
    });
    
    autoTable(doc, {
        head, body, startY: currentY, theme: 'grid',
        margin: { left: 10, right: 10 },
        headStyles: { fillColor: THEME_COLOR.primary_rgb, textColor: THEME_COLOR.text_light_rgb, fontStyle: 'bold', lineWidth: 0.1, lineColor: [255, 255, 255] },
        styles: { cellPadding: 2, fontSize: 9 },
        columnStyles: {
            0: { fontStyle: 'bold', halign: 'left' },
            1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' },
            4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' },
        },
        didParseCell: (data) => {
            if (data.cell.raw === 'N/A') {
                data.cell.styles.textColor = '#888888';
            }
        },
        didDrawCell: (data) => {
            if (data.column.index === 3 && data.row.section === 'body') {
                doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2);
                doc.line(data.cell.x + data.cell.width, data.cell.y, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
            }
        },
    });

    drawPdfFooter(doc);
    return doc;
}

// Draws the footer with page number on each page.
function drawPdfFooter(doc) {
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor('#888888');
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() / 2, 290, { align: 'center' });
    }
}

// Builds a Chart.js instance and returns the chart and canvas.
function buildChart(labels, dataPoints, type, label, width, height, color, yAxisOptions = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  const isLine = type === "line";
  const chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label, data: dataPoints,
        borderColor: color.border,
        backgroundColor: isLine ? color.background_line : color.background_bar,
        fill: isLine, pointRadius: isLine ? 0 : undefined, tension: isLine ? 0.4 : 0, borderWidth: isLine ? 2 : 1,
      }],
    },
    options: {
      animation: false, responsive: false, devicePixelRatio: 1.5,
      scales: { y: { beginAtZero: true, suggestedMin: 0, ...yAxisOptions }, x: { ticks: { maxTicksLimit: 15, autoSkip: true } } },
      plugins: { legend: { display: false } },
    },
  });
  return { chart, canvas };
}

// Fetches monthly data, calculates stats, and renders a line chart to an image URL.
export async function fetchMonthlyChartImage(channelOrBranch, fieldId, year, month, label, color, tempUnit = 'C') {
  try {
    const channels = Array.isArray(channelOrBranch) ? channelOrBranch : [channelOrBranch];
    const results = await Promise.all(channels.map((ch) => getMonthlyData(ch.CHANNEL_ID, ch.READ_API_KEY, fieldId, month, year)));
    const dateMap = {};
    results.flat().forEach((f) => {
        const date = new Date(f.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
        if (f.value !== null && !isNaN(f.value)) {
            if (!dateMap[date]) dateMap[date] = [];
            dateMap[date].push(f.value);
        }
    });

    const daysInMonth = new Date(year, month, 0).getDate();
    const labels = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month - 1, i + 1).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    const dataPoints = labels.map((label) => {
        const values = dateMap[label] || [];
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    });

    if (dataPoints.every(v => v === null)) return { imageDataUrl: null, dataPoints: [], stats: {}, error: "No monthly data available." };
    
    const isTempF = label === 'Temperature' && tempUnit === 'F';
    const displayDataPoints = isTempF ? dataPoints.map(p => p === null ? null : cToF(p)) : dataPoints;
    const yAxisOptions = isTempF ? { suggestedMin: 32, beginAtZero: false } : {};

    const { chart, canvas } = buildChart(labels, displayDataPoints, "line", label, 800, 295, color, yAxisOptions);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const imageDataUrl = canvas.toDataURL("image/png");
    chart.destroy();
    
    const validDataPoints = dataPoints.filter(v => v !== null);
    const stats = getChartStats(validDataPoints);

    return { imageDataUrl, dataPoints, stats };
  } catch (error) {
    console.error(`Failed to generate monthly chart for field ${fieldId}:`, error);
    return { imageDataUrl: null, dataPoints: [], stats: {}, error: error.message || "Failed to generate monthly chart." };
  }
}

// Fetches hourly data and renders a bar chart to an image URL.
export async function fetchHourlyBarChartImage(channelOrBranch, fieldId, year, month, label, color, tempUnit = 'C') {
  try {
    const channels = Array.isArray(channelOrBranch) ? channelOrBranch : [channelOrBranch];
    const results = await Promise.all(channels.map((ch) => fetchMonthlyHourlyPattern(ch.CHANNEL_ID, ch.READ_API_KEY, fieldId, year, month)));
    const hourMap = {};
    results.forEach((hourlyObj) => {
      Object.entries(hourlyObj).forEach(([hour, value]) => {
        if (value !== null) {
          if (!hourMap[hour]) hourMap[hour] = [];
          hourMap[hour].push(value);
        }
      });
    });

    const labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0") + ":00");
    const dataPoints = labels.map((hour) => {
      const values = hourMap[hour] || [];
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    });

    if (dataPoints.every((v) => v === null)) return { imageDataUrl: null, dataPoints: [], error: "No hourly data available." };

    const isTempF = label === 'Temperature' && tempUnit === 'F';
    const displayDataPoints = isTempF ? dataPoints.map(p => p === null ? null : cToF(p)) : dataPoints;
    const yAxisOptions = isTempF ? { suggestedMin: 32, beginAtZero: false } : {};

    const { chart, canvas } = buildChart(labels, displayDataPoints, "bar", label, 800, 295, color, yAxisOptions);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const imageDataUrl = canvas.toDataURL("image/png");
    chart.destroy();
    return { imageDataUrl, dataPoints };
  } catch (error) {
    console.error(`Failed to generate hourly chart for field ${fieldId}:`, error);
    return { imageDataUrl: null, dataPoints: [], error: error.message || "Failed to generate hourly chart." };
  }
}

// Converts an image URL to a Base64 string.
function toBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (err) => reject(err);
  });
}