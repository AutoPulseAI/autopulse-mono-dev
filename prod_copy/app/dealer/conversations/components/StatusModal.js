"use client";
import { useState } from "react";
import { Modal, Button, Form } from "react-bootstrap";

export default function StatusModal({ 
  show, 
  onHide, 
  currentStatus, 
  onStatusChange 
}) {
  const [tempStatus, setTempStatus] = useState(currentStatus || "");

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
    onStatusChange(tempStatus);
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
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="custom" onClick={handleStatusUpdate}>
          Update Status
        </Button>
      </Modal.Footer>
    </Modal>
  );
}   