"use client";
import { useState } from "react";
import { Row, Col, Button, Alert, Badge, Form, Card } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";

const NYC_TIMEZONE = "America/New_York";

export default function ContactDetail({ contact, onBack }) {
  const [status, setStatus] = useState(contact.status);
  const [notes, setNotes] = useState(contact.notes || "");
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  const statusOptions = [
    "new", "in-progress", "resolved"
  ];

  const getStatusBadge = (status) => {
    switch (status) {
      case 'new': return <Badge bg="secondary">New</Badge>;
      case 'in-progress': return <Badge bg="warning">In Progress</Badge>;
      case 'resolved': return <Badge bg="success">Resolved</Badge>;
      default: return <Badge bg="light">Unknown</Badge>;
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      const response = await fetch(`/api/contact/${contact._id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) throw new Error("Failed to update status");

      setStatus(newStatus);
      showAlert("Status updated successfully");
    } catch (err) {
      console.error("Error updating status:", err);
      showAlert("Failed to update status", "danger");
    }
  };

  const handleSaveNotes = async () => {
    try {
      const response = await fetch(`/api/contact/${contact._id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        body: JSON.stringify({ notes })
      });

      if (!response.ok) throw new Error("Failed to save notes");

      showAlert("Notes saved successfully");
    } catch (err) {
      console.error("Error saving notes:", err);
      showAlert("Failed to save notes", "danger");
    }
  };

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ ...alert, show: false }), 5000);
  };

  return (
    <>
      {alert.show && (
        <Alert variant={alert.variant} onClose={() => setAlert({ ...alert, show: false })} dismissible>
          {alert.message}
        </Alert>
      )}

      <Row className="justify-content-center gx-3">
        <Col xl={3} md={4}>
          <div className="w_card mb-3 dealer_info position-sticky">
            <p><strong>Name:</strong> {contact.firstName} {contact.lastName}</p>
            <p><strong>Email:</strong> {contact.email}</p>
            <p><strong>Phone:</strong> {contact.phone && <span>{contact.phone}</span>}</p>
            <p><strong>IP Address:</strong> {contact.ipAddress || 'N/A'}</p>
            <p><strong>Source:</strong> {contact.source || 'website'}</p>
            <p><strong>Created at (NYC):</strong> {formatTimestamp(contact.createdAt, NYC_TIMEZONE)}</p>
            <Form.Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                handleStatusChange(e.target.value);
              }}
              className={`mt-xl-3 mt-1 ${status === "in-progress"
                ? "text-warning border-warning"
                : status === "resolved"
                  ? "text-success border-success"
                  : "text-custom border-custom"
                }`}
            >
              {statusOptions.map(option => (
                <option key={option} value={option}>
                  {option.replace('-', ' ')}
                </option>
              ))}
            </Form.Select>
          </div>
        </Col>

        <Col xl={9} md={8}>
          <div className="d-flex align-items-center mb-3">
            <h3 className="w_card_title mb-0">Message</h3>
          </div>

          <div className="w_card mt-3">
            <p>{contact.message}</p>
          </div>
        </Col>
      </Row>
    </>

  );
}