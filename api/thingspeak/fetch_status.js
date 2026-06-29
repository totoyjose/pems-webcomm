// src/thingspeak/fetch_status.js

export const fetchDeviceStatus = async (channel) => {
  if (!channel || !channel.ID || !channel.ReadAPI) {
      return { text: 'N/A', icon: 'bi-question-circle', colorClass: 'text-muted' };
  }
  
  try {
      const statusFieldNumber = channel.StatusField ? parseInt(String(channel.StatusField).replace('field', ''), 10) : 4;
      
      if (isNaN(statusFieldNumber) || statusFieldNumber < 1 || statusFieldNumber > 8) {
          return { text: 'No Field', icon: 'bi-gear', colorClass: 'text-secondary' };
      }
      
      const statusApiUrl = `https://api.thingspeak.com/channels/${channel.ID}/fields/${statusFieldNumber}/last.json?api_key=${channel.ReadAPI}`;
      const response = await fetch(statusApiUrl);

      if (!response.ok) {
          if (response.status === 404) {
              return { text: 'No Data', icon: 'bi-x-circle', colorClass: 'text-secondary' };
          } else {
              return { text: 'N/A', icon: 'bi-exclamation-triangle', colorClass: 'text-danger' };
          }
      }

      const data = await response.json();
      const fieldKey = `field${statusFieldNumber}`;
      const val = data?.[fieldKey];

      if (val === "1" || val === 1 || val === "1.00000") {
          return { text: 'Online', icon: 'bi-wifi', colorClass: 'text-primary' };
      } else if (val === "0" || val === 0) {
          return { text: 'Offline', icon: 'bi-wifi-off', colorClass: 'text-danger' };
      } else {
          return { text: `Unknown (${val ?? 'N/A'})`, icon: 'bi-question-circle', colorClass: 'text-muted' };
      }
  } catch (error) {
      console.error(`Error fetching ThingSpeak status for ${channel.Name}:`, error);
      return { text: 'Error', icon: 'bi-exclamation-triangle', colorClass: 'text-danger' };
  }
};