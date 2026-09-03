"use client";
import { useState } from "react";
import { Button, Card, Badge, Alert, Row, Col } from "react-bootstrap";

export default function SubscriptionRequestDetail({ request, onBack }) {
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "pending": return <Badge bg="warning">Pending</Badge>;
      case "approved": return <Badge bg="success">Approved</Badge>;
      case "rejected": return <Badge bg="danger">Rejected</Badge>;
      default: return <Badge bg="secondary">Unknown</Badge>;
    }
  };

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ ...alert, show: false }), 5000);
  };

  return (
    <div>
      {alert.show && (
        <Alert variant={alert.variant} dismissible>
          {alert.message}
        </Alert>
      )}

      <div className="d-flex justify-content-between mb-3">
        <h3>Subscription Request</h3>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>

      <Row>
        <Col md={6}>
          <Card className="mb-3">
            <Card.Header>Request Details</Card.Header>
            <Card.Body>
              <p><strong>Status:</strong> {getStatusBadge(request.status)}</p>
              <p><strong>Dealer Count:</strong> {request.dealerCount}</p>
              <p><strong>Requested:</strong> {formatDate(request.requestedAt)}</p>
              {request.processedAt && (
                <p><strong>Processed:</strong> {formatDate(request.processedAt)}</p>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Card className="mb-3">
            <Card.Header>Vendor Information</Card.Header>
            <Card.Body>
              <p><strong>Name:</strong> {request.user?.name || "N/A"}</p>
              <p><strong>Email:</strong> {request.email || request.user?.email || "N/A"}</p>
              <p><strong>Phone:</strong> {request.phone || request.user?.phone || "N/A"}</p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {request.message && (
        <Card className="mb-3">
          <Card.Header>Additional Message</Card.Header>
          <Card.Body>
            <p>{request.message}</p>
          </Card.Body>
        </Card>
      )}

      {request.adminNotes && (
        <Card>
          <Card.Header>Admin Notes</Card.Header>
          <Card.Body>
            <p>{request.adminNotes}</p>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}