"use client";
import { useState, useEffect } from "react";
import { useUser } from "../../context/UserContext";
import { Form, Button } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function StaffForm({ roles, setStaff, editStaff, setEditStaff, handleClose }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const { dealerParent, loadingParent } = useUser();
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
    if (!name.trim()) newErrors.name = "Name is required.";
    else if (!/^[a-zA-Z\s]+$/.test(name)) newErrors.name = "Name should only contain letters and spaces.";
    if (!email.trim()) newErrors.email = "Email is required.";
    if (!password.trim() && !editStaff) newErrors.password = "Password is required.";
    if (!role) newErrors.role = "Role selection is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!validateForm()) return;

    const payload = {
      email,
      name,
      password: editStaff ? undefined : password,
      role,
      parent_id: dealerParent.id,
      type: "vendor",
    };

    const method = editStaff ? "PUT" : "POST";
    const url = "/api/staff";

    const res = await fetchData(url, {
      method,
      headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`},
      body: JSON.stringify(editStaff ? { ...payload, staffId: editStaff._id } : payload),
    });

    const data = await res.json();

    if (res.ok) {
      setMessage(
        editStaff ? (
          <span className="text-success">Employee updated!</span>
        ) : (
          <span className="text-success">Employee added!</span>
        )
      );

      //  Ensure updated staff is set properly
      setStaff((prev) =>
        editStaff
          ? prev.map((s) => (s._id === editStaff._id ? data.staff : s))
          : [...prev, data.staff]
      );

      //  Reset form fields after update
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
      {message && <p>{message}</p>}
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

          {!editStaff && (
            <Form.Group className="mb-3 position-relative">
              <Form.Label>Password</Form.Label>
              <div className="position-relative">
                <Form.Control type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} isInvalid={!!errors.password} />
                <span
                  className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
                </span>
                <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
              </div>
            </Form.Group>
          )}

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
            {editStaff ? "Save Changes" : "Create Employee"}
          </Button>
        </Form>
      </div>
    </>

  );
}
