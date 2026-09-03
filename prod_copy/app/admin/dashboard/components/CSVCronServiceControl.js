// admin/dashboard/components/CSVCronServiceControl.js
'use client';

import { useState, useEffect } from 'react';

export default function CSVCronServiceControl() {
  const [serviceStatus, setServiceStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [csvHistory, setCsvHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [stats, setStats] = useState(null);

  // Fetch service status on component mount
  useEffect(() => {
    fetchServiceStatus();
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/csv-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_stats' })
      });
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/csv-data?limit=20');
      const data = await response.json();
      if (data.success) {
        setCsvHistory(data.data);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const fetchServiceStatus = async () => {
    try {
      const response = await fetch('/api/cron/csv-service');
      const data = await response.json();
      
      if (data.success) {
        setServiceStatus(data.data);
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
      const response = await fetch('/api/cron/csv-service', {
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
        await fetchStats();
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
      const response = await fetch('/api/cron/csv-service', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'check' }),
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage(`Manual check completed. Files processed: ${data.data.filesProcessed}, Rows imported: ${data.data.rowsImported}`);
        // Refresh status after check
        await fetchServiceStatus();
        await fetchStats();
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
        <h3 className="text-lg font-semibold text-gray-900">
          CSV Processing Service
        </h3>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${
            serviceStatus?.isRunning ? 'bg-green-500' : 'bg-red-500'
          }`}></div>
          <span className="text-sm text-gray-600">
            {serviceStatus?.isRunning ? 'Running' : 'Stopped'}
          </span>
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
        <div className="flex space-x-3">
          <button
            onClick={() => handleServiceAction('start')}
            disabled={loading || serviceStatus?.isRunning}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Starting...' : 'Start Service'}
          </button>
          
          <button
            onClick={() => handleServiceAction('stop')}
            disabled={loading || !serviceStatus?.isRunning}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Stopping...' : 'Stop Service'}
          </button>
          
          <button
            onClick={handleManualCheck}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Checking...' : 'Manual Check'}
          </button>
          
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) fetchHistory();
            }}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            {showHistory ? 'Hide History' : 'Show History'}
          </button>
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
                <span className="font-medium text-gray-600">Upload Directory:</span>
                <span className="ml-2 text-gray-900 font-mono text-xs">
                  {serviceStatus.uploadDir || 'N/A'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">Processed Directory:</span>
                <span className="ml-2 text-gray-900 font-mono text-xs">
                  {serviceStatus.processedDir || 'N/A'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">Failed Directory:</span>
                <span className="ml-2 text-gray-900 font-mono text-xs">
                  {serviceStatus.failedDir || 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Statistics */}
        {stats && stats.length > 0 && (
          <div className="bg-green-50 rounded-md p-4">
            <h4 className="font-medium text-green-900 mb-2">Processing Statistics</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="font-medium text-green-800 capitalize">{stat._id || 'Unknown'}</div>
                  <div className="text-green-600">Files: {stat.count}</div>
                  <div className="text-green-600">Records: {stat.records_imported || 0}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Processing History */}
        {showHistory && (
          <div className="bg-gray-50 rounded-md p-4">
            <h4 className="font-medium text-gray-900 mb-2">Recent Processing History</h4>
            {csvHistory.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {csvHistory.map((item) => (
                  <div key={item._id} className="flex items-center justify-between p-2 bg-white rounded border">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{item.original_filename}</div>
                      <div className="text-xs text-gray-500">
                        {item.file_type.toUpperCase()} • {item.total_records} records • {item.records_imported} imported
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs px-2 py-1 rounded ${
                        item.processing_status === 'completed' ? 'bg-green-100 text-green-800' :
                        item.processing_status === 'failed' ? 'bg-red-100 text-red-800' :
                        item.processing_status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.processing_status}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">No processing history found</div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 rounded-md p-4">
          <h4 className="font-medium text-blue-900 mb-2">How it works:</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Monitors <code className="bg-blue-100 px-1 rounded">public/csv/dealersocket/upload</code> directory</li>
            <li>• Processes ZIP files by extracting and processing CSV files inside</li>
            <li>• Processes individual CSV files directly</li>
            <li>• Imports lead data into the database</li>
            <li>• Moves processed files to <code className="bg-blue-100 px-1 rounded">processed</code> directory</li>
            <li>• Moves failed files to <code className="bg-blue-100 px-1 rounded">failed</code> directory</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
