import {
  saveTableDataToFirestore,
  loadTableDataFromFirestore,
} from "../firebase/storeData.js";

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getStartAndEndDate(year, month) {
  const paddedMonth = String(month).padStart(2, "0");
  const startDate = `${year}-${paddedMonth}-01T00:00:00Z`;
  const endDate = `${year}-${paddedMonth}-${getDaysInMonth(
    year,
    month
  )}T23:59:59Z`;
  return { startDate, endDate };
}

function buildThingSpeakUrl(channelId, apiKey, fieldId, startDate, endDate) {
  const url = new URL(
    `https://api.thingspeak.com/channels/${channelId}/fields/${fieldId}.json`
  );
  url.searchParams.append("api_key", apiKey);
  url.searchParams.append("start", startDate);
  url.searchParams.append("end", endDate);
  url.searchParams.append("round", "2");
  url.searchParams.append("average", "daily");
  return url.toString();
}

async function fetchThingSpeakFieldData(url, fieldId, signal) {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok)
      throw new Error(
        `Request failed for field ${fieldId} with status ${response.status}`
      );

    const data = await response.json();
    const feeds = data.feeds || [];

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;

    for (const entry of feeds) {
      const valueStr = entry[`field${fieldId}`];
      if (valueStr !== null && valueStr !== undefined) {
        const value = parseFloat(valueStr);
        if (!isNaN(value)) {
          if (value > max) max = value;
          if (value < min) min = value;
          sum += value;
          count++;
        }
      }
    }

    if (!isFinite(min) || !isFinite(max)) {
      return { min: "", max: "", average: "" };
    }

    const average = count > 0 ? (sum / count).toFixed(2) : "";

    return {
      min: min.toFixed(2),
      max: max.toFixed(2),
      average,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      console.log(`Fetch aborted for field ${fieldId}`);
    } else {
      console.error(
        `Error fetching or processing data for field ${fieldId}:`,
        error
      );
    }
    return { min: "Error", max: "Error", average: "Error" };
  }
}

export async function getAnnualMinMaxData(
  branchName,
  firestoreId,
  year,
  channelId,
  apiKey,
  ammoniaFieldId,
  tempFieldId,
  signal
) {
  const cachedData =
    (await loadTableDataFromFirestore(branchName, firestoreId, year)) || [];

  if (cachedData.length > 0 && cachedData.some(d => d)) {
    console.log(`📂 Loaded annual summary for ${year} from Firestore`);
  }

  console.log(`🌐 Processing annual summary for ${year}...`);
  const monthlyData = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  for (let month = 1; month <= 12; month++) {
    const monthName = new Date(year, month - 1, 1).toLocaleString("default", {
      month: "long",
    });

    if (year > currentYear || (year === currentYear && month > currentMonth)) {
      monthlyData.push({
        month: monthName,
        ammoniaMax: "",
        ammoniaMin: "",
        ammoniaAvg: "",
        tempMax: "",
        tempMin: "",
        tempAvg: "",
      });
      continue;
    }

    const cachedMonthData = cachedData[month - 1];
    const isCompletedMonth = year < currentYear || (year === currentYear && month < currentMonth);

    if (isCompletedMonth && cachedMonthData) {
      monthlyData.push(cachedMonthData);
      continue;
    }

    console.log(
      `🌐 Fetching summary for ${monthName} ${year} from ThingSpeak...`
    );

    if (signal?.aborted) {
      throw new DOMException("Request aborted by user", "AbortError");
    }

    const { startDate, endDate } = getStartAndEndDate(year, month);

    const ammoniaUrl = buildThingSpeakUrl(
      channelId,
      apiKey,
      ammoniaFieldId,
      startDate,
      endDate
    );
    const tempUrl = buildThingSpeakUrl(
      channelId,
      apiKey,
      tempFieldId,
      startDate,
      endDate
    );

    const [ammoniaResult, tempResult] = await Promise.all([
      fetchThingSpeakFieldData(ammoniaUrl, ammoniaFieldId, signal),
      fetchThingSpeakFieldData(tempUrl, tempFieldId, signal),
    ]);

    if (signal?.aborted) {
      throw new DOMException("Request aborted by user", "AbortError");
    }

    monthlyData.push({
      month: monthName,
      ammoniaMax: ammoniaResult?.max ?? "",
      ammoniaMin: ammoniaResult?.min ?? "",
      ammoniaAvg: ammoniaResult?.average ?? "",
      tempMax: tempResult?.max ?? "",
      tempMin: tempResult?.min ?? "",
      tempAvg: tempResult?.average ?? "",
    });
  }

  await saveTableDataToFirestore(branchName, firestoreId, year, monthlyData);

  return monthlyData;
}