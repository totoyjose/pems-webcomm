// src/thingspeak/fetch_latest.js

export const fetchLatestReadings = async (channelConfig) => {
  if (!channelConfig || !channelConfig.ID || !channelConfig.ReadAPI) {
      return { ammoniaValue: NaN, tempValue: NaN, error: "Invalid channel configuration." };
  }

  try {
      const ammoniaField = channelConfig.AmmoniaField || "field3";
      const tempField = channelConfig.TempField || "field1";
      const response = await fetch(`https://api.thingspeak.com/channels/${channelConfig.ID}/feeds.json?api_key=${channelConfig.ReadAPI}&results=1`);

      if (!response.ok) {
          throw new Error(`ThingSpeak API error: ${response.status}`);
      }

      const { feeds } = await response.json();
      if (!feeds?.length) {
          return { ammoniaValue: NaN, tempValue: NaN, error: "No data feeds found." };
      }

      const latest = feeds[0];
      const ammoniaValue = parseFloat(latest[ammoniaField]);
      const tempValue = parseFloat(latest[tempField]);
      
      return { ammoniaValue, tempValue };

  } catch (err) {
      console.error("Error fetching latest readings from ThingSpeak:", err);
      return { ammoniaValue: NaN, tempValue: NaN, error: err.message };
  }
};