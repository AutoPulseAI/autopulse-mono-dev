"use client";
import { useState, useEffect } from "react";
import { Form, Button, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function StaffForm({ roles, setStaff, editStaff, setEditStaff, handleClose }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (editStaff) {
      setEmail(editStaff.email || "");
      setName(editStaff.name || "");
      setRole(editStaff.role?._id || "");
    }
    setPassword("");
  }, [editStaff]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage("");
        handleClose(); // This will be called after 3000ms
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [message]);

  const validateForm = () => {
    let newErrors = {};
    if (!email.trim()) newErrors.email = "Email is required.";
    if (!name.trim()) newErrors.name = "Name is required.";
    else if (!/^[a-zA-Z\s]+$/.test(name)) newErrors.name = "Name should only contain letters and spaces.";
    if (!role) newErrors.role = "Role selection is required.";
    const pwd = password.trim();
    if (!editStaff) {
      if (!pwd) newErrors.password = "Password is required.";
      else if (pwd.length < 8) newErrors.password = "Password must be at least 8 characters.";
    } else if (pwd && pwd.length < 8) {
      newErrors.password = "Password must be at least 8 characters.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    // Only allow alphabets and spaces
    if (/^[a-zA-Z\s]*$/.test(value)) {
      setName(value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!validateForm()) return;

    const trimmedPassword = password.trim();
    // On edit: only send password when user entered a value (API hashes & saves when present).
    // On create: password is required (validated above).
    const payload = {
      email,
      name,
      password: trimmedPassword ? trimmedPassword : undefined,
      role,
      type: "admin",
    };

    const method = editStaff ? "PUT" : "POST";
    const url = "/api/staff";

    const res = await fetchData(url, {
      method,
      headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('token')}`},
      body: JSON.stringify(editStaff ? { ...payload, staffId: editStaff._id } : payload),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage(editStaff ? "Employee updated successfully!" : "Employee created successfully!");

      // Ensure updated staff is set properly
      setStaff((prev) =>
        editStaff
          ? prev.map((s) => (s._id === editStaff._id ? data.staff : s))
          : [...prev, data.staff]
      );

      // Reset form fields after update
      setEmail("");
      setName("");
      setPassword("");
      setRole("");
      setEditStaff(null);
    } else {
      setMessage(data.message);
    }
  };

  return (
    <>
      {message && <Alert variant="success">{message}</Alert>}
      <div className="w_card">
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Name</Form.Label>
            <Form.Control
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              isInvalid={!!errors.name}
            />
            <Form.Control.Feedback type="invalid">
              {errors.name}
            </Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Email Id</Form.Label>
            <Form.Control
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              isInvalid={!!errors.email}
            />
            <Form.Control.Feedback type="invalid">
              {errors.email}
            </Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3 position-relative">
            <Form.Label>{editStaff ? "New password (optional)" : "Password"}</Form.Label>
            {editStaff && (
              <Form.Text muted className="d-block mb-1">
                Enter a new password only if you want to change it.
              </Form.Text>
            )}
            <div className="position-relative">
              <Form.Control
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                isInvalid={!!errors.password}
                placeholder={editStaff ? "Leave blank to keep current" : ""}
                autoComplete="new-password"
              />
              <span
                className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
                onClick={() => setShowPassword(!showPassword)}
              >
                <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
              </span>
              <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
            </div>
          </Form.Group>

          <Form.Group className="mb-4">
            <Form.Label>Select Role</Form.Label>
            <Form.Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              isInvalid={!!errors.role}
            >
              <option value="">Select Role</option>
              {Array.isArray(roles) ? (
                roles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))
              ) : (
                <option disabled>No roles available</option>
              )}
            </Form.Select>
            <Form.Control.Feedback type="invalid">
              {errors.role}
            </Form.Control.Feedback>
          </Form.Group>

          <Button
            type="submit"
            variant="custom"
          >
            {editStaff ? "Save Changes" : "Add Employee"}
          </Button>
        </Form>
      </div>
    </>

  );
}