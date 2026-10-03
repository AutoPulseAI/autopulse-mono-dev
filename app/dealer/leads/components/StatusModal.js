"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Form } from "react-bootstrap";

export default function StatusModal({ 
  show, 
  onHide, 
  currentStatus, 
  onStatusChange 
}) {
  const [tempStatus, setTempStatus] = useState(currentStatus || "");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [managerOutcome, setManagerOutcome] = useState("");

  useEffect(() => {
    setTempStatus(currentStatus || "");
  }, [currentStatus]);

  const statusOptions = [
    "Contacted",
    "Appointment Booked",
    "Visited",
    "Managerial Review",
    "Sold",
    "Sold Pending",
    "Sold Delivered",
    "Unsold",
    "Closed Lost",
    "Lead",
    "DND",
    "No Show"
  ];
  // MASTER_PLAN_3 C5: a visit needs the manager's outcome (client: "Sales Visit -> manager outcome required").
  const managerOutcomes = ["Sold Pending", "Sold Delivered", "Unsold"];

  const handleStatusUpdate = () => {
    const extra = {};
    if (tempStatus === "Appointment Booked") {
      if (!bookingDate || !bookingTime) {
        alert("Please select booking date and time.");
        return;
      }
      extra.booking_date = bookingDate;
      extra.booking_time = bookingTime;
    }
    if (tempStatus === "Visited") {
      if (!managerOutcome) {
        alert("Please pick the visit's outcome.");
        return;
      }
      extra.manager_outcome = managerOutcome;
    }
    console.log('StatusModal submitting:', { status: tempStatus, ...extra });
    onStatusChange(tempStatus, extra);
    onHide();
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
          onClick={handleStatusUpdate}
          disabled={(tempStatus === "Appointment Booked" && (!bookingDate || !bookingTime)) ||
            (tempStatus === "Visited" && !managerOutcome)}
        >
          Update Status
        </Button>
      </Modal.Footer>
    </Modal>
  );
}   