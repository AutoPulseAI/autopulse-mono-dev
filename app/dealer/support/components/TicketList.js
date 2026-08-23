"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { ListGroup, Row, Col, Button, Form, Alert, Badge } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import DateRangePickerComponent from "../../components/DateRangePicker";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

export default function TicketList({ setEditTicket, onTicketSelected }) {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10
  });
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent || user;
  const [dateRange, setDateRange] = useState({ startDate: null, endDate: null });

  // Filter states
  const [filters, setFilters] = useState({
    subject: "",
    status: "",
    dateRange: {
      startDate: null,
      endDate: null
    }
  });

  const [appliedFilters, setAppliedFilters] = useState({
    subject: "",
    status: "",
    dateRange: {
      startDate: null,
      endDate: null
    }
  });

  const statusOptions = [
    "open", "in_progress", "resolved", "closed"
  ];

  useEffect(() => {
    if (!activeEntity?.id) return;
    fetchTickets();
  }, [activeEntity?.id, pagination.currentPage, appliedFilters]);

  const fetchTickets = async () => {
    try {
      setLoading(true);

      let queryParams = `user_id=${activeEntity.id}&page=${pagination.currentPage}&limit=${pagination.itemsPerPage}`;

      if (filters.subject) queryParams += `&subject=${encodeURIComponent(filters.subject)}`;
      if (filters.status) queryParams += `&status=${filters.status}`;
      if (filters.dateRange.startDate) queryParams += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) queryParams += `&endDate=${filters.dateRange.endDate.toISOString()}`;

      const res = await fetch(`/api/tickets?${queryParams}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Failed to fetch tickets");

      setTickets(data.data || []);
      setPagination({
        currentPage: data.currentPage || 1,
        totalPages: data.totalPages || 1,
        totalItems: data.totalItems || 0,
        itemsPerPage: data.itemsPerPage || 10
      });
    } catch (err) {
      console.error("Error fetching tickets:", err);
      showAlert("Failed to load tickets", "danger");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'open': return <Badge bg="custom">Open</Badge>;
      case 'in_progress': return <Badge bg="warning">In Progress</Badge>;
      case 'resolved': return <Badge bg="success">Resolved</Badge>;
      case 'closed': return <Badge bg="secondary">Closed</Badge>;
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
    setSelectedTicket(id);
    setShowDeleteModal(true);
  };

  const handleDelete = async (id) => {
    if (!selectedTicket) return;

    if (!selectedTicket) {
      console.error("No staff ID provided");
      return;
    }

    try {
      const response = await fetch(`/api/tickets/${selectedTicket}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) throw new Error("Failed to delete ticket");

      setTickets(prev => prev.filter(t => t._id !== selectedTicket));
      showAlert("Ticket deleted successfully");

      if (tickets.length === 1 && pagination.currentPage > 1) {
        setPagination(prev => ({ ...prev, currentPage: prev.currentPage - 1 }));
      } else {
        fetchTickets();
      }
    } catch (err) {
      console.error("Error deleting ticket:", err);
      showAlert("Failed to delete ticket", "danger");
    }

    setShowDeleteModal(false);
    setSelectedTicket(null);
  };

  const applyFilters = () => {
    // Reset to first page when applying new filters
    setPagination(prev => ({ ...prev, currentPage: 1 }));
    // Set the applied filters which will trigger the useEffect
    setAppliedFilters(filters);
  };

  const handleDateRangeChange = ({ startDate, endDate }) => {
    setFilters({ ...filters, dateRange: { startDate, endDate } });
    setDateRange({ startDate, endDate }); // ✅ Now this won't throw error
  };

  const clearFilters = () => {
    setFilters({
      subject: "",
      status: "",
      dateRange: {
        startDate: null,
        endDate: null
      }
    });
    setDateRange({ startDate: null, endDate: null });
    setAppliedFilters({
      subject: "",
      status: "",
      dateRange: {
        startDate: null,
        endDate: null
      }
    });
  };

  if (loading) {
    return (
      <div className="w_card">
        <div className="text-center py-4">Loading tickets...</div>
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
              <h3 className="w_card_title mb-0">Ticket List</h3>
              {dealerParent && (
                <span className="ms-2 text-muted"></span>
              )}
            </div>
          </Col>
          <Col xl={7} md={9}>
            {/* Filter Controls */}
            <Row className="search_filters gx-1">
              <Col md={4} xs={6}>
                <Form.Control
                  type="text"
                  placeholder="Filter by subject"
                  value={filters.subject}
                  onChange={(e) => setFilters({ ...filters, subject: e.target.value })}
                  size="sm"
                />
              </Col>
              <Col md={3} xs={6}>
                <Form.Select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  size="sm"
                >
                  <option value="">All Status</option>
                  {statusOptions.map(status => (
                    <option key={status} value={status}>
                      {status.replace('_', ' ').toUpperCase()}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3} xs={9} className="mt-1 mt-md-0">
                <DateRangePickerComponent
                  // onDateRangeChange={(start, end) =>
                  //   setFilters({ ...filters, dateRange: { startDate: start, endDate: end } })
                  // }
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={dateRange}
                  size="sm"
                />
              </Col>
              <Col md={2} xs={3} className="text-end">
                <div className="d-flex gap-1 w-100 justify-content-md-start justify-content-end mt-1 mt-md-0">
                  <Button
                    variant="custom"
                    size="sm"
                    onClick={() => applyFilters()}
                  >
                    Apply
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearFilters}
                    disabled={!filters.subject && !filters.status && !filters.dateRange.startDate}
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
                <Col xl={10} lg={10} sm={10} xs={8}>
                  <Row className="align-items-center">
                    <Col xl={4} lg={4} sm={5} xs={12}>
                      <p className="label"><small>Subject</small></p>
                    </Col>
                    <Col xl={4} lg={4} sm={3} xs={12}>
                      <p className="label"><small>Category</small></p>
                    </Col>
                    <Col xl={4} lg={4} sm={4} xs={12}>
                      <p className="label"><small>Created</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="label"><small>Status</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {tickets.length > 0 ? (
              tickets.map(ticket => (
                <ListGroup.Item as="li" key={ticket._id} className="w_card_list_box list-group-item">
                  <Row className="align-items-md-center g-0 row">
                    <Col xl={10} lg={10} sm={10} xs={7} onClick={() => onTicketSelected(ticket)} className="a_link">
                      <Row className="align-items-center">
                        <Col xl={4} lg={4} sm={5} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Subject:</small></p>
                            <p className="p_bold">
                              {ticket.ticketNumber
                                ? `#${ticket.ticketNumber} - ${ticket.title || "N/A"}`
                                : ticket.title || "N/A"}
                            </p>
                          </div>
                        </Col>
                        <Col xl={4} lg={4} sm={3} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Category:</small></p>
                            <p>{ticket.category || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={4} lg={4} sm={4} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Created:</small></p>
                            <p>{formatTimestamp(ticket.createdAt)}</p>
                          </div>
                        </Col>
                      </Row>
                    </Col>

                    <Col xl={1} lg={1} sm={1} xs={3} className="text-md-start text-end pe-md-0 pe-1">
                      {getStatusBadge(ticket.status)}
                    </Col>

                    <Col xl={1} lg={1} sm={1} xs={2}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button variant="danger" size="sm" onClick={() => confirmDelete(ticket._id)}>
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={() => onTicketSelected(ticket)}>
                          <i className="fa-regular fa-comment"></i>
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No tickets found.</div>
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