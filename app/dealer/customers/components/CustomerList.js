"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Form, ListGroup, Pagination, Row, Col, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { formatTimestamp } from "../../../utils/dateUtils";

const defaultPagination = {
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 10,
  hasNextPage: false,
  hasPreviousPage: false,
};

const defaultLeadState = {
  leads: [],
  pagination: {
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 5,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  loading: false,
  loaded: false,
  error: null,
};

function primaryValue(items) {
  return items?.find((item) => item.is_primary)?.value || items?.[0]?.value || "";
}

function getLeadSource(lead) {
  return lead.source || lead.lead_source || "Unknown";
}

function getVehicleInterest(lead) {
  const parts = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export default function CustomerList() {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState(defaultPagination);
  const [filters, setFilters] = useState({ name: "", email: "", phone: "" });
  const [inputValues, setInputValues] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);
  const [leadStates, setLeadStates] = useState({});
  const [pageInputValue, setPageInputValue] = useState("1");

  const fetchCustomers = useCallback(async (page = 1) => {
    if (loadingParent || !activeEntity?.id) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        dealer_id: activeEntity.id,
        page: String(page),
        limit: String(pagination.itemsPerPage),
      });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const response = await fetch(`/api/customers?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load customers");

      setCustomers(data.data || []);
      setPagination(data.pagination || { ...defaultPagination, currentPage: page });
      setPageInputValue(String(data.pagination?.currentPage || page));
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, filters, loadingParent, pagination.itemsPerPage]);

  const fetchCustomerLeads = useCallback(async (customerId, page = 1) => {
    if (loadingParent || !activeEntity?.id) return;

    setLeadStates((previous) => ({
      ...previous,
      [customerId]: {
        ...(previous[customerId] || defaultLeadState),
        loading: true,
        error: null,
      },
    }));

    try {
      const params = new URLSearchParams({
        dealer_id: activeEntity.id,
        customer_id: customerId,
        page: String(page),
        limit: "5",
      });
      const response = await fetch(`/api/leads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load customer leads");

      setLeadStates((previous) => ({
        ...previous,
        [customerId]: {
          leads: data.data || [],
          pagination: data.pagination || defaultLeadState.pagination,
          loading: false,
          loaded: true,
          error: null,
        },
      }));
    } catch (fetchError) {
      setLeadStates((previous) => ({
        ...previous,
        [customerId]: {
          ...(previous[customerId] || defaultLeadState),
          loading: false,
          error: fetchError.message || "Failed to load customer leads",
        },
      }));
    }
  }, [activeEntity?.id, loadingParent]);

  useEffect(() => {
    fetchCustomers(1);
  }, [fetchCustomers]);

  const toggleCustomer = (customerId) => {
    if (expandedCustomerId === customerId) {
      setExpandedCustomerId(null);
      return;
    }

    setExpandedCustomerId(customerId);
    const state = leadStates[customerId];
    if (!state?.loaded && !state?.loading) fetchCustomerLeads(customerId, 1);
  };

  const handleSearch = () => setFilters({ ...inputValues });

  const clearFilters = () => {
    const emptyFilters = { name: "", email: "", phone: "" };
    setInputValues(emptyFilters);
    setFilters(emptyFilters);
  };

  const handleCustomerPageChange = (page) => {
    if (page >= 1 && page <= pagination.totalPages) fetchCustomers(page);
  };

  const createCustomerPaginationItems = () => {
    const items = [];
    const { totalPages, currentPage } = pagination;

    const addPageItem = (page) => {
      items.push(
        <Pagination.Item key={page} active={page === currentPage} onClick={() => handleCustomerPageChange(page)}>
          {page}
        </Pagination.Item>
      );
    };

    const addEllipsis = (key) => {
      items.push(
        <Pagination.Item key={key} disabled className="disabled">
          &hellip;
        </Pagination.Item>
      );
    };

    // Always show first 2 pages
    addPageItem(1);
    if (totalPages >= 2) addPageItem(2);

    // Show ellipsis if currentPage is beyond page 4
    if (currentPage > 3) {
      addEllipsis("start-ellipsis");
    }

    // Show currentPage neighbors if not near start or end
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 2, currentPage + 1);

    for (let i = start; i <= end; i++) {
      if (i > 2 && i < totalPages - 1) {
        addPageItem(i);
      }
    }

    // Show ellipsis if currentPage is before totalPages - 3
    if (currentPage < totalPages - 3) {
      addEllipsis("end-ellipsis");
    }

    // Always show last 2 pages
    if (totalPages > 3) addPageItem(totalPages - 1);
    if (totalPages > 2) addPageItem(totalPages);

    return items;
  };

  if (loadingParent || (loading && customers.length === 0)) {
    return <div className="w_card text-center py-4">Loading customers...</div>;
  }

  return (
    <div className="w_card">
      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      <Row className="search_filters gx-1 gy-1 mb-3">
        <Col lg={3} md={4} sm={12}>
          <Form.Control size="sm" placeholder="Name" value={inputValues.name} onChange={(event) => setInputValues({ ...inputValues, name: event.target.value })} />
        </Col>
        <Col lg={3} md={4} sm={12}>
          <Form.Control size="sm" placeholder="Email" value={inputValues.email} onChange={(event) => setInputValues({ ...inputValues, email: event.target.value })} />
        </Col>
        <Col lg={3} md={4} sm={12}>
          <Form.Control size="sm" placeholder="Phone" value={inputValues.phone} onChange={(event) => setInputValues({ ...inputValues, phone: event.target.value })} />
        </Col>
        <Col lg={3} md={12}>
          <div className="d-flex gap-1">
            <Button size="sm" variant="custom" onClick={handleSearch} className="flex-grow-1"><i className="fa-solid fa-magnifying-glass me-1" />Search</Button>
            <Button size="sm" variant="secondary" onClick={clearFilters} aria-label="Clear filters"><i className="fa-solid fa-xmark" /></Button>
          </div>
        </Col>
      </Row>

      <div className="d-flex align-items-center mb-2">
        <h3 className="w_card_title mb-0">Customer List</h3>
        <small className="text-muted ms-2">({pagination.totalItems.toLocaleString()} {pagination.totalItems === 1 ? "customer" : "customers"})</small>
      </div>

      <div className="w_card_list">
        <ListGroup variant="flush">
          <ListGroup.Item className="w_card_list_head border-bottom-0">
            <Row className="align-items-center">
              <Col md={3}>Name</Col>
              <Col md={3}>Primary Email</Col>
              <Col md={3}>Primary Phone</Col>
              <Col md={2}>Contact Methods</Col>
              <Col md={1} className="text-end">Leads</Col>
            </Row>
          </ListGroup.Item>

          {customers.length === 0 ? <div className="text-center py-4">No customers found.</div> : customers.map((customer) => {
            const isExpanded = expandedCustomerId === customer._id;
            const state = leadStates[customer._id] || defaultLeadState;
            const email = primaryValue(customer.emails);
            const phone = primaryValue(customer.phones);

            return (
              <ListGroup.Item key={customer._id} className="w_card_list_box p-0">
                <button type="button" className="w-100 border-0 bg-transparent text-start px-3 py-3" onClick={() => toggleCustomer(customer._id)} aria-expanded={isExpanded}>
                  <Row className="align-items-center">
                    <Col md={3} className="p_bold"><i className={`fa-solid ${isExpanded ? "fa-chevron-down" : "fa-chevron-right"} me-2`} />{customer.name || "Unnamed customer"}</Col>
                    <Col md={3}>{email || "No email"}</Col>
                    <Col md={3}>{phone || "No phone"}</Col>
                    <Col md={2}>{(customer.emails?.length || 0) + (customer.phones?.length || 0)}</Col>
                    <Col md={1} className="text-end">{customer.lead_count ?? 0}</Col>
                  </Row>
                </button>

                {isExpanded && (
                  <div className="border-top px-3 py-3 bg-light">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <h5 className="mb-0">Leads</h5>
                      {state.loading && <Spinner animation="border" size="sm" />}
                    </div>

                    {state.error && <Alert variant="danger" className="mb-2">{state.error}<Button size="sm" variant="outline-danger" className="ms-2" onClick={() => fetchCustomerLeads(customer._id, state.pagination.currentPage)}>Retry</Button></Alert>}
                    {!state.loading && !state.error && state.loaded && state.leads.length === 0 && <div className="text-muted py-2">No linked leads found.</div>}

                    {state.leads.length > 0 && <ListGroup variant="flush">
                      {state.leads.map((lead) => {
                        const vehicleInterest = getVehicleInterest(lead);
                        return (
                          <ListGroup.Item key={lead._id} className="px-2">
                            <Row className="align-items-center small">
                              <Col md={3}>{lead.name || "Unnamed lead"}</Col>
                              <Col md={2}>{getLeadSource(lead)}</Col>
                              <Col md={2}>{lead.fe_lead_status || "N/A"}</Col>
                              <Col md={3}>{lead.email || lead.phone || "No contact"}</Col>
                              <Col md={2} className="text-md-end text-muted">{lead.createdAt ? formatTimestamp(lead.createdAt) : "N/A"}</Col>
                            </Row>
                            {(vehicleInterest || lead.vin) && (
                              <Row className="small text-muted mt-1">
                                <Col>
                                  <i className="fa-solid fa-car me-1" />
                                  {vehicleInterest || "Vehicle interest unknown"}
                                  {lead.vin && <span> &middot; VIN: {lead.vin}</span>}
                                </Col>
                              </Row>
                            )}
                          </ListGroup.Item>
                        );
                      })}
                    </ListGroup>}

                    {state.pagination.totalPages > 1 && <Pagination size="sm" className="justify-content-center mt-3 mb-0"><Pagination.Prev disabled={!state.pagination.hasPreviousPage || state.loading} onClick={() => fetchCustomerLeads(customer._id, state.pagination.currentPage - 1)} /><Pagination.Item active>{state.pagination.currentPage}</Pagination.Item><Pagination.Next disabled={!state.pagination.hasNextPage || state.loading} onClick={() => fetchCustomerLeads(customer._id, state.pagination.currentPage + 1)} /></Pagination>}
                  </div>
                )}
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      </div>

      {pagination.totalPages > 1 && (
        <div className="d-md-flex justify-content-center mt-3">
          <Pagination className="mb-md-0 justify-content-center flex-wrap">
            <Pagination.Prev
              onClick={() => handleCustomerPageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1 || loading}
            />
            {createCustomerPaginationItems()}
            <Pagination.Next
              onClick={() => handleCustomerPageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === pagination.totalPages || loading}
            />
          </Pagination>

          <div className="d-flex align-items-center justify-content-center gap-1 ms-md-3 mt-1">
            <span className="text-muted small">Go to page:</span>
            <input
              type="number"
              min="1"
              value={pageInputValue}
              onChange={(event) => setPageInputValue(event.target.value)}
              onKeyPress={(event) => {
                if (event.key === "Enter") {
                  const page = parseInt(event.target.value, 10);
                  if (page >= 1) handleCustomerPageChange(page);
                }
              }}
              className="form-control form-control-sm text-center"
              style={{ width: "50px" }}
              placeholder="Page"
            />
            <span className="text-muted small">of {pagination.totalPages}</span>
            <Button
              size="sm"
              variant="outline-custom"
              onClick={() => {
                const page = parseInt(pageInputValue, 10);
                if (page >= 1) handleCustomerPageChange(page);
              }}
              disabled={!pageInputValue || parseInt(pageInputValue, 10) < 1}
            >
              Go
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
