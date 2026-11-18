"use client";
import { useState, useEffect } from "react";
import { Button, Offcanvas } from "react-bootstrap";
import RoleForm from "./components/RoleForm";
import RoleList from "./components/RoleList";
import useFetch from "../../hooks/useFetch";
import { useUser } from "../context/UserContext";

export default function RoleManagement() {
  const { user, dealerParent } = useUser();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [editRole, setEditRole] = useState(null);
  const [show, setShow] = useState(false);
  const { fetchData, error: fetchError, loading } = useFetch();

  const fetchRolesAndPermissions = async () => {
    try {
      const parentId = dealerParent?.id;
      if (!parentId) return;

      const [roleRes, permissionRes] = await Promise.all([
        fetchData(`/api/roles?type=dealer&entity_id=${parentId}`,{
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        }),
        fetchData(`/api/permissions?type=dealer`,{
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        }),
      ]);

      if (!roleRes.ok) throw new Error("Failed to fetch roles");
      if (!permissionRes.ok) throw new Error("Failed to fetch permissions");

      const roleData = await roleRes.json();
      const permissionData = await permissionRes.json();

      setRoles(roleData);
      setPermissions(permissionData);
    } catch (err) {
      console.error("Fetch error:", err);
      setRoles([]);
      setPermissions([]);
    }
  };

  useEffect(() => {
    if (dealerParent) {
      fetchRolesAndPermissions();
    }
  }, [dealerParent]);

  if (!dealerParent) {
    return (
      <>
        {loading}
      </>
    );
  }

  const handleEditRole = (role) => {
    setEditRole(role);
    setShow(true);
  };

  const handleClose = () => setShow(false);

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0">Employee Roles Management</h3>
              <Button
                variant="custom"
                size="sm"
                onClick={() => {
                  setEditRole(null);
                  setShow(true);
                }}
                className="ms-auto"
              >
                <i className="fa fa-plus me-1"></i> Add Role
              </Button>
              {/* SOW G-054: the standard dealership roles in one click (app/lib/standardRoles.js). */}
              <Button variant="outline-custom" size="sm" className="ms-2" onClick={async () => {
                if (!window.confirm("Add the standard roles - Rooftop Admin, Executive, Sales Manager, BDC / Sales, Service and Read-only? Roles you already have are kept as they are; nobody's role changes.")) return;
                const res = await fetch("/api/roles/standard", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` } });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { window.alert(data.message || "Could not add the roles"); return; }
                window.alert(data.created.length ? `Added: ${data.created.join(", ")}${data.skipped.length ? `. Already there: ${data.skipped.join(", ")}` : ""}` : "You already have all the standard roles.");
                fetchRolesAndPermissions();
              }}>
                <i className="fa-regular fa-users-gear me-1"></i> Add standard roles
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {fetchError && (
          <div className="alert alert-danger">
            <p>{fetchError}</p>
          </div>
        )}

        <RoleList roles={roles} setRoles={setRoles} setEditRole={handleEditRole} />
      </div>

      <Offcanvas show={show} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{editRole ? "Edit Role" : "Add Role"}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <RoleForm
            permissions={permissions}
            setRoles={setRoles}
            editRole={editRole}
            setEditRole={setEditRole}
            handleClose={handleClose}
          />
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
}