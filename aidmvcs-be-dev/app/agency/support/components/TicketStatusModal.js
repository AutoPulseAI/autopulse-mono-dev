"use client";
import { useState } from "react";
import { Modal, Button, Form } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function TicketStatusModal({ show, onHide, ticket, onStatusUpdate }) {
  const [status, setStatus] = useState(ticket?.status || "open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { fetchData } = useFetch();

  const statusOptions = [
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In Progress" },
    { value: "resolved", label: "Resolved" },
    { value: "closed", label: "Closed" }
  ];

  const handleSubmit = async () => {
    if (!ticket?._id || status === ticket.status) {
      onHide();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetchData(`/api/tickets/${ticket._id}/status`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        },
        body: JSON.stringify({ status })
      });

      if (!res.ok) throw new Error("Failed to update status");

      onStatusUpdate();
      onHide();
    } catch (err) {
      setError(err.message || "Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Update Ticket Status</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group>
          <Form.Label>Status</Form.Label>
          <Form.Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {statusOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        {error && <p className="text-danger mt-2">{error}</p>}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="custom" onClick={handleSubmit} disabled={loading}>
          {loading ? "Updating..." : "Update Status"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}