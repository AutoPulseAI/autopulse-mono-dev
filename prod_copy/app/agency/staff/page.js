"use client";
import { useState, useEffect } from "react";
import { Button, Col, Form, Offcanvas, Row } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import StaffList from "./components/StaffList";
import StaffForm from "./components/StaffForm";
import useFetch from "../../hooks/useFetch";

export default function StaffManagement() {
  const { fetchData, error: fetchError, loading } = useFetch();
  const { dealerParent, loadingParent } = useUser();
  const [staff, setStaff] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editStaff, setEditStaff] = useState(null);
  const [show, setShow] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState(null);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empRole, setEmpRole] = useState("");


  const fetchStaff = async () => {
    try {
      if (!dealerParent?.id) return;
      setLoadingStaff(true);
      setError(null);

      const [staffRes, rolesRes] = await Promise.all([
        fetchData(`/api/staff?page=${currentPage}&type=vendor&parent_id=${dealerParent.id}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }}),
        fetchData(`/api/roles?type=vendor&entity_id=${dealerParent.id}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }}),
      ]);

      if (!staffRes.ok) throw new Error("Failed to fetch Employees");
      if (!rolesRes.ok) throw new Error("Failed to fetch roles");

      const staffData = await staffRes.json();
      const rolesData = await rolesRes.json();

      setStaff(staffData.staff || []);
      setTotalPages(staffData.totalPages || 1);
      setRoles(rolesData || []);
    } catch (err) {
      console.error("Fetch error:", err);
      setError(err.message);
      setStaff([]);
      setRoles([]);
    } finally {
      setLoadingStaff(false);
    }
  };

  useEffect(() => {
    if (dealerParent) {
      fetchStaff();
    }
  }, [dealerParent, currentPage]);

  if (loadingParent || !dealerParent) return;

  const handleEditStaff = (staffMember) => {
    setEditStaff(staffMember);
    setShow(true);
  };

  const handleClose = () => setShow(false);

  const clearFilters = () => {
    setEmpName("");
    setEmpEmail("");
    setEmpRole("");
    setCurrentPage(1); // Reset to first page
    fetchStaff(); // Refetch staff with cleared filters
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <Row className="align-items-center">
          <Col md={3}>
            <div className="d-flex align-items-center mb-md-0 mb-2">
              <h3 className="page_title mb-0">Employee Management</h3>
            </div>
          </Col>
          <Col md={9}>
            <Row className="search_filters gx-1 gy-md-0 gy-1">
              <Col md={3} xs={6}>
                <Form.Control
                  type="text"
                  placeholder="Search by Name"
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  size="sm"
                />
              </Col>
              <Col md={3} xs={6}>
                <Form.Control
                  type="text"
                  placeholder="Search by Email"
                  value={empEmail}
                  onChange={(e) => setEmpEmail(e.target.value)}
                  size="sm"
                />
              </Col>
              <Col md={2} xs={5}>
                <Form.Select
                  value={empRole}
                  onChange={(e) => setEmpRole(e.target.value)}
                  size="sm"
                >
                  <option value="">Filter by Role</option>
                  {roles.map((role) => {
                    return (
                      <option key={role._id} value={role.name}>{role.name}</option>
                    )
                  })}
                </Form.Select>
              </Col>
              <Col md={4} xs={7}>
                <div className="d-flex gap-1">
                  <Button variant="custom" size="sm">Apply</Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearFilters}
                    disabled={!empName && !empEmail && !empRole}
                    className="text-nowrap"
                  >
                    Clear
                  </Button>
                  <Button
                    variant="custom"
                    size="sm"
                    onClick={() => {
                      setEditStaff(null);
                      setShow(true);
                    }}
                    className="ms-auto"
                  >
                    <i className="fa fa-plus me-1"></i>Add Emp
                  </Button>
                </div>
              </Col>
            </Row>
          </Col>
        </Row>
      </div>

      <div className="page_body">
        {error && (
          <div className="alert alert-danger">
            <p>{error}</p>
          </div>
        )}

        <StaffList
          staff={staff}
          setStaff={setStaff}
          setEditStaff={handleEditStaff}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          totalPages={totalPages}
          fetchStaff={fetchStaff}
          empName={empName}
          empEmail={empEmail}
          empRole={empRole}
        />
      </div>

      <Offcanvas show={show} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{editStaff ? "Edit Employee" : "Add Employee"}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <StaffForm
            roles={roles}
            setStaff={setStaff}
            editStaff={editStaff}
            setEditStaff={setEditStaff}
            dealerId={dealerParent.id}
            fetchStaff={fetchStaff}
            handleClose={handleClose}
          />
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
}
