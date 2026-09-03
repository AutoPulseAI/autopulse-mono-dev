"use client";
import { useState } from "react";
import { Modal, Button, Form, Alert } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";

export default function ProfileModal({ user, onClose }) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [website, setWebsite] = useState(user?.website || "");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const { fetchData, error: fetchError, loading } = useFetch();
  
  // Check if user is a parent (has no parent_id)
  const isParentUser = !user?.parent_id;

  const validateInputs = () => {
    let newErrors = {};
    if (!name.trim()) newErrors.name = "Name is required.";
    if (!email.trim()) newErrors.email = "Email is required.";
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = "Invalid email format.";
    
    // Only validate phone and website if user is a parent
    if (isParentUser) {
      if (phone && !/^[\d\s\-()+]{10,20}$/.test(phone)) {
        newErrors.phone = "Invalid phone number format.";
      }
      if (website && !/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(website)) {
        newErrors.website = "Invalid website URL.";
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!validateInputs()) return;

    setMessage("");
    const updateData = { 
      userId: user.id, 
      name, 
      email,
      ...(isParentUser && { phone, website }) // Only include phone/website if parent user
    };

    const res = await fetchData("/api/auth/update-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });

    const data = await res.json();
    if (res.ok) {
      setMessage("Profile updated successfully!");
      setTimeout(() => onClose(), 2000);
    } else {
      setMessage(data.message);
    }
  };

  return (
    <Modal show={true} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Edit Profile</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant={message.includes("successfully") ? "success" : "danger"}>{message}</Alert>}
        <Form onSubmit={handleUpdateProfile}>
          <Form.Group className="mb-3">
            <Form.Label>Agency Name</Form.Label>
            <Form.Control
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              isInvalid={!!errors.name}
            />
            <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              isInvalid={!!errors.email}
            />
            <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
          </Form.Group>

          {/* Only show phone and website if user is a parent (no parent_id) */}
          {isParentUser && (
            <>
              <Form.Group className="mb-3">
                <Form.Label>Phone</Form.Label>
                <Form.Control
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  isInvalid={!!errors.phone}
                  placeholder="Optional"
                />
                <Form.Control.Feedback type="invalid">{errors.phone}</Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Website</Form.Label>
                <Form.Control
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  isInvalid={!!errors.website}
                  placeholder="Optional (include http:// or https://)"
                />
                <Form.Control.Feedback type="invalid">{errors.website}</Form.Control.Feedback>
              </Form.Group>
            </>
          )}

          <Form.Group className="text-center mt-4">
            <Button variant="custom" type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
            <Button variant="secondary" className="ms-2" onClick={onClose}>
              Cancel
            </Button>
          </Form.Group>
        </Form>
      </Modal.Body>
    </Modal>
  );
}