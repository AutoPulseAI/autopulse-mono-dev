'use client';

import { useState, useEffect } from 'react';
import { Container, Row, Col, Button, Form, Spinner, Alert } from 'react-bootstrap';
import { useUser } from "../context/UserContext";
import useFetch from "../../hooks/useFetch";
import ScheduleEditor from './components/ScheduleEditor';

export default function ReportSchedulePage() {
  const [schedules, setSchedules] = useState([]);
  const [reportEmail, setReportEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const [validationErrors, setValidationErrors] = useState({});
  const [serverError, setServerError] = useState('');
  
  const { fetchData, loading } = useFetch();
  const {  dealerParent } = useUser();

  // Load existing settings and convert old format data
  // In page.js, update the useEffect that fetches data:
  useEffect(() => {
    if (loading) return;
    if (!dealerParent?.id) return;
    
    const fetchReportSettings = async () => {
      try {
        const res = await fetch(`/api/dealers/report-settings?dealer_id=${dealerParent.id}`);
        if (res.ok) {
          const data = await res.json();
          const existingSchedules = data.userSettings?.schedules || [];
          
          // Normalize the schedule data structure
          const convertedSchedules = existingSchedules.map((schedule, index) => {
            // Extract data from Mongoose document if needed
            const scheduleData = schedule._doc || schedule;
            
            return {
              id: scheduleData.id || scheduleData._id?.$oid || `schedule-${Date.now()}-${index}`,
              active: scheduleData.active !== undefined ? scheduleData.active : true,
              frequency: scheduleData.frequency || 'daily',
              time: scheduleData.time || '09:00',
              days: scheduleData.days || [],
              // Ensure we don't include Mongoose-specific properties
            };
          });
          
          setSchedules(convertedSchedules);
          setReportEmail(data.userSettings?.default_email || '');
        } else {
          console.error('Failed to fetch report settings');
          setSchedules([]);
          setReportEmail(dealerParent.email || '');
        }
      } catch (error) {
        console.error('Error fetching report settings:', error);
        setSchedules([]);
        setReportEmail(dealerParent.email || '');
      }
    };
    
    fetchReportSettings();
  }, [loading, dealerParent]);

  // Clear errors when form changes
  useEffect(() => {
    if (Object.keys(validationErrors).length > 0) {
      setValidationErrors({});
    }
    if (serverError) {
      setServerError('');
    }
  }, [reportEmail, schedules]);

  // Helper function to validate multiple emails
  const validateEmails = (emailString) => {
    if (!emailString.trim()) {
      return { isValid: false, error: 'Email is required' };
    }
    
    // Split by comma and trim each email
    const emails = emailString.split(',').map(email => email.trim()).filter(email => email.length > 0);
    
    if (emails.length === 0) {
      return { isValid: false, error: 'At least one email address is required' };
    }
    
    // Validate each email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(email => !emailRegex.test(email));
    
    if (invalidEmails.length > 0) {
      return { 
        isValid: false, 
        error: `Invalid email address(es): ${invalidEmails.join(', ')}` 
      };
    }
    
    return { isValid: true, emails };
  };

  // Validation function
  const validateForm = () => {
    const errors = {};

    // Email validation (supports multiple comma-separated emails)
    const emailValidation = validateEmails(reportEmail);
    if (!emailValidation.isValid) {
      errors.email = emailValidation.error;
    }

    // Schedule validation
    if (schedules.length === 0) {
      errors.schedules = 'At least one schedule is required';
    } else {
      schedules.forEach((schedule, index) => {
        if (!errors.schedules) errors.schedules = {};
        if (!errors.schedules[index]) errors.schedules[index] = {};
        
        // Time validation
        if (!schedule.time) {
          errors.schedules[index].time = 'Time is required';
        }
        
        // Days validation for weekly, monthly, and yearly schedules
        if (schedule.frequency === 'weekly' && (!schedule.days || schedule.days.length === 0)) {
          errors.schedules[index].days = 'Please select a day of the week';
        } else if (schedule.frequency === 'monthly' && (!schedule.days || schedule.days.length === 0)) {
          errors.schedules[index].days = 'Please select a date of the month';
        } else if (schedule.frequency === 'yearly' && (!schedule.days || schedule.days.length < 2)) {
          errors.schedules[index].days = 'Please select both month and date for yearly schedule';
        }
        
        // Remove empty error objects
        if (Object.keys(errors.schedules[index]).length === 0) {
          delete errors.schedules[index];
        }
      });
      
      // Remove empty schedules error object if no schedule errors
      if (Object.keys(errors.schedules).length === 0) {
        delete errors.schedules;
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddSchedule = () => {
    const newSchedule = {
      id: Date.now().toString(),
      active: true,
      frequency: 'daily',
      time: '09:00',
      days: [],
      //reports: []
    };
    setSchedules([...schedules, newSchedule]);
  };

  // Handle frequency change to ensure days are properly initialized
  const handleFrequencyChange = (scheduleId, newFrequency) => {
    setSchedules(schedules.map(schedule => {
      if (schedule.id === scheduleId) {
        let newDays = [];
        
        // Reset days based on new frequency
        if (newFrequency === 'weekly') {
          newDays = ['monday']; // Default to Monday
        } else if (newFrequency === 'monthly') {
          newDays = ['1']; // Default to 1st of month
        } else if (newFrequency === 'yearly') {
          newDays = ['january', '1']; // Default to January 1st
        } else if (newFrequency === 'daily') {
          newDays = []; // No days needed for daily
        }
        
        return { 
          ...schedule, 
          frequency: newFrequency,
          days: newDays
        };
      }
      return schedule;
    }));
  };

  const saveSettings = async () => {
    // Clear previous errors
    setValidationErrors({});
    setServerError('');
    
    // Validate form before submission
    if (!validateForm()) {
      return;
    }

    setSaveStatus('saving');
    try {
      const res = await fetchData('/api/dealers/report-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealerId: dealerParent.id,
          schedules,
          reportEmail
        }),
      });

      if (res.ok) {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        // Try to get error message from response
        try {
          const errorData = await res.json();
          setServerError(errorData.message || 'Failed to save settings. Please try again.');
        } catch {
          setServerError('Failed to save settings. Please try again.');
        }
      }
    } catch {
      setSaveStatus('error');
      setServerError('Network error. Please check your connection and try again.');
    }
  };

  if (loading || !dealerParent?.id) {
    return (
      <Container className="py-5">
        <Row className="justify-content-center align-items-center" style={{ height: '300px' }}>
          <Spinner animation="border" variant="dark" />
          <p className='text-center'><span className="ms-3">Loading settings...</span></p>
        </Row>
      </Container>
    );
  }

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0">Manage Report Schedule</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Row className="justify-content-center">
          <Col lg={10} xl={8}>
            {/* Server Error Display */}
            {serverError && (
              <Alert variant="danger" dismissible onClose={() => setServerError('')}>
                <i className="bi bi-exclamation-triangle me-2"></i>
                {serverError}
              </Alert>
            )}

            {/* Email Configuration */}
            <div className="w_card">
              <div className="position-relative">
                <h3 className="w_card_title mb-3">Report Email</h3>
                <Form.Group>
                  <Form.Control
                    type="text"
                    value={reportEmail}
                    onChange={(e) => setReportEmail(e.target.value)}
                    placeholder="Enter email address(es) for reports (comma-separated)"
                    isInvalid={!!validationErrors.email}
                  />
                  <Form.Control.Feedback type="invalid">
                    {validationErrors.email}
                  </Form.Control.Feedback>
                  <Form.Text className="text-muted">
                    Scheduled reports will be sent to these email addresses. You can enter multiple emails separated by commas (e.g., email1@example.com, email2@example.com)
                  </Form.Text>
                </Form.Group>
              </div>
            </div>

            {/* Schedule Rules */}
            <div className="w_card">
              <div className="position-relative d-flex mb-3">
                <div className="position-relative d-flex align-items-center me-auto">
                  <h3 className="w_card_title mb-0">Schedule Rules</h3>
                </div>
                <Button variant="custom" size="sm" onClick={handleAddSchedule}>
                  Add Schedule
                </Button>
              </div>
              
              {/* Schedule validation error */}
              {validationErrors.schedules && typeof validationErrors.schedules === 'string' && (
                <Alert variant="danger" className="mt-2">
                  <i className="bi bi-exclamation-triangle me-2"></i>
                  {validationErrors.schedules}
                </Alert>
              )}

              {schedules.length === 0 ? (
                <p className="text-secondary-light text-center">No schedules configured</p>
              ) : (
                <div className="position-relative">
                  {schedules.map((schedule, index) => (
                    <ScheduleEditor
                      key={`${schedule.id}-${schedule.frequency}-${index}`} // Add frequency to key
                      schedule={schedule}
                      validationErrors={validationErrors.schedules?.[index] || {}}
                      onUpdate={(id, updates) => {
                        setSchedules(schedules.map(s => 
                          s.id === id ? { ...s, ...updates } : s
                        ));
                      }}
                      onDelete={(id) => {
                        setSchedules(schedules.filter(s => s.id !== id));
                      }}
                      onFrequencyChange={handleFrequencyChange}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Save button */}
            <div className="d-flex justify-content-end align-items-center gap-3">
              <Button
                variant="custom"
                onClick={saveSettings}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Spinner as="span" animation="border" size="sm" role="status" className="me-2" />
                    Saving...
                  </>
                ) : 'Save Settings'}
              </Button>
              {saveStatus === 'success' && (
                <span className="text-success">
                  <i className="bi bi-check-circle me-1"></i>Saved!
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-danger">
                  <i className="bi bi-x-circle me-1"></i>Failed to save
                </span>
              )}
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
}
