"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { ListGroup, Row, Col, Button, Form, Alert, Badge } from "react-bootstrap";

const NYC_TIMEZONE = "America/New_York";
import DateRangePickerComponent from "../../components/DateRangePicker";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

export default function ContactList({ onContactSelected }) {
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10
  });
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });
  const [dateRange, setDateRange] = useState({ startDate: null, endDate: null });

  // Filter states
  const [filters, setFilters] = useState({
    name: "",
    email: "",
    status: "",
    dateRange: {
      startDate: null,
      endDate: null
    }
  });

  const [appliedFilters, setAppliedFilters] = useState({
    name: "",
    email: "",
    status: "",
    dateRange: {
      startDate: null,
      endDate: null
    }
  });

  const statusOptions = [
    "new", "in-progress", "resolved"
  ];

  useEffect(() => {
    fetchContacts();
  }, [pagination.currentPage, appliedFilters]);

  const fetchContacts = async () => {
    try {
      setLoading(true);

      let queryParams = `page=${pagination.currentPage}&limit=${pagination.itemsPerPage}`;

      if (appliedFilters.name) queryParams += `&name=${encodeURIComponent(appliedFilters.name)}`;
      if (appliedFilters.email) queryParams += `&email=${encodeURIComponent(appliedFilters.email)}`;
      if (appliedFilters.status) queryParams += `&status=${appliedFilters.status}`;
      if (appliedFilters.dateRange.startDate) queryParams += `&startDate=${appliedFilters.dateRange.startDate.toISOString()}`;
      if (appliedFilters.dateRange.endDate) queryParams += `&endDate=${appliedFilters.dateRange.endDate.toISOString()}`;

      const res = await fetch(`/api/contact?${queryParams}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Failed to fetch contacts");

      setContacts(data.data || []);
      setPagination({
        currentPage: data.currentPage || 1,
        totalPages: data.totalPages || 1,
        totalItems: data.totalItems || 0,
        itemsPerPage: data.itemsPerPage || 10
      });
    } catch (err) {
      console.error("Error fetching contacts:", err);
      showAlert("Failed to load contacts", "danger");
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    // Reset to first page when applying new filters
    setPagination(prev => ({ ...prev, currentPage: 1 }));
    // Set the applied filters which will trigger the useEffect
    setAppliedFilters(filters);
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // const handleDateRangeChange = (start, end) => {
  //   setFilters(prev => ({
  //     ...prev,
  //     dateRange: { startDate: start, endDate: end }
  //   }));
  // };
  const handleDateRangeChange = ({ startDate, endDate }) => {
    setFilters({ ...filters, dateRange: { startDate, endDate } });
    setDateRange({ startDate, endDate }); // ✅ Now this won't throw error
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'new': return <Badge bg="secondary">New</Badge>;
      case 'in-progress': return <Badge bg="warning">In Progress</Badge>;
      case 'resolved': return <Badge bg="success">Resolved</Badge>;
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
    setSelectedContact(id);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedContact) return;

    if (!selectedContact) {
      console.error("No staff ID provided");
      return;
    }

    try {
      const response = await fetch(`/api/contact/${selectedContact}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`}
      });

      if (!response.ok) throw new Error("Failed to delete contact");

      setContacts(prev => prev.filter(c => c._id !== selectedContact));
      showAlert("Contact deleted successfully");

      if (contacts.length === 1 && pagination.currentPage > 1) {
        setPagination(prev => ({ ...prev, currentPage: prev.currentPage - 1 }));
      } else {
        fetchContacts();
      }
    } catch (err) {
      console.error("Error deleting contact:", err);
      showAlert("Failed to delete contact", "danger");
    }

    setShowDeleteModal(false);
    setSelectedContact(null);
  };

  const updateStatus = async (id, status) => {
    try {
      const response = await fetch(`/api/contact/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });

      if (!response.ok) throw new Error("Failed to update status");

      setContacts(prev => prev.map(c =>
        c._id === id ? { ...c, status } : c
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
      dateRange: {
        startDate: null,
        endDate: null
      }
    });
    setDateRange({
      startDate: null,
      endDate: null
    });
    setAppliedFilters({
      name: "",
      email: "",
      status: "",
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
        <div className="text-center py-4">Loading contacts...</div>
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
          <Col xl={3} md={2}>
            <div className="d-flex align-items-center">
              <h3 className="w_card_title mb-0">Contact List</h3>
            </div>
          </Col>
          <Col xl={9} md={10}>
            {/* Filter Controls */}
            <Row className="search_filters gx-1 gy-1 gy-md-0">
              <Col md={3} xs={6}>
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
              <Col md={2} xs={4}>
                <Form.Select
                  name="status"
                  value={filters.status}
                  onChange={handleFilterChange}
                  size="sm"
                >
                  <option value="">All Status</option>
                  {statusOptions.map(status => (
                    <option key={status} value={status}>
                      {status.replace('-', ' ').toUpperCase()}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2} xs={5}>
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={dateRange}
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
                    disabled={!filters.name && !filters.email && !filters.status && !filters.dateRange.startDate}
                    className="text-nowrap"
                  >Clear</Button>
                </div>
              </Col>
            </Row>

          </Col>
        </Row>

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" className="w_card_list_head border-0 list-group-item">
              <Row className="align-items-center g-0 row">
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
                      <p className="label"><small>Created at (NYC)</small></p>
                    </Col>
                  </Row>
                </Col>
                
                <Col xl={2} lg={2} sm={2} xs={2}>
                  <p className="label"><small>Status</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {contacts.length > 0 ? (
              contacts.map(contact => (
                <ListGroup.Item as="li" key={contact._id} className="w_card_list_box list-group-item">
                  <Row className="align-items-md-center g-0 row">
                    <Col xl={8} lg={8} sm={8} xs={12} onClick={() => onContactSelected(contact)} className="a_link mb-2 mb-md-0">
                      <Row className="align-items-center">
                        <Col xl={3} lg={3} sm={3} xs={12}>
                          <p className="p_bold">{contact.firstName} {contact.lastName}</p>
                        </Col>
                        <Col xl={4} lg={4} sm={4} xs={12}>
                          <p>{contact.email}</p>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <p>{contact.phone || "N/A"}</p>
                        </Col>
                        <Col xl={3} lg={3} sm={3} xs={12}>
                          <p>{formatTimestamp(contact.createdAt, NYC_TIMEZONE)}</p>
                        </Col>
                      </Row>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={6}>
                      <Form.Select
                        size="sm"
                        value={contact.status}
                        onChange={(e) => updateStatus(contact._id, e.target.value)}
                        className={`w-auto ${contact.status === "in-progress"
                          ? "text-warning border-warning"
                          : contact.status === "resolved"
                            ? "text-success border-success"
                            : "text-custom border-custom"
                          }`}
                      >
                        {statusOptions.map(status => (
                          <option key={status} value={status}>
                            {status.replace('-', ' ')}
                          </option>
                        ))}
                      </Form.Select>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={6}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button variant="danger" size="sm" onClick={() => confirmDelete(contact._id)}>
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={() => onContactSelected(contact)}>
                          <i className="fa-regular fa-eye"></i>
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No contacts found.</div>
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

      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Support Tickets?"
        body="Are you sure you want to delete this support ticket?"
      />
    </>
  );
}