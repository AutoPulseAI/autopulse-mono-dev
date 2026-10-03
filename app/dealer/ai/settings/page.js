"use client";
// AI Settings for the dealership: AI mode (off / shadow / on), vehicle photos in
// texts (MMS), and the opening hours the AI works to (read-only; they come from the
// dealer account).
//   /dealer/ai/settings

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import { AI_MODE_LABELS, aiFetch } from "../components/aiShared";

const MODES = ["off", "shadow", "live"];
const MODE_TITLES = { off: "Off", shadow: "Shadow (drafts only)", live: "On" };

export default function AiSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [mode, setMode] = useState("off");
  const [mms, setMms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await aiFetch("/api/dealer-ai/settings");
        setSettings(data);
        setMode(data.ai_mode);
        setMms(data.mms_enabled);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const changed = settings && (mode !== settings.ai_mode || mms !== settings.mms_enabled);

  const save = async () => {
    if (mode === "live" && settings.ai_mode !== "live"
      && !window.confirm("Turn the AI on? It will start replying to customers and running follow-ups. "
        + "Your existing rule-based follow-ups that are still waiting will be cleared.")) {
      return;
    }
    setSaveStatus("saving");
    setError("");
    try {
      const body = {};
      if (mode !== settings.ai_mode) body.ai_mode = mode;
      if (mms !== settings.mms_enabled) body.mms_enabled = mms;
      const data = await aiFetch("/api/dealer-ai/settings", { method: "PUT", body: JSON.stringify(body) });
      setSettings(data);
      setMode(data.ai_mode);
      setMms(data.mms_enabled);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setError(err.message);
      setSaveStatus("error");
    }
  };

  if (loading) {
    return (
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center flex-column" style={{ height: "300px" }}>
          <Spinner animation="border" variant="dark" />
          <p className="mt-3">Loading AI settings...</p>
        </div>
      </div>
    );
  }

  const canChange = settings?.can_change;

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <h3 className="page_title mb-0">AI Settings</h3>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Row className="justify-content-center">
          <Col lg={10} xl={8}>
            {error && <Alert variant="danger">{error}</Alert>}
            {settings && !canChange && (
              <Alert variant="info">You can view these settings. Ask your manager to change them.</Alert>
            )}

            {settings && (
              <>
                <div className="w_card">
                  <div className="d-flex align-items-center mb-2">
                    <div className="me-auto">
                      <h3 className="w_card_title mb-0">AI assistant</h3>
                      <p className="text-secondary-light mb-0"><small>Who answers your customers&apos; messages and runs follow-ups.</small></p>
                    </div>
                    <Badge bg={(AI_MODE_LABELS[settings.effective_mode] || AI_MODE_LABELS.off).variant}>
                      Now: {(AI_MODE_LABELS[settings.effective_mode] || AI_MODE_LABELS.off).label}
                    </Badge>
                  </div>
                  {MODES.map((m) => (
                    <Form.Check key={m} type="radio" name="ai-mode" id={`ai-mode-${m}`} className="mb-2"
                      disabled={!canChange} checked={mode === m} onChange={() => setMode(m)}
                      label={<><strong>{MODE_TITLES[m]}</strong><small className="d-block text-secondary-light">{AI_MODE_LABELS[m].help}</small></>} />
                  ))}
                  {!settings.auto_reply_enabled && (
                    <Alert variant="warning" className="py-2 mb-0 small">
                      Auto-reply is turned off in Follow-up Settings, so the AI stays off whatever is chosen here.
                    </Alert>
                  )}
                </div>

                <div className="w_card">
                  <div className="d-flex">
                    <div className="me-auto">
                      <h3 className="w_card_title mb-0">Vehicle photos in texts</h3>
                      <p className="text-secondary-light mb-0">
                        <small>
                          When on, the AI sends the vehicle&apos;s photo with its text (MMS). A photo text costs about
                          three times a normal text.
                        </small>
                      </p>
                    </div>
                    <Form.Check type="switch" id="ai-mms-switch" disabled={!canChange}
                      label={mms ? "On" : "Off"} checked={mms} onChange={(e) => setMms(e.target.checked)} />
                  </div>
                </div>

                <div className="w_card">
                  <h3 className="w_card_title mb-0">Opening hours the AI uses</h3>
                  <p className="text-secondary-light">
                    <small>
                      The AI tells customers these hours, offers appointments inside them and opens call tasks during
                      them. They come from your dealer account; ask your account manager to change them.
                      {settings.timezone && <> Time zone: {settings.timezone}.</>}
                    </small>
                  </p>
                  {!settings.hours_on_record && (
                    <Alert variant="warning" className="py-2 small">
                      No opening hours are set. The AI won&apos;t tell customers any hours, and uses Monday to Saturday,
                      9:00 AM to 6:00 PM for its own timing.
                    </Alert>
                  )}
                  <Table bordered size="sm" className="mb-0">
                    <tbody>
                      {settings.hours.map((h) => (
                        <tr key={h.day}>
                          <td className="text-capitalize" style={{ width: "40%" }}>{h.day}</td>
                          <td>{h.open ? `${h.start || "?"} - ${h.end || "?"}` : <span className="text-secondary-light">Closed</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>

                {canChange && (
                  <div className="d-flex justify-content-end align-items-center gap-3">
                    <Button variant="custom" onClick={save} disabled={!changed || saveStatus === "saving"}>
                      {saveStatus === "saving" ? (
                        <><Spinner as="span" animation="border" size="sm" role="status" className="me-2" />Saving...</>
                      ) : "Save Settings"}
                    </Button>
                    {saveStatus === "success" && <span className="text-success">Saved!</span>}
                    {saveStatus === "error" && <span className="text-danger">Failed to save</span>}
                  </div>
                )}
              </>
            )}
          </Col>
        </Row>
      </div>
    </div>
  );
}
