'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Alert, Spinner, Badge } from 'react-bootstrap';

export default function RedisQueueControl() {
  const [queueStatus, setQueueStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Fetch queue status on component mount
  useEffect(() => {
    fetchQueueStatus();
  }, []);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch('/api/system/redis-queues');
      if (res.ok) {
        const data = await res.json();
        setQueueStatus(data.data);
      }
    } catch (error) {
      console.error('Error fetching queue status:', error);
    }
  };

  const executeAction = async (action, queueName = null) => {
    setLoading(true);
    setMessage('');
    
    try {
      const body = queueName ? { action, queueName } : { action };
      
      const res = await fetch('/api/system/redis-queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (res.ok) {
        const data = await res.json();
        setMessage(data.message);
        // Refresh status
        setTimeout(() => fetchQueueStatus(), 1000);
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

  const clearAllQueues = () => {
    if (window.confirm('Are you sure you want to clear ALL Redis queues? This action cannot be undone.')) {
      executeAction('clear-all');
    }
  };

  const clearSpecificQueue = (queueName) => {
    if (window.confirm(`Are you sure you want to clear the ${queueName} queue? This action cannot be undone.`)) {
      executeAction('clear-queue', queueName);
    }
  };

  const getStatusBadge = (queueData) => {
    if (queueData.error) {
      return <Badge bg="danger">Error</Badge>;
    }
    
    const total = queueData.total || 0;
    if (total === 0) {
      return <Badge bg="success">Empty</Badge>;
    } else if (total > 10) {
      return <Badge bg="warning">Busy</Badge>;
    } else {
      return <Badge bg="info">Active</Badge>;
    }
  };

  const formatJobCounts = (queueData) => {
    if (queueData.error) {
      return <span className="text-danger">Error: {queueData.error}</span>;
    }
    
    return (
      <div className="small">
        <div>Waiting: <Badge bg="secondary">{queueData.waiting || 0}</Badge></div>
        <div>Active: <Badge bg="primary">{queueData.active || 0}</Badge></div>
        <div>Completed: <Badge bg="success">{queueData.completed || 0}</Badge></div>
        <div>Failed: <Badge bg="danger">{queueData.failed || 0}</Badge></div>
        <div>Delayed: <Badge bg="warning">{queueData.delayed || 0}</Badge></div>
        <div>Paused: <Badge bg="info">{queueData.paused || 0}</Badge></div>
        <div><strong>Total: <Badge bg="dark">{queueData.total || 0}</Badge></strong></div>
      </div>
    );
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0">🔄 Redis Queue Management</h5>
      </Card.Header>
      <Card.Body>
        {message && (
          <Alert variant={message.includes('Error') ? 'danger' : 'success'} dismissible onClose={() => setMessage('')}>
            {message}
          </Alert>
        )}

        <div className="row mb-3">
          <div className="col-12">
            <h6>Queue Actions</h6>
            <div className="d-flex gap-2 flex-wrap">
              <Button
                variant="danger"
                onClick={clearAllQueues}
                disabled={loading}
                size="sm"
              >
                {loading ? <Spinner size="sm" /> : '🧹 Clear All Queues'}
              </Button>
              
              <Button
                variant="warning"
                onClick={() => executeAction('pause-all')}
                disabled={loading}
                size="sm"
              >
                {loading ? <Spinner size="sm" /> : '⏸️ Pause All'}
              </Button>
              
              <Button
                variant="success"
                onClick={() => executeAction('resume-all')}
                disabled={loading}
                size="sm"
              >
                {loading ? <Spinner size="sm" /> : '▶️ Resume All'}
              </Button>
              
              <Button
                variant="info"
                onClick={fetchQueueStatus}
                disabled={loading}
                size="sm"
              >
                {loading ? <Spinner size="sm" /> : '🔄 Refresh Status'}
              </Button>
            </div>
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            <h6>Queue Status</h6>
            {queueStatus ? (
              <div className="row">
                {Object.entries(queueStatus).map(([queueName, queueData]) => (
                  <div key={queueName} className="col-md-4 mb-3">
                    <Card className="h-100">
                      <Card.Header className="d-flex justify-content-between align-items-center">
                        <strong>{queueName}</strong>
                        {getStatusBadge(queueData)}
                      </Card.Header>
                      <Card.Body>
                        {formatJobCounts(queueData)}
                        <div className="mt-2">
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => clearSpecificQueue(queueName)}
                            disabled={loading}
                          >
                            Clear This Queue
                          </Button>
                        </div>
                      </Card.Body>
                    </Card>
                  </div>
                ))}
              </div>
            ) : (
              <p>Loading queue status...</p>
            )}
          </div>
        </div>

        <div className="mt-3">
          <small className="text-muted">
            Redis queues handle background job processing for emails, SMS, and lead processing.
            Use these controls to manage queue operations and monitor job counts.
            <strong>Warning:</strong> Clearing queues will permanently remove all pending jobs.
          </small>
        </div>
      </Card.Body>
    </Card>
  );
}
