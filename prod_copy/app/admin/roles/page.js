"use client";
import { useState, useEffect } from "react";
import CustomLoader from "./../components/CustomLoader";
import RoleForm from "./components/RoleForm";
import RoleList from "./components/RoleList";
import useFetch from "../../hooks/useFetch";
import { Button, Offcanvas } from "react-bootstrap";
export default function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [editRole, setEditRole] = useState(null);
  const [show, setShow] = useState(false);
  const { fetchData, error: fetchError } = useFetch();
  const [loading, setLoading] = useState(true); // override default from useFetch

  useEffect(() => {
    const fetchall = async () => {
      try {
        setLoading(true); // Start loading

        const roleRes = await fetchData(`/api/roles?type=admin`, {
          method: "GET",
          headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('token')}`},
        });

        const permissionRes = await fetchData(`/api/permissions?type=admin`, {
          method: "GET",
          headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        });

        const roleData = await roleRes.json();
        const permissionData = await permissionRes.json();

        setRoles(roleData);
        setPermissions(permissionData);
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false); // End loading regardless of error
      }
    };

    fetchall();
  }, []);

  const handleEditRole = (role) => {
    setEditRole(role);
    setShow(true);
  };

  const handleClose = () => setShow(false);

  if (loading) {
    return <CustomLoader />;
  }

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
