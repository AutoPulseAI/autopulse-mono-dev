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
        fetchData(`/api/roles?type=vendor&entity_id=${parentId}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }}),
        fetchData(`/api/permissions?type=vendor`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }}),
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