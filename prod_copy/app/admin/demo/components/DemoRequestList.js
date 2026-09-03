"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { ListGroup, Row, Col, Button, Form, Alert, Badge } from "react-bootstrap";

const NYC_TIMEZONE = "America/New_York";
import DateRangePickerComponent from "../../components/DateRangePicker";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

export default function DemoRequestList({ onDemoRequestSelected }) {
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10
  });
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  // Filter states
  const [filters, setFilters] = useState({
    name: "",
    email: "",
    status: "",
    type: "",
    dateRange: {
      startDate: null,
      endDate: null
    }
  });

  const [appliedFilters, setAppliedFilters] = useState({
    name: "",
    email: "",
    status: "",
    type: "",
    dateRange: {
      startDate: null,
      endDate: null
    }
  });

  const statusOptions = [
    "pending", "contacted", "scheduled", "completed", "rejected"
  ];

  const typeOptions = [
    "dealership", "agency"
  ];

  useEffect(() => {
    fetchDemoRequests();
  }, [pagination.currentPage, appliedFilters]);

  const fetchDemoRequests = async () => {
    try {
      setLoading(true);

      let queryParams = `page=${pagination.currentPage}&limit=${pagination.itemsPerPage}`;

      if (appliedFilters.name) queryParams += `&name=${encodeURIComponent(appliedFilters.name)}`;
      if (appliedFilters.email) queryParams += `&email=${encodeURIComponent(appliedFilters.email)}`;
      if (appliedFilters.status) queryParams += `&status=${appliedFilters.status}`;
      if (appliedFilters.type) queryParams += `&type=${appliedFilters.type}`;
      
      // Format dates without time (YYYY-MM-DD)
      if (appliedFilters.dateRange.startDate) {
        const startDate = new Date(appliedFilters.dateRange.startDate);
        startDate.setHours(0, 0, 0, 0);
        queryParams += `&startDate=${startDate.toISOString()}`;
      }
      if (appliedFilters.dateRange.endDate) {
        const endDate = new Date(appliedFilters.dateRange.endDate);
        endDate.setHours(23, 59, 59, 999);
        queryParams += `&endDate=${endDate.toISOString()}`;
      }

      const res = await fetch(`/api/bookademo?${queryParams}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Failed to fetch demo requests");

      setRequests(data.data || []);
      setPagination({
        currentPage: data.currentPage || 1,
        totalPages: data.totalPages || 1,
        totalItems: data.totalItems || 0,
        itemsPerPage: data.itemsPerPage || 10
      });
    } catch (err) {
      console.error("Error fetching demo requests:", err);
      showAlert("Failed to load demo requests", "danger");
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    setPagination(prev => ({ ...prev, currentPage: 1 }));
    setAppliedFilters({...filters});
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleDateRangeChange = ({ startDate, endDate }) => {
    setFilters(prev => ({
      ...prev,
      dateRange: { startDate, endDate }
    }));
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending': return <Badge bg="secondary">Pending</Badge>;
      case 'contacted': return <Badge bg="primary">Contacted</Badge>;
      case 'scheduled': return <Badge bg="warning">Scheduled</Badge>;
      case 'completed': return <Badge bg="success">Completed</Badge>;
      case 'rejected': return <Badge bg="danger">Rejected</Badge>;
      default: return <Badge bg="light">Unknown</Badge>;
    }
  };

  const handlePageChange = (page) => {
    setPagination(prev => ({ ...prev, currentPage: page }));
  };

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ ...alert, show: false }), 5000);
  };

  const confirmDelete = (id) => {
    setSelectedRequest(id);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedRequest) return;

    try {
      const response = await fetch(`/api/bookademo?id=${selectedRequest}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) throw new Error("Failed to delete demo request");

      setRequests(prev => prev.filter(r => r._id !== selectedRequest));
      showAlert("Demo request deleted successfully");

      if (requests.length === 1 && pagination.currentPage > 1) {
        setPagination(prev => ({ ...prev, currentPage: prev.currentPage - 1 }));
      } else {
        fetchDemoRequests();
      }
    } catch (err) {
      console.error("Error deleting demo request:", err);
      showAlert("Failed to delete demo request", "danger");
    }

    setShowDeleteModal(false);
    setSelectedRequest(null);
  };

  const updateStatus = async (id, status) => {
    try {
      const response = await fetch(`/api/bookademo/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });

      if (!response.ok) throw new Error("Failed to update status");

      setRequests(prev => prev.map(r =>
        r._id === id ? { ...r, status } : r
      ));
      showAlert("Status updated successfully");
    } catch (err) {
      console.error("Error updating status:", err);
      showAlert("Failed to update status", "danger");
    }
  };

  const clearFilters = () => {
    setFilters({
      name: "",
      email: "",
      status: "",
      type: "",
      dateRange: {
        startDate: null,
        endDate: null
      }
    });
    setAppliedFilters({
      name: "",
      email: "",
      status: "",
      type: "",
      dateRange: {
        startDate: null,
        endDate: null
      }
    });
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  if (loading) {
    return (
      <div className="w_card">
        <div className="text-center py-4">Loading demo requests...</div>
      </div>
    );
  }

  return (
    <>
      {alert.show && (
        <Alert variant={alert.variant} onClose={() => setAlert({ ...alert, show: false })} dismissible>
          {alert.message}
        </Alert>
      )}

      <div className="w_card">
        <Row className="align-items-center">
          <Col xl={5} md={3} >
            <div className="d-flex align-items-center mb-2">
              <h3 className="w_card_title mb-0">Demo Requests</h3>
            </div>
          </Col>
          <Col xl={7} md={9}>
            <Row className="search_filters gx-1 gy-1 gy-md-0">
              <Col md={4} xs={6}>
                <Form.Control
                  type="text"
                  name="name"
                  placeholder="Filter by Name"
                  value={filters.name}
                  onChange={handleFilterChange}
                  size="sm"
                />
              </Col>
              <Col md={3} xs={6}>
                <Form.Control
                  type="email"
                  name="email"
                  placeholder="Filter by Email"
                  value={filters.email}
                  onChange={handleFilterChange}
                  size="sm"
                />
              </Col>
              <Col md={3} xs={9}>
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={filters.dateRange}
                  size="sm"
                />
              </Col>
              <Col md={2} xs={3} className="text-end">
                <div className="d-flex gap-1">
                  <Button
                    variant="custom"
                    size="sm"
                    onClick={applyFilters}
                  >
                    Apply
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearFilters}
                    disabled={!filters.name && !filters.email && !filters.status && !filters.type && !filters.dateRange.startDate}
                    className="text-nowrap"
                  >
                    Clear
                  </Button>
                </div>
              </Col>
            </Row>
          </Col>
        </Row>

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" className="w_card_list_head border-0 list-group-item">
              <Row className="align-items-center g-0">
                <Col xl={8} lg={8} sm={8} xs={8}>
                  <Row className="align-items-center">
                    <Col xl={3} lg={3} sm={3} xs={12}>
                      <p className="label"><small>Name</small></p>
                    </Col>
                    <Col xl={4} lg={4} sm={4} xs={12}>
                      <p className="label"><small>Email</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Phone</small></p>
                    </Col>
                    <Col xl={3} lg={3} sm={3} xs={12}>
                      <p className="label"><small>Submitted (NYC)</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={2} lg={2} sm={2} xs={2}>
                  <p className="label"><small>Type</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={2}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {requests.length > 0 ? (
              requests.map(request => (
                <ListGroup.Item as="li" key={request._id} className="w_card_list_box list-group-item">
                  <Row className="align-items-md-center g-0">
                    <Col xl={8} lg={8} sm={8} xs={7} onClick={() => onDemoRequestSelected(request)} className="a_link">
                      <Row className="align-items-center">
                        <Col xl={3} lg={3} sm={3} xs={12}>
                          <p className="p_bold">{request.name}</p>
                        </Col>
                        <Col xl={4} lg={4} sm={4} xs={12}>
                          <p>{request.email}</p>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <p>{request.phone}</p>
                        </Col>
                        <Col xl={3} lg={3} sm={3} xs={12}>
                          <p>{formatTimestamp(request.createdAt, NYC_TIMEZONE)}</p>
                        </Col>
                      </Row>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={3}>
                      <p className="text-md-start text-end pe-md-0 pe-2"><small className="text-capitalize me-0">
                        <Badge
                          pill
                          bg="light"
                          className={`border ${request.dealershipAgencyName === "dealership"
                            ? "text-info-emphasis border-info-emphasis"
                            : "text-warning-emphasis border-warning-emphasis"
                            }`}
                        >{request.dealershipAgencyName}</Badge>
                      </small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={2}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button variant="danger" size="sm" onClick={() => confirmDelete(request._id)}>
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={() => onDemoRequestSelected(request)}>
                          <i className="fa-regular fa-eye"></i>
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No demo requests found.</div>
            )}
          </ListGroup>

          {pagination.totalPages > 1 && (
            <div className="d-flex justify-content-center mt-3">
              <nav>
                <ul className="pagination">
                  <li className={`page-item ${pagination.currentPage === 1 ? 'disabled' : ''}`}>
                    <button className="page-link" onClick={() => handlePageChange(pagination.currentPage - 1)}>
                      Previous
                    </button>
                  </li>
                  {Array.from({ length: pagination.totalPages }, (_, i) => (
                    <li key={i + 1} className={`page-item ${pagination.currentPage === i + 1 ? 'active' : ''}`}>
                      <button className="page-link" onClick={() => handlePageChange(i + 1)}>
                        {i + 1}
                      </button>
                    </li>
                  ))}
                  <li className={`page-item ${pagination.currentPage === pagination.totalPages ? 'disabled' : ''}`}>
                    <button className="page-link" onClick={() => handlePageChange(pagination.currentPage + 1)}>
                      Next
                    </button>
                  </li>
                </ul>
              </nav>
            </div>
          )}
        </div>
      </div>

      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Demo Request?"
        body="Are you sure you want to delete this demo request?"
      />
    </>
  );
}