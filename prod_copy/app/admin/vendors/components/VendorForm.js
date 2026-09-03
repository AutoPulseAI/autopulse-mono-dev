"use client";
import { useState, useEffect } from "react";
import { Form, Button, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function VendorForm({ fetchVendors, setEditVendor, editVendor, handleClose }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (editVendor) {
      setName(editVendor.name || "");
      setEmail(editVendor.email || "");
      setPhone(editVendor.phone || "");
      setWebsite(editVendor.website || "");
    } else {
      setName("");
      setEmail("");
      setPassword("");
      setPhone("");
      setWebsite("");
    }
  }, [editVendor]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage("");
        handleClose();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const validateForm = () => {
    let newErrors = {};
    if (!name.trim()) {
      newErrors.name = "Name is required.";
    } else if (!/^[a-zA-Z\s]+$/.test(name)) {
      newErrors.name = "Agency name should only contain letters.";
    }
    if (!email.trim()) newErrors.email = "Email is required.";
    if (phone && !/^[\d\s+-]+$/.test(phone)) {
      newErrors.phone = "Invalid phone number format";
    }
    if (website && !/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(website)) {
      newErrors.website = "Invalid website URL";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    if (/^[a-zA-Z\s]*$/.test(value)) {
      setName(value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!validateForm()) return;

    const payload = {
      name,
      email,
      phone,
      website,
      password: editVendor ? undefined : password,
      type: "vendor",
    };

    const method = editVendor ? "PUT" : "POST";
    const url = "/api/vendors";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
      body: JSON.stringify(editVendor ? { ...payload, vendorId: editVendor._id } : payload),
    });

    const data = await res.json();

    if (res.ok) {
      setMessage(editVendor ? "Agency updated successfully!" : "Agency created successfully!");
      fetchVendors();
      setName("");
      setEmail("");
      setPassword("");
      setPhone("");
      setWebsite("");
      setEditVendor(null);
    } else {
      setMessage(data.message);
    }
  };

  return (
    <div className="w_card">
      {message && <Alert variant="success">{message}</Alert>}

      <Form onSubmit={handleSubmit}>
        <Form.Group className="mb-3">
          <Form.Label htmlFor="vendorName">Agency Name</Form.Label>
          <Form.Control
            id="vendorName"
            type="text"
            value={name}
            onChange={handleNameChange}
            isInvalid={!!errors.name}
          />
          <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label htmlFor="vendorEmail">Agency Email</Form.Label>
          <Form.Control
            id="vendorEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            isInvalid={!!errors.email}
          />
          <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label htmlFor="vendorPhone">Phone Number</Form.Label>
          <Form.Control
            id="vendorPhone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            isInvalid={!!errors.phone}
            placeholder="+1 (123) 456-7890"
          />
          <Form.Control.Feedback type="invalid">{errors.phone}</Form.Control.Feedback>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label htmlFor="vendorWebsite">Website URL</Form.Label>
          <Form.Control
            id="vendorWebsite"
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            isInvalid={!!errors.website}
            placeholder="https://example.com"
          />
          <Form.Control.Feedback type="invalid">{errors.website}</Form.Control.Feedback>
        </Form.Group>

        {!editVendor && (
          <Form.Group className="mb-3">
            <Form.Label htmlFor="VendorPass">Agency Password</Form.Label>
            <Form.Control
              id="VendorPass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              isInvalid={!!errors.password}
            />
            <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
          </Form.Group>
        )}

        {editVendor?.current_subscription && (
          <Form.Group className="mb-3">
            <Form.Label>Current Package</Form.Label>
            <Form.Control
              plaintext
              readOnly
              value={`${editVendor.current_subscription.package_id?.name || 'No package'} (Expires: ${editVendor.package_expiry ? new Date(editVendor.package_expiry).toLocaleDateString() : 'N/A'})`}
            />
          </Form.Group>
        )}

        <Button variant="custom" type="submit">
          {editVendor ? "Save Changes" : "Create Agency"}
        </Button>
      </Form>
    </div>
  );
}