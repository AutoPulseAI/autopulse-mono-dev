"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Form } from "react-bootstrap";
import SlotFullNotice from "../../components/SlotFullNotice";

// One status modal for the lead list, the booking page and the conversation views (stream R: the booking and
// conversations folders re-export this one). `onStatusChange` may return a promise: when it rejects with a
// full-slot answer (app/lib/bookingConflict.js `throwIfStatusFailed`), the modal stays open, shows the message
// and offers "Book {next available}" in one click.

export default function StatusModal({ 
  show, 
  onHide, 
  currentStatus, 
  onStatusChange 
}) {
  const [tempStatus, setTempStatus] = useState(currentStatus || "");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  // Sales or service: each has its own slot capacity (app/lib/bookingService.js). Empty = decided from the lead.
  const [appointmentType, setAppointmentType] = useState("");
  const [managerOutcome, setManagerOutcome] = useState("");
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTempStatus(currentStatus || "");
  }, [currentStatus]);

  useEffect(() => {
    if (!show) setConflict(null);
  }, [show]);

  const statusOptions = [
    "Contacted",
    "Appointment Booked",
    "Visited",
    "Managerial Review",
    "Sold",
    "Sold Pending",
    "Sold Delivered",
    "Unsold",
    "Closed - Lost",
    "Lead",
    "DND",
    "No Show"
  ];
  // Statuses only the AI sets (app/lib/ai/aiDnd.js READ_ONLY_STATUSES).
  const readOnlyStatuses = ["Closed - No Longer Owns"];
  // MASTER_PLAN_3 C5: a visit needs the manager's outcome (client: "Sales Visit -> manager outcome required").
  const managerOutcomes = ["Sold Pending", "Sold Delivered", "Unsold"];

  const submit = async (status, extra) => {
    setBusy(true);
    setConflict(null);
    try {
      await onStatusChange(status, extra);
      onHide();
    } catch (err) {
      if (err?.slotConflict) setConflict(err.slotConflict);
      else onHide();
    } finally {
      setBusy(false);
    }
  };

  const handleStatusUpdate = (date = bookingDate, time = bookingTime) => {
    const extra = {};
    if (tempStatus === "Appointment Booked") {
      if (!date || !time) {
        alert("Please select booking date and time.");
        return;
      }
      extra.booking_date = date;
      extra.booking_time = time;
      if (appointmentType) extra.appointment_type = appointmentType;
    }
    if (tempStatus === "Visited") {
      if (!managerOutcome) {
        alert("Please pick the visit's outcome.");
        return;
      }
      extra.manager_outcome = managerOutcome;
    }
    submit(tempStatus, extra);
  };

  // "Book {next available}": the suggested time goes into the form and is submitted at once.
  const bookSuggested = (date, time) => {
    setBookingDate(date);
    setBookingTime(time);
    handleStatusUpdate(date, time);
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Update Lead Status</Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg_gray">
        <Form.Group controlId="statusSelect">
          <Form.Label>Select Status</Form.Label>
          <Form.Select
            value={tempStatus}
            onChange={(e) => setTempStatus(e.target.value)}
          >
            <option value="">Select Status</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
            {/* Set only by the AI (PLAN_4 stream S): shown when it is the lead's status, never offered. */}
            {readOnlyStatuses.includes(currentStatus) && (
              <option value={currentStatus} disabled>
                {currentStatus} (set by the AI)
              </option>
            )}
          </Form.Select>
        </Form.Group>

        {tempStatus === "Appointment Booked" && (
          <div className="mt-3">
            <Form.Group controlId="bookingDate" className="mb-2">
              <Form.Label>Booking Date</Form.Label>
              <Form.Control
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
              />
            </Form.Group>
            <Form.Group controlId="bookingTime">
              <Form.Label>Booking Time</Form.Label>
              <Form.Control
                type="time"
                value={bookingTime}
                onChange={(e) => setBookingTime(e.target.value)}
              />
            </Form.Group>
            <Form.Group controlId="appointmentType" className="mt-2">
              <Form.Label>Appointment Type</Form.Label>
              <Form.Select value={appointmentType} onChange={(e) => setAppointmentType(e.target.value)}>
                <option value="">From the lead</option>
                <option value="sales">Sales</option>
                <option value="service">Service</option>
              </Form.Select>
            </Form.Group>
            <SlotFullNotice conflict={conflict} onBook={bookSuggested} busy={busy} />
          </div>
        )}

        {tempStatus === "Visited" && (
          <Form.Group controlId="managerOutcome" className="mt-3">
            <Form.Label>Outcome of the visit (required)</Form.Label>
            <Form.Select value={managerOutcome} onChange={(e) => setManagerOutcome(e.target.value)}>
              <option value="">Select Outcome</option>
              {managerOutcomes.map((outcome) => (
                <option key={outcome} value={outcome}>{outcome}</option>
              ))}
            </Form.Select>
          </Form.Group>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant="custom"
          onClick={() => handleStatusUpdate()}
          disabled={busy || (tempStatus === "Appointment Booked" && (!bookingDate || !bookingTime)) ||
            (tempStatus === "Visited" && !managerOutcome)}
        >
          Update Status
        </Button>
      </Modal.Footer>
    </Modal>
  );
}   