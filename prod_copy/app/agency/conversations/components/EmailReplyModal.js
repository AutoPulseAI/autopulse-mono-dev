"use client";
import { useState } from "react";
import { Modal, Button, Form, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function EmailReplyModal({ user, onClose }) {
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { fetchData, loading } = useFetch();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) {
      setError("Content is required.");
      return;
    }
    setError("");
    setMessage("");

    const res = await fetchData("/api/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, content }),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage("Mail sent successfully!");
      setTimeout(() => onClose(), 2000);
    } else {
      setMessage(data.message || "An error occurred.");
    }
  };

  return (
    <Modal show={true} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Reply</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant="success">{message}</Alert>}
        {error && <Alert variant="danger">{error}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Email Content</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter your content here..."
              isInvalid={!!error}
            />
            <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="text-center mt-4">
            <Button variant="custom" type="submit" disabled={loading}>Save</Button>
            <Button variant="secondary" className="ms-2" onClick={onClose}>Cancel</Button>
          </Form.Group>
        </Form>
      </Modal.Body>
    </Modal>
  );
}
