// src/pages/GenerateReportPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '../components/layout/Sidebar';
import styles from '../styles/GenerateReportPage.module.css';
import { getAllChannels } from '../firebase/channelService.js';
import { getAnnualMinMaxData } from '../thingspeak/fetch_tabledata.js';
import { createPdfDocument, createAnnualPdfDocument, calculateMonthlySummary } from '../utils/reportGenerationUtils';

// Averages annual report data from multiple poultry houses.
const aggregateAnnualData = (allAnnualData) => {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (!allAnnualData || allAnnualData.length === 0) return [];

  return monthNames.map((monthName, monthIndex) => {
    const monthDataForAllHouses = allAnnualData.map(houseData => houseData ? houseData[monthIndex] : undefined);
    const metrics = ['ammoniaMax', 'ammoniaMin', 'ammoniaAvg', 'tempMax', 'tempMin', 'tempAvg'];
    const aggregatedMetrics = {};

    metrics.forEach(metric => {
      const values = monthDataForAllHouses
        .filter(Boolean) // Filter out any falsy month data objects
        .map(data => parseFloat(data[metric]))
        .filter(v => !isNaN(v));
      
      if (values.length > 0) {
        const sum = values.reduce((acc, v) => acc + v, 0);
        aggregatedMetrics[metric] = (sum / values.length).toFixed(2);
      } else {
        aggregatedMetrics[metric] = '';
      }
    });

    return { month: monthName, ...aggregatedMetrics };
  });
};

// Renders the page for generating and downloading PDF reports.
const GenerateReportPage = () => {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

  const [allChannels, setAllChannels] = useState([]);
  const [branchList, setBranchList] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [channelList, setChannelList] = useState([]);

  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [reportType, setReportType] = useState('monthly');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [tempUnit, setTempUnit] = useState(localStorage.getItem('tempUnit') || 'C');

  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [message, setMessage] = useState({ text: '', type: '', show: false });

  const pdfPreviewRef = useRef(null);

  // Toggles the sidebar's expanded state.
  const toggleSidebar = () => setIsSidebarExpanded(!isSidebarExpanded);

  // Displays a temporary message to the user.
  const showAppMessage = (text, type = 'error', duration = 4000) => {
    setMessage({ text, type, show: true });
    setTimeout(() => setMessage({ text: '', type: '', show: false }), duration);
  };
  
  // Sets up an event listener for temperature unit changes in local storage.
  useEffect(() => {
    const handleStorageChange = () => setTempUnit(localStorage.getItem('tempUnit') || 'C');
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Loads all channel data and populates branch and house selection dropdowns.
  useEffect(() => {
    const loadChannels = async () => {
      setIsLoadingChannels(true);
      try {
        const rawChannels = await getAllChannels();
        const mappedChannels = rawChannels.map(ch => ({
          channelId: ch.ID, readAPIKey: ch.ReadAPI, name: ch.Name,
          branchName: ch.branchName, firestoreId: ch.firestoreId,
          hasSensor: ch.hasSensor, ammoniaField: "field3", tempField: "field1",
          alertThreshold: ch.alertThreshold,
        }));

        if (mappedChannels.length > 0) {
          setAllChannels(mappedChannels);
          const uniqueBranches = [...new Set(mappedChannels.map(ch => ch.branchName))].sort();
          setBranchList(uniqueBranches);
          const defaultBranch = uniqueBranches[0];
          setSelectedBranch(defaultBranch);

          const initialFilteredChannels = mappedChannels.filter(ch => ch.branchName === defaultBranch).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          setChannelList(initialFilteredChannels);

          const firstEnabledChannel = initialFilteredChannels.find(ch => ch.hasSensor);
          setSelectedChannelId(firstEnabledChannel ? firstEnabledChannel.channelId : 'ALL');
        } else {
          showAppMessage('No poultry houses found.', 'info');
        }
      } catch (error) {
        console.error("Error loading channels:", error);
        showAppMessage(`Error fetching channels: ${error.message}`, 'error');
      }
      setIsLoadingChannels(false);
    };
    loadChannels();
  }, []);

  // Handles changes to the selected branch, updating the available poultry houses.
  const handleBranchChange = (e) => {
    const newBranch = e.target.value;
    setSelectedBranch(newBranch);
    const filteredChannels = allChannels.filter(ch => ch.branchName === newBranch).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setChannelList(filteredChannels);
    const firstEnabledInBranch = filteredChannels.find(ch => ch.hasSensor);
    setSelectedChannelId(firstEnabledInBranch ? firstEnabledInBranch.channelId : 'ALL');
  };

  // Retrieves detailed information for the currently selected channel or branch.
  const getSelectedChannelInfo = () => {
    if (!allChannels || allChannels.length === 0) return null;
    const createChannelInfo = (ch) => ({
        CHANNEL_ID: ch.channelId, READ_API_KEY: ch.readAPIKey,
        COOP_NAME: ch.name, BRANCH_NAME: ch.branchName, firestoreId: ch.firestoreId,
        alertThreshold: ch.alertThreshold,
        ammoniaField: parseInt(String(ch.ammoniaField).replace('field', ''), 10),
        tempField: parseInt(String(ch.tempField).replace('field', ''), 10),
    });
    if (selectedChannelId === "ALL") {
      const branchChannelsWithSensors = allChannels.filter(ch => ch.branchName === selectedBranch && ch.hasSensor);
      return branchChannelsWithSensors.length > 0 ? branchChannelsWithSensors.map(createChannelInfo) : null;
    }
    const channel = allChannels.find(c => c.channelId === selectedChannelId);
    return channel && channel.hasSensor ? createChannelInfo(channel) : null;
  };

  // Generates the data and structure for a monthly PDF report.
  const generateMonthlyPdf = async () => {
    const currentChannelInfo = getSelectedChannelInfo();
    if (!currentChannelInfo || !selectedMonth) {
      showAppMessage('Please select a valid poultry house with a sensor and a month.', 'error');
      return null;
    }
    const year = new Date().getFullYear();
    const firstDay = new Date(year, selectedMonth - 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastDay = new Date(year, selectedMonth, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const observationPeriod = `${firstDay} - ${lastDay}`;
    try {
      const summary = await calculateMonthlySummary(currentChannelInfo, year, selectedMonth, tempUnit);
      if (!summary.tempSummary.avg && !summary.ammoniaSummary.avg) {
        const monthName = new Date(0, selectedMonth - 1).toLocaleString('default', { month: 'long' });
        throw new Error(`No data available for ${monthName} ${year}.`);
      }
      const reportData = { summary, observationPeriod };
      return await createPdfDocument(currentChannelInfo, selectedMonth, reportData, tempUnit);
    } catch (error) {
      console.error("Error during Monthly PDF generation process:", error);
      showAppMessage(`Error creating Monthly PDF: ${error.message}`, 'error');
      return null;
    }
  };

  // Generates the data and structure for an annual PDF report.
  const generateAnnualPdf = async () => {
    const channelInfo = getSelectedChannelInfo();
    if (!channelInfo) {
      showAppMessage('Please select a valid poultry house with a sensor.', 'error');
      return null;
    }

    try {
      let annualData;
      let reportInfo;

      if (Array.isArray(channelInfo)) { // ALL HOUSES
        const allAnnualDataPromises = channelInfo.map(ch => 
          getAnnualMinMaxData(ch.BRANCH_NAME, ch.firestoreId, selectedYear, ch.CHANNEL_ID, ch.READ_API_KEY, ch.ammoniaField, ch.tempField)
        );
        const allAnnualData = await Promise.all(allAnnualDataPromises);
        annualData = aggregateAnnualData(allAnnualData);
        reportInfo = { 
          BRANCH_NAME: selectedBranch, 
          COOP_NAME: `All Houses in ${selectedBranch}`, 
          isBranch: true, 
          houseCount: channelInfo.length 
        };
      } else { // SINGLE HOUSE
        annualData = await getAnnualMinMaxData(
          channelInfo.BRANCH_NAME, channelInfo.firestoreId, selectedYear,
          channelInfo.CHANNEL_ID, channelInfo.READ_API_KEY, channelInfo.ammoniaField, channelInfo.tempField
        );
        reportInfo = { ...channelInfo, isBranch: false };
      }

      if (!annualData || annualData.length === 0 || annualData.every(m => !m || (!m.ammoniaAvg && !m.tempAvg))) {
        throw new Error(`No data available for ${selectedYear}.`);
      }
      return await createAnnualPdfDocument(reportInfo, selectedYear, annualData, tempUnit);
    } catch (error) {
      console.error("Error during Annual PDF generation process:", error);
      showAppMessage(`Error creating Annual PDF: ${error.message}`, 'error');
      return null;
    }
  };

  // Determines whether to generate a monthly or annual PDF based on user selection.
  const generatePdf = async () => {
    return reportType === 'monthly' ? await generateMonthlyPdf() : await generateAnnualPdf();
  };

  // Handles the "Generate Preview" button click, creating and displaying a PDF preview.
  const handlePreview = async () => {
    setIsGeneratingPreview(true);
    setPdfPreviewUrl('');
    console.log(`Generating preview for type: ${reportType}, target: ${selectedChannelId}, month: ${selectedMonth}, year: ${selectedYear}`);
    const doc = await generatePdf();
    if (doc) {
      try {
        const url = doc.output('bloburl');
        setPdfPreviewUrl(url);
        setTimeout(() => pdfPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
        showAppMessage('Preview generated.', 'success');
      } catch (e) {
        console.error("Error generating preview URL:", e);
        showAppMessage(`Error generating preview: ${e.message}`, 'error');
      }
    }
    setIsGeneratingPreview(false);
  };

  // Handles the "Download PDF" button click, creating and saving the PDF report.
  const handleDownload = async () => {
    setIsDownloading(true);
    console.log(`Generating download for type: ${reportType}, target: ${selectedChannelId}, month: ${selectedMonth}, year: ${selectedYear}`);
    const doc = await generatePdf();
    if (doc) {
      const channelInfo = getSelectedChannelInfo();
      let fileName;
      if (reportType === 'monthly') {
        const monthName = monthOptions.find(m => m.value === selectedMonth)?.label || 'Report';
        fileName = `${Array.isArray(channelInfo) ? selectedBranch : channelInfo.COOP_NAME} - ${monthName} ${new Date().getFullYear()} Report.pdf`;
      } else {
        const name = Array.isArray(channelInfo) ? `All Houses in ${selectedBranch}` : channelInfo.COOP_NAME;
        fileName = `${name} - ${selectedYear} Annual Report.pdf`;
      }
      doc.save(fileName);
      showAppMessage('Report downloaded successfully!', 'success');
    }
    setIsDownloading(false);
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(0, i).toLocaleString('default', { month: 'long' }) }));
  const yearOptions = Array.from({ length: 5 }, (_, i) => ({ value: new Date().getFullYear() - i, label: new Date().getFullYear() - i }));

  return (
    <div className="d-flex">
      <Sidebar isExpanded={isSidebarExpanded} toggleSidebar={toggleSidebar} />
      <main className={styles.mainContent} style={{ marginLeft: isSidebarExpanded ? '260px' : '70px' }}>
        {message.show && (<div className={`${styles.messageDiv} ${styles[message.type]} ${message.show ? styles.show : ''}`}>{message.text}</div>)}
        <div className="container-fluid py-3">
          <div className={`${styles.pageHeader} mb-4`}>
            <h1><i className="bi bi-file-earmark-text"></i>Generate Reports</h1>
            <p className={`${styles.textMuted} mb-0`}>Create and download detailed poultry environment reports</p>
          </div>
          <div className={`${styles.card} my-4`}>
            <div className={styles.cardHeader}>
                <h5><i className="bi bi-gear"></i>Customize Report</h5>
            </div>
            <div className={styles.cardBody}>
                {isLoadingChannels ? (<div className={styles.spinnerContainer}><div className={styles.spinner}></div></div>) : allChannels.length === 0 ? (<div className="alert alert-warning">No poultry houses available. Please add one first.</div>) : (
                <form><div className="row g-3">
                    <div className="col-md-3"><label htmlFor="branchSelect" className={`form-label ${styles.formLabel}`}>Select Branch</label><select id="branchSelect" className={`form-select ${styles.formSelect}`} value={selectedBranch} onChange={handleBranchChange} disabled={isGeneratingPreview || isDownloading}>{branchList.map(branch => (<option key={branch} value={branch}>{branch}</option>))}</select></div>
                    <div className="col-md-3"><label htmlFor="coopSelect" className={`form-label ${styles.formLabel}`}>Select Poultry House</label><select id="coopSelect" className={`form-select ${styles.formSelect}`} value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)} disabled={isGeneratingPreview || isDownloading || channelList.length === 0}><option value="ALL">All Houses w/ Sensor in Branch</option>{channelList.length > 0 ? (channelList.map((channel) => (<option key={channel.firestoreId} value={channel.channelId} disabled={!channel.hasSensor}>{channel.name}{!channel.hasSensor && " (No Sensor)"}</option>))) : (<option value="">No houses in this branch</option>)}</select></div>
                    <div className="col-md-3"><label htmlFor="reportTypeSelect" className={`form-label ${styles.formLabel}`}>Report Type</label><select id="reportTypeSelect" className={`form-select ${styles.formSelect}`} value={reportType} onChange={(e) => setReportType(e.target.value)} disabled={isGeneratingPreview || isDownloading}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></div>
                    <div className="col-md-3">
                      {reportType === 'monthly' ? (<><label htmlFor="monthSelect" className={`form-label ${styles.formLabel}`}>Select Month</label><select id="monthSelect" className={`form-select ${styles.formSelect}`} value={selectedMonth} onChange={(e) => setSelectedMonth(parseInt(e.target.value))} disabled={isGeneratingPreview || isDownloading}>{monthOptions.map(month => (<option key={month.value} value={month.value}>{month.label}</option>))}</select></>) 
                      : (<><label htmlFor="yearSelect" className={`form-label ${styles.formLabel}`}>Select Year</label><select id="yearSelect" className={`form-select ${styles.formSelect}`} value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))} disabled={isGeneratingPreview || isDownloading}>{yearOptions.map(year => (<option key={year.value} value={year.value}>{year.label}</option>))}</select></>)}
                    </div>
                </div></form>
                )}
            </div>
          </div>
          <div className={`${styles.card} mb-4`}>
            <div className={`${styles.cardHeader} d-flex justify-content-between align-items-center`}>
                <h5><i className="bi bi-eye"></i>Report Preview</h5>
                <button className={`btn btn-primary ${styles.actionButton}`} onClick={handlePreview} disabled={isLoadingChannels || isGeneratingPreview || isDownloading || !selectedChannelId}>
                    {isGeneratingPreview ? (<><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Generating...</>) : (<><i className="bi bi-magic"></i>Generate Preview</>)}
                </button>
            </div>
            <div className={styles.cardBody}>
                {!pdfPreviewUrl && !isGeneratingPreview && (<div className="alert alert-info"><i className="bi bi-info-circle me-2"></i>Customize your report above and click "Generate Preview". Reports can only be generated for houses with sensors.</div>)}
                {isGeneratingPreview && (<div className={styles.spinnerContainer}><div className={styles.spinner}></div><p className="ms-2">Generating PDF preview, please wait...</p></div>)}
                {pdfPreviewUrl && (<div><h5 className="mb-2">PDF Preview</h5><iframe ref={pdfPreviewRef} src={pdfPreviewUrl} className={`${styles.pdfPreviewFrame} ${pdfPreviewUrl ? styles.expanded : ''}`} title="PDF Preview" frameBorder="0"></iframe></div>)}
            </div>
            {pdfPreviewUrl && (
                <div className={`${styles.cardFooter} text-end`}>
                    <button className={`btn btn-success ${styles.actionButton}`} onClick={handleDownload} disabled={isDownloading || isGeneratingPreview}>
                        {isDownloading ? (<><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Downloading...</>) : (<><i className="bi bi-file-earmark-pdf"></i>Download PDF</>)}
                    </button>
                </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default GenerateReportPage;