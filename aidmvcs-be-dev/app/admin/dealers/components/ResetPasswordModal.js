"use client";
import { useState } from "react";
import { Modal, Button, Form, Alert } from "react-bootstrap";

export default function ResetPasswordModal({ show, handleClose, dealer, onSuccess }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const validateForm = () => {
    let newErrors = {};
    if (!password) newErrors.password = "Password is required";
    if (password.length < 8) newErrors.password = "Password must be at least 8 characters";
    if (password !== confirmPassword) newErrors.confirmPassword = "Passwords don't match";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!validateForm()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/vendors/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        body: JSON.stringify({
          vendorId: dealer._id,
          password
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage("Password updated successfully!");
        setTimeout(() => {
          handleClose();
          onSuccess();
        }, 1500);
      } else {
        setMessage(data.message || "Error updating password");
      }
    } catch (error) {
      setMessage("Error updating password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Change Password for {dealer?.name}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant={message.includes("success") ? "success" : "danger"}>{message}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3 position-relative">
            <Form.Label>New Password</Form.Label>
            <div className="position-relative">
            <Form.Control
              type={showNewPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              isInvalid={!!errors.password}
            />
            <span
              className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
              onClick={() => setShowNewPassword(!showNewPassword)}
            >
              <i className={showNewPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
            </span>
            <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
            </div>
          </Form.Group>

          <Form.Group className="mb-3 position-relative">
            <Form.Label>Confirm Password</Form.Label>
            <div className="position-relative">
            <Form.Control
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              isInvalid={!!errors.confirmPassword}
            />
            <span
              className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              <i className={showConfirmPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
            </span>
            <Form.Control.Feedback type="invalid">{errors.confirmPassword}</Form.Control.Feedback>
            </div>
          </Form.Group>

          <Form.Group className="text-center mt-4">
            <Button variant="custom" type="submit" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
            <Button variant="secondary" className="ms-2" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
          </Form.Group>
        </Form>
      </Modal.Body>
    </Modal>
  );
}