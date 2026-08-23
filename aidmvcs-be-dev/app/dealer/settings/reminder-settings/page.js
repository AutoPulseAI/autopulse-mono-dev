"use client";
import { useState, useEffect } from "react";
import { Container, Row, Col, Card, Form, Button, Alert, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

export default function ReminderSettingsPage() {

  const DEFAULT_SETTINGS = {
    enabled: true,
    total_reminders: 3,
    reminder_intervals: [12, 6],
    reminder_type: "both",
    post_enabled: false,
    post_total_reminders: 1,
    post_intervals: [24],
    post_type: "both",
    // Managerial Review Settings
    review_enabled: true,
    review_frequency: [24],
    review_type: "both"
  };

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // Store raw string values for inputs to allow proper editing
  const [inputValues, setInputValues] = useState({});
  
  const normalizeSettings = (s) => {
    const safe = s || {};
    const toNum = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    const toNumArray = (arr, dArr) => {
      return Array.isArray(arr) ? arr.map((n) => toNum(n, 0)) : dArr;
    };
    return {
      ...DEFAULT_SETTINGS,
      ...safe,
      enabled: !!(safe.enabled ?? DEFAULT_SETTINGS.enabled),
      total_reminders: toNum(safe.total_reminders ?? DEFAULT_SETTINGS.total_reminders, DEFAULT_SETTINGS.total_reminders),
      reminder_intervals: toNumArray(safe.reminder_intervals, DEFAULT_SETTINGS.reminder_intervals),
      reminder_type: safe.reminder_type ?? DEFAULT_SETTINGS.reminder_type,
      post_enabled: !!(safe.post_enabled ?? DEFAULT_SETTINGS.post_enabled),
      post_total_reminders: toNum(safe.post_total_reminders ?? DEFAULT_SETTINGS.post_total_reminders, DEFAULT_SETTINGS.post_total_reminders),
      post_intervals: toNumArray(safe.post_intervals, DEFAULT_SETTINGS.post_intervals),
      post_type: safe.post_type ?? DEFAULT_SETTINGS.post_type,
      // Managerial Review Settings
      review_enabled: !!(safe.review_enabled ?? DEFAULT_SETTINGS.review_enabled),
      review_frequency: toNumArray(safe.review_frequency, DEFAULT_SETTINGS.review_frequency),
      review_type: safe.review_type ?? DEFAULT_SETTINGS.review_type,
    };
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { user, dealerParent } = useUser();

  useEffect(() => {
    fetchSettings();
  }, [dealerParent, user]);

  const fetchSettings = async () => {
    try {
      const activeEntity = dealerParent || user;
      if (!activeEntity?.id) {
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/dealers/reminder-settings?dealer_id=${activeEntity.id}`,{
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        console.log('Received settings from API:', data.settings);
        const normalized = normalizeSettings(data.settings);
        setSettings(normalized);
        
        // Initialize input values from normalized settings
        const initialInputValues = {};
        (normalized.reminder_intervals || []).forEach((val, idx) => {
          initialInputValues[`reminder_${idx}`] = String(val);
        });
        (normalized.post_intervals || []).forEach((val, idx) => {
          initialInputValues[`post_${idx}`] = String(val);
        });
        (normalized.review_frequency || []).forEach((val, idx) => {
          initialInputValues[`review_${idx}`] = String(val);
        });
        setInputValues(initialInputValues);
      } else {
        setError("Failed to load reminder settings");
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
      setError("Failed to load reminder settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const activeEntity = dealerParent || user;
      if (!activeEntity?.id) {
        setSaving(false);
        return;
      }

      const payload = {
        dealer_id: activeEntity.id,
        ...settings,
        enabled: !!settings.enabled,
        total_reminders: Number(settings.total_reminders || DEFAULT_SETTINGS.total_reminders),
        reminder_intervals: (settings.reminder_intervals || DEFAULT_SETTINGS.reminder_intervals).map(n => Number(n)),
        reminder_type: settings.reminder_type || DEFAULT_SETTINGS.reminder_type,
        post_enabled: !!settings.post_enabled,
        post_total_reminders: Number(settings.post_total_reminders || DEFAULT_SETTINGS.post_total_reminders),
        post_intervals: (settings.post_intervals || DEFAULT_SETTINGS.post_intervals).map(n => Number(n)),
        post_type: settings.post_type || DEFAULT_SETTINGS.post_type,
        // Managerial Review Settings
        review_enabled: !!settings.review_enabled,
        review_frequency: (settings.review_frequency || DEFAULT_SETTINGS.review_frequency).map(n => Number(n)),
        review_type: settings.review_type || DEFAULT_SETTINGS.review_type
      };
      
      console.log('Sending payload:', JSON.stringify(payload, null, 2));

      const response = await fetch("/api/dealers/reminder-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`  
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      
      console.log('Received response:', JSON.stringify(data, null, 2));
      
      if (data.success) {
        setMessage("Reminder settings saved successfully!");
        setSettings(normalizeSettings(data.settings));
        // Clear message after 5 seconds
        setTimeout(() => {
          setMessage("");
        }, 5000);
      } else {
        setError(data.error || "Failed to save settings");
        // Clear error after 5 seconds
        setTimeout(() => {
          setError("");
        }, 5000);
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      setError("Failed to save settings");
      // Clear error after 5 seconds
      setTimeout(() => {
        setError("");
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleReminderIntervalChange = (index, value) => {
    // Allow only numbers, decimal point, and empty string
    const sanitized = value.replace(/[^0-9.]/g, '');
    // Prevent multiple decimal points
    const parts = sanitized.split('.');
    const finalValue = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : sanitized;
    
    // Store raw string value for this input
    const inputKey = `reminder_${index}`;
    setInputValues({ ...inputValues, [inputKey]: finalValue });
    
    // Only update settings if value is valid number (allow empty for editing)
    if (finalValue === '' || finalValue === null || finalValue === undefined) {
      return; // Keep the raw value, don't update settings yet
    }
    
    const num = parseFloat(finalValue);
    if (Number.isFinite(num) && num >= 0) {
      const current = settings.reminder_intervals || [];
      const newIntervals = [...current];
      newIntervals[index] = num;
      setSettings({ ...settings, reminder_intervals: newIntervals, total_reminders: newIntervals.length });
    }
  };

  const handleReminderIntervalBlur = (index) => {
    const inputKey = `reminder_${index}`;
    const rawValue = inputValues[inputKey];
    const current = settings.reminder_intervals || [];
    const newIntervals = [...current];
    
    // If empty or invalid, restore the previous valid value
    if (!rawValue || rawValue === '' || isNaN(parseFloat(rawValue))) {
      // Restore previous value
      setInputValues({ ...inputValues, [inputKey]: String(current[index] || 0) });
    } else {
      const num = parseFloat(rawValue);
      if (Number.isFinite(num) && num >= 0) {
        newIntervals[index] = num;
        setSettings({ ...settings, reminder_intervals: newIntervals, total_reminders: newIntervals.length });
      }
    }
  };

  const addReminderInterval = () => {
    const current = settings.reminder_intervals || [];
    if (current.length < 10) {
      const newIndex = current.length;
      setSettings({
        ...settings,
        reminder_intervals: [...current, 1],
        total_reminders: current.length + 1
      });
      // Initialize input value for new field
      setInputValues({ ...inputValues, [`reminder_${newIndex}`]: '1' });
    }
  };

  const handlePostIntervalChange = (index, value) => {
    // Allow only numbers (no decimals for post intervals)
    const sanitized = value.replace(/[^0-9]/g, '');
    
    // Store raw string value for this input
    const inputKey = `post_${index}`;
    setInputValues({ ...inputValues, [inputKey]: sanitized });
    
    // Only update settings if value is valid number (allow empty for editing)
    if (sanitized === '' || sanitized === null || sanitized === undefined) {
      return; // Keep the raw value, don't update settings yet
    }
    
    const num = parseInt(sanitized, 10);
    if (Number.isFinite(num) && num >= 0) {
      const newIntervals = [...settings.post_intervals];
      newIntervals[index] = num;
      setSettings({ ...settings, post_intervals: newIntervals, post_total_reminders: newIntervals.length });
    }
  };

  const handlePostIntervalBlur = (index) => {
    const inputKey = `post_${index}`;
    const rawValue = inputValues[inputKey];
    const newIntervals = [...settings.post_intervals];
    
    // If empty or invalid, restore the previous valid value
    if (!rawValue || rawValue === '' || isNaN(parseFloat(rawValue))) {
      // Restore previous value
      setInputValues({ ...inputValues, [inputKey]: String(newIntervals[index] || 1) });
    } else {
      const num = parseFloat(rawValue);
      if (Number.isFinite(num) && num >= 0) {
        newIntervals[index] = num;
        setSettings({ ...settings, post_intervals: newIntervals, post_total_reminders: newIntervals.length });
      }
    }
  };

  const addPostInterval = () => {
    if (settings.post_intervals.length < 10) {
      const newIntervals = [...settings.post_intervals, 24];
      const newIndex = newIntervals.length - 1;
      setSettings({ ...settings, post_intervals: newIntervals, post_total_reminders: newIntervals.length });
      // Initialize input value for new field
      setInputValues({ ...inputValues, [`post_${newIndex}`]: '24' });
    }
  };

  const removePostInterval = (index) => {
    if (settings.post_intervals.length > 1) {
      const newIntervals = settings.post_intervals.filter((_, i) => i !== index);
      setSettings({ ...settings, post_intervals: newIntervals, post_total_reminders: newIntervals.length });
    }
  };

  const removeReminderInterval = (index) => {
    const current = settings.reminder_intervals || [];
    if (current.length > 1) {
      const newIntervals = current.filter((_, i) => i !== index);
      setSettings({
        ...settings,
        reminder_intervals: newIntervals,
        total_reminders: newIntervals.length
      });
    }
  };

  // Managerial Review handlers
  const handleReviewFrequencyChange = (index, value) => {
    // Allow only numbers (no decimals for review frequency)
    const sanitized = value.replace(/[^0-9]/g, '');
    
    // Store raw string value for this input
    const inputKey = `review_${index}`;
    setInputValues({ ...inputValues, [inputKey]: sanitized });
    
    // Only update settings if value is valid number (allow empty for editing)
    if (sanitized === '' || sanitized === null || sanitized === undefined) {
      return; // Keep the raw value, don't update settings yet
    }
    
    const num = parseInt(sanitized, 10);
    if (Number.isFinite(num) && num >= 0) {
      const newFrequency = [...settings.review_frequency];
      newFrequency[index] = num;
      setSettings({ ...settings, review_frequency: newFrequency });
    }
  };

  const handleReviewFrequencyBlur = (index) => {
    const inputKey = `review_${index}`;
    const rawValue = inputValues[inputKey];
    const newFrequency = [...settings.review_frequency];
    
    // If empty or invalid, restore the previous valid value
    if (!rawValue || rawValue === '' || isNaN(parseFloat(rawValue))) {
      // Restore previous value
      setInputValues({ ...inputValues, [inputKey]: String(newFrequency[index] || 24) });
    } else {
      const num = parseFloat(rawValue);
      if (Number.isFinite(num) && num >= 0) {
        newFrequency[index] = num;
        setSettings({ ...settings, review_frequency: newFrequency });
      }
    }
  };

  const addReviewFrequency = () => {
    if (settings.review_frequency.length < 10) {
      const newFrequency = [...settings.review_frequency, 24];
      const newIndex = newFrequency.length - 1;
      setSettings({ ...settings, review_frequency: newFrequency });
      // Initialize input value for new field
      setInputValues({ ...inputValues, [`review_${newIndex}`]: '24' });
    }
  };

  const removeReviewFrequency = (index) => {
    if (settings.review_frequency.length > 1) {
      const newFrequency = settings.review_frequency.filter((_, i) => i !== index);
      setSettings({ ...settings, review_frequency: newFrequency });
    }
  };

  if (loading) {
    return (
      <Container className="py-4">
        <div className="text-center">
          <Spinner animation="border" />
          <p className="mt-2">Loading reminder settings...</p>
        </div>
      </Container>
    );
  }

  return (
    <>
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-1">Messaging & Reminder Settings</h3>
              </div>
                <p className="text-muted mb-0">Configure appointment reminders and managerial review messaging</p>
            </div>
          </div>

          {message && (
            <Row>
              <Col>
                <Alert variant="success" className="mb-0 mt-2 p-2">
                  <i className="fa-solid fa-circle-check me-2"></i>
                  {message}
                </Alert>
              </Col>
            </Row>
          )}

          {error && (
            <Row>
              <Col>
                <Alert variant="danger" className="mb-0 mt-2 p-2">
                  <i className="fa-solid fa-triangle-exclamation me-2"></i>
                  {error}
                </Alert>
              </Col>
            </Row>
          )}
        </div>

        <div className="page_body">         

          <Row className="justify-content-center">
            <Col lg={10} xl={8}>
              {/* Appointment Reminders */}
              <div className="position-relative d-flex mb-3 mt-2">
                  <h3 className="w_card_title mb-0">Appointment Reminders</h3>
              </div>

              <div className="w_card mb-2">               
                {/* Enable Appointment Reminders */}
                <div className="position-relative">
                  <div className="d-flex align-items-center p-md-3 p-2 rounded-2" style={{ backgroundColor: '#e3f2fd' }}>
                    <Form.Check
                      type="switch"
                      id="enabled"
                      label=""
                      checked={!!settings.enabled}
                      onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                      className="me-3"
                    />
                    <div>
                      <h6 className="w_card_title mb-1">Enable Appointment Reminders</h6>
                      <small className="text-muted">Turn on automatic reminders for your appointments</small>
                    </div>
                  </div>
                </div>

                {settings.enabled && (
                  <div className="position-relative mb-2 mt-3">
                    <Form.Label className="fw-semibold text-dark mb-3">
                      When to send reminders (hours before appointment)
                    </Form.Label>
                    
                    <div className="border rounded-2 px-3 mb-1" style={{ backgroundColor: '#f8f9fa' }}>
                      <div className="position-relative mb-3">
                      {(settings.reminder_intervals || []).map((interval, index) => (
                        <div key={index} className="d-flex align-items-center followup_rule">
                          <div className="d-flex align-items-center me-3">
                            <span className="badge bg-custom me-2" style={{ minWidth: '30px' }}>
                              {index + 1}
                            </span>
                            <Form.Control
                              type="text"
                              inputMode="decimal"
                              min="0.5"
                              max="168"
                              step="0.5"
                              value={inputValues[`reminder_${index}`] !== undefined ? inputValues[`reminder_${index}`] : String(interval ?? 0)}
                              onChange={(e) => handleReminderIntervalChange(index, e.target.value)}
                              onBlur={() => handleReminderIntervalBlur(index)}
                              disabled={!settings.enabled}
                              className="form-control-sm"
                              style={{ width: "100px" }}
                            />
                            <span className="ms-2 text-muted">hours before</span>
                          </div>
                          {(settings.reminder_intervals || []).length > 1 && (
                            <Button
                              size="sm"
                              onClick={() => removeReminderInterval(index)}
                              disabled={!settings.enabled}
                              className="ms-auto close_sm btn btn-danger"
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </Button>
                          )}
                        </div>
                      ))}
                      </div>

                      {(settings.reminder_intervals || []).length < 10 && (
                        <Button
                          variant="custom"
                          size="sm"
                          onClick={addReminderInterval}
                          disabled={!settings.enabled}
                          className="mx-auto mb-md-3 mb-2"
                        >
                          Add Another Reminder
                        </Button>
                      )}
                    </div>
                    
                    <Form.Text className="text-muted">
                      <i className="fa-solid fa-circle-info me-1"></i>Configure when to send each reminder before the appointment (0.5 to 168 hours)
                    </Form.Text>
                  </div>
                )}
              </div>

              <div className="w_card">               
                {/* Post-appointment follow-ups */}
                <div className="position-relative">
                  <div className="d-flex align-items-center p-md-3 p-2 rounded-2" style={{ backgroundColor: '#fff8e1' }}>
                    <Form.Check
                      type="switch"
                      id="post_enabled"
                      label=""
                      checked={settings.post_enabled}
                      onChange={(e) => setSettings({ ...settings, post_enabled: e.target.checked })}
                      className="me-3"
                    />
                    <div>
                      <h6 className="w_card_title mb-1">Enable Post-Appointment Follow-ups</h6>
                      <small className="text-muted">Send follow-up reminders after the appointment for feedback or next steps</small>
                    </div>
                  </div>
                </div>

                {settings.post_enabled && (
                  <div className="position-relative mb-2 mt-3">
                    <Form.Label className="fw-semibold text-dark mb-3">
                      <i className="bi bi-clock-history me-2 text-warning"></i>
                      When to send follow-ups (hours after appointment)
                    </Form.Label>
                    <div className="border rounded-2 px-3 mb-1" style={{ backgroundColor: '#f8f9fa' }}>
                      <div className="position-relative mb-3">
                      {(settings.post_intervals || []).map((interval, index) => (
                        <div key={index} className="d-flex align-items-center followup_rule">
                          <div className="d-flex align-items-center me-3">
                            <span className="badge bg-custom me-2" style={{ minWidth: '30px' }}>
                              {index + 1}
                            </span>
                            <Form.Control
                              type="text"
                              inputMode="numeric"
                              min="1"
                              max="720"
                              step="1"
                              value={inputValues[`post_${index}`] !== undefined ? inputValues[`post_${index}`] : String(interval ?? 1)}
                              onChange={(e) => handlePostIntervalChange(index, e.target.value)}
                              onBlur={() => handlePostIntervalBlur(index)}
                              disabled={!settings.post_enabled}
                              className="form-control-sm"
                              style={{ width: "100px" }}
                            />
                            <span className="ms-2 text-muted">hours after</span>
                          </div>
                          {(settings.post_intervals || []).length > 1 && (
                            <Button
                              size="sm"
                              onClick={() => removePostInterval(index)}
                              disabled={!settings.post_enabled}
                              className="ms-auto close_sm btn btn-danger"
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </Button>
                          )}
                        </div>
                      ))}
                      </div>

                      {(settings.post_intervals || []).length < 10 && (
                        <Button
                          variant="custom"
                          size="sm"
                          onClick={addPostInterval}
                          disabled={!settings.post_enabled}
                          className="mx-auto mb-md-3 mb-2"
                        >
                          Add Another Follow-up
                        </Button>
                      )}
                    </div>
                    <Form.Text className="text-muted">
                      <i className="fa-solid fa-circle-info me-1"></i>
                      Configure when to send each follow-up after the appointment (1 to 720 hours)
                    </Form.Text>
                  </div>
                )}
              </div>

              {/* Managerial Review Messaging */}
              <div className="position-relative d-flex mb-3 mt-4">
                  <h3 className="w_card_title mb-0">Managerial Review Messaging</h3>
              </div>

              <div className="w_card">    
                {/* Enable Managerial Review Messaging            */}
                <div className="position-relative">
                  <div className="d-flex align-items-center p-md-3 p-2 rounded-2" style={{ backgroundColor: '#e3f2fd' }}>
                    <Form.Check
                      type="switch"
                      id="review_enabled"
                      label=""
                      checked={settings.review_enabled}
                      onChange={(e) => setSettings({ ...settings, review_enabled: e.target.checked })}
                      className="me-3"
                    />
                    <div>
                      <h6 className="w_card_title mb-1">Enable Managerial Review Messaging</h6>
                      <small className="text-muted">Send follow-up messages when leads are moved to "Managerial Review" status</small>
                    </div>
                  </div>
                </div>

                {settings.review_enabled && (
                  <div className="position-relative mb-2 mt-3">
                    <Form.Label className="fw-semibold text-dark mb-3">
                        <i className="bi bi-clock-history me-2 text-warning"></i>
                        When to send messages (hours after status change)
                      </Form.Label>
                     <div className="border rounded-2 px-3 mb-1" style={{ backgroundColor: '#f8f9fa' }}>
                      <div className="position-relative mb-3">
                        {settings.review_frequency.map((interval, index) => (
                          <div key={index} className="d-flex align-items-center followup_rule">
                            <div className="d-flex align-items-center me-3">
                              <span className="badge bg-custom me-2" style={{ minWidth: '30px' }}>
                                {index + 1}
                              </span>
                              <Form.Control
                                type="text"
                                inputMode="numeric"
                                min="1"
                                max="720"
                                step="1"
                                value={inputValues[`review_${index}`] !== undefined ? inputValues[`review_${index}`] : String(interval)}
                                onChange={(e) => handleReviewFrequencyChange(index, e.target.value)}
                                onBlur={() => handleReviewFrequencyBlur(index)}
                                disabled={!settings.review_enabled}
                                className="form-control-sm"
                                style={{ width: "100px" }}
                              />
                              <span className="ms-2 text-muted">hours after</span>
                            </div>
                            {settings.review_frequency.length > 1 && (
                              <Button
                                size="sm"
                                onClick={() => removeReviewFrequency(index)}
                                disabled={!settings.review_enabled}
                                className="ms-auto close_sm btn btn-danger"
                            >
                              <i className="fa-solid fa-xmark"></i>
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>

                        {settings.review_frequency.length < 10 && (
                          <Button
                            variant="custom"
                            size="sm"
                            onClick={addReviewFrequency}
                            disabled={!settings.review_enabled}
                            className="mx-auto mb-md-3 mb-2"
                          >
                            <i className="bi bi-plus-circle me-2"></i>
                            Add Another Message
                          </Button>
                        )}
                      </div>
                      <Form.Text className="text-muted">
                        <i className="fa-solid fa-circle-info me-1"></i>Configure when to send each message after lead status changes to "Managerial Review" (1 to 720 hours)
                      </Form.Text>
                  </div>
                )}
              </div>
            </Col>

            {/* Submit Button */}
            <Col lg={10} xl={8}>
              <div className="text-center mb-4">
                <Button
                  variant="custom"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Saving Settings...
                    </>
                  ) : (
                    <>
                      Save All Settings
                    </>
                  )}
                </Button>
              </div>
            </Col>

          </Row>
        </div>
      </div>

    {/* <div className="min-vh-100" style={{ backgroundColor: '#f8f9fa' }}>
      <Container className="py-5">
        <Row className="mb-4">
          <Col>
            <div className="text-center mb-4">
              <h1 className="display-6 fw-bold text-primary mb-3">
                <i className="bi bi-bell me-3"></i>
                Messaging & Reminder Settings
              </h1>
              <p className="lead text-muted">Configure appointment reminders and managerial review messaging</p>
            </div>
          </Col>
        </Row> */}

        

        {/* <Row className="justify-content-center">
          <Col lg={10} xl={8}>
            <Card className="border-0 shadow-lg">
              <Card.Header className="bg-primary text-white border-0 py-4">
                <h4 className="mb-0 fw-semibold">
                  <i className="bi bi-gear me-2"></i>
                  Appointment Reminders
                </h4>
              </Card.Header>
              <Card.Body className="p-4">
              <Form>
                <div className="mb-4">
                  <div className="d-flex align-items-center p-3 rounded-3" style={{ backgroundColor: '#e3f2fd' }}>
                    <Form.Check
                      type="switch"
                      id="enabled"
                      label=""
                      checked={!!settings.enabled}
                      onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                      className="me-3"
                    />
                    <div>
                      <h6 className="mb-1 fw-semibold">Enable Appointment Reminders</h6>
                      <small className="text-muted">Turn on automatic reminders for your appointments</small>
                    </div>
                  </div>
                </div>

                <div className="mb-4 mt-4">
                  <div className="d-flex align-items-center p-3 rounded-3" style={{ backgroundColor: '#fff8e1' }}>
                    <Form.Check
                      type="switch"
                      id="post_enabled"
                      label=""
                      checked={settings.post_enabled}
                      onChange={(e) => setSettings({ ...settings, post_enabled: e.target.checked })}
                      className="me-3"
                    />
                    <div>
                      <h6 className="mb-1 fw-semibold">Enable Post-Appointment Follow-ups</h6>
                      <small className="text-muted">Send follow-up reminders after the appointment for feedback or next steps</small>
                    </div>
                  </div>
                </div>

                {settings.post_enabled && (
                  <div className="mb-4">
                    <Form.Label className="fw-semibold text-dark mb-3">
                      <i className="bi bi-clock-history me-2 text-warning"></i>
                      When to send follow-ups (hours after appointment)
                    </Form.Label>
                    <div className="border rounded-3 p-3" style={{ backgroundColor: '#f8f9fa' }}>
                      {(settings.post_intervals || []).map((interval, index) => (
                        <div key={index} className="d-flex align-items-center mb-3 p-2 rounded-2" style={{ backgroundColor: 'white' }}>
                          <div className="d-flex align-items-center me-3">
                            <span className="badge bg-warning text-dark me-2" style={{ minWidth: '30px' }}>
                              {index + 1}
                            </span>
                            <Form.Control
                              type="number"
                              min="1"
                              max="720"
                              step="1"
                              value={Number(interval ?? 1)}
                              onChange={(e) => handlePostIntervalChange(index, e.target.value)}
                              disabled={!settings.post_enabled}
                              className="border-2"
                              style={{ width: "100px" }}
                            />
                            <span className="ms-2 text-muted">hours after</span>
                          </div>
                          {(settings.post_intervals || []).length > 1 && (
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => removePostInterval(index)}
                              disabled={!settings.post_enabled}
                              className="ms-auto"
                            >
                              <i className="bi bi-trash"></i>
                            </Button>
                          )}
                        </div>
                      ))}

                      {(settings.post_intervals || []).length < 10 && (
                        <Button
                          variant="outline-warning"
                          size="sm"
                          onClick={addPostInterval}
                          disabled={!settings.post_enabled}
                          className="w-100"
                        >
                          <i className="bi bi-plus-circle me-2"></i>
                          Add Another Follow-up
                        </Button>
                      )}
                    </div>
                    <Form.Text className="text-muted">
                      <i className="bi bi-info-circle me-1"></i>
                      Configure when to send each follow-up after the appointment (1 to 720 hours)
                    </Form.Text>
                  </div>
                )}

                <div className="mb-4">
                  <Form.Label className="fw-semibold text-dark mb-3">
                    <i className="bi bi-clock me-2 text-primary"></i>
                    When to send reminders (hours before appointment)
                  </Form.Label>
                  
                  <div className="border rounded-3 p-3" style={{ backgroundColor: '#f8f9fa' }}>
                    {(settings.reminder_intervals || []).map((interval, index) => (
                      <div key={index} className="d-flex align-items-center mb-3 p-2 rounded-2" style={{ backgroundColor: 'white' }}>
                        <div className="d-flex align-items-center me-3">
                          <span className="badge bg-primary me-2" style={{ minWidth: '30px' }}>
                            {index + 1}
                          </span>
                          <Form.Control
                            type="number"
                            min="0.5"
                            max="168"
                            step="0.5"
                            value={Number(interval ?? 0)}
                            onChange={(e) => handleReminderIntervalChange(index, e.target.value)}
                            disabled={!settings.enabled}
                            className="border-2"
                            style={{ width: "100px" }}
                          />
                          <span className="ms-2 text-muted">hours before</span>
                        </div>
                        {(settings.reminder_intervals || []).length > 1 && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => removeReminderInterval(index)}
                            disabled={!settings.enabled}
                            className="ms-auto"
                          >
                            <i className="bi bi-trash"></i>
                          </Button>
                        )}
                      </div>
                    ))}
                    
                    {(settings.reminder_intervals || []).length < 10 && (
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={addReminderInterval}
                        disabled={!settings.enabled}
                        className="w-100"
                      >
                        <i className="bi bi-plus-circle me-2"></i>
                        Add Another Reminder
                      </Button>
                    )}
                  </div>
                  
                  <Form.Text className="text-muted">
                    <i className="bi bi-info-circle me-1"></i>
                    Configure when to send each reminder before the appointment (0.5 to 168 hours)
                  </Form.Text>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row> */}

      {/* Managerial Review Section */}
      {/* <Row className="mt-5 justify-content-center">
        <Col lg={10} xl={8}>
          <Card className="border-0 shadow-lg">
            <Card.Header className="bg-warning text-dark border-0 py-4">
              <h4 className="mb-0 fw-semibold">
                <i className="bi bi-clipboard-check me-2"></i>
                Managerial Review Messaging
              </h4>
            </Card.Header>
            <Card.Body className="p-4">
              <Form>
                <div className="mb-4">
                  <div className="d-flex align-items-center p-3 rounded-3" style={{ backgroundColor: '#fff3cd' }}>
                    <Form.Check
                      type="switch"
                      id="review_enabled"
                      label=""
                      checked={settings.review_enabled}
                      onChange={(e) => setSettings({ ...settings, review_enabled: e.target.checked })}
                      className="me-3"
                    />
                    <div>
                      <h6 className="mb-1 fw-semibold">Enable Managerial Review Messaging</h6>
                      <small className="text-muted">Send follow-up messages when leads are moved to "Managerial Review" status</small>
                    </div>
                  </div>
                </div>

                {settings.review_enabled && (
                  <>
                    <div className="mb-4">
                      <Form.Label className="fw-semibold text-dark mb-3">
                        <i className="bi bi-clock-history me-2 text-warning"></i>
                        When to send messages (hours after status change)
                      </Form.Label>
                      <div className="border rounded-3 p-3" style={{ backgroundColor: '#f8f9fa' }}>
                        {settings.review_frequency.map((interval, index) => (
                          <div key={index} className="d-flex align-items-center mb-3 p-2 rounded-2" style={{ backgroundColor: 'white' }}>
                            <div className="d-flex align-items-center me-3">
                              <span className="badge bg-warning text-dark me-2" style={{ minWidth: '30px' }}>
                                {index + 1}
                              </span>
                              <Form.Control
                                type="number"
                                min="1"
                                max="720"
                                step="1"
                                value={Number(interval)}
                                onChange={(e) => handleReviewFrequencyChange(index, e.target.value)}
                                disabled={!settings.review_enabled}
                                className="border-2"
                                style={{ width: "100px" }}
                              />
                              <span className="ms-2 text-muted">hours after</span>
                            </div>
                            {settings.review_frequency.length > 1 && (
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => removeReviewFrequency(index)}
                                disabled={!settings.review_enabled}
                                className="ms-auto"
                              >
                                <i className="bi bi-trash"></i>
                              </Button>
                            )}
                          </div>
                        ))}

                        {settings.review_frequency.length < 10 && (
                          <Button
                            variant="outline-warning"
                            size="sm"
                            onClick={addReviewFrequency}
                            disabled={!settings.review_enabled}
                            className="w-100"
                          >
                            <i className="bi bi-plus-circle me-2"></i>
                            Add Another Message
                          </Button>
                        )}
                      </div>
                      <Form.Text className="text-muted">
                        <i className="bi bi-info-circle me-1"></i>
                        Configure when to send each message after lead status changes to "Managerial Review" (1 to 720 hours)
                      </Form.Text>
                    </div>
                  </>
                )}
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row> */}

      {/* Submit Button */}
      {/* <Row className="mt-4 justify-content-center">
        <Col lg={10} xl={8}>
          <div className="text-center">
            <Button
              variant="success"
              size="lg"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-3 rounded-pill"
            >
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Saving Settings...
                </>
              ) : (
                <>
                  <i className="bi bi-check-circle me-2"></i>
                  Save All Settings
                </>
              )}
            </Button>
          </div>
        </Col>
      </Row> */}

      {/* Preview Section */}
      {/* <Row className="mt-5 justify-content-center">
        <Col lg={10} xl={8}>
          <Card className="border-0 shadow">
            <Card.Header className="bg-info text-white border-0 py-3">
              <h5 className="mb-0 fw-semibold">
                <i className="bi bi-eye me-2"></i>
                Preview Schedule
              </h5>
            </Card.Header>
            <Card.Body className="p-4">
              <div className="text-center mb-4">
                <h6 className="text-muted">For an appointment on <strong>Jan 15, 2024 at 2:00 PM</strong>:</h6>
              </div>
              
              <div className="row g-3">
                {settings.reminder_intervals.map((interval, index) => {
                  const exampleDate = new Date('2024-01-15T14:00:00');
                  const reminderTime = new Date(exampleDate.getTime() - (interval * 60 * 60 * 1000));
                  return (
                    <div key={index} className="col-md-6 col-lg-4">
                      <div className="card border-0 h-100" style={{ backgroundColor: '#f8f9fa' }}>
                        <div className="card-body text-center p-3">
                          <div className="badge bg-primary mb-2" style={{ fontSize: '0.8rem' }}>
                            Reminder {index + 1}
                          </div>
                          <h6 className="card-title mb-1">
                            {reminderTime.toLocaleDateString('en-US', { 
                              weekday: 'short', 
                              month: 'short', 
                              day: 'numeric' 
                            })}
                          </h6>
                          <p className="card-text mb-1 fw-semibold text-primary">
                            {reminderTime.toLocaleTimeString('en-US', { 
                              hour: 'numeric', 
                              minute: '2-digit', 
                              hour12: true 
                            })}
                          </p>
                          <small className="text-muted">
                            {interval}h before appointment
                          </small>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row> */}
    {/* </Container>
    </div> */}
    </>
  );
}
