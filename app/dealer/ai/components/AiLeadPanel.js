"use client";
// What the AI is doing with one lead, for staff: on/off for this lead, the stage
// in the client's words and why, the opportunity day, the next scheduled touch,
// the appointment, an open call task, recent history and consent per channel.
//
// Shown on the lead's conversation screen (leads/components/viewConversations.js),
// in the Lead Details drawer (leads/components/LeadDetailsSidebar.js) and in the
// drawers on the Call Tasks and AI Alerts pages.
//
// Sections render only when the AI service sends their data, so new profile
// fields (e.g. SOLD PENDING ownership, customer active/inactive, recall and
// maintenance) can be added as one more <Section> below without touching the rest.

import { useCallback, useEffect, useState, isValidElement } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import {
  AI_MODE_LABELS, CHANNEL_LABELS, aiFetch, alertKind, formatDate, formatDateTime, fromNow, stageLabel, stageVariant,
} from "./aiShared";
import { vehicleTypeText } from "@lib/ai/aiInsights";

const OPPORTUNITY_DAYS = 91;
const HISTORY_SHOWN = 5;
const AI_STOPPED = ["paused", "handoff"];

function Section({ title, icon, children }) {
  return (
    <div className="border-top pt-2 mt-2">
      <p className="mb-1 small text-secondary-light text-uppercase fw-semibold">
        {icon && <i className={`fa-regular ${icon} me-1`} />}{title}
      </p>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === "") return null;
  // The AI service's profile grows as workflows are added. A section that arrives as a record where this
  // panel expected plain text must not take the whole lead screen down: skip the row instead.
  if (typeof children === "object" && !Array.isArray(children) && !isValidElement(children)) return null;
  return (
    <p className="mb-1 small"><strong>{label}:</strong> {children}</p>
  );
}

// Generic renderer for profile sections other streams add (ownership, recall...):
// a flat object of simple values shown as label/value rows.
function ExtraSection({ title, data }) {
  if (!data || typeof data !== "object") return null;
  const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  if (!rows.length) return null;
  return (
    <Section title={title} icon="fa-circle-info">
      {rows.map(([k, v]) => (
        <Row key={k} label={k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}>
          {typeof v === "boolean" ? (v ? "Yes" : "No") : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? formatDateTime(v) : String(v)}
        </Row>
      ))}
    </Section>
  );
}

// The client's three sales lead buckets (blueprint section 2).
const BUCKET_LABELS = {
  credit: "Credit / financing",
  trade_in: "Trade-in / sell my car",
  general: "General sales",
};

const EXTRA_SECTIONS = [
  ["opportunity", "Opportunity"],
  ["ownership", "Ownership"],
  ["customer_status", "Customer"],
  ["recall", "Recalls"],
  ["maintenance", "Maintenance"],
  ["sold_pending", "Sold Pending"],
];

export default function AiLeadPanel({ leadId, className = "w_card mb-2" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [reason, setReason] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError("");
    try {
      setData(await aiFetch(`/api/dealer-ai/leads/${leadId}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const setAiForLead = async (on) => {
    setSaving(true);
    setError("");
    try {
      await aiFetch(`/api/dealer-ai/leads/${leadId}/${on ? "resume" : "pause"}`, {
        method: "POST",
        body: JSON.stringify(on ? {} : { reason: reason.trim() || undefined }),
      });
      setConfirmOff(false);
      setReason("");
      // The AI applies the change from its queue: give it a moment before re-reading.
      setTimeout(load, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const profile = data?.profile;
  const life = profile?.lifecycle || {};
  const aiStatus = profile?.lead?.status;
  const aiOnForLead = profile ? !AI_STOPPED.includes(aiStatus) : true;
  const mode = AI_MODE_LABELS[data?.ai_mode] || AI_MODE_LABELS.off;
  const dealerAiOff = data && data.ai_mode === "off";
  const history = [...(life.history || [])].reverse();
  const nextTouch = profile?.cadence?.next_touch;
  const nextAction = life.next_action;
  const appointment = life.appointment;
  const callTask = profile?.call_task;
  const notice = profile?.staff_notice;
  // The lead bucket arrives as a record: { bucket, original_bucket, why, overridden, ... } (older builds: a word).
  const bucketInfo = profile?.bucket ?? life.bucket;
  const bucketKey = typeof bucketInfo === "string" ? bucketInfo : bucketInfo?.bucket;
  const originalBucket = typeof bucketInfo === "object" ? bucketInfo?.original_bucket : null;
  const bucket = bucketKey
    ? (BUCKET_LABELS[bucketKey] || bucketKey)
      + (originalBucket && originalBucket !== bucketKey ? ` (came in as ${BUCKET_LABELS[originalBucket] || originalBucket})` : "")
    : null;
  // PLAN_4 stream L: new / used now, and as the lead came in (kept for reporting).
  const vehicleType = vehicleTypeText(profile?.vehicle_type ?? profile?.lead);
  const oppDay = typeof life.opportunity_age_days === "number" ? life.opportunity_age_days + 1 : null;
  const channels = data?.consent?.channels;

  return (
    <div className={className}>
      <div className="d-flex align-items-center mb-2">
        <h3 className="w_card_title mb-0 me-auto">
          <i className="fa-regular fa-message-bot me-2" />AI Assistant
        </h3>
        {data && <Badge bg={mode.variant} className="me-2" title={mode.help}>AI {mode.label}</Badge>}
        <Button variant="link" size="sm" className="p-0" onClick={load} disabled={loading} title="Refresh">
          <i className={`fa-solid fa-rotate-right ${loading ? "fa-spin" : ""}`} />
        </Button>
      </div>

      {error && <Alert variant="danger" className="py-2 small mb-2">{error}</Alert>}

      {loading && !data ? (
        <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>
      ) : data && (
        <>
          {dealerAiOff && (
            <Alert variant="light" className="py-2 small mb-2 border">
              The AI is off for this dealership, so it isn&apos;t contacting this customer.{" "}
              <Link href="/dealer/ai/settings">AI settings</Link>
            </Alert>
          )}

          {!dealerAiOff && (
            <div className="d-flex align-items-center justify-content-between mb-1">
              <span className="small">
                <strong>AI on this lead</strong>
                {!aiOnForLead && profile?.lead?.status_reason && (
                  <span className="d-block text-secondary-light">{profile.lead.status_reason}</span>
                )}
              </span>
              <Form.Check
                type="switch"
                id={`ai-lead-switch-${leadId}`}
                label={aiOnForLead ? "On" : "Off"}
                checked={aiOnForLead}
                disabled={saving}
                onChange={(e) => (e.target.checked ? setAiForLead(true) : setConfirmOff(true))}
              />
            </div>
          )}

          {data.profile_status === "not_found" && (
            <p className="small text-secondary-light mb-0">The AI hasn&apos;t worked on this lead yet.</p>
          )}
          {data.profile_status === "unavailable" && (
            <p className="small text-secondary-light mb-0">
              The AI service can&apos;t be reached right now, so its details for this lead aren&apos;t available.
            </p>
          )}

          {profile && (
            <>
              <Section title="Where the lead stands" icon="fa-signal-bars">
                {life.label ? (
                  <p className="mb-1">
                    <Badge bg={stageVariant(life.stage)} className="me-2">{life.label}</Badge>
                    {life.since && <small className="text-secondary-light">since {formatDate(life.since)}</small>}
                  </p>
                ) : (
                  <p className="mb-1 small text-secondary-light">No stage yet.</p>
                )}
                <Row label="Bucket">{bucket}</Row>
                <Row label="New or used">{vehicleType}</Row>
                <Row label="Why">{life.reason}</Row>
                <Row label="Opportunity">
                  {oppDay !== null && (life.opportunity_closed_at
                    ? `Closed on ${formatDate(life.opportunity_closed_at)}`
                    : `Day ${oppDay} of ${OPPORTUNITY_DAYS}`)}
                </Row>
              </Section>

              {(nextTouch || nextAction || profile.pending_followup || profile.pending_morning_message) && (
                <Section title="Next step" icon="fa-calendar-clock">
                  {nextTouch && (
                    <Row label="Next touch">
                      {nextTouch.theme_label || `Touch ${nextTouch.touch_number || ""}`.trim()}
                      {nextTouch.due_at && ` - ${formatDateTime(nextTouch.due_at)} (${fromNow(nextTouch.due_at)})`}
                    </Row>
                  )}
                  {nextAction && (
                    <Row label="Follow-up agreed">
                      {nextAction.display || nextAction.date}
                      {nextAction.time && nextAction.time_given ? ` at ${nextAction.time}` : ""}
                      {nextAction.channel ? ` by ${CHANNEL_LABELS[nextAction.channel] || nextAction.channel}` : ""}
                      {nextAction.call_requested ? " (customer asked for a call)" : ""}
                    </Row>
                  )}
                  {profile.pending_followup && (
                    <Row label="Channel switch">
                      {CHANNEL_LABELS[profile.pending_followup.channel] || profile.pending_followup.channel}{" "}
                      {fromNow(profile.pending_followup.due_at)}
                    </Row>
                  )}
                  {profile.pending_morning_message && (
                    <Row label="Morning message">{formatDateTime(profile.pending_morning_message.due_at)}</Row>
                  )}
                </Section>
              )}

              {(appointment || profile.booking) && (
                <Section title="Appointment" icon="fa-calendar-check">
                  <Row label="When">
                    {appointment?.display
                      || (appointment?.planned_at && formatDateTime(appointment.planned_at))
                      || (profile.booking && `${formatDate(profile.booking.date)}${profile.booking.time ? ` ${profile.booking.time}` : ""}`)}
                  </Row>
                  <Row label="Status">{profile.booking?.status || appointment?.status}</Row>
                  <Row label="Confirmed">
                    {appointment ? (appointment.confirmed_at ? `Yes, ${formatDateTime(appointment.confirmed_at)}` : "Not yet") : null}
                  </Row>
                  <Row label="Showed">
                    {appointment?.showed_at ? `Yes, ${formatDateTime(appointment.showed_at)}` : null}
                  </Row>
                </Section>
              )}

              {(callTask || profile.pending_call_timer) && (
                <Section title="Call task" icon="fa-phone">
                  {callTask ? (
                    <p className="mb-1 small">
                      <Badge bg="primary" className="me-1">Open</Badge>
                      Call {callTask.phone} (opened {fromNow(callTask.opened_at)}).{" "}
                      <Link href="/dealer/ai/call-tasks">Go to Call Tasks</Link>
                    </p>
                  ) : (
                    <p className="mb-1 small text-secondary-light">
                      A call task opens {fromNow(profile.pending_call_timer.due_at)} if the customer doesn&apos;t reply.
                    </p>
                  )}
                </Section>
              )}

              {(notice || profile.staff_alert) && (
                <Section title="For the team" icon="fa-bell">
                  {profile.staff_alert && (
                    <p className="mb-1 small text-danger">{profile.staff_alert.reason}</p>
                  )}
                  {notice && (
                    <p className="mb-1 small">
                      <Badge bg={alertKind(notice.kind).variant} className="me-1">{alertKind(notice.kind).label}</Badge>
                      {notice.text}
                    </p>
                  )}
                </Section>
              )}

              {EXTRA_SECTIONS.map(([key, title]) => (
                <ExtraSection key={key} title={title} data={profile[key] || life[key]} />
              ))}

              {history.length > 0 && (
                <Section title="Recent history" icon="fa-clock-rotate-left">
                  <ul className="list-unstyled mb-0 small">
                    {(showAllHistory ? history : history.slice(0, HISTORY_SHOWN)).map((h, i) => (
                      <li key={`${h.at}-${i}`} className="mb-1">
                        <span className="text-secondary-light">{formatDateTime(h.at)}</span>{" "}
                        <strong>{h.to_label || stageLabel(h.to)}</strong>
                        {h.reason && <span> - {h.reason}</span>}
                      </li>
                    ))}
                  </ul>
                  {history.length > HISTORY_SHOWN && (
                    <Button variant="link" size="sm" className="p-0" onClick={() => setShowAllHistory((v) => !v)}>
                      {showAllHistory ? "Show less" : `Show all ${history.length}`}
                    </Button>
                  )}
                </Section>
              )}
            </>
          )}

          {channels && (
            <Section title="Consent" icon="fa-shield-check">
              {Object.entries(channels).map(([channel, c]) => (
                <p key={channel} className="mb-1 small d-flex align-items-center">
                  <span className="me-auto">{CHANNEL_LABELS[channel] || channel}</span>
                  {c.opted_out ? (
                    <Badge bg="danger" title={c.since ? `Since ${formatDateTime(c.since)}` : ""}>Opted out</Badge>
                  ) : c.address_invalid ? (
                    <Badge bg="warning" text="dark">Bad contact</Badge>
                  ) : c.address ? (
                    <Badge bg="success">OK to contact</Badge>
                  ) : (
                    <Badge bg="light" text="dark">No {channel === "email" ? "email" : "phone"}</Badge>
                  )}
                </p>
              ))}
              {data.consent.possible_opt_out_review && (
                <p className="mb-0 small text-warning">
                  Possible opt-out waiting for review
                  {data.consent.possible_opt_out_review.message && `: "${data.consent.possible_opt_out_review.message}"`}
                </p>
              )}
            </Section>
          )}
        </>
      )}

      <Modal show={confirmOff} onHide={() => setConfirmOff(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Turn the AI off for this lead?</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg_gray">
          <p className="mb-2">
            The AI will stop replying to this customer and cancel its scheduled follow-ups. You can turn it back on
            at any time.
          </p>
          <Form.Group>
            <Form.Label>Reason (optional)</Form.Label>
            <Form.Control
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. I'm handling this customer myself"
              maxLength={300}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
          <Button variant="secondary" onClick={() => setConfirmOff(false)} disabled={saving}>Cancel</Button>
          <Button variant="custom" onClick={() => setAiForLead(false)} disabled={saving}>
            {saving && <Spinner animation="border" size="sm" className="me-2" />}Turn AI off
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
