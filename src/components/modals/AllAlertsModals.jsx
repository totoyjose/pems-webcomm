// src/components/modals/AllAlertsModals.jsx
import React, { useEffect, useRef } from 'react';
import { Modal } from 'bootstrap';
import styles from './AllAlertsModals.module.css';

const AllAlertsModal = ({ show, onHide, alerts, onAcknowledge, onAnalyze, getBadgeDetailsForAlertType }) => {
  const modalRef = useRef(null);
  const bsModalInstance = useRef(null);

  useEffect(() => {
    if (!modalRef.current) return;
    const modalInstance = Modal.getOrCreateInstance(modalRef.current);
    bsModalInstance.current = modalInstance;

    const handleHidden = () => onHide();
    const modalEl = modalRef.current;
    modalEl.addEventListener('hidden.bs.modal', handleHidden);

    if (show) {
      modalInstance.show();
    } else {
      modalInstance.hide();
    }
    return () => modalEl.removeEventListener('hidden.bs.modal', handleHidden);
  }, [show, onHide]);

  useEffect(() => {
    return () => {
      if (bsModalInstance.current) {
        bsModalInstance.current.dispose();
        bsModalInstance.current = null;
      }
    };
  }, []);

  const unacknowledgedAlerts = alerts.filter(a => !a.isAcknowledge);
  const acknowledgedAlerts = alerts.filter(a => a.isAcknowledge);

  const AlertItem = ({ alert, isAcknowledged }) => {
    const { iconClass, iconColorClass } = getBadgeDetailsForAlertType(alert.type);
    const itemClasses = [
      styles.listGroupItem,
      isAcknowledged ? styles.acknowledgedItem : styles.unacknowledgedItem,
    ].join(' ');

    return (
      <div className={`list-group-item d-flex justify-content-between align-items-center ${itemClasses}`}>
        <div className="d-flex align-items-center flex-grow-1" style={{ minWidth: 0 }}>
          <i className={`${iconClass} ${iconColorClass} mx-3 fs-4 flex-shrink-0`}></i>
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <small className="text-muted d-block text-truncate" title={`${alert.branchName} / ${alert.channelName} • ${alert.time}`}>{alert.branchName} / <u className="text-muted">{alert.channelName}</u> • {alert.time}</small>
            <span className={`mb-0 d-block text-truncate ${styles.alertMessage}`}>{alert.message}</span>
            {isAcknowledged && alert.actionTaken && alert.actionTaken.length > 0 && (
              <div className={`${styles.actionTakenContainer} mt-1`}>
                <i className="bi bi-tools me-1"></i>
                <small className="text-muted text-truncate" title={`Actions: ${alert.actionTaken.join(', ')}`}>{alert.actionTaken.join(', ')}</small>
              </div>
            )}
          </div>
        </div>
        <div className="d-flex align-items-center flex-shrink-0 ms-2">
          {isAcknowledged ? (
            <i className="bi bi-check-circle-fill text-success fs-4" title="Acknowledged"></i>
          ) : (
            <>
              <button className="btn btn-outline-primary me-2" title={`Analyze Alert: ${alert.message}`} onClick={(e) => { e.stopPropagation(); onAnalyze(alert); }}>
                <i className="bi bi-clipboard2-data"></i>
              </button>
              <button className="btn btn-outline-success" title={`Acknowledge Alert: ${alert.message}`} onClick={(e) => { e.stopPropagation(); onAcknowledge(alert); }}>
                <i className="bi bi-check-circle"></i>
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="modal fade" id="allAlertsModal" tabIndex="-1" aria-labelledby="allAlertsModalLabel" aria-hidden="true" ref={modalRef}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="allAlertsModalLabel"><i className="bi bi-bell-fill me-2"></i>All Alerts</h5>
            <button type="button" className="btn-close" onClick={onHide} aria-label="Close"></button>
          </div>
          <div className="modal-body" style={{ padding: '0' }}>
            <div id="allAlertsContainer" className="list-group list-group-flush">
              {alerts.length === 0 ? (
                <p className="text-center text-muted p-3">No alerts found.</p>
              ) : (
                <>
                  {unacknowledgedAlerts.length === 0 && (
                    <div className="p-4 text-center text-muted">
                      <h5><i className="bi bi-check2-circle me-2"></i>No new alerts</h5>
                      <p className="mb-0">All alerts have been acknowledged.</p>
                    </div>
                  )}
                  {unacknowledgedAlerts.map(alert => <AlertItem key={alert.id} alert={alert} isAcknowledged={false} />)}

                  {acknowledgedAlerts.length > 0 && (
                    <>
                      <div className={styles.historySeparator}><span>Recent History</span></div>
                      {acknowledgedAlerts.map(alert => <AlertItem key={alert.id} alert={alert} isAcknowledged={true} />)}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onHide}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AllAlertsModal;