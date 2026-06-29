// Fetch ThingSpeak data for last N days (daily/weekly/etc.)
export async function fetchThingSpeakData(channelId, apiKey, fieldId, days = 1) {
  let average;
  switch (days) {
    case 1:
      average = "10";
      break;
    case 7:
      average = "60";
      break;
    default:
      average = "10";
  }

  try {
    const url = new URL(`https://api.thingspeak.com/channels/${channelId}/fields/${fieldId}.json`);
    url.searchParams.append("days", days);
    url.searchParams.append('average', average);
    if (apiKey) url.searchParams.append("api_key", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`ThingSpeak fetch failed: ${response.status}`);
    }

    const data = await response.json();

    return (data.feeds || []).map(feed => ({
      created_at: new Date(feed.created_at),
      value: parseFloat(feed[`field${fieldId}`])
    })).filter(p => !isNaN(p.value));
  } catch (error) {
    console.error("❌ Error fetching ThingSpeak data:", error);
    return [];
  }
}

// Fetch ThingSpeak data for the current month
export async function getMonthlyData(channelId, apiKey, fieldId, month, year = new Date().getFullYear()) {
  const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // last day of month

  const url = new URL(`https://api.thingspeak.com/channels/${channelId}/fields/${fieldId}.json`);
  url.searchParams.append('start', `${startDate} 00:00:00`);
  url.searchParams.append('end', `${endDate} 23:59:59`);
  url.searchParams.append('timezone', 'Asia/Manila');
  url.searchParams.append('average', '1440'); // daily average
  if (apiKey) url.searchParams.append('api_key', apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorData = await response.text();
      console.error("ThingSpeak API Error Response:", errorData);
      if (response.status === 400 && errorData === "0") {
         return []; // No data
      }
      throw new Error(`ThingSpeak API error: ${response.status} ${response.statusText}. Details: ${errorData}`);
    }

    const data = await response.json();
    const points = (data.feeds || [])
      .map(feed => ({
        created_at: new Date(feed.created_at),
        value: parseFloat(feed[`field${fieldId}`])
      }))
      .filter(p => !isNaN(p.value));

    // Use a Map for efficient O(1) lookups to fill missing days
    const pointsMap = new Map(points.map(p => [
      p.created_at.toISOString().split('T')[0], // UTC date string 'YYYY-MM-DD' as key
      p.value
    ]));

    const filled = [];
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dayDate = new Date(Date.UTC(year, month - 1, d)); // Create date in UTC
      const dateKey = dayDate.toISOString().split('T')[0];
      const value = pointsMap.get(dateKey) ?? null;
      filled.push({ created_at: dayDate, value });
    }
    return filled;
  } catch (error) {
    console.error(`Error fetching from ThingSpeak (monthly): ${error.message}`);
    return [];
  }
}