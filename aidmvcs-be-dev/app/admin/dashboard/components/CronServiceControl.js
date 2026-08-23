'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Alert, Spinner } from 'react-bootstrap';

export default function CronServiceControl() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Fetch service status on component mount
  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/cron/report-service');
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch (error) {
      console.error('Error fetching status:', error);
    }
  };

  const controlService = async (action) => {
    setLoading(true);
    setMessage('');
    
    try {
      const res = await fetch('/api/cron/report-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      
      if (res.ok) {
        const data = await res.json();
        setMessage(data.message);
        // Refresh status
        setTimeout(() => fetchStatus(), 1000);
      } else {
        const errorData = await res.json();
        setMessage(`Error: ${errorData.message}`);
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0">📊 Report Cron Service Control</h5>
      </Card.Header>
      <Card.Body>
        {message && (
          <Alert variant={message.includes('Error') ? 'danger' : 'success'} dismissible onClose={() => setMessage('')}>
            {message}
          </Alert>
        )}

        <div className="row">
          <div className="col-md-6">
            <h6>Service Status</h6>
            {status ? (
              <div>
                <p><strong>Status:</strong> 
                  <span className={`badge ms-2 ${status.isRunning ? 'bg-success' : 'bg-danger'}`}>
                    {status.isRunning ? 'Running' : 'Stopped'}
                  </span>
                </p>
                <p><strong>Check Interval:</strong> {status.checkInterval / 1000} seconds</p>
                <p><strong>Last Check:</strong> {formatDate(status.lastCheck)}</p>
              </div>
            ) : (
              <p>Loading status...</p>
            )}
          </div>
          
          <div className="col-md-6">
            <h6>Actions</h6>
            <div className="d-grid gap-2">
              <Button
                variant="success"
                onClick={() => controlService('start')}
                disabled={loading || (status?.isRunning)}
              >
                {loading ? <Spinner size="sm" /> : '▶️ Start Service'}
              </Button>
              
              <Button
                variant="danger"
                onClick={() => controlService('stop')}
                disabled={loading || (!status?.isRunning)}
              >
                {loading ? <Spinner size="sm" /> : '⏹️ Stop Service'}
              </Button>
              
              <Button
                variant="info"
                onClick={() => controlService('check')}
                disabled={loading}
              >
                {loading ? <Spinner size="sm" /> : '🔍 Manual Check'}
              </Button>
              
              <Button
                variant="warning"
                onClick={() => controlService('process-overdue')}
                disabled={loading}
              >
                {loading ? <Spinner size="sm" /> : '⏰ Process Overdue Reports'}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <small className="text-muted">
            The cron service automatically checks for scheduled reports every minute and sends them via email.
            Use the manual check button to test the system immediately.
            Use the Process Overdue Reports button to catch up on reports that should have been sent in the past.
          </small>
        </div>
      </Card.Body>
    </Card>
  );
}
