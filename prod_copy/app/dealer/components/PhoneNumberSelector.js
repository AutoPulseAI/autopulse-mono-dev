'use client';

import { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Badge, Spinner, Alert, Card } from 'react-bootstrap';

export default function PhoneNumberSelector({ 
  show, 
  onHide, 
  onSelect, 
  currentPhoneNumber = '',
  userId 
}) {
  const [loading, setLoading] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [areaCodeStats, setAreaCodeStats] = useState([]);
  const [selectedAreaCode, setSelectedAreaCode] = useState('');
  const [error, setError] = useState(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (show) {
      fetchExistingNumbers();
    }
  }, [show, selectedAreaCode]);

  const fetchExistingNumbers = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      if (selectedAreaCode) {
        params.append('area_code', selectedAreaCode);
      }
      params.append('limit', '100');
      
      const response = await fetch(`/api/twilio/available-numbers?${params}`,{
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setPhoneNumbers(data.data.phone_numbers);
        setAreaCodeStats(data.data.area_code_stats);
      } else {
        setError(data.error || 'Failed to fetch existing phone numbers');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignNumber = async (phoneNumberId, phoneNumber) => {
    if (!userId) {
      //setError('User ID is required to assign phone number');
      //return;
    }

    setAssigning(true);
    setError(null);
    
    try {
      const response = await fetch('/api/twilio/available-numbers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          user_id: userId
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Call the onSelect callback with the selected number
        onSelect(data.data.phone_number);
        onHide();
      } else {
        setError(data.error || 'Failed to assign phone number');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setAssigning(false);
    }
  };

  const filteredNumbers = phoneNumbers.filter(number => {
    // Only filter by area code if selected
    if (selectedAreaCode) {
      return number.area_code === selectedAreaCode;
    }
    return true;
  });

  const formatPhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return '';
    // Remove any non-digit characters and format
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `(${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7, 11)}`;
    } else if (cleaned.length === 10) {
      return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6, 10)}`;
    }
    return phoneNumber;
  };

  return (
    <Modal show={show} onHide={onHide} size="xl" centered>
      <Modal.Header closeButton>
        <Modal.Title>📱 Select from Your Twilio Phone Numbers</Modal.Title>
      </Modal.Header>
      
      <Modal.Body>
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}

        {/* Area Code Filter */}
        <Row className="mb-3">
          <Col md={12}>
            <Form.Group>
              <Form.Label>Filter by Area Code</Form.Label>
              <Form.Select 
                value={selectedAreaCode} 
                onChange={(e) => setSelectedAreaCode(e.target.value)}
              >
                <option value="">All Area Codes</option>
                {areaCodeStats.map((stat) => (
                  <option key={stat._id} value={stat._id}>
                    ({stat._id}) - {stat.count} available
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        {/* Current Phone Number Display */}
        {currentPhoneNumber && (
          <Alert variant="info" className="mb-3">
            <strong>Current SMS Phone:</strong> {formatPhoneNumber(currentPhoneNumber)}
          </Alert>
        )}

        {/* Phone Numbers List */}
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" variant="dark" />
            <p className="mt-2">Loading your existing Twilio phone numbers...</p>
          </div>
        ) : (
          <div>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6>Your Unassigned Twilio Numbers ({filteredNumbers.length})</h6>
              <Button 
                variant="outline-secondary" 
                size="sm" 
                onClick={fetchExistingNumbers}
                disabled={loading}
              >
                🔄 Refresh
              </Button>
            </div>

            {filteredNumbers.length === 0 ? (
              <Alert variant="warning">
                No unassigned phone numbers found. All your Twilio numbers are currently assigned to dealers.
              </Alert>
            ) : (
              <div className="phone-numbers-list" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {filteredNumbers.map((number) => (
                  <Card key={number.id} className="mb-3">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div className="d-flex align-items-center gap-2 mb-2">
                            <h5 className="text-primary mb-0">{number.formatted_number}</h5>
                            <Badge bg="secondary">({number.area_code})</Badge>
                            {number.capabilities.voice && <Badge bg="success">Voice</Badge>}
                            {number.capabilities.sms && <Badge bg="info">SMS</Badge>}
                            {number.capabilities.mms && <Badge bg="warning">MMS</Badge>}
                          </div>
                          
                          <div className="text-muted small mb-2">
                            {number.locality && <span className="me-3">📍 {number.locality}</span>}
                            {number.region && <span className="me-3">🏛️ {number.region}</span>}
                            <span className="me-3">💰 ${number.monthly_cost}/month</span>
                            <span className="me-3">📅 Purchased: {new Date(number.date_created).toLocaleDateString()}</span>
                          </div>
                          
                          <div className="text-info small">
                            🔒 This number is already purchased from your Twilio account and ready to assign
                          </div>
                        </div>
                        
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleAssignNumber(number.id, number.phone_number)}
                          disabled={assigning}
                        >
                          {assigning ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Assigning...
                            </>
                          ) : (
                            'Use This Number'
                          )}
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal.Body>
      
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <small className="text-muted me-auto">
          💡 These are phone numbers already purchased from your Twilio account
        </small>
      </Modal.Footer>
    </Modal>
  );
}
