"use client";
import { useState, useEffect } from "react";
import { Form, Button, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function RoleForm({ permissions, setRoles, editRole, setEditRole, handleClose }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [message, setMessage] = useState("");
  const [userId, setUserId] = useState(null);
  const [errors, setErrors] = useState({});
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const fetchUserId = async () => {
      const token = localStorage.getItem("token");
      if (token) {
        const res = await fetchData("/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok) {
          setUserId(data?.user?._id);
        }
      }
    };
    fetchUserId();
  }, []);

  useEffect(() => {
    if (editRole && Object.keys(editRole).length > 0) {
      setName(editRole?.name || "");
      setSelectedPermissions(editRole?.permissions || []);
    }
  }, [editRole]);

  // Automatically remove message after 3 seconds
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
    let newErrors = {};
    if (!name.trim()) {
      newErrors.name = "Role Name is required.";
    } else if (!/^[a-zA-Z\s]+$/.test(name)) {
      newErrors.name = "Role Name should only contain letters and spaces.";
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
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setIsSuccess(false);

    if (!validateForm()) return;

    const payload = {
      name: name.trim(),
      entity: "admin",
      permissions: selectedPermissions,
      entity_id: userId,
    };

    try {
      const url = editRole ? `/api/roles/${editRole._id}` : "/api/roles";
      const method = editRole ? "PUT" : "POST";

      const res = await fetchData(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
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

  // const handleSubmit = async (e) => {
  //   e.preventDefault();
  //   setMessage("");
  //   setIsSuccess(false);

  //   if (!validateForm()) return;

  //   const payload = {
  //     name,
  //     entity: "admin",
  //     permissions: selectedPermissions,
  //     entity_id: userId,
  //   };

  //   const method = editRole ? "PUT" : "POST";
  //   const url = "/api/roles";

  //   const res = await fetch(url, {
  //     method,
  //     headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
  //     body: JSON.stringify(editRole ? { ...payload, roleId: editRole._id } : payload),
  //   });

  //   const data = await res.json();
  //   if (res.ok) {
  //     setMessage(editRole ? "Role updated successfully!" : "Role created successfully!");
  //     setIsSuccess(true);
  //     setRoles((prev) => (editRole ? prev.map((r) => (r._id === editRole._id ? data.role : r)) : [...prev, data.role]));
  //     setName("");
  //     setSelectedPermissions([]);
  //     setEditRole(null);
  //   } else {
  //     setMessage(data.message);
  //     setIsSuccess(false);
  //   }
  // };

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

      {/* <div className="w_card">
        <h3 className="w_card_title">{editRole ? "Edit Role" : "Create Role"}</h3>

        {message && <Alert variant="success">{message}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="roleName">Role Name</Form.Label>
            <Form.Control
              id="roleName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              isInvalid={!!errors.name}
            />
            <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Permissions</Form.Label>
            <div className="">
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
                  />
                );
              })}
            </div>
          </Form.Group>

          <Button variant="custom" type="submit">
            {editRole ? "Update" : "Create"}
          </Button>
        </Form>
      </div> */}
    </>

  );
}