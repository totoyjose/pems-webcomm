// Fetches the hourly average pattern for a given month from ThingSpeak.
export async function fetchMonthlyHourlyPattern(channelId, apiKey, fieldId, year, month) {
  // month is 1-based (1 = Jan, 12 = Dec)
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const url = new URL(`https://api.thingspeak.com/channels/${channelId}/fields/${fieldId}.json`);
  url.searchParams.append("start", start.toISOString());
  url.searchParams.append("end", end.toISOString());
  url.searchParams.append("average", "60"); // Get hourly averages
  if (apiKey) url.searchParams.append("api_key", apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();

    // Use an array indexed by hour (0-23) for efficient aggregation.
    const hourlyGroups = Array.from({ length: 24 }, () => []);

    (data.feeds || []).forEach(feed => {
      const dateTime = new Date(feed.created_at);
      const hour = dateTime.getUTCHours(); // number 0-23
      const value = parseFloat(feed[`field${fieldId}`]);
      if (!isNaN(value)) {
        hourlyGroups[hour].push(value);
      }
    });

    const hourlyAverages = {};
    for (let h = 0; h < 24; h++) {
      const hourKey = h.toString().padStart(2, '0') + ':00';
      const values = hourlyGroups[h];
      if (values.length > 0) {
        const sum = values.reduce((acc, val) => acc + val, 0);
        hourlyAverages[hourKey] = parseFloat((sum / values.length).toFixed(2));
      } else {
        hourlyAverages[hourKey] = null;
      }
    }
    return hourlyAverages;
  } catch (error) {
    console.error("Failed to fetch or process monthly hourly data:", error);
    return {};
  }
}