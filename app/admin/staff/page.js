"use client";
import { useState, useEffect } from "react";
import { Button, Col, Form, Offcanvas, Row } from "react-bootstrap";
import StaffForm from "./components/StaffForm";
import StaffList from "./components/StaffList";
import useFetch from "../../hooks/useFetch";

export default function StaffManagement() {
  const { fetchData } = useFetch();
  const [staff, setStaff] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editStaff, setEditStaff] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(true);
  
  // Form input values
  const [formInputs, setFormInputs] = useState({
    name: "",
    email: "",
    role: ""
  });
  
  // Active search parameters
  const [searchParams, setSearchParams] = useState({
    name: "",
    email: "",
    role: "",
    page: 1
  });

  const fetchStaff = async () => {
    try {
      setLoadingStaff(true);
      setError(null);

      let url = `/api/staff?page=${searchParams.page}&type=admin`;
      if (searchParams.name) url += `&name=${searchParams.name}`;
      if (searchParams.email) url += `&email=${searchParams.email}`;
      if (searchParams.role) url += `&role=${searchParams.role}`;

      const [staffRes, rolesRes] = await Promise.all([
        fetchData(url,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }}),
        fetchData(`/api/roles?type=admin`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
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
    fetchStaff();
  }, [searchParams]); // Trigger when searchParams change

  const handleSearch = () => {
    setSearchParams({
      ...formInputs,
      page: 1 // Reset to first page when searching
    });
  };

  const handleEditStaff = (staffMember) => {
    setEditStaff(staffMember);
    setShow(true);
  };

  const handleClose = () => setShow(false);

  const clearFilters = () => {
    setFormInputs({
      name: "",
      email: "",
      role: ""
    });
    setSearchParams({
      name: "",
      email: "",
      role: "",
      page: 1
    });
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setSearchParams(prev => ({
      ...prev,
      page
    }));
  };

  return (
    <>
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
                    value={formInputs.name}
                    onChange={(e) => setFormInputs({...formInputs, name: e.target.value})}
                    size="sm"
                  />
                </Col>
                <Col md={3} xs={6}>
                  <Form.Control
                    type="text"
                    placeholder="Search by Email"
                    value={formInputs.email}
                    onChange={(e) => setFormInputs({...formInputs, email: e.target.value})}
                    size="sm"
                  />
                </Col>
                <Col md={2} xs={5}>
                  <Form.Select
                    value={formInputs.role}
                    onChange={(e) => setFormInputs({...formInputs, role: e.target.value})}
                    size="sm"
                  >
                    <option value="">Filter by Role</option>
                    {roles.map((role) => (
                      <option key={role._id} value={role._id}>
                        {role.name}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col md={4} xs={7}>
                  <div className="d-flex">
                    <Button
                      variant="custom"
                      size="sm"
                      onClick={handleSearch}
                    >
                      Apply
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={clearFilters}
                      disabled={!formInputs.name && !formInputs.email && !formInputs.role}
                      className="text-nowrap ms-1"
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
                      <i className="fa fa-plus me-1"></i> Add Emp
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
            setCurrentPage={handlePageChange}
            totalPages={totalPages}
            fetchStaff={fetchStaff}
            loading={loadingStaff}
          />
        </div>

        <Offcanvas show={show} onHide={handleClose} placement="end">
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>
              {editStaff ? "Edit Employee" : "Add Employee"}
            </Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            <StaffForm
              roles={roles}
              setStaff={setStaff}
              editStaff={editStaff}
              setEditStaff={setEditStaff}
              fetchStaff={fetchStaff}
              handleClose={handleClose}
            />
          </Offcanvas.Body>
        </Offcanvas>
      </div>
    </>
  );
}