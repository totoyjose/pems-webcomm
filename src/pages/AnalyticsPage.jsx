// src/pages/AnalyticsPage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/layout/Sidebar';
import styles from '../styles/AnalyticsPage.module.css';
import { Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Title, Tooltip, Legend } from 'chart.js';
import { getAllChannels } from '../firebase/channelService.js';
import { fetchAllUserAlerts } from '../firebase/fetch_alerts.js';
import { fetchThingSpeakData, getMonthlyData } from '../thingspeak/fetch_chartdata.js';
import { getAnnualMinMaxData } from '../thingspeak/fetch_tabledata.js';
import { fetchMonthlyHourlyPattern } from '../thingspeak/fetch_bardata.js';
import { fetchDeviceStatus } from '../thingspeak/fetch_status.js';
import { NoDataResponse } from '../components/utils/noDataFallBack.jsx';
import { format } from 'date-fns';
import { generateInsights } from '../utils/descriptiveAnalysis.js';
import { predictNext24Hours, predictNext7Days } from '../utils/predictiveAnalysis.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Title, Tooltip, Legend);

const CURRENT_YEAR = new Date().getFullYear();
const chartTitleMap = { daily: "Daily Poultry House Report", weekly: "Weekly Report", insights: "Monthly Report" };

// Skeleton component for the insight cards to prevent CLS....
const InsightCardSkeleton = () => (
  <div className="col-12 col-md-6 col-lg-4 mb-4">
    <div className="card h-100 shadow-sm placeholder-glow">
      <div className="card-header"><span className="placeholder col-8"></span></div>
      <ul className="list-group list-group-flush">
        <li className="list-group-item"><span className="placeholder col-10"></span></li>
        <li className="list-group-item"><span className="placeholder col-7"></span></li>
      </ul>
    </div>
  </div>
);

// Skeleton for prediction cards to prevent CLS.
const PredictionCardSkeleton = () => (
    <div className="col-12 col-md-6 mb-3">
        <div className="card h-100 placeholder-glow">
            <div className="card-body text-center d-flex flex-column justify-content-center">
                <h6 className="card-title text-muted"><span className="placeholder col-6"></span></h6>
                <p className={`${styles.predictionValue} placeholder col-4`}></p>
                <p className="mb-0 placeholder col-7"></p>
            </div>
        </div>
    </div>
);

// Skeleton component for the annual summary table rows to prevent CLS.
const TableRowSkeleton = () => (
  <tr className="placeholder-glow">
    <td><span className="placeholder col-8"></span></td>
    <td><span className="placeholder col-6"></span></td>
    <td><span className="placeholder col-6"></span></td>
    <td><span className="placeholder col-6"></span></td>
    <td><span className="placeholder col-6"></span></td>
    <td><span className="placeholder col-6"></span></td>
    <td><span className="placeholder col-6"></span></td>
  </tr>
);

// Parses and renders text with bold markdown (**text**).
const InsightText = ({ text }) => {
  const parts = text.split('**');
  return (
    <span>
      {parts.map((part, index) =>
        index % 2 === 1 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>
      )}
    </span>
  );
};

// Renders analytics charts, data tables, and descriptive insights.
const AnalyticsPage = () => {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [tempUnit, setTempUnit] = useState(localStorage.getItem('tempUnit') || 'C');

  const [allChannels, setAllChannels] = useState([]);
  const [branchList, setBranchList] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [filteredChannels, setFilteredChannels] = useState([]);
  
  const [allAlerts, setAllAlerts] = useState([]);
  const [channelAlerts, setChannelAlerts] = useState([]);

  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [selectedSensor, setSelectedSensor] = useState('ammonia');
  const [activeTab, setActiveTab] = useState('daily');
  const [deviceStatus, setDeviceStatus] = useState({ text: 'N/A', icon: 'bi-question-circle', colorClass: 'text-muted' });

  // Data states for charts
  const [lineChartData, setLineChartData] = useState({});
  const [annualSummaryData, setAnnualSummaryData] = useState([]);
  const [hourlyBarData, setHourlyBarData] = useState(null);
  
  // States for insights
  const [allChartData, setAllChartData] = useState(null);
  const [hourlyRawData, setHourlyRawData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [displayInsights, setDisplayInsights] = useState(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);

  // States for predictions
  const [predictions, setPredictions] = useState(null);
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(false);
  const [activePredictionTab, setActivePredictionTab] = useState('daily');

  // General loading and error states
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isLoadingCharts, setIsLoadingCharts] = useState(false);
  const [isLoadingTable, setIsLoadingTable] = useState(false);
  const [isLoadingHourlyBar, setIsLoadingHourlyBar] = useState(false);
  const [hourlyBarError, setHourlyBarError] = useState(null);

  const [chartsReportTitleText, setChartsReportTitleText] = useState("Loading Charts...");
  const [hourlyBarTitleText, setHourlyBarTitleText] = useState("Loading Chart...");
  const [tableReportTitleText, setTableReportTitleText] = useState("Loading Table...");
  
  const toggleSidebar = () => setIsSidebarExpanded(!isSidebarExpanded);

  const { unitSymbol, convertTemp } = useMemo(() => ({
    unitSymbol: tempUnit === 'C' ? '°C' : '°F',
    convertTemp: (celsius) => {
      if (tempUnit === 'F' && typeof celsius === 'number' && !isNaN(celsius)) {
        return celsius * 9 / 5 + 32;
      }
      return celsius;
    }
  }), [tempUnit]);

  // Determines the CSS color class for a predicted value based on alert thresholds.
  const getPredictionColor = (metric, value, thresholds) => {
    if (!thresholds || value === null || isNaN(value)) return 'text-dark';
    if (metric === 'ammonia') {
      if (value >= parseFloat(thresholds.ammoniaHigh)) return 'text-danger';
    }
    if (metric === 'temperature') {
      if (value >= parseFloat(thresholds.tempHigh)) return 'text-danger';
      if (value <= parseFloat(thresholds.tempLow)) return 'text-primary';
    }
    return 'text-success';
  };
  
  // Reusable component for displaying prediction cards.
  const PredictionCard = ({ title, prediction, metric, unit }) => {
    const TrendIcon = ({ trend, metric }) => {
      const downColor = metric === 'temperature' ? 'text-primary' : 'text-success';
      if (trend === 'increasing') return <i className="bi bi-arrow-up-right text-danger ms-1"></i>;
      if (trend === 'decreasing') return <i className={`bi bi-arrow-down-right ${downColor} ms-1`}></i>;
      return <i className="bi bi-arrow-right text-muted ms-1"></i>;
    };

    return (
      <div className={`${styles.predictionCard} card h-100`}>
        <div className="card-body text-center d-flex flex-column justify-content-center">
          <h3 className="h6 card-title text-muted">{title}</h3>
          {prediction ? (
            <>
              <p className={`${styles.predictionValue} ${getPredictionColor(metric, prediction.predictedValue, selectedChannel.alertThreshold)}`}>
                ~{metric === 'temperature' ? convertTemp(prediction.predictedValue).toFixed(1) : prediction.predictedValue.toFixed(2)} {unit}
              </p>
              <p className="mb-0">
                Trend: <span className="fw-bold text-capitalize">{prediction.trend}</span>
                <TrendIcon trend={prediction.trend} metric={metric} />
              </p>
            </>
          ) : (<p className="text-muted my-4">Not enough data to predict.</p>)}
        </div>
      </div>
    );
  };


  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'tempUnit') {
        setTempUnit(localStorage.getItem('tempUnit') || 'C');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const currentMonthName = monthNames[new Date().getMonth()];
  
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } } },
  };

  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoadingChannels(true);
      try {
        const rawChannels = await getAllChannels();
        const channels = rawChannels.map(ch => ({ ...ch, channelId: ch.ID, readAPIKey: ch.ReadAPI, name: ch.Name, ammoniaField: "field3", tempField: "field1" }));
        
        if (channels.length > 0) {
          const alerts = await fetchAllUserAlerts(channels);
          const uniqueBranches = [...new Set(channels.map(c => c.branchName))].sort();

          setAllAlerts(alerts);
          setAllChannels(channels);
          setBranchList(uniqueBranches);
          setSelectedBranch(uniqueBranches[0]);
        }
      } catch (error) {
        console.error("Error fetching initial data:", error);
      } finally {
        setIsLoadingChannels(false);
      }
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedBranch) {
      const channelsInBranch = allChannels.filter(c => c.branchName === selectedBranch).sort((a, b) => a.name.localeCompare(b.name));
      setFilteredChannels(channelsInBranch);
      const firstEnabledChannel = channelsInBranch.find(ch => ch.hasSensor);
      setSelectedChannelId(firstEnabledChannel ? firstEnabledChannel.channelId : '');
    } else {
      setFilteredChannels([]);
      setSelectedChannelId('');
    }
  }, [selectedBranch, allChannels]);

  useEffect(() => {
    const channel = allChannels.find(c => c.channelId === selectedChannelId) || null;
    setSelectedChannel(channel);
    if (channel && allAlerts.length > 0) {
      const filtered = allAlerts.filter(alert => alert.branchName === channel.branchName && alert.firestoreId === channel.firestoreId);
      setChannelAlerts(filtered);
    } else {
      setChannelAlerts([]);
    }
  }, [selectedChannelId, allChannels, allAlerts]);

  // Effect to fetch the device status for the selected channel
  useEffect(() => {
    if (!selectedChannel) {
      setDeviceStatus({ text: 'N/A', icon: 'bi-question-circle', colorClass: 'text-muted' });
      return;
    }
    if (!selectedChannel.hasSensor) {
      setDeviceStatus({ text: 'No Sensor', icon: 'bi-exclamation-circle', colorClass: 'text-muted' });
      return;
    }
    const getStatus = async () => {
      setDeviceStatus({ text: 'Checking...', icon: 'bi-arrow-repeat', colorClass: 'text-muted' });
      const status = await fetchDeviceStatus(selectedChannel);
      setDeviceStatus(status);
    };
    getStatus();
  }, [selectedChannel]);

  // Main data fetching effect for a selected channel
  useEffect(() => {
    if (!selectedChannel) {
      setInsights(null); setPredictions(null); setAllChartData(null);
      setAnnualSummaryData([]); setHourlyRawData(null);
      return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    const fetchAllData = async () => {
      setIsLoadingInsights(true); setIsLoadingPredictions(true); setIsLoadingCharts(true);
      setIsLoadingTable(true); setIsLoadingHourlyBar(true);
      setChartsReportTitleText("Loading Charts..."); setTableReportTitleText("Loading Table...");
      setHourlyBarTitleText("Loading Chart...");
      setInsights(null); setPredictions(null); setAnnualSummaryData([]); setHourlyRawData(null);

      const { channelId, readAPIKey, name: coopName, ammoniaField: afStr, tempField: tfStr, branchName, firestoreId } = selectedChannel;
      const ammoniaFieldNum = parseInt(afStr?.replace("field", ""), 10);
      const tempFieldNum = parseInt(tfStr?.replace("field", ""), 10);
      const now = new Date();

      try {
        // --- STAGE 1: Fetch core data for initial view (charts and daily predictions) ---
        const [dailyAmmonia, dailyTemp, weeklyAmmonia, weeklyTemp] = await Promise.all([
            fetchThingSpeakData(channelId, readAPIKey, ammoniaFieldNum, 1, signal),
            fetchThingSpeakData(channelId, readAPIKey, tempFieldNum, 1, signal),
            fetchThingSpeakData(channelId, readAPIKey, ammoniaFieldNum, 7, signal),
            fetchThingSpeakData(channelId, readAPIKey, tempFieldNum, 7, signal)
        ]);
        if (signal.aborted) return;
        
        const partialChartData = {
            daily: { ammonia: dailyAmmonia, temp: dailyTemp },
            weekly: { ammonia: weeklyAmmonia, temp: weeklyTemp },
        };
        setAllChartData(partialChartData);
        setIsLoadingCharts(false);

        setPredictions({
          daily: {
            ammonia: predictNext24Hours(weeklyAmmonia),
            temperature: predictNext24Hours(weeklyTemp)
          },
          weekly: null,
        });
        setIsLoadingPredictions(false);

        // --- STAGE 2: Fetch remaining data for insights, weekly predictions, and other reports ---
        const [thirtyDayAmmonia, thirtyDayTemp, monthlyAmmonia, monthlyTemp, annualData, hourlyAmmonia, hourlyTemp] = await Promise.all([
          fetchThingSpeakData(channelId, readAPIKey, ammoniaFieldNum, 30, signal),
          fetchThingSpeakData(channelId, readAPIKey, tempFieldNum, 30, signal),
          getMonthlyData(channelId, readAPIKey, ammoniaFieldNum, now.getMonth() + 1, now.getFullYear(), signal),
          getMonthlyData(channelId, readAPIKey, tempFieldNum, now.getMonth() + 1, now.getFullYear(), signal),
          getAnnualMinMaxData(branchName, firestoreId, CURRENT_YEAR, channelId, readAPIKey, ammoniaFieldNum, tempFieldNum, signal),
          fetchMonthlyHourlyPattern(channelId, readAPIKey, ammoniaFieldNum, now.getFullYear(), now.getMonth() + 1, signal),
          fetchMonthlyHourlyPattern(channelId, readAPIKey, tempFieldNum, now.getFullYear(), now.getMonth() + 1, signal)
        ]);
        if (signal.aborted) return;

        setAllChartData(prev => ({...prev, monthly: { ammonia: monthlyAmmonia, temp: monthlyTemp }}));
        setAnnualSummaryData(annualData);
        setHourlyRawData({ ammonia: hourlyAmmonia, temperature: hourlyTemp });
        setIsLoadingTable(false); setIsLoadingHourlyBar(false);
        setTableReportTitleText(`Annual Report - ${coopName}`);
        setHourlyBarTitleText(`Hourly Pattern for ${monthNames[now.getMonth()]} - ${coopName}`);

        setPredictions(prev => ({ ...prev, weekly: {
          ammonia: predictNext7Days(thirtyDayAmmonia),
          temperature: predictNext7Days(thirtyDayTemp)
        }}));

        setInsights(generateInsights({
          channel: selectedChannel, ...partialChartData,
          monthly: { ammonia: monthlyAmmonia, temp: monthlyTemp }, hourlyAmmonia, hourlyTemp, annualData,
          alerts: channelAlerts || [],
        }));
        setIsLoadingInsights(false);

      } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Error fetching analytics data:", err);
            setIsLoadingCharts(false); setIsLoadingTable(false); setIsLoadingHourlyBar(false);
            setIsLoadingInsights(false); setIsLoadingPredictions(false);
        }
      }
    };
    
    fetchAllData();
    return () => abortController.abort();
  }, [selectedChannel, channelAlerts]);

  // Effect to convert insights text to the selected temperature unit
  useEffect(() => {
    if (!insights) {
      setDisplayInsights(null);
      return;
    }
    if (tempUnit === 'C') {
      setDisplayInsights(insights);
      return;
    }
    const convertedInsights = JSON.parse(JSON.stringify(insights));
    for (const category in convertedInsights) {
      convertedInsights[category].insights.forEach(insight => {
        insight.text = insight.text.replace(/(\d+\.?\d*)°C/g, (match, tempC) => {
          return `${convertTemp(parseFloat(tempC)).toFixed(1)}${unitSymbol}`;
        });
      });
    }
    setDisplayInsights(convertedInsights);
  }, [insights, tempUnit, convertTemp, unitSymbol]);
  
  // Effect to update displayed chart based on activeTab
  useEffect(() => {
    if (isLoadingCharts || !allChartData || !selectedChannel) {
      setLineChartData({});
      setChartsReportTitleText(selectedChannel ? "Loading Charts..." : "Select a Poultry House");
      return;
    }
    const dataForTab = allChartData[activeTab === 'insights' ? 'monthly' : activeTab];
    if (!dataForTab) return;
  
    const formatLabels = (points) => points.map(p => {
      const date = new Date(p.created_at);
      if (activeTab === "daily") return format(date, "HH:mm");
      if (activeTab === "weekly") return format(date, "EEE");
      return format(date, "MMM dd");
    });
  
    const ammoniaPoints = dataForTab.ammonia || [];
    const tempPoints = dataForTab.temp || [];
    const convertedTempPoints = tempPoints.map(p => ({...p, value: convertTemp(p.value)}));
    
    const hasAmmonia = ammoniaPoints.length > 0;
    const hasTemp = tempPoints.length > 0;
    const sourcePoints = hasAmmonia ? ammoniaPoints : tempPoints;
  
    setLineChartData({
      ammonia: { labels: formatLabels(sourcePoints), datasets: [{ data: hasAmmonia ? ammoniaPoints.map(p => p.value) : [], borderColor: "rgba(0, 128, 0, 1)", backgroundColor: "rgba(0, 128, 0, 0.5)", fill: true, tension: 0.3, pointRadius: 2 }] },
      temp: { labels: formatLabels(sourcePoints), datasets: [{ data: hasTemp ? convertedTempPoints.map(p => p.value) : [], borderColor: "rgba(255, 149, 0, 1)", backgroundColor: "rgba(255, 149, 0, 0.5)", fill: true, tension: 0.3, pointRadius: 2 }] },
      hasAmmonia, hasTemp,
    });
    setChartsReportTitleText(`${chartTitleMap[activeTab] || "Report"} - ${selectedChannel.name}`);
  
  }, [activeTab, allChartData, isLoadingCharts, selectedChannel, convertTemp]);

  // Effect to process hourly data for the bar chart
  useEffect(() => {
    if (!hourlyRawData) { setHourlyBarData(null); return; }
    const labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ":00");
    const isAmmonia = selectedSensor === 'ammonia';
    
    const rawValues = isAmmonia ? hourlyRawData.ammonia : hourlyRawData.temperature;
    const dataValues = isAmmonia 
      ? labels.map(label => rawValues[label] ?? null)
      : labels.map(label => rawValues[label] !== null && rawValues[label] !== undefined ? convertTemp(rawValues[label]) : null);

    setHourlyBarData({
      labels,
      datasets: [{
        label: isAmmonia ? 'Average Ammonia (ppm)' : `Average Temperature (${unitSymbol})`,
        backgroundColor: isAmmonia ? 'rgba(0, 128, 0, 0.6)' : 'rgba(253, 126, 20, 0.6)',
        borderColor: isAmmonia ? 'rgba(0, 128, 0, 1)' : 'rgba(253, 126, 20, 1)',
        borderWidth: 1, data: dataValues,
      }],
    });
  }, [hourlyRawData, selectedSensor, convertTemp, unitSymbol]);

  const tempBarChartOptions = useMemo(() => ({
    responsive: true, maintainAspectRatio: false, 
    scales: { 
      y: { beginAtZero: false, min: convertTemp(10), max: convertTemp(40), title: { display: true, text: `Temperature (${unitSymbol})` } }, 
      x: { title: { display: true, text: 'Hour of Day' } } 
    }, 
    plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } }
  }), [convertTemp, unitSymbol]);

  const ammoniaBarChartOptions = {
    responsive: true, maintainAspectRatio: false,
    scales: {
        y: { beginAtZero: true, min: 0, max: 30, title: { display: true, text: 'Ammonia (ppm)' } },
        x: { title: { display: true, text: 'Hour of Day' } }
    },
    plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } }
  };

  // --- RENDER METHOD ---
  return (
    <div className="d-flex">
      <Sidebar isExpanded={isSidebarExpanded} toggleSidebar={toggleSidebar} />
      <main className={styles.mainContent} style={{ marginLeft: isSidebarExpanded ? '260px' : '70px' }}>
        {isLoadingChannels ? (
          <div className="container-fluid py-3 text-center"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div><p>Loading Branches and Poultry Houses...</p></div>
        ) : (
          <div className="container-fluid py-3">
            <div className={`d-flex justify-content-between align-items-center mb-4 ${styles.pageHeaderContainer}`}>
              <div className={styles.pageHeader}><h1 className="h3"><i className="bi bi-activity me-2"></i>Analytics</h1><p className={`${styles.textMuted} mb-0`}>Detailed data analysis and trends for poultry houses</p></div>
            </div>

            {branchList.length > 0 ? (
              <div className="d-flex align-items-end flex-wrap gap-3 mb-4 my-4 p-3 bg-white rounded shadow-sm">
                <div><label htmlFor="branchSelect" className="form-label fw-bold">Select Branch</label><select id="branchSelect" className={`form-select w-auto ${styles.coopSelect}`} value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} disabled={isLoadingChannels}>{branchList.map(branch => (<option key={branch} value={branch}>{branch}</option>))}</select></div>
                <div><label htmlFor="coopSelect" className="form-label fw-bold">Select Poultry House</label><select id="coopSelect" className={`form-select w-auto ${styles.coopSelect}`} value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)} disabled={isLoadingCharts || isLoadingTable || !selectedBranch || filteredChannels.length === 0}>
                    {filteredChannels.length > 0 ? (filteredChannels.map(channel => (<option key={channel.firestoreId} value={channel.channelId} disabled={!channel.hasSensor}>{channel.name}{!channel.hasSensor && " (No Sensor)"}</option>))) : (<option value="" disabled>No houses in this branch</option>)}
                  </select></div>
                  {selectedChannel && (
                    <div className={`${styles.deviceStatusIndicator} ${deviceStatus.colorClass}`}>
                      <i className={`bi ${deviceStatus.icon} me-2`}></i>
                      <strong>{deviceStatus.text}</strong>
                    </div>
                  )}
              </div>
            ) : (<div className="alert alert-warning">No poultry houses available. Please add one via the Poultry Houses page.</div>)}

            {selectedChannel && (
              <div className="card my-4">
                <div className="card-header bg-light d-flex align-items-center">
                  <i className="bi bi-lightbulb me-2 text-primary fs-4"></i>
                  <h2 className="h5 mb-0 fw-bold">Quick Insights for {selectedChannel.name}</h2>
                </div>
                <div className={`card-body ${styles.insightsContainer}`}>
                  {isLoadingInsights ? (
                    <div className="row">
                      {Array.from({ length: 3 }).map((_, index) => <InsightCardSkeleton key={index} />)}
                    </div>
                  ) : displayInsights ? (
                    <div className="row">
                      {Object.entries(displayInsights).map(([key, value]) => (
                        value.insights.length > 0 && (
                          <div className="col-12 col-md-6 col-lg-4 mb-4" key={key}>
                            <div className={`${styles.insightCard} card h-100 shadow-sm`} style={{ '--insight-color': value.color }}>
                              <div className="card-header d-flex align-items-center" style={{backgroundColor: value.color+'20', color: value.color}}>
                                <i className={`bi ${value.icon} me-2 fs-5`}></i><h3 className="h6 mb-0 fw-bold">{value.title}</h3>
                              </div>
                              <ul className="list-group list-group-flush">
                                {value.insights.map((insight, index) => (
                                  <li key={index} className="list-group-item d-flex align-items-start">
                                    <i className={`bi ${insight.icon} me-3 mt-1 fs-5`} style={{ color: value.color }}></i>
                                    <span><InsightText text={insight.text} /></span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  ) : ( <p className="text-muted mb-0 text-center p-4">Not enough data to generate insights for this poultry house.</p> )}
                </div>
              </div>
            )}
            
            {selectedChannel && (
              <div className="card my-4">
                <div className="card-header bg-light d-flex align-items-center">
                  <i className="bi bi-graph-up-arrow me-2 text-info fs-4"></i>
                  <h2 className="h5 mb-0 fw-bold">Forecast for {selectedChannel.name}</h2>
                </div>
                <div className={`card-body ${styles.predictionsContainer}`}>
                  {isLoadingPredictions ? (
                     <div className="row">
                        <PredictionCardSkeleton />
                        <PredictionCardSkeleton />
                    </div>
                  ) : predictions ? (
                    <>
                      <div className="d-flex justify-content-start mb-4">
                        <div className="btn-group" role="group">
                          <button type="button" className={`btn ${activePredictionTab === 'daily' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setActivePredictionTab('daily')}>Daily Forecast</button>
                          <button type="button" className={`btn ${activePredictionTab === 'weekly' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setActivePredictionTab('weekly')}>Weekly Forecast</button>
                        </div>
                      </div>

                      {activePredictionTab === 'daily' && (
                        <div className="row">
                          <div className="col-12 col-md-6 mb-3"><PredictionCard title="Ammonia (Next 24h)" prediction={predictions.daily?.ammonia} metric="ammonia" unit="ppm" /></div>
                          <div className="col-12 col-md-6 mb-3"><PredictionCard title="Temperature (Next 24h)" prediction={predictions.daily?.temperature} metric="temperature" unit={unitSymbol} /></div>
                        </div>
                      )}

                      {activePredictionTab === 'weekly' && (
                        <div className="row">
                          {predictions.weekly ? (
                            <>
                              <div className="col-12 col-md-6 mb-3"><PredictionCard title="Ammonia (Next 7 Days)" prediction={predictions.weekly?.ammonia} metric="ammonia" unit="ppm" /></div>
                              <div className="col-12 col-md-6 mb-3"><PredictionCard title="Temperature (Next 7 Days)" prediction={predictions.weekly?.temperature} metric="temperature" unit={unitSymbol} /></div>
                            </>
                          ) : (
                            <div className="col-12 text-center p-4">
                                <div className="spinner-border text-info" role="status"></div>
                                <p className="mt-2 mb-0">Generating weekly forecast...</p>
                            </div>
                          )}
                        </div>
                      )}
                      
                    </>
                  ) : (<p className="text-muted mb-0 text-center p-4">Not enough data to generate predictions for this poultry house.</p>)}
                </div>
              </div>
            )}

            {selectedChannel ? (
              <div className={`${styles.tableWrapper} bg-white p-3 rounded shadow-sm`}>
                <div className="card-header bg-white"><h2 className="h5 mb-0"><i className="bi bi-graph-up me-2"></i>Detailed Charts & Reports</h2></div>
                <div className="card-body mt-3">
                  <ul className="nav nav-pills mb-4" id="reportTypeTab" role="tablist">
                    <li className="nav-item" role="presentation"><button className={`nav-link ${activeTab === 'daily' ? 'active' : ''}`} onClick={() => setActiveTab('daily')} disabled={isLoadingCharts} role="tab"><i className="bi bi-calendar-day me-1"></i> Last 24 Hours</button></li>
                    <li className="nav-item" role="presentation"><button className={`nav-link ${activeTab === 'weekly' ? 'active' : ''}`} onClick={() => setActiveTab('weekly')} disabled={isLoadingCharts} role="tab"><i className="bi bi-calendar-week me-1"></i> Last 7 Days</button></li>
                    <li className="nav-item" role="presentation"><button className={`nav-link ${activeTab === 'insights' ? 'active' : ''}`} onClick={() => setActiveTab('insights')} disabled={isLoadingCharts} role="tab"><i className="bi bi-calendar-month me-1"></i> Current Month</button></li>
                  </ul>
                  
                  <div className="tab-content" id="reportTypeTabContent">
                    <div className="card mb-3"><div className="card-body">
                        <h3 className={`${styles.chartsReportTitle} h5`}>{isLoadingCharts ? (<span className="spinner-border spinner-border-sm text-primary me-2"></span>) : (<i className="bi bi-graph-up me-2"></i>)}{chartsReportTitleText}</h3>
                        <div className={styles.chartsRow}>
                          <div className={styles.chartWrapper}>
                            <h4 className={`${styles.chartTitle} h6`}>Ammonia Data Chart</h4>
                            <div className={styles.chartContainer}>
                              {isLoadingCharts ? (<div className="d-flex align-items-center justify-content-center h-100"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div></div>) 
                              : !lineChartData.hasAmmonia ? (<div className='p-5 h-100 d-flex align-items-center justify-content-center'><NoDataResponse message="No Ammonia Data Available" /></div>) 
                              : (<Line data={lineChartData.ammonia} options={{...chartOptions, scales:{...chartOptions.scales, y: {...chartOptions.scales.y, max: 25}}}} />)}
                            </div>
                          </div>
                          <div className={styles.chartWrapper}>
                            <h4 className={`${styles.chartTitle} h6`}>Temperature Data Chart</h4>
                            <div className={styles.temperatureChartContainer}>
                              {isLoadingCharts ? (<div className="d-flex align-items-center justify-content-center h-100"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div></div>) 
                              : !lineChartData.hasTemp ? (<div className='p-5 h-100 d-flex align-items-center justify-content-center'><NoDataResponse message="No Temperature Data Available" /></div>) 
                              : (<Line data={lineChartData.temp} options={chartOptions} />)}
                            </div>
                          </div>
                        </div>
                    </div></div>
                  </div>

                  <div id="barChartContainer"><div className={`card mb-4 ${styles.reportCard}`}><div className="card-body">
                    <h3 className={`${styles.chartsReportTitle} h5 d-flex justify-content-between align-items-center`}>
                      <div>{isLoadingHourlyBar ? (<span className="spinner-border spinner-border-sm text-primary me-2"></span>) : (<i className="bi bi-bar-chart-line me-2"></i>)}{hourlyBarTitleText}</div>
                      <div className="btn-group btn-group-sm" role="group">
                        <button type="button" className="btn" style={{ backgroundColor: selectedSensor === "ammonia" ? "#1F7A33" : "transparent", color: selectedSensor === "ammonia" ? "#fff" : "#1F7A33", border: `1px solid #1F7A33` }} onClick={() => setSelectedSensor("ammonia")}>Ammonia</button>
                        <button type="button" className="btn" style={{ backgroundColor: selectedSensor === "temperature" ? "#C05F07" : "transparent", color: selectedSensor === "temperature" ? "#fff" : "#C05F07", border: `1px solid #C05F07` }} onClick={() => setSelectedSensor("temperature")}>Temperature</button>
                      </div>
                    </h3>
                    <div style={{ height: '400px' }}>
                      {isLoadingHourlyBar ? (<div className="d-flex align-items-center justify-content-center h-100"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div></div>) 
                      : hourlyBarError ? (<div className="alert alert-danger d-flex align-items-center justify-content-center h-100">{hourlyBarError}</div>) 
                      : hourlyBarData && hourlyBarData.datasets[0]?.data.some(v => v !== null) ? (<Bar data={hourlyBarData} options={selectedSensor === 'ammonia' ? ammoniaBarChartOptions : tempBarChartOptions} />) 
                      : (<div className="d-flex align-items-center justify-content-center h-100"><NoDataResponse message={ selectedSensor === "ammonia"  ? "No Ammonia Data Available" : "No Temperature Data Available" }/></div>)}
                    </div>
                  </div></div></div>

                  <div id="annualTableContainer"><div className={`card mb-3 ${styles.reportCard} ${styles.annualCard}`}><div className="card-body"><h3 className={`${styles.tableReportTitle} h5`}>{isLoadingTable ? (<span className="spinner-border spinner-border-sm text-primary me-2"></span>) : (<i className="bi bi-calendar-event me-2"></i>)}{tableReportTitleText}</h3>
                  <div className={`table-responsive ${styles.tableResponsive}`}><table className={`table table-hover ${styles.annualTable}`}>
                    <thead>
                      <tr>
                        <th rowSpan="2" className={styles.monthHeader}>Month</th>
                        <th colSpan="3" className={`${styles.mainParameterHeader} ${styles.divider}`}>Ammonia (ppm)</th>
                        <th colSpan="3" className={styles.mainParameterHeader}>Temperature ({unitSymbol})</th>
                      </tr>
                      <tr>
                        <th className={styles.subParameterHeader}><i className="bi bi-graph-up me-1"></i>High</th>
                        <th className={styles.subParameterHeader}><i className="bi bi-graph-down me-1"></i>Low</th>
                        <th className={`${styles.subParameterHeader} ${styles.divider}`}><i className="bi bi-bar-chart-line me-1"></i>Avg</th>
                        <th className={styles.subParameterHeader}><i className="bi bi-graph-up me-1"></i>High</th>
                        <th className={styles.subParameterHeader}><i className="bi bi-graph-down me-1"></i>Low</th>
                        <th className={styles.subParameterHeader}><i className="bi bi-bar-chart-line me-1"></i>Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoadingTable ? (
                        Array.from({ length: 6 }).map((_, index) => <TableRowSkeleton key={index} />)
                      ) : annualSummaryData.length > 0 ? (
                        annualSummaryData.map((row, index) => {
                          const tempMax = row.tempMax ? convertTemp(parseFloat(row.tempMax)).toFixed(1) : null;
                          const tempMin = row.tempMin ? convertTemp(parseFloat(row.tempMin)).toFixed(1) : null;
                          const tempAvg = row.tempAvg ? convertTemp(parseFloat(row.tempAvg)).toFixed(1) : null;

                          return (
                            <tr key={index} className={row.month === currentMonthName ? styles.currentMonthRow : ''}>
                              <td>{row.month}</td>
                              <td className={!row.ammoniaMax ? styles.noDataCell : ''}>{row.ammoniaMax || 'No Data'}</td>
                              <td className={!row.ammoniaMin ? styles.noDataCell : ''}>{row.ammoniaMin || 'No Data'}</td>
                              <td className={`${styles.divider} ${!row.ammoniaAvg ? styles.noDataCell : ''}`.trim()}>{row.ammoniaAvg || 'No Data'}</td>
                              <td className={!tempMax ? styles.noDataCell : ''}>{tempMax || 'No Data'}</td>
                              <td className={!tempMin ? styles.noDataCell : ''}>{tempMin || 'No Data'}</td>
                              <td className={!tempAvg ? styles.noDataCell : ''}>{tempAvg || 'No Data'}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr><td colSpan="7" className="text-center p-4">No annual data for {selectedChannel?.name} for {CURRENT_YEAR}.</td></tr>
                      )}
                    </tbody>
                  </table></div>
                  </div></div></div>
                </div>
              </div>
            ) : (!isLoadingChannels && (
              <div className="alert alert-info mt-4">
                {branchList.length > 0 ? (selectedBranch && filteredChannels.length === 0 ? `There are no poultry houses configured for the '${selectedBranch}' branch.` : 'Please select a branch and a poultry house with a sensor to view analytics.') : 'No branches or poultry houses available. Please add one via the Poultry Houses page.'}
              </div>
            ))}
          </div>
        )}
      </main >
    </div >
  );
};

export default AnalyticsPage;