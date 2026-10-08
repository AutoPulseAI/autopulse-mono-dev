'use client';

import { useState, useEffect } from 'react';
import RuleEditor from './RuleEditor';
import useFetch from "../../../hooks/useFetch";
import { useUser } from "../../context/UserContext";
import Spinner from 'react-bootstrap/Spinner';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Card from 'react-bootstrap/Card';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';

export default function SettingsPage() {
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [rules, setRules] = useState([]);
  const [saveStatus, setSaveStatus] = useState('idle');

  const { fetchData, loading } = useFetch();
  const { user, dealerParent } = useUser();

  // Your lead‑status options
  const statusOptions = [
    'Lead', 'Contacted',  'Visited',
    'Sold','Deal Close','No Show'
  ];

  // Load existing settings
  useEffect(() => {
    if (loading) return;
    if (!dealerParent?.setting) return;
    setAutoReplyEnabled('autoReplyEnabled' in dealerParent.setting ? dealerParent.setting.autoReplyEnabled : true);
    //setAutoReplyEnabled(dealerParent.setting.autoReplyEnabled || false);
    setRules(dealerParent.setting.rules || []);
  }, [loading, dealerParent]);

  // Show spinner until we have a dealer ID
  if (loading || !dealerParent?.id) {
    return (
      <Container className="py-5">
        <Row
          className="justify-content-center align-items-center"
          style={{ height: '300px' }}
        >
          <Spinner animation="border" variant="dark" />
          <p className='text-center'><span className="ms-3">Loading settings...</span></p>
        </Row>
      </Container>
    );
  }

  // Add a fresh, blank rule
  const addNewRule = () => {
    setRules([
      ...rules,
      {
        id: Date.now().toString(),
        leadStatus: '',
        active: true,
        frequencyValue: 1,
        stopAfter: 0,
      },
    ]);
  };

  // Update or delete a rule
  const updateRule = (id, updated) => {
    setRules(rules.map(r => (r.id === id ? { ...r, ...updated } : r)));
  };
  const deleteRule = (id) => {
    setRules(rules.filter(r => r.id !== id));
  };

  // Persist to your API
  const saveSettings = async () => {
    setSaveStatus('saving');
    try {
      const res = await fetchData('/api/dealers/setting', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' ,'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`},
        body: JSON.stringify({
          dealerId: dealerParent.id,
          autoReplyEnabled,
          rules,
        }),
      });

      if (res.ok) {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  };

  return (
    <>
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">Manage Follow-up Setting</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          <Row className="justify-content-center">
            <Col lg={10} xl={8}>
              {/* Auto‑reply */}
              <div className="w_card">
                <div className="position-relative d-flex">
                  <div className="position-relative me-auto">
                    <h3 className="w_card_title mb-0">Auto-reply</h3>
                    <p className='text-secondary-light mb-0'><small>When enabled, incoming messages get an automatic reply.</small></p>
                  </div>
                  <Form.Check
                    type="switch"
                    id="auto-reply-switch"
                    label={autoReplyEnabled ? 'Enabled' : 'Disabled'}
                    checked={autoReplyEnabled}
                    onChange={e => setAutoReplyEnabled(e.target.checked)}
                  />
                </div>
              </div>

              {/* Follow‑up */}
              <div className="w_card">
                <div className="position-relative d-flex">
                  <div className="position-relative me-auto">
                    <h3 className="w_card_title mb-0">Follow-up Rules</h3>
                    {/* <p className='text-secondary-light mb-0'><small>No follow‑up rules configured</small></p> */}
                  </div>
                  <Button variant="custom" size="sm" onClick={addNewRule}>Add Rule</Button>
                </div>
                {rules.length === 0 ? (
                  <p className="text-secondary-light text-center">No follow‑up rules configured</p>
                ) : (
                  <div className="position-relative">
                    {rules.map(rule => (
                      <RuleEditor
                        key={rule.id}
                        rule={rule}
                        statusOptions={statusOptions}
                        onUpdate={updateRule}
                        onDelete={deleteRule}
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
                      <Spinner
                        as="span"
                        animation="border"
                        size="sm"
                        role="status"
                        className="me-2"
                      />
                      Saving...
                    </>
                  ) : (
                    'Save Settings'
                  )}
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

      {/* <Container className="py-4">
        <Row className="justify-content-center">
          <Col md={10} lg={8}>
            <h1 className="mb-4">Follow‑up Settings</h1>

     
            <Card className="mb-4">
              <Card.Header className="d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Auto‑reply</h5>
                <Form.Check
                  type="switch"
                  id="auto-reply-switch"
                  label={autoReplyEnabled ? 'Enabled' : 'Disabled'}
                  checked={autoReplyEnabled}
                  onChange={e => setAutoReplyEnabled(e.target.checked)}
                />
              </Card.Header>
              <Card.Body>
                <Card.Text className="text-muted">
                  When enabled, incoming messages get an automatic reply.
                </Card.Text>
              </Card.Body>
            </Card>

          
            <Card className="mb-4">
              <Card.Header>
                <Row className="align-items-center">
                  <Col><h5 className="mb-0">Follow‑up Rules</h5></Col>
                  <Col xs="auto">
                    <Button variant="primary" size="sm" onClick={addNewRule}>
                      Add Rule
                    </Button>
                  </Col>
                </Row>
              </Card.Header>
              <Card.Body>
                {rules.length === 0 ? (
                  <Card.Text className="text-muted">
                    No follow‑up rules configured
                  </Card.Text>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {rules.map(rule => (
                      <RuleEditor
                        key={rule.id}
                        rule={rule}
                        statusOptions={statusOptions}
                        onUpdate={updateRule}
                        onDelete={deleteRule}
                      />
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>


            <div className="d-flex justify-content-end align-items-center gap-3">
              <Button
                variant="success"
                onClick={saveSettings}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Spinner
                      as="span"
                      animation="border"
                      size="sm"
                      role="status"
                      className="me-2"
                    />
                    Saving...
                  </>
                ) : (
                  'Save Settings'
                )}
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
      </Container> */}
    </>

  );
}
