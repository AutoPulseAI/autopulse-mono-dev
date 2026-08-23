"use client";
import { useState, useEffect } from "react";
import { Form, Button, Alert, Card } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import { useUser } from "../../context/UserContext";

export default function RoleForm({ permissions, setRoles, editRole, setEditRole, handleClose }) {
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState({});

  const { fetchData, loading } = useFetch();
  const { dealerParent } = useUser();

  useEffect(() => {
    if (editRole && Object.keys(editRole).length > 0) {
      setName(editRole?.name || "");
      setSelectedPermissions(editRole?.permissions || []);
    }
  }, [editRole]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage("");
        if (isSuccess) {
          handleClose();
        }
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [message, isSuccess]);

  const validateForm = () => {
    const newErrors = {};
    
    // Role Name Validation
    if (!name.trim()) {
      newErrors.name = "Role Name is required";
    } else if (!/^[a-zA-Z0-9\s]+$/.test(name)) {
      newErrors.name = "Only alphanumeric characters and spaces are allowed";
    } else if (name.trim().length < 2) {
      newErrors.name = "Role Name must be at least 2 characters";
    } else if (name.trim().length > 50) {
      newErrors.name = "Role Name cannot exceed 50 characters";
    }
    
    // Permissions Validation
    if (selectedPermissions.length === 0) {
      newErrors.permissions = "Select at least one permission";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    // Only update if the input matches our validation pattern or is empty
    if (/^[a-zA-Z0-9\s]*$/.test(value) || value === "") {
      setName(value);
      if (errors.name) {
        setErrors(prev => ({ ...prev, name: "" }));
      }
    }
  };

  const handlePermissionChange = (permId) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    );
    if (errors.permissions) {
      setErrors(prev => ({ ...prev, permissions: "" }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setIsSuccess(false);

    if (!validateForm()) return;
    if (!dealerParent?.id) {
      setMessage("Vendor information missing");
      return;
    }

    const payload = {
      name: name.trim(),
      entity: "vendor",
      permissions: selectedPermissions,
      entity_id: dealerParent.id,
    };

    try {
      const url = editRole ? `/api/roles/${editRole._id}` : "/api/roles";
      const method = editRole ? "PUT" : "POST";

      const res = await fetchData(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("vendortoken")}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Request failed");
      }

      const data = await res.json();
      setMessage(editRole ? "Role updated successfully!" : "Role created successfully!");
      setIsSuccess(true);

      setRoles(prev =>
        editRole
          ? prev.map((r) => (r._id === editRole._id ? data.role : r))
          : [...prev, data.role]
      );
     
      setName("");
      setSelectedPermissions([]);
      setEditRole(null);

    } catch (error) {
      setMessage(error.message || "Submission failed. Please try again.");
      setIsSuccess(false);
    }
  };

  return (
    <>
      {message && (
        <Alert variant={isSuccess ? "success" : "danger"}>{message}</Alert>
      )}
      <div className="w_card">
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="roleName">
            <Form.Label>Role Name *</Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter role name (letters and numbers only)"
              value={name}
              onChange={handleNameChange}
              isInvalid={!!errors.name}
              maxLength={50}
            />
            <Form.Control.Feedback type="invalid">
              {errors.name}
            </Form.Control.Feedback>
            <Form.Text muted>
              Only alphanumeric characters and spaces allowed (2-50 characters)
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Permissions *</Form.Label>
            <div className="permissions-checkbox-group">
              {permissions.map((perm) => {
                const permId = `perm-${perm._id}`;
                return (
                  <Form.Check
                    key={perm._id}
                    type="checkbox"
                    id={permId}
                    label={perm.permission_name}
                    value={perm._id}
                    checked={selectedPermissions.includes(perm._id)}
                    onChange={() => handlePermissionChange(perm._id)}
                    className="mb-2"
                  />
                );
              })}
            </div>
            {errors.permissions && (
              <div className="text-danger small">{errors.permissions}</div>
            )}
          </Form.Group>

          <Form.Group className="d-flex justify-content-center">
            <Button 
              type="submit" 
              disabled={loading} 
              variant="custom" 
              className="w-100"
            >
              {loading ? "Processing..." : editRole ? "Update Role" : "Create Role"}
            </Button>
          </Form.Group>
        </Form>
      </div>
    </>
  );
}