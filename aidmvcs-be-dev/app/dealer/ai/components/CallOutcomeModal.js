"use client";
// The prompt staff answer after a call from the Call Tasks page: how the call went
// and what it means for the lead. It can't be closed without an answer.
//
//   appointment        -> the CRM's own booking flow (PUT /api/conversations/lead/status,
//                         "Appointment Booked" + date/time + appointment type, same as the Update Status modal)
//   specific follow-up -> date, time, channel, owner (AI or a person) and notes: the AI's dated next step
//   no next step       -> Contact Made - No Next Action; the AI's Short-Term cadence carries on
//   no contact         -> recorded; the lead stays in its flow
//   wrong number       -> the AI marks that phone invalid (never texted or called again)
//   opted out          -> the AI's consent records (every channel, or calls only); every channel also sets DND
// A full appointment slot (stream T, with stream R's shared pieces): the booking route's 409 / slot 422 shows as
// SlotFullNotice - the message, one-click "Book {next available}" and the day's other open times - and nothing
// else is saved until the booking goes through.
// The lead outcome goes to the AI service with the call result (PLAN_4 stream H).
// Then an internal note summarising the call is added to the lead's conversation,
// and the call task is completed (or dismissed) in the AI service.

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { bookingConflictFrom } from "@lib/bookingConflict";
import SlotFullNotice from "../../components/SlotFullNotice";
import { CALL_OUTCOMES, CHANNEL_LABELS, aiFetch, callOutcomeLabel } from "./aiShared";

const LEAD_OUTCOMES = [
  { value: "appointment", label: "Booked an appointment", needsContact: true },
  { value: "specific_followup", label: "Agreed a specific follow-up", needsContact: true },
  { value: "contact_no_action", label: "Spoke with them, no next step agreed", needsContact: true },
  { value: "no_contact", label: "Couldn't reach them", needsContact: false },
  { value: "wrong_number", label: "Wrong number - don't use it again", needsContact: false, onlyFor: "wrong_number" },
  { value: "opted_out", label: "They asked us to stop contacting them", needsContact: null },
];
const leadOutcomeLabel = (value) => LEAD_OUTCOMES.find((o) => o.value === value)?.label || value;

const EMPTY = {
  callOutcome: "", leadOutcome: "", bookingDate: "", bookingTime: "", appointmentType: "",
  followDate: "", followTime: "", followChannel: "sms", followOwner: "ai", followNotes: "", notes: "",
  optOutScope: "all",
};

export default function CallOutcomeModal({ show, task, dealerId, onDone, onNotCalled }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dismissMode, setDismissMode] = useState(false);
  const [conflict, setConflict] = useState(null); // a full appointment slot

  useEffect(() => {
    if (show) {
      setForm(EMPTY);
      setError("");
      setDismissMode(false);
      setConflict(null);
    }
  }, [show, task?.id]);

  const set = (field) => (e) => {
    if (["bookingDate", "bookingTime", "appointmentType"].includes(field)) setConflict(null);
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };
  const connected = form.callOutcome === "connected";
  const leadOptions = useMemo(
    () => LEAD_OUTCOMES.filter((o) => (o.needsContact === null || o.needsContact === connected)
      && (!o.onlyFor || o.onlyFor === form.callOutcome)),
    [connected, form.callOutcome],
  );

  // Picking a call outcome resets a lead outcome that no longer fits.
  useEffect(() => {
    if (form.leadOutcome && !leadOptions.some((o) => o.value === form.leadOutcome)) {
      setForm((f) => ({ ...f, leadOutcome: "" }));
    }
  }, [leadOptions, form.leadOutcome]);

  const missing = (() => {
    if (dismissMode) return form.notes.trim() ? null : "Say why this call won't be made.";
    if (!form.callOutcome) return "Pick how the call went.";
    if (!form.leadOutcome) return "Pick the outcome for the lead.";
    if (form.leadOutcome === "appointment" && (!form.bookingDate || !form.bookingTime)) {
      return "Pick the appointment date and time.";
    }
    if (form.leadOutcome === "specific_followup" && !form.followDate) return "Pick the follow-up date.";
    return null;
  })();

  const leadDealerId = task?.dealer_id || dealerId;

  const summary = (booking) => {
    if (dismissMode) return `Call task dismissed (no call made): ${form.notes.trim()}`;
    const parts = [`Call outcome: ${callOutcomeLabel(form.callOutcome)}.`, `Lead outcome: ${leadOutcomeLabel(form.leadOutcome)}.`];
    if (form.leadOutcome === "appointment") parts.push(`Appointment: ${booking.date} at ${booking.time}.`);
    if (form.leadOutcome === "specific_followup") {
      parts.push(`Follow up on ${form.followDate}${form.followTime ? ` at ${form.followTime}` : ""} by `
        + `${CHANNEL_LABELS[form.followChannel] || form.followChannel} (${form.followOwner === "ai" ? "the AI" : "staff"})`
        + `${form.followNotes.trim() ? `: ${form.followNotes.trim()}` : "."}`);
    }
    if (form.leadOutcome === "opted_out" && form.optOutScope === "voice") parts.push("Calls only: texts and emails carry on.");
    if (form.notes.trim()) parts.push(`Notes: ${form.notes.trim()}`);
    return parts.join(" ");
  };

  const updateLeadStatus = (status, extra = {}) => aiFetch("/api/conversations/lead/status", {
    method: "PUT",
    body: JSON.stringify({ id: task.lead_id, status, ...extra }),
  });

  // `slot`: a time picked from the full-slot notice ({date, time}), booked at once.
  const submit = async (slot = null) => {
    if (missing) {
      setError(missing);
      return;
    }
    const booking = { date: slot?.date || form.bookingDate, time: slot?.time || form.bookingTime };
    setSaving(true);
    setError("");
    setConflict(null);
    const note = summary(booking);
    try {
      // 1. The lead outcome, through the CRM's existing flows.
      if (!dismissMode && form.leadOutcome === "appointment") {
        try {
          await updateLeadStatus("Appointment Booked", {
            booking_date: booking.date, booking_time: booking.time,
            ...(form.appointmentType ? { appointment_type: form.appointmentType } : {}),
          });
        } catch (err) {
          // A full / unbookable slot: offer the next available time instead of a plain error; nothing else saved.
          const found = bookingConflictFrom(err.status, err.body, booking);
          if (!found) throw err;
          setConflict(found);
          return;
        }
      } else if (!dismissMode && form.leadOutcome === "opted_out" && form.optOutScope === "all") {
        await updateLeadStatus("DND");
      }
      // 2. An internal note on the lead, so the call shows in its conversation.
      if (leadDealerId && task.lead_id) {
        await aiFetch("/api/conversations/notes", {
          method: "POST",
          body: JSON.stringify({ lead_id: task.lead_id, dealer_id: leadDealerId, content: note, internal_use: true }),
        }).catch(() => null); // the call result still gets saved below
      }
      // 3. Close the call task in the AI service.
      await aiFetch(`/api/dealer-ai/call-tasks/${task.id}`, {
        method: "POST",
        body: JSON.stringify(dismissMode
          ? { action: "dismiss", note, dealer_id: dealerId }
          : {
            action: "complete", outcome: form.callOutcome, note, dealer_id: dealerId,
            // What the call means for the lead reaches the AI (dated next step, cadence, invalid phone, consent).
            lead_outcome: form.leadOutcome,
            follow_up: form.leadOutcome === "specific_followup" ? {
              date: form.followDate, time: form.followTime || null, channel: form.followChannel,
              owner: form.followOwner, notes: form.followNotes.trim() || null,
            } : null,
            opt_out_scope: form.optOutScope,
          }),
      });
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!task) return null;

  return (
    <Modal show={show} centered backdrop="static" keyboard={false} size="lg">
      <Modal.Header>
        <Modal.Title>
          {dismissMode ? "Dismiss this call" : "How did the call go?"}
          <small className="d-block text-secondary-light fs-6 mt-1">
            {task.customer_name || "Customer"}{task.phone ? ` - ${task.phone}` : ""}
          </small>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg_gray">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}

        {dismissMode ? (
          <Form.Group>
            <Form.Label>Why won&apos;t this call be made? (required)</Form.Label>
            <Form.Control as="textarea" rows={3} value={form.notes} onChange={set("notes")}
              placeholder="e.g. Customer already booked in by phone with Sam" />
          </Form.Group>
        ) : (
          <>
            <Form.Group className="mb-3">
              <Form.Label>Call outcome (required)</Form.Label>
              <div>
                {CALL_OUTCOMES.map((o) => (
                  <Form.Check key={o.value} inline type="radio" name="call-outcome" id={`call-outcome-${o.value}`}
                    label={o.label} value={o.value} checked={form.callOutcome === o.value} onChange={set("callOutcome")} />
                ))}
              </div>
            </Form.Group>

            {form.callOutcome && (
              <Form.Group className="mb-3">
                <Form.Label>Outcome for the lead (required)</Form.Label>
                <Form.Select value={form.leadOutcome} onChange={set("leadOutcome")}>
                  <option value="">Select outcome</option>
                  {leadOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Form.Select>
              </Form.Group>
            )}

            {form.leadOutcome === "appointment" && (
              <Row className="g-2 mb-3">
                <Col sm={6}>
                  <Form.Label>Appointment date</Form.Label>
                  <Form.Control type="date" value={form.bookingDate} onChange={set("bookingDate")} />
                </Col>
                <Col sm={6}>
                  <Form.Label>Appointment time</Form.Label>
                  <Form.Control type="time" value={form.bookingTime} onChange={set("bookingTime")} />
                </Col>
                <Col sm={6}>
                  <Form.Label>Appointment type</Form.Label>
                  <Form.Select value={form.appointmentType} onChange={set("appointmentType")}>
                    <option value="">From the lead</option>
                    <option value="sales">Sales (up to 10 per hour)</option>
                    <option value="service">Service (1 per hour)</option>
                  </Form.Select>
                </Col>
                <Col xs={12}>
                  <small className="text-secondary-light">
                    The appointment is booked the same way as &quot;Update Status&quot; - &quot;Appointment Booked&quot;.
                  </small>
                  <SlotFullNotice conflict={conflict} busy={saving} onBook={(date, time) => {
                    setForm((f) => ({ ...f, bookingDate: date, bookingTime: time }));
                    submit({ date, time });
                  }} />
                </Col>
              </Row>
            )}

            {form.leadOutcome === "specific_followup" && (
              <Row className="g-2 mb-3">
                <Col sm={4}>
                  <Form.Label>Follow-up date</Form.Label>
                  <Form.Control type="date" value={form.followDate} onChange={set("followDate")} />
                </Col>
                <Col sm={4}>
                  <Form.Label>Time (optional)</Form.Label>
                  <Form.Control type="time" value={form.followTime} onChange={set("followTime")} />
                </Col>
                <Col sm={4}>
                  <Form.Label>How</Form.Label>
                  <Form.Select value={form.followChannel} onChange={set("followChannel")}>
                    <option value="sms">Text</option>
                    <option value="email">Email</option>
                    <option value="voice">Phone call</option>
                  </Form.Select>
                </Col>
                <Col xs={12}>
                  <Form.Label>Who follows up</Form.Label>
                  <div>
                    <Form.Check inline type="radio" name="follow-owner" id="follow-owner-ai" label="The AI checks back"
                      value="ai" checked={form.followOwner === "ai"} onChange={set("followOwner")} />
                    <Form.Check inline type="radio" name="follow-owner" id="follow-owner-human" label="I will"
                      value="human" checked={form.followOwner === "human"} onChange={set("followOwner")} />
                  </div>
                </Col>
                <Col xs={12}>
                  <Form.Label>What was agreed</Form.Label>
                  <Form.Control as="textarea" rows={2} value={form.followNotes} onChange={set("followNotes")}
                    placeholder="e.g. Call back after payday to talk numbers on the 2024 Tacoma" />
                </Col>
              </Row>
            )}

            {form.leadOutcome === "opted_out" && (
              <>
                <Form.Group className="mb-2">
                  <Form.Check type="radio" name="opt-out-scope" id="opt-out-all" value="all"
                    label="Stop all contact (text, email and calls)" checked={form.optOutScope === "all"}
                    onChange={set("optOutScope")} />
                  <Form.Check type="radio" name="opt-out-scope" id="opt-out-voice" value="voice"
                    label="Just don't call them (texts and emails carry on)" checked={form.optOutScope === "voice"}
                    onChange={set("optOutScope")} />
                </Form.Group>
                <Alert variant="warning" className="py-2">
                  {form.optOutScope === "all"
                    ? "The lead will be set to DND, and the AI records the opt-out on every channel."
                    : "The AI records that they don't want calls: no more call tasks for them."}
                </Alert>
              </>
            )}

            <Form.Group>
              <Form.Label>Notes (optional)</Form.Label>
              <Form.Control as="textarea" rows={2} value={form.notes} onChange={set("notes")} />
            </Form.Group>
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0 bg_gray">
        {dismissMode ? (
          <Button variant="link" className="me-auto" onClick={() => setDismissMode(false)} disabled={saving}>
            Back
          </Button>
        ) : (
          <div className="me-auto d-flex gap-2">
            {onNotCalled && (
              <Button variant="link" className="px-0" onClick={onNotCalled} disabled={saving}>
                I didn&apos;t make the call
              </Button>
            )}
            <Button variant="link" className="px-0" onClick={() => setDismissMode(true)} disabled={saving}>
              Won&apos;t call - dismiss
            </Button>
          </div>
        )}
        <Button variant="custom" onClick={() => submit()} disabled={saving || Boolean(missing)}>
          {saving && <Spinner animation="border" size="sm" className="me-2" />}
          {dismissMode ? "Dismiss call task" : "Save outcome"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
