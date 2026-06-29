// src/pages/DashboardPage.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import AllAlertsModal from '../components/modals/AllAlertsModals';
import AcknowledgeAlertModal from '../components/modals/AcknowledgeAlertModal';
import AlertAnalysisModal from '../components/modals/AlertAnalysisModal'; // Added
import styles from '../styles/DashboardPage.module.css';
import { db } from '../firebase/firebaseConfig';
import { doc, runTransaction, collection, getDocs } from 'firebase/firestore';
import { getAllChannels } from '../firebase/channelService.js';
import { fetchAllUserAlerts } from '../firebase/fetch_alerts.js';
import { fetchDeviceStatus } from '../thingspeak/fetch_status.js';
import { updateDashboardVisuals, createOrClearChart } from '../utils/dashboardMiniChart.js';

// Determines status badge based on value and thresholds (dynamic or default).
const getStatus = (value, type, alertThresholds = {}) => {
  if (isNaN(value) || value === null) return { badgeClass: 'bg-secondary', text: 'N/A' };

  if (type === 'ammonia') {
    const dangerHigh = parseFloat(alertThresholds?.ammoniaHigh);
    
    // Use dynamic thresholds if available, otherwise fallback to defaults
    if (!isNaN(dangerHigh)) {
      const warnHigh = dangerHigh * 0.8; // Warning starts at 80% of danger level
      if (value >= dangerHigh) return { badgeClass: 'bg-danger', text: 'Danger' };
      if (value >= warnHigh) return { badgeClass: 'bg-warning text-dark', text: 'Warning' };
      return { badgeClass: 'bg-success', text: 'Safe' };
    } else {
      // Fallback to hardcoded defaults
      if (value >= 25) return { badgeClass: 'bg-danger', text: 'Danger' };
      if (value >= 10) return { badgeClass: 'bg-warning text-dark', text: 'Warning' };
      return { badgeClass: 'bg-success', text: 'Safe' };
    }
  }

  if (type === 'temperature') {
    const dangerHigh = parseFloat(alertThresholds?.tempHigh);
    const dangerLow = parseFloat(alertThresholds?.tempLow);
    
    // Use dynamic thresholds if available, otherwise fallback to defaults
    if (!isNaN(dangerHigh) && !isNaN(dangerLow)) {
      const tempWarningBuffer = 2.0; // 2 degrees Celsius buffer for warning
      const warnHigh = dangerHigh - tempWarningBuffer;
      const warnLow = dangerLow + tempWarningBuffer;

      if (value >= dangerHigh || value <= dangerLow) return { badgeClass: 'bg-danger', text: 'Danger' };
      if (value > warnHigh || value < warnLow) return { badgeClass: 'bg-warning text-dark', text: 'Warning' };
      return { badgeClass: 'bg-success', text: 'Safe' };
    } else {
      // Fallback to hardcoded defaults
      if (value >= 28 || value <= 20) return { badgeClass: 'bg-danger', text: 'Danger' };
      if (value > 26 || value < 22) return { badgeClass: 'bg-warning text-dark', text: 'Warning' };
      return { badgeClass: 'bg-success', text: 'Safe' };
    }
  }

  // Default return for unknown type
  return { badgeClass: 'bg-secondary', text: 'N/A' };
};

const tempThresholds = { danger_high: 28, danger_low: 20, warn_high: 26, warn_low: 22 };

// Renders the main dashboard for real-time monitoring.
const DashboardPage = () => {
  const navigate = useNavigate();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [tempUnit, setTempUnit] = useState(localStorage.getItem('tempUnit') || 'C');

  const [branches, setBranches] = useState([]);
  const [channels, setChannels] = useState([]);
  const [allUserAlerts, setAllUserAlerts] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  
  const [selectedBranch, setSelectedBranch] = useState('');
  const [filteredChannels, setFilteredChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [selectedChannelDetails, setSelectedChannelDetails] = useState(null);
  const [selectedChannelStatus, setSelectedChannelStatus] = useState({ text: 'Checking...', icon: 'bi-question-circle', colorClass: 'text-muted' });
  const [currentAmmonia, setCurrentAmmonia] = useState('-- ppm');
  const [currentTemp, setCurrentTemp] = useState('-- °C');
  const [ammoniaStatus, setAmmoniaStatus] = useState({ badgeClass: 'bg-secondary', text: 'N/A' });
  const [tempStatus, setTempStatus] = useState({ badgeClass: 'bg-secondary', text: 'N/A' });
  const [performanceSummary, setPerformanceSummary] = useState({ highestAmmoniaVal: null, highestAmmoniaTime: '--', lowestAmmoniaVal: null, lowestAmmoniaTime: '--', highestTempVal: null, highestTempTime: '--', lowestTempVal: null, lowestTempTime: '--' });

  const [ammoniaRangeText, setAmmoniaRangeText] = useState('Normal Range: 0-20ppm');
  const [tempRangeText, setTempRangeText] = useState('');

  const [healthOverviewBranch, setHealthOverviewBranch] = useState('');
  const [coopHealthData, setCoopHealthData] = useState([]);
  const [isHealthDataLoading, setIsHealthDataLoading] = useState(false);
  const [healthOverviewStats, setHealthOverviewStats] = useState({ onlineCount: 0, totalCount: 0, overallHealth: 'N/A' });

  const [isLoading, setIsLoading] = useState(true);
  const [isDashboardDataLoading, setIsDashboardDataLoading] = useState(false);
  const [error, setError] = useState(null);

  const ammoniaMiniChartRef = useRef(null);
  const tempMiniChartRef = useRef(null);
  const ammoniaChartInstanceRef = useRef(null);
  const tempChartInstanceRef = useRef(null);

  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [isAcknowledgeModalOpen, setIsAcknowledgeModalOpen] = useState(false);
  const [alertToAcknowledge, setAlertToAcknowledge] = useState(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [alertForAnalysis, setAlertForAnalysis] = useState(null);
  const [toastInfo, setToastInfo] = useState({ show: false, message: "", type: "success" });
  const toastRef = useRef(null);
  const [wasAllAlertsModalOpen, setWasAllAlertsModalOpen] = useState(false);

  const toggleSidebar = () => setIsSidebarExpanded(!isSidebarExpanded);

  const { unitSymbol, convertTemp } = useMemo(() => {
    const unit = localStorage.getItem('tempUnit') || 'C';
    const symbol = unit === 'C' ? '°C' : '°F';
    const convert = (celsius) => {
      if (unit === 'F' && typeof celsius === 'number' && !isNaN(celsius)) {
        return celsius * 9 / 5 + 32;
      }
      return celsius;
    };
    return {
      unitSymbol: symbol,
      convertTemp: convert,
    };
  }, [tempUnit]);

  useEffect(() => {
    const thresholds = selectedChannelDetails?.alertThreshold;

    const defaultTempLow = Math.round(convertTemp(tempThresholds.warn_low));
    const defaultTempHigh = Math.round(convertTemp(tempThresholds.warn_high));
    const defaultTempRange = `Ideal Range: ${defaultTempLow}-${defaultTempHigh}${unitSymbol}`;

    if (thresholds && Object.keys(thresholds).length > 0) {
      const ammoniaHigh = parseFloat(thresholds.ammoniaHigh);
      setAmmoniaRangeText(
        !isNaN(ammoniaHigh) 
        ? `Normal Range: 0-${ammoniaHigh}ppm` 
        : 'Normal Range: 0-20ppm'
      );

      const tempLow = parseFloat(thresholds.tempLow);
      const tempHigh = parseFloat(thresholds.tempHigh);

      if (!isNaN(tempLow) && !isNaN(tempHigh)) {
        const convertedLow = Math.round(convertTemp(tempLow));
        const convertedHigh = Math.round(convertTemp(tempHigh));
        setTempRangeText(`Ideal Range: ${convertedLow}-${convertedHigh}${unitSymbol}`);
      } else {
        setTempRangeText(defaultTempRange);
      }
    } else {
      setAmmoniaRangeText('Normal Range: 0-20ppm');
      setTempRangeText(defaultTempRange);
    }
  }, [selectedChannelDetails, convertTemp, unitSymbol]);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'tempUnit') {
        setTempUnit(localStorage.getItem('tempUnit') || 'C');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  const getBadgeDetailsForAlertType = useCallback((alertType) => {
    let iconClass = 'bi-info-circle-fill', iconColorClass = 'text-secondary';
    switch (alertType?.toLowerCase()) {
      case 'temperature': iconClass = 'bi-thermometer-half'; iconColorClass = 'text-warning'; break;
      case 'ammonia': iconClass = 'bi-wind'; iconColorClass = 'text-success'; break;
      case 'both': iconClass = 'bi-exclamation-triangle-fill'; iconColorClass = 'text-danger'; break;
      default: iconClass = 'bi-info-circle-fill'; iconColorClass = 'text-info'; break;
    }
    return { iconClass, iconColorClass };
  }, []);

  const loadAlerts = useCallback(async (allChannelsData) => {
    const freshAlerts = await fetchAllUserAlerts(allChannelsData);
    setAllUserAlerts(freshAlerts);
    const unacknowledged = freshAlerts.filter(a => !a.isAcknowledge);
    setRecentAlerts(unacknowledged.slice(0, 5));
  }, []);

  const updateDashboardCards = useCallback(async (channelConfig) => {
    const resetValues = () => {
      setCurrentAmmonia("-- ppm");
      setCurrentTemp(`-- ${unitSymbol}`);
      setAmmoniaStatus({ badgeClass: 'bg-secondary', text: 'N/A' });
      setTempStatus({ badgeClass: 'bg-secondary', text: 'N/A' });
    };

    if (!channelConfig || !channelConfig.ID || !channelConfig.ReadAPI) {
      resetValues();
      return;
    }

    try {
      const response = await fetch(`https://api.thingspeak.com/channels/${channelConfig.ID}/feeds.json?api_key=${channelConfig.ReadAPI}&results=1`);
      if (!response.ok) throw new Error(`ThingSpeak API error: ${response.status}`);
      
      const data = await response.json();
      const latestFeed = data.feeds?.[0];

      if (latestFeed) {
        const readingTime = new Date(latestFeed.created_at);
        const now = new Date();
        const secondsSinceReading = (now.getTime() - readingTime.getTime()) / 1000;

        if (secondsSinceReading <= 30) {
          const ammoniaField = channelConfig.AmmoniaField || 'field3';
          const tempField = channelConfig.TempField || 'field1';
          const ammoniaValue = parseFloat(latestFeed[ammoniaField]);
          const tempValue = parseFloat(latestFeed[tempField]);
          const dynamicThresholds = channelConfig.alertThreshold || {};

          setCurrentAmmonia(isNaN(ammoniaValue) ? "-- ppm" : `${ammoniaValue.toFixed(1)} ppm`);
          setCurrentTemp(isNaN(tempValue) ? `-- ${unitSymbol}` : `${convertTemp(tempValue).toFixed(1)} ${unitSymbol}`);
          setAmmoniaStatus(getStatus(ammoniaValue, 'ammonia', dynamicThresholds));
          setTempStatus(getStatus(tempValue, 'temperature', dynamicThresholds));
        } else {
          resetValues(); // Data is older than 30 seconds
        }
      } else {
        resetValues(); // No data found
      }
    } catch (error) {
      console.error("Error fetching latest readings for dashboard cards:", error);
      setCurrentAmmonia("Error");
      setCurrentTemp("Error");
      setAmmoniaStatus({ badgeClass: 'bg-danger', text: 'Error' });
      setTempStatus({ badgeClass: 'bg-danger', text: 'Error' });
    }
  }, [convertTemp, unitSymbol]);
  
  const resetDashboardVisuals = useCallback(() => {
    setCurrentAmmonia('-- ppm');
    setCurrentTemp(`-- ${unitSymbol}`);
    setAmmoniaStatus({ badgeClass: 'bg-secondary', text: 'N/A' });
    setTempStatus({ badgeClass: 'bg-secondary', text: 'N/A' });
    updateDashboardVisuals({ channelConfig: null, ammoniaMiniChartRef, tempMiniChartRef, ammoniaChartInstanceRef, tempChartInstanceRef, setPerformanceSummary });
  }, [unitSymbol]);

  useEffect(() => {
    setIsLoading(true);
    const initialize = async () => {
      try {
        const branchDocs = await getDocs(collection(db, 'poultryHouses'));
        const branchNames = branchDocs.docs.map(doc => doc.id).sort();
        if (branchNames.length === 0) throw new Error("No branches found. Please add a branch and poultry house configuration.");
        
        setBranches(branchNames);
        setSelectedBranch(branchNames[0]);
        setHealthOverviewBranch(branchNames[0]);
        const allFetchedChannels = await getAllChannels();
        if (allFetchedChannels.length === 0) setError("No poultry houses found across all branches.");
        setChannels(allFetchedChannels);
        await loadAlerts(allFetchedChannels);
      } catch (err) {
        setError(err.message);
        createOrClearChart(ammoniaMiniChartRef, ammoniaChartInstanceRef);
        createOrClearChart(tempMiniChartRef, tempChartInstanceRef);
      } finally {
        setIsLoading(false);
      }
    };
    initialize();
    return () => { 
        ammoniaChartInstanceRef.current?.destroy(); 
        tempChartInstanceRef.current?.destroy(); 
    };
  }, [loadAlerts]);

  useEffect(() => {
    if (!selectedBranch || channels.length === 0) {
        setFilteredChannels([]);
        setSelectedChannelId('');
        return;
    }
    const channelsForBranch = channels.filter(ch => ch.branchName === selectedBranch).sort((a, b) => a.Name.localeCompare(b.Name));
    setFilteredChannels(channelsForBranch);

    const firstEnabledChannel = channelsForBranch.find(ch => ch.hasSensor);
    if (firstEnabledChannel) {
        setSelectedChannelId(firstEnabledChannel.firestoreId);
    } else if (channelsForBranch.length > 0) {
        setSelectedChannelId(channelsForBranch[0].firestoreId);
    } else {
        setSelectedChannelId('');
        setSelectedChannelDetails(null);
        resetDashboardVisuals();
    }
  }, [selectedBranch, channels, resetDashboardVisuals]);

  // This effect finds the correct channel configuration when the user selection changes.
  useEffect(() => {
    if (!selectedChannelId || !selectedBranch) {
      setSelectedChannelDetails(null);
      return;
    }

    const channel = channels.find(ch => ch.firestoreId === selectedChannelId && ch.branchName === selectedBranch);
    setSelectedChannelDetails(channel);

    if (channel && !channel.hasSensor) {
      setSelectedChannelStatus({ text: 'No Sensor', icon: 'bi-exclamation-circle', colorClass: 'text-muted' });
      resetDashboardVisuals();
    }
  }, [selectedChannelId, selectedBranch, channels, resetDashboardVisuals]);

  // This effect handles all data fetching for the selected channel.
  // It runs when the channel changes, on a 15s interval, and when the tab becomes visible.
  useEffect(() => {
    if (!selectedChannelDetails || !selectedChannelDetails.hasSensor) {
      return; // Do nothing if no channel is selected or it has no sensor.
    }

    const refetchData = async () => {
      setIsDashboardDataLoading(true);
      await Promise.all([
        fetchDeviceStatus(selectedChannelDetails).then(setSelectedChannelStatus),
        updateDashboardCards(selectedChannelDetails),
        updateDashboardVisuals({ 
          channelConfig: selectedChannelDetails, 
          ammoniaMiniChartRef, 
          tempMiniChartRef, 
          ammoniaChartInstanceRef, 
          tempChartInstanceRef, 
          setPerformanceSummary 
        })
      ]);
      setIsDashboardDataLoading(false);
    };

    refetchData(); // Fetch data immediately when the component mounts or channel changes.

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchData();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(refetchData, 15000); // Refresh every 15 seconds.

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [selectedChannelDetails, updateDashboardCards]);

  useEffect(() => {
    const populateHealthOverview = async () => {
        if (!healthOverviewBranch || channels.length === 0) {
            setCoopHealthData([]);
            setHealthOverviewStats({ onlineCount: 0, totalCount: 0, overallHealth: 'N/A' });
            return;
        }
        setIsHealthDataLoading(true);
        const coopsForTable = channels.filter(ch => ch.branchName === healthOverviewBranch);

        if (coopsForTable.length === 0) {
            setCoopHealthData([]);
            setHealthOverviewStats({ onlineCount: 0, totalCount: 0, overallHealth: 'Safe' });
            setIsHealthDataLoading(false);
            return;
        }

        const healthPromises = coopsForTable.map(async (channel) => {
            if (!channel.hasSensor) {
              return { 
                firestoreId: channel.firestoreId, name: channel.Name, branchName: channel.branchName, hasSensor: false,
                ammoniaStatus: { text: 'N/A', class: 'bg-secondary' }, 
                tempStatus: { text: 'N/A', class: 'bg-secondary' }, 
                deviceStatus: { text: 'Not Installed', class: 'bg-secondary' }
              };
            }
            const ammoniaAlerts = allUserAlerts.filter(a => !a.isAcknowledge && a.firestoreId === channel.firestoreId && (a.type?.toLowerCase() === 'ammonia' || a.type?.toLowerCase() === 'both'));
            const tempAlerts = allUserAlerts.filter(a => !a.isAcknowledge && a.firestoreId === channel.firestoreId && (a.type?.toLowerCase() === 'temperature' || a.type?.toLowerCase() === 'both'));
            const ammoniaStatus = ammoniaAlerts.length > 0 ? { text: 'Warning', class: 'bg-warning text-dark' } : { text: 'Safe', class: 'bg-success' };
            const tempStatus = tempAlerts.length > 0 ? { text: 'Warning', class: 'bg-warning text-dark' } : { text: 'Safe', class: 'bg-success' };
            const statusResult = await fetchDeviceStatus(channel);
            const deviceStatus = { text: statusResult.text, class: statusResult.colorClass.replace('text-', 'bg-') };
            return { firestoreId: channel.firestoreId, name: channel.Name, branchName: channel.branchName, hasSensor: true, ammoniaStatus, tempStatus, deviceStatus };
        });

        const allHealthResults = (await Promise.allSettled(healthPromises))
            .filter(r => r.status === 'fulfilled').map(r => r.value);
            
        const onlineCount = allHealthResults.filter(coop => coop.deviceStatus.text === 'Online').length;
        const totalCount = coopsForTable.length;
        const hasWarning = allHealthResults.some(coop => coop.ammoniaStatus.text === 'Warning' || coop.tempStatus.text === 'Warning');
        const overallHealth = hasWarning ? 'Warning' : 'Safe';
        setHealthOverviewStats({ onlineCount, totalCount, overallHealth });

        setCoopHealthData(allHealthResults.sort((a, b) => a.name.localeCompare(b.name)));
        setIsHealthDataLoading(false);
    };
    populateHealthOverview();
  }, [healthOverviewBranch, channels, allUserAlerts]);

  useEffect(() => {
    if (toastRef.current && toastInfo.show) {
      const toast = new window.bootstrap.Toast(toastRef.current, { delay: 3000 });
      toast.show();
      const handleHidden = () => setToastInfo(prev => ({ ...prev, show: false }));
      toastRef.current.addEventListener('hidden.bs.toast', handleHidden, { once: true });
    }
  }, [toastInfo]);

  useEffect(() => {
    document.body.classList.toggle(styles.modalOpenBlur, isAlertModalOpen || isAcknowledgeModalOpen || isAnalysisModalOpen);
    return () => document.body.classList.remove(styles.modalOpenBlur);
  }, [isAlertModalOpen, isAcknowledgeModalOpen, isAnalysisModalOpen]);

  const handleBranchChange = e => setSelectedBranch(e.target.value);
  const handleChannelChange = e => setSelectedChannelId(e.target.value);
  const handleHealthBranchChange = e => setHealthOverviewBranch(e.target.value);

  const handleOpenAcknowledgeModal = (alert) => {
    if (isAlertModalOpen) {
      setIsAlertModalOpen(false);
      setWasAllAlertsModalOpen(true);
    }
    setAlertToAcknowledge(alert);
    setIsAcknowledgeModalOpen(true);
  };

  const handleOpenAnalysisModal = (alert) => {
    if (isAlertModalOpen) {
        setIsAlertModalOpen(false);
        setWasAllAlertsModalOpen(true);
    }
    setAlertForAnalysis(alert);
    setIsAnalysisModalOpen(true);
  };

  const handleCloseAcknowledgeModal = () => {
    setIsAcknowledgeModalOpen(false);
    setAlertToAcknowledge(null);
    if (wasAllAlertsModalOpen) {
      setIsAlertModalOpen(true);
      setWasAllAlertsModalOpen(false);
    }
  };

  const handleCloseAnalysisModal = () => {
    setIsAnalysisModalOpen(false);
    setAlertForAnalysis(null);
    if (wasAllAlertsModalOpen) {
      setIsAlertModalOpen(true);
      setWasAllAlertsModalOpen(false);
    }
  };

  const handleConfirmAcknowledge = async (actionsTaken) => {
    if (!alertToAcknowledge) return;
    const { branchName, firestoreId, originalAlert } = alertToAcknowledge;

    if (!branchName || !firestoreId || !originalAlert) {
      console.error("Invalid alert object for acknowledgment:", alertToAcknowledge);
      setToastInfo({ show: true, message: "Could not acknowledge: invalid data.", type: "danger" });
      return;
    }
    const branchDocRef = doc(db, "poultryHouses", branchName);

    try {
      await runTransaction(db, async (transaction) => {
        const branchSnapshot = await transaction.get(branchDocRef);
        if (!branchSnapshot.exists()) throw new Error("Branch document not found!");

        const data = branchSnapshot.data();
        const alerts = data.houses?.withSensor?.[firestoreId]?.alerts || [];

        let alertFound = false;
        const updatedAlerts = alerts.map(alert => {
          if (alert.timestamp && originalAlert.timestamp &&
              alert.timestamp.isEqual(originalAlert.timestamp) &&
              alert.message === originalAlert.message &&
              !alert.isAcknowledge) {
            alertFound = true;
            return { ...alert, isAcknowledge: true, actionTaken: actionsTaken };
          }
          return alert;
        });

        if (alertFound) {
          const fieldPath = `houses.withSensor.${firestoreId}.alerts`;
          transaction.update(branchDocRef, { [fieldPath]: updatedAlerts });
        } else {
          throw new Error("Alert not found or already acknowledged.");
        }
      });
      setToastInfo({ show: true, message: "Alert acknowledged!", type: "success" });
      await loadAlerts(channels);
    } catch (e) {
      console.error("Error acknowledging alert:", e);
      setToastInfo({ show: true, message: `Failed to acknowledge: ${e.message}`, type: "danger" });
    } finally {
      handleCloseAcknowledgeModal();
    }
  };
  
  // Formats performance summary values for display.
  const formatSummaryValue = (value, unit, conversionFn = val => val) => {
    if (value === null) return `-- ${unit}`;
    if (typeof value === 'number') return `${conversionFn(value).toFixed(1)} ${unit}`;
    return value; // Handles 'Error' string
  };

  if (isLoading) {
    return (
      <div className="wrapper d-flex">
        <Sidebar isExpanded={isSidebarExpanded} toggleSidebar={toggleSidebar} />
        <div className={styles.mainContent} style={{ marginLeft: isSidebarExpanded ? '260px' : '70px' }}>
          <div className={`container-fluid py-3 d-flex justify-content-center align-items-center vh-100`}>
            <div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wrapper d-flex">
        <Sidebar isExpanded={isSidebarExpanded} toggleSidebar={toggleSidebar} />
        <div className={styles.mainContent} style={{ marginLeft: isSidebarExpanded ? '260px' : '70px' }}>
          <div className="container-fluid py-3">
            <div className="alert alert-danger" role="alert"><h4><i className="bi bi-exclamation-triangle-fill me-2"></i>Dashboard Error</h4><p>{error}</p><button onClick={() => window.location.reload()} className="btn btn-primary">Try Again</button></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrapper d-flex">
      <Sidebar isExpanded={isSidebarExpanded} toggleSidebar={toggleSidebar} />
      <main className={styles.mainContent} style={{ marginLeft: isSidebarExpanded ? '260px' : '70px' }}>
        <div className={styles.toastContainer}>
            <div ref={toastRef} className={`toast align-items-center text-white bg-${toastInfo.type} border-0`} role="alert" aria-live="assertive" aria-atomic="true">
                <div className="d-flex">
                    <div className="toast-body">{toastInfo.message}</div>
                    <button type="button" className="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        </div>
        <div className="container-fluid py-3">
          <div className={`d-flex align-items-center mb-4 ${styles.pageHeaderContainer}`}>
            <div className={styles.pageHeader}>
              <h1 className="h3"><i className="bi bi-bar-chart me-2"></i>Dashboard</h1>
              <p className={`${styles.textMuted} mb-0`}>Real-time poultry environment monitoring overview</p>
            </div>
          </div>
          <div className={`card ${styles.monitoringCard}`} style={{ marginBottom: '2.5rem' }}>
            <div className={`card-header bg-white d-flex justify-content-between align-items-center ${styles.cardHeader}`}>
              <div>
                <h2 className="h5 mb-1 fw-bold"><i className="bi bi-bar-chart-fill me-2"></i>Monitor Environment</h2>
                <small className={`${styles.textMuted} mb-0`}>Track ammonia and temperature levels in a poultry house</small>
              </div>
              {isDashboardDataLoading && <div className="spinner-border spinner-border-sm text-primary" role="status"><span className="visually-hidden">Loading data...</span></div>}
            </div>

            <div className="row g-3 align-items-end px-3 pt-3">
                <div className="col-md-auto">
                  <label htmlFor="branchSelect" className="form-label">Choose Branch</label>
                  <select id="branchSelect" className={`form-select w-auto ${styles.coopSelect}`} value={selectedBranch} onChange={handleBranchChange} disabled={branches.length === 0 || isLoading}>
                    {branches.length === 0 ? <option value="">No Branches Found</option> : branches.map(branchName => <option key={branchName} value={branchName}>{branchName}</option>)}
                  </select>
                </div>
                <div className="col-md-auto">
                  <label htmlFor="coopSelect" className="form-label">Select Poultry House</label>
                  <select id="coopSelect" className={`form-select w-auto ${styles.coopSelect}`} value={selectedChannelId} onChange={handleChannelChange} disabled={filteredChannels.length === 0 || isDashboardDataLoading}>
                    {filteredChannels.length === 0 
                      ? <option value="">{selectedBranch ? 'No Poultry Houses in this Branch' : 'Select a Branch First'}</option> 
                      : filteredChannels.map(channel => (
                          <option key={channel.firestoreId} value={channel.firestoreId} disabled={!channel.hasSensor}>
                              {channel.Name}{!channel.hasSensor && " (No Sensor)"}
                          </option>
                      ))
                    }
                  </select>
                </div>
                {selectedChannelId && (
                  <div className="col-md-auto">
                    <div className={`${styles.deviceStatusIndicator} ${selectedChannelStatus.colorClass}`}>
                      <i className={`bi ${selectedChannelStatus.icon} me-2`}></i>
                      <strong>{selectedChannelStatus.text}</strong>
                    </div>
                  </div>
                )}
            </div>

            <div className={`card-body ${styles.cardBody}`}>
              <div className="row g-3 mb-3">
                <div className="col-md-6">
                  <div className={`card ${styles.statusCard} ${styles.statusSafe} h-100`}>
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-center">
                        <div><h3 className="h5 card-title mb-1">Ammonia Levels</h3><p className={`mb-0 ${styles.readingSubtitle}`}>{ammoniaRangeText}</p></div>
                        <span className={`badge ${ammoniaStatus.badgeClass}`}>{ammoniaStatus.text}</span>
                      </div>
                      <h2 className={`mt-2 mb-1 ${styles.currentReading}`} id="currentAmmoniaVal">{currentAmmonia}</h2>
                      <div className={styles.miniGraph}><canvas ref={ammoniaMiniChartRef} id="ammoniaMiniChart"></canvas></div>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className={`card ${styles.statusCard} ${styles.statusWarning} h-100`}>
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-center">
                        <div><h3 className="h5 card-title mb-1">Temperature Levels</h3><p className={`mb-0 ${styles.readingSubtitle}`}>{tempRangeText}</p></div>
                        <span className={`badge ${tempStatus.badgeClass}`}>{tempStatus.text}</span>
                      </div>
                      <h2 className={`mt-2 mb-1 ${styles.currentReading}`} id="currentTempVal">{currentTemp}</h2>
                      <div className={styles.miniGraph}><canvas ref={tempMiniChartRef} id="tempMiniChart"></canvas></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className={`row g-3 ${styles.statCardRow}`}>
                <div className={`col-md-3 col-6 ${styles.statCardCol}`}><div className={`card ${styles.statCard} ${styles.statCardAmmoniaHigh}`}><div className="card-body"><i className={`bi bi-graph-up-arrow ${styles.statCardIcon}`}></i><h6 className="card-subtitle mb-2 text-muted">Today's Highest Ammonia</h6><h4 id="highestAmmoniaVal" className="card-title">{formatSummaryValue(performanceSummary.highestAmmoniaVal, 'ppm')}</h4><p id="highestAmmoniaTime" className="card-text small">{performanceSummary.highestAmmoniaTime}</p></div></div></div>
                <div className={`col-md-3 col-6 ${styles.statCardCol}`}><div className={`card ${styles.statCard} ${styles.statCardAmmoniaLow}`}><div className="card-body"><i className={`bi bi-graph-down-arrow ${styles.statCardIcon}`}></i><h6 className="card-subtitle mb-2 text-muted">Today's Lowest Ammonia</h6><h4 id="lowestAmmoniaVal" className="card-title">{formatSummaryValue(performanceSummary.lowestAmmoniaVal, 'ppm')}</h4><p id="lowestAmmoniaTime" className="card-text small">{performanceSummary.lowestAmmoniaTime}</p></div></div></div>
                <div className={`col-md-3 col-6 ${styles.statCardCol}`}><div className={`card ${styles.statCard} ${styles.statCardTempHigh}`}><div className="card-body"><i className={`bi bi-graph-up-arrow ${styles.statCardIcon}`}></i><h6 className="card-subtitle mb-2 text-muted">Today's Highest Temperature</h6><h4 id="highestTempVal" className="card-title">{formatSummaryValue(performanceSummary.highestTempVal, unitSymbol, convertTemp)}</h4><p id="highestTempTime" className="card-text small">{performanceSummary.highestTempTime}</p></div></div></div>
                <div className={`col-md-3 col-6 ${styles.statCardCol}`}><div className={`card ${styles.statCard} ${styles.statCardTempLow}`}><div className="card-body"><i className={`bi bi-graph-down-arrow ${styles.statCardIcon}`}></i><h6 className="card-subtitle mb-2 text-muted">Today's Lowest Temperature</h6><h4 id="lowestTempVal" className="card-title">{formatSummaryValue(performanceSummary.lowestTempVal, unitSymbol, convertTemp)}</h4><p id="lowestTempTime" className="card-text small">{performanceSummary.lowestTempTime}</p></div></div></div>
              </div>
            </div>
          </div>
          <div className={`card ${styles.alertCard}`} style={{ marginBottom: '2.5rem' }}>
            <div className={`card-header bg-white d-flex justify-content-between align-items-center ${styles.cardHeader}`}>
              <div><h2 className="h5 mb-0 fw-bold"><i className="bi bi-exclamation-triangle-fill me-2"></i>Recent Active Alerts</h2><small className={styles.textMuted}>Recent alerts from all poultry houses</small></div>
              <button id="viewAllAlertsBtn" className="btn btn-sm btn-outline-danger" onClick={() => setIsAlertModalOpen(true)} disabled={allUserAlerts.length === 0}>View All</button>
            </div>
            <div className={`card-body ${styles.cardBody}`}>
              <div className="table-responsive">
                <table className={`table table-hover ${styles.alertsTable}`}>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Warning</th>
                      <th scope="col">Branch</th>
                      <th scope="col">Poultry House</th>
                      <th scope="col">Message</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAlerts.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center text-muted py-3">No active alerts.</td>
                      </tr>
                    ) : (
                      recentAlerts.map(alert => {
                        const { iconClass, iconColorClass } = getBadgeDetailsForAlertType(alert.type);
                        const warningType = alert.type?.toLowerCase() === 'both' 
                          ? <>Ammonia &<br />Temperature</> 
                          : <span className="text-capitalize">{alert.type}</span>;
                        return (
                          <tr key={alert.id}>
                            <td className="text-nowrap"><span className={`badge bg-danger ${styles.alertTimeBadge}`}>{alert.time}</span></td>
                            <td><div className={`d-flex align-items-center justify-content-center gap-2 ${styles.alertTypeCell}`}><i className={`${iconClass} ${iconColorClass} fs-4`}></i>{warningType}</div></td>
                            <td>{alert.branchName}</td>
                            <td>{alert.channelName}</td>
                            <td className="fw-bold">{alert.message}</td>
                            <td className="text-nowrap">
                                <button className="btn btn-outline-primary me-2" title={`Analyze Alert: ${alert.message}`} aria-label={`Analyze Alert: ${alert.message}`} onClick={(e) => { e.stopPropagation(); handleOpenAnalysisModal(alert); }}>
                                    <i className="bi bi-clipboard2-data"></i>
                                </button>
                               <button className="btn btn-outline-success" title={`Acknowledge Alert: ${alert.message}`} aria-label={`Acknowledge Alert: ${alert.message}`} onClick={(e) => { e.stopPropagation(); handleOpenAcknowledgeModal(alert); }}>
                                <i className="bi bi-check-circle"></i>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-12">
              <div className={`card ${styles.healthOverviewCard}`} style={{ marginBottom: '2.5rem' }}>
                <div className={`card-header bg-white d-flex justify-content-between align-items-center ${styles.cardHeader}`}>
                    <div>
                        <h2 className="h5 mb-1 fw-bold"><i className="bi bi-heart-pulse-fill me-2"></i>Branch Health Overview</h2>
                        <small className={`${styles.textMuted} mb-0`}>Summary of all poultry houses' operational and health status in a branch</small>
                    </div>
                    {isHealthDataLoading && <div className="spinner-border spinner-border-sm text-primary" role="status"><span className="visually-hidden">Loading...</span></div>}
                </div>
                <div className="px-3 pt-3 d-flex align-items-end gap-3 flex-wrap">
                    <div>
                        <label htmlFor="healthBranchSelect" className="form-label">Choose Branch</label>
                        <select id="healthBranchSelect" className={`form-select w-auto ${styles.coopSelect}`} value={healthOverviewBranch} onChange={handleHealthBranchChange} disabled={branches.length === 0}>
                            {branches.map(branchName => <option key={branchName} value={branchName}>{branchName}</option>)}
                        </select>
                    </div>
                    {!isHealthDataLoading && healthOverviewStats.totalCount > 0 && (
                        <div className="d-flex align-items-center gap-2">
                            <div className={`${styles.deviceStatusIndicator} ${
                                healthOverviewStats.onlineCount === healthOverviewStats.totalCount
                                    ? 'text-success' : healthOverviewStats.onlineCount > 0
                                    ? 'text-warning' : 'text-danger'
                            }`}>
                                <i className="bi bi-hdd-stack-fill me-2"></i>
                                <strong>{healthOverviewStats.onlineCount}/{healthOverviewStats.totalCount} Online</strong>
                            </div>
                            <div className={`${styles.deviceStatusIndicator} ${healthOverviewStats.overallHealth === 'Safe' ? 'text-success' : 'text-warning'}`}>
                                <i className={`bi ${healthOverviewStats.overallHealth === 'Safe' ? 'bi-shield-check' : 'bi-shield-exclamation'} me-2`}></i>
                                <strong>{healthOverviewStats.overallHealth}</strong>
                            </div>
                        </div>
                    )}
                </div>
                <div className={`card-body ${styles.cardBody}`}>
                  <div className="table-responsive">
                    <table className={`table table-hover ${styles.coopStatusTable}`}>
                      <thead>
                        <tr>
                            <th>Poultry House</th>
                            <th>Sensor</th>
                            <th>Ammonia</th>
                            <th>Temperature</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isHealthDataLoading ? (
                            <tr><td colSpan="4" className="text-center text-muted py-3"><div className="spinner-border spinner-border-sm me-2" role="status"></div>Loading health overview...</td></tr>
                        ) : coopHealthData.length === 0 ? (
                            <tr><td colSpan="4" className="text-center text-muted py-3">No poultry houses to display for this branch.</td></tr>
                        ) : (
                            coopHealthData.map(coop => {
                                const isActive = coop.firestoreId === selectedChannelId && coop.branchName === selectedBranch;
                                const isClickable = coop.hasSensor;
                                const rowClass = `${isClickable ? styles.clickableCoopRow : styles.nonClickableCoopRow} ${isActive ? styles.activeCoopRow : ''}`;
                                
                                let rowTitle = `Switch to ${coop.name}`;
                                if (isActive) rowTitle = `Currently monitoring ${coop.name}`;
                                if (!isClickable) rowTitle = `Cannot monitor: No sensor installed`;
                                
                                return (
                                    <tr 
                                        key={coop.firestoreId} 
                                        onClick={() => {
                                            if (isClickable) {
                                                setSelectedBranch(coop.branchName); 
                                                setSelectedChannelId(coop.firestoreId);
                                                window.scrollTo({ top: 0, behavior: 'smooth' }); 
                                            }
                                        }} 
                                        className={rowClass} 
                                        title={rowTitle}
                                    >
                                        <td>{coop.name}</td>
                                        <td><span className={`badge ${coop.deviceStatus.class}`}>{coop.deviceStatus.text}</span></td>
                                        <td><span className={`badge ${coop.ammoniaStatus.class}`}>{coop.ammoniaStatus.text}</span></td>
                                        <td><span className={`badge ${coop.tempStatus.class}`}>{coop.tempStatus.text}</span></td>
                                    </tr>
                                );
                            })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <AllAlertsModal
        show={isAlertModalOpen}
        onHide={() => setIsAlertModalOpen(false)}
        alerts={allUserAlerts}
        onAcknowledge={handleOpenAcknowledgeModal}
        onAnalyze={handleOpenAnalysisModal}
        getBadgeDetailsForAlertType={getBadgeDetailsForAlertType}
      />

      <AcknowledgeAlertModal
        show={isAcknowledgeModalOpen}
        onHide={handleCloseAcknowledgeModal}
        alert={alertToAcknowledge}
        onSubmit={handleConfirmAcknowledge}
      />

      <AlertAnalysisModal
        show={isAnalysisModalOpen}
        onHide={handleCloseAnalysisModal}
        alert={alertForAnalysis}
        allUserAlerts={allUserAlerts}
        channelConfig={channels.find(ch => ch.firestoreId === alertForAnalysis?.firestoreId)}
      />
    </div>
  );
};

export default DashboardPage;