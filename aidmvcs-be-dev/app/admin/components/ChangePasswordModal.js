"use client";

import { useState } from "react";
import { Modal, Button, Form, Alert } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";

export default function ChangePasswordModal({ onClose, userId }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const validateInputs = () => {
    let newErrors = {};
    if (!currentPassword) newErrors.currentPassword = "Current password is required.";
    if (!newPassword) newErrors.newPassword = "New password is required.";
    else if (newPassword.length < 6) newErrors.newPassword = "Password must be at least 6 characters.";
    if (!confirmPassword) newErrors.confirmPassword = "Please confirm your password.";
    else if (newPassword !== confirmPassword) newErrors.confirmPassword = "Passwords do not match.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!validateInputs()) return;

    const res = await fetchData("/api/auth/change-password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, currentPassword, newPassword }),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage("Password changed successfully!");
      setTimeout(() => onClose(), 2000);
    } else {
      setMessage(data.message);
    }
  };

  return (
    <Modal show={true} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Change Password</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant={message.includes("success") ? "success" : "danger"}>{message}</Alert>}
        <Form onSubmit={handleChangePassword}>
          <Form.Group className="mb-3 position-relative">
            <Form.Label>Current Password</Form.Label>
            <div className="position-relative">
              <Form.Control
                type={showPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                isInvalid={!!errors.currentPassword}
              />
              <span
                className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
                onClick={() => setShowPassword(!showPassword)}
              >
                <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
              </span>
              <Form.Control.Feedback type="invalid">{errors.currentPassword}</Form.Control.Feedback>
            </div>
          </Form.Group>

          <Form.Group className="mb-3 position-relative">
            <Form.Label>New Password</Form.Label>
            <div className="position-relative">
              <Form.Control
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                isInvalid={!!errors.newPassword}
              />
              <span
                  className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  <i className={showNewPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
                </span>
              <Form.Control.Feedback type="invalid">{errors.newPassword}</Form.Control.Feedback>
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
            <Button variant="custom" type="submit">Save Changes</Button>
            <Button variant="secondary" className="ms-2" onClick={onClose}>Cancel</Button>
          </Form.Group>
        </Form>
      </Modal.Body>
    </Modal>
  );
}