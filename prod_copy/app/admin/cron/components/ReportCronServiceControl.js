// admin/dashboard/components/ReportCronServiceControl.js
'use client';

import { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';

export default function ReportCronServiceControl() {
  const [serviceStatus, setServiceStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [reportHistory, setReportHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Fetch service status on component mount
  useEffect(() => {
    fetchServiceStatus();
  }, []);

  const fetchServiceStatus = async () => {
    try {
      const response = await fetch('/api/cron/report-service');
      const data = await response.json();
      
      if (data.success) {
        setServiceStatus(data.status);
      } else {
        setMessage('Error fetching service status: ' + data.message);
      }
    } catch (error) {
      setMessage('Error fetching service status: ' + error.message);
    }
  };

  const handleServiceAction = async (action) => {
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/cron/report-service', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage(data.message);
        // Refresh status after action
        await fetchServiceStatus();
      } else {
        setMessage('Error: ' + data.message);
      }
    } catch (error) {
      setMessage('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualCheck = async () => {
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/cron/report-service', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'check' }),
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage('Manual report check completed successfully');
        // Refresh status after check
        await fetchServiceStatus();
      } else {
        setMessage('Error: ' + data.message);
      }
    } catch (error) {
      setMessage('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessOverdue = async () => {
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/cron/report-service', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'process-overdue' }),
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage('Overdue report processing completed successfully');
        // Refresh status after processing
        await fetchServiceStatus();
      } else {
        setMessage('Error: ' + data.message);
      }
    } catch (error) {
      setMessage('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-lg font-semibold text-gray-900 mb-3">
          Report Cron Service
        </h4>
        <div className="flex items-center space-x-2">
          <h6 className={`${serviceStatus?.isRunning ? 'text-success' : 'text-danger'}`}>{serviceStatus?.isRunning ? 'Running' : 'Stopped'}</h6>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-md ${
          message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {message}
        </div>
      )}

      <div className="space-y-4">
        {/* Service Controls */}
        <div className="d-flex gap-1">
          <Button
            variant="custom"
            onClick={() => handleServiceAction('start')}
            disabled={loading || serviceStatus?.isRunning}
          >
            {loading ? 'Starting...' : 'Start Service'}
          </Button>
          
          <Button
            variant="custom"
            onClick={() => handleServiceAction('stop')}
            disabled={loading || !serviceStatus?.isRunning}
          >
            {loading ? 'Stopping...' : 'Stop Service'}
          </Button>
          
          <Button
            variant="custom"
            onClick={handleManualCheck}
            disabled={loading}
          >
            {loading ? 'Checking...' : 'Manual Check'}
          </Button>
          
          <Button
            variant="custom"
            onClick={handleProcessOverdue}
            disabled={loading}
          >
            {loading ? 'Processing...' : 'Process Overdue'}
          </Button>
        </div>

        {/* Service Information */}
        {serviceStatus && (
          <div className="bg-gray-50 rounded-md p-4">
            <h4 className="font-medium text-gray-900 mb-2">Service Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-600">Check Interval:</span>
                <span className="ml-2 text-gray-900">
                  {serviceStatus.checkInterval ? `${serviceStatus.checkInterval / 1000} seconds` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">Last Check:</span>
                <span className="ml-2 text-gray-900">
                  {serviceStatus.lastCheck ? new Date(serviceStatus.lastCheck).toLocaleString() : 'Never'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 rounded-md p-4">
          <h4 className="font-medium text-blue-900 mb-2">How it works:</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Monitors scheduled reports for all dealers</li>
            <li>• Sends daily, weekly, monthly, and yearly reports</li>
            <li>• Processes overdue reports automatically</li>
            <li>• Includes lead metrics, communication stats, and vehicle data</li>
            <li>• Now includes lead source breakdown in reports</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
