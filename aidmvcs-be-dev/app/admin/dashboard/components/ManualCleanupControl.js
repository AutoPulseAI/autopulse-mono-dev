'use client';

import { useState } from 'react';
import { Button, Card, Alert, Spinner, Badge } from 'react-bootstrap';

export default function ManualCleanupControl() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const performCleanup = async (action, dryRun = false) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/admin/manual-cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, dryRun }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Cleanup operation failed');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatus = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/admin/manual-cleanup');
      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to get status');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderResult = () => {
    if (!result) return null;

    if (result.data?.action === 'status') {
      return (
        <div className="mt-3">
          <h6>Current Status:</h6>
          <div className="d-flex gap-2 flex-wrap">
            {Object.entries(result.data.summary || {}).map(([status, count]) => (
              <Badge key={status} bg={status === 'pending' ? 'warning' : status === 'sent' ? 'success' : 'secondary'}>
                {status}: {count}
              </Badge>
            ))}
          </div>
        </div>
      );
    }

    if (result.data?.dryRun) {
      return (
        <div className="mt-3">
          <h6>Dry Run Results:</h6>
          <p>Found {result.data.reportsFound} reports that would be affected.</p>
          {result.data.reports && result.data.reports.length > 0 && (
            <div className="mt-2">
              <h6>Reports to be processed:</h6>
              <div className="small">
                {result.data.reports.map((report, index) => (
                  <div key={index} className="border-bottom pb-1 mb-1">
                    <strong>{report.dealer}</strong> - {report.id}
                    {report.daysOld && <span className="text-muted ms-2">({report.daysOld} days old)</span>}
                    {report.daysUntilScheduled && <span className="text-muted ms-2">({report.daysUntilScheduled} days away)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="mt-3">
        <Alert variant="success">
          ✅ {result.data?.action} completed successfully!
        </Alert>
      </div>
    );
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0">🛡️ Manual Cleanup Control</h5>
        <small className="text-muted">
          Safe cleanup operations - always use dry run first!
        </small>
      </Card.Header>
      <Card.Body>
        <div className="row">
          <div className="col-md-6">
            <h6>Cleanup Operations</h6>
            <div className="d-grid gap-2">
              <Button
                variant="outline-warning"
                size="sm"
                onClick={() => performCleanup('cleanup-old', true)}
                disabled={loading}
              >
                🔍 Dry Run: Clean Old Reports
              </Button>
              <Button
                variant="warning"
                size="sm"
                onClick={() => performCleanup('cleanup-old', false)}
                disabled={loading}
              >
                🧹 Clean Old Reports (90+ days)
              </Button>
            </div>
          </div>
          
          <div className="col-md-6">
            <h6>Future Report Management</h6>
            <div className="d-grid gap-2">
              <Button
                variant="outline-info"
                size="sm"
                onClick={() => performCleanup('cleanup-future', true)}
                disabled={loading}
              >
                🔍 Dry Run: Fix Future Reports
              </Button>
              <Button
                variant="info"
                size="sm"
                onClick={() => performCleanup('cleanup-future', false)}
                disabled={loading}
              >
                🔧 Fix Future Reports
              </Button>
            </div>
          </div>
        </div>

        <div className="row mt-3">
          <div className="col-12">
            <div className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={getStatus}
                disabled={loading}
              >
                📊 Get Status
              </Button>
              {loading && <Spinner animation="border" size="sm" />}
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="danger" className="mt-3">
            ❌ {error}
          </Alert>
        )}

        {renderResult()}

        <div className="mt-3">
          <small className="text-muted">
            <strong>Safety Features:</strong>
            <ul className="mb-0 mt-1">
              <li>✅ Always use "Dry Run" first to see what will happen</li>
              <li>✅ Old reports are only deleted after 90 days (not 30)</li>
              <li>✅ Future reports are fixed/rescheduled instead of deleted</li>
              <li>✅ All operations are logged for audit purposes</li>
            </ul>
          </small>
        </div>
      </Card.Body>
    </Card>
  );
}
