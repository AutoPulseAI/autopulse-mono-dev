"use client";
import { useState } from "react";
import { Row, Col, Button, Alert, Badge, Form, Card } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";

const NYC_TIMEZONE = "America/New_York";

export default function DemoRequestDetail({ request, onBack }) {
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.notes || "");
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  const statusOptions = [
    "pending", "contacted", "scheduled", "completed", "rejected"
  ];

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending': return <Badge bg="secondary">Pending</Badge>;
      case 'contacted': return <Badge bg="primary">Contacted</Badge>;
      case 'scheduled': return <Badge bg="warning">Scheduled</Badge>;
      case 'completed': return <Badge bg="success">Completed</Badge>;
      case 'rejected': return <Badge bg="danger">Rejected</Badge>;
      default: return <Badge bg="light">Unknown</Badge>;
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      const response = await fetch(`/api/bookademo/${request._id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`/api/bookademo/${request._id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
            <p><strong>Name:</strong> {request.name}</p>
            <p><strong>Type:</strong> {request.dealershipAgencyName}</p>
            <p><strong>Email:</strong> {request.email}</p>
            <p><strong>Phone:</strong> {request.phone || 'N/A'}</p>
            <p><strong>IP Address:</strong> {request.ipAddress || 'N/A'}</p>
            <p><strong>Submitted (NYC):</strong> {formatTimestamp(request.createdAt, NYC_TIMEZONE)}</p>
          </div>
        </Col>

        <Col xl={9} md={8}>
          <div className="d-flex align-items-center mb-3">
            <h3 className="w_card_title mb-0">Request Details</h3>
          </div>

          <div className="w_card mt-3">
            <p>{request.comment}</p>
          </div>

          
        </Col>
      </Row>
    </>
  );
}