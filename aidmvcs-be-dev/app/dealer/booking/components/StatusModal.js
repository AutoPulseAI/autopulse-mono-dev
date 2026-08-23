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

  useEffect(() => {
    setTempStatus(currentStatus || "");
  }, [currentStatus]);

  const statusOptions = [
    "Contacted",
    "Appointment Booked",
    "Visited",
    "Managerial Review",
    "Sold",
    "Lead",
    "DND",
    "No Show"
  ];

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
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant="custom"
          onClick={handleStatusUpdate}
          disabled={tempStatus === "Appointment Booked" && (!bookingDate || !bookingTime)}
        >
          Update Status
        </Button>
      </Modal.Footer>
    </Modal>
  );
}   