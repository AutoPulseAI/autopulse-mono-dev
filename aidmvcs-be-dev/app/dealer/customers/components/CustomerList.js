"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Form, ListGroup, Modal, Pagination, Row, Col } from "react-bootstrap";
import moment from "moment-timezone";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import CustomerForm from "./CustomerForm";
import { lastFirst } from "../../../lib/personName";
import DateRangePickerComponent from "../../components/DateRangePicker";
import AppIcon, { Avatar, IconLabel } from "../../components/AppIcon";
import { rememberCustomerList } from "../[id]/components/customerListMemory";

const defaultPagination = {
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 10,
  hasNextPage: false,
  hasPreviousPage: false,
};

function primaryValue(items) {
  return items?.find((item) => item.is_primary)?.value || items?.[0]?.value || "";
}

// The one search box, read the same way as the list beside the profile (CustomerSideList.js): an @ means email,
// only digits and phone signs (3+ digits) a phone number, anything else a name.
function searchFields(text) {
  const term = String(text || "").trim();
  const out = { name: "", last_name: "", email: "", phone: "" };
  if (!term) return out;
  if (term.includes("@")) out.email = term;
  else if (/^[\d\s()+.-]+$/.test(term) && term.replace(/\D/g, "").length >= 3) out.phone = term;
  else out.name = term;
  return out;
}

export default function CustomerList() {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState(defaultPagination);
  const [filters, setFilters] = useState({
    name: "",
    last_name: "",
    email: "",
    phone: "",
    source: "",
    assigned_to: "",
    sort: "",
    dateRange: { startDate: null, endDate: null },
  });
  // The one search box; it fills name / email / phone (searchFields below).
  const [searchText, setSearchText] = useState("");
  const [staffList, setStaffList] = useState([]);
  const canAssign = useCan("Assign Leads");
  const dealerTimezone = activeEntity?.dealer_account_information?.time_zone || "America/New_York";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageInputValue, setPageInputValue] = useState("1");
  // Same editLead convention as LeadList.js: {} opens the form in create mode.
  const [editCustomer, setEditCustomer] = useState(null);

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
        if (key === "dateRange") return; // handled separately below
        if (value) params.set(key, value);
      });
      if (filters.dateRange.startDate && filters.dateRange.endDate) {
        params.set("startDate", filters.dateRange.startDate.toISOString());
        params.set("endDate", filters.dateRange.endDate.toISOString());
      }

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

  useEffect(() => {
    fetchCustomers(1);
  }, [fetchCustomers]);

  useEffect(() => {
    if (!activeEntity?.id) return;
    fetch(`/api/staff/list?dealer_id=${activeEntity.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` } })
      .then((r) => (r.ok ? r.json() : null)).then((b) => setStaffList(b?.staff || [])).catch(() => {});
  }, [activeEntity?.id]);

  const handleAssignmentChange = async (customerId, assignedToId) => {
    setError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ dealer_id: activeEntity.id, assigned_to: assignedToId || null }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not change the assignment");
      setCustomers((list) => list.map((c) => (c._id === customerId ? { ...c, assigned_to: assignedToId || null } : c)));
    } catch (assignError) {
      setError(assignError.message);
    }
  };

  // Auto-filter as the user types, instead of requiring the Search button click.
  // Skips the initial mount so it doesn't re-fetch with the same (empty) filters
  // fetchCustomers(1) above already just requested.
  const isFirstInputRender = useRef(true);
  const searchDebounceRef = useRef(null);
  useEffect(() => {
    if (isFirstInputRender.current) {
      isFirstInputRender.current = false;
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, ...searchFields(searchText) }));
    }, 400);
    return () => clearTimeout(searchDebounceRef.current);
  }, [searchText]);

  // The 360 profile shows this same list on its left (search, source, dates, page) - CustomerSideList.js.
  const openCustomer = (customerId) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (key !== "dateRange" && value) query.set(key, value); });
    if (filters.dateRange.startDate && filters.dateRange.endDate) {
      query.set("startDate", filters.dateRange.startDate.toISOString());
      query.set("endDate", filters.dateRange.endDate.toISOString());
    }
    const at = ((pagination.currentPage || 1) - 1) * pagination.itemsPerPage
      + Math.max(0, customers.findIndex((c) => c._id === customerId));
    const listedPage = Math.floor(at / 15) + 1; // the side list shows 15 a page
    rememberCustomerList(query.toString(), listedPage);
    router.push(`/dealer/customers/${customerId}`);
  };

  const handleSearch = () => {
    clearTimeout(searchDebounceRef.current);
    setFilters((prev) => ({ ...prev, ...searchFields(searchText) }));
  };

  // Source and date range apply immediately (no debounce) - each already
  // only fires on a deliberate selection, not per-keystroke.
  const handleSourceChange = (event) => {
    setFilters((prev) => ({ ...prev, source: event.target.value }));
  };

  const handleDateRangeChange = ({ startDate, endDate }) => {
    setFilters((prev) => ({ ...prev, dateRange: { startDate, endDate } }));
  };

  const clearFilters = () => {
    clearTimeout(searchDebounceRef.current);
    setSearchText("");
    setFilters({ name: "", last_name: "", email: "", phone: "", source: "", assigned_to: "", sort: "", dateRange: { startDate: null, endDate: null } });
  };

  const handleCustomerPageChange = (page) => {
    if (page >= 1 && page <= pagination.totalPages) fetchCustomers(page);
  };

  const handleEditCustomerChange = (value) => {
    setEditCustomer(value);
    if (!value) fetchCustomers(pagination.currentPage); // picks up the newly created customer
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

  if (loadingParent || (loading && customers.length === 0 && !error)) {
    return <div className="w_card text-center py-4">Loading customers...</div>;
  }

  const staffName = (id) => staffList.find((s) => String(s._id) === String(id))?.name;

  return (
    <>
    <div className="w_card">
      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      {/* Laid out like the Leads list (27 Nov 2026): Sort, whose customers, one search box, the filters, then rows. */}
      <div className="d-flex gap-2 mb-2 align-items-center">
        <span className="small text-muted">Sort:</span>
        <Form.Select size="sm" style={{ flex: "1 1 0", minWidth: 0, maxWidth: 240 }} value={filters.sort}
          onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))} aria-label="Sort customers">
          <option value="">Latest activity first</option>
          <option value="created_desc">Customer since: newest first</option>
          <option value="created_asc">Customer since: oldest first</option>
          <option value="last_name">Last name A-Z</option>
        </Form.Select>
      </div>
      <div className="btn-group mb-3 lead_fltr" role="group" aria-label="Whose customers">
        {[["", "All", "fa-users", "All customers"], ["me", "Mine", "fa-user", "Customers assigned to me"],
          ["none", "Unassigned", "fa-user-slash", "Customers nobody is assigned to"]].map(([key, label, icon, title]) => (
          <Button key={key || "all"} size="sm" title={title} aria-pressed={filters.assigned_to === key}
            variant={filters.assigned_to === key ? "custom" : "outline-custom"}
            onClick={() => setFilters((prev) => ({ ...prev, assigned_to: key }))}>
            <i className={`fa-regular ${icon} me-1`} />{label}
          </Button>
        ))}
      </div>

      <Row className="align-items-center g-0">
        <Col>
          <div className="d-flex flex-md-column mb-2">
            <h3 className="w_card_title mb-0 me-2">Customer List</h3>
            <small className="text-muted">({pagination.totalItems.toLocaleString()} {pagination.totalItems === 1 ? "customer" : "customers"})</small>
          </div>
        </Col>
        <Col xs="auto">
          <Button variant="custom" size="sm" className="mb-2" onClick={() => setEditCustomer({})}>
            <i className="fa-solid fa-plus me-1" />Add Customer
          </Button>
        </Col>
      </Row>

      <Row className="search_filters gx-1 gy-1">
        <Col xl={4} md={6} xs={12}>
          {/* One box (as on the Leads list and beside the profile): an @ means email, digits a phone number, anything
              else a name (first, last or both). */}
          <Form.Control type="search" size="sm" placeholder="Search name, phone or email" aria-label="Search name, phone or email"
            value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
        </Col>
        <Col xl={2} md={3} xs={6}>
          <Form.Select size="sm" value={filters.source} onChange={handleSourceChange} aria-label="Source">
            <option value="">All Sources</option>
            <option value="inbound">Inbound Lead</option>
            <option value="internet">Internet</option>
            <option value="phone">Phone</option>
            <option value="imports">Imports</option>
            <option value="dealervault">DealerVault</option>
            <option value="both">Inbound & DealerVault</option>
            <option value="manual">Manual</option>
            <option value="unknown">Unknown</option>
          </Form.Select>
        </Col>
        <Col xl={2} md={3} xs={6}>
          <Form.Select size="sm" value={filters.assigned_to} aria-label="Assigned to"
            onChange={(e) => setFilters((prev) => ({ ...prev, assigned_to: e.target.value }))}>
            <option value="">Anyone (assigned to)</option>
            <option value="none">Unassigned</option>
            {staffList.map((staff) => <option key={staff._id} value={staff._id}>{staff.name}</option>)}
          </Form.Select>
        </Col>
        <Col xl={2} md={6} xs={12}>
          <DateRangePickerComponent onDateRangeChange={handleDateRangeChange} dateRange={filters.dateRange}
            timezone={dealerTimezone} className="w-100" />
        </Col>
        <Col xl={2} md={6} xs={12}>
          <div className="d-flex gap-1">
            <Button size="sm" variant="custom" className="w-50" onClick={handleSearch}>Search</Button>
            <Button size="sm" variant="secondary" className="w-50" onClick={clearFilters}>Clear</Button>
          </div>
        </Col>
      </Row>

      <div className="w_card_list mt-3" style={loading ? { opacity: 0.5 } : undefined}>
        <ListGroup as="ul" variant="flush">
          <ListGroup.Item as="li" className="w_card_list_head lead_list_head border-bottom-0">
            <Row className="align-items-center w-100 g-0">
              <Col xl={10} lg={9} sm={9} xs={12} className="lead_main_col">
                <Row className="align-items-center gx-2">
                  <Col xl={3} lg={3} sm={3}><p className="label"><small><IconLabel name="customer">Name</IconLabel></small></p></Col>
                  <Col xl={2} lg={2} sm={2}><p className="label"><small><IconLabel name="email">Email</IconLabel></small></p></Col>
                  <Col xl={2} lg={2} sm={2}><p className="label"><small><IconLabel name="phone">Phone</IconLabel></small></p></Col>
                  <Col xl={1} lg={1} sm={1}><p className="label"><small><IconLabel name="source">Source</IconLabel></small></p></Col>
                  <Col xl={2} lg={2} sm={2}><p className="label"><small><IconLabel name="owner">Assigned To</IconLabel></small></p></Col>
                  <Col xl={2} lg={2} sm={2}><p className="label"><small><IconLabel name="date">Customer since</IconLabel></small></p></Col>
                </Row>
              </Col>
              <Col xl={1} lg={1} sm={1} xs={12} className="lead_status_col">
                <p className="label"><small><IconLabel name="lead">Leads</IconLabel></small></p>
              </Col>
              <Col xl={1} lg={2} sm={2} xs={12} className="lead_action_col">
                <p className="p_bold text-center"><small><IconLabel name="action">Action</IconLabel></small></p>
              </Col>
            </Row>
          </ListGroup.Item>

          {customers.length === 0 ? <div className="text-center py-4">No customers found.</div> : customers.map((customer) => {
            const email = primaryValue(customer.emails);
            const phone = primaryValue(customer.phones);
            const moreContacts = (customer.emails?.length || 0) + (customer.phones?.length || 0) - (email ? 1 : 0) - (phone ? 1 : 0);
            const open = (e) => { if (e.target.closest("select, button, input")) return; openCustomer(customer._id); };
            const since = customer.createdAt ? moment(customer.createdAt).tz(dealerTimezone) : null;
            return (
              <ListGroup.Item as="li" key={customer._id} className="lead-item w_card_list_box d-flex align-items-center"
                style={{ cursor: "pointer" }} onClick={open}>
                <Row className="align-items-center w-100 g-0">
                  <Col xl={10} lg={9} sm={9} xs={12} className="lead_main_col">
                    <Row className="align-items-center gx-2">
                      <Col xl={3} lg={3} sm={3} xs={12} className="a_link">
                        <p className="p_bold ap_person"><Avatar name={lastFirst(customer)} /><span>{lastFirst(customer) || "Unnamed customer"}</span></p>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Email:</small></p>
                          <p className="ap_field"><AppIcon name="email" /><span className="text-truncate" title={email}>{email || "No email"}</span></p>
                        </div>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Phone:</small></p>
                          <p className="ap_field"><AppIcon name="phone" /><span>{phone || "No phone"}</span></p>
                          {moreContacts > 0 && <small className="text-muted d-block" title="Other phone numbers and email addresses on file">
                            <AppIcon name="contactMethods" />+{moreContacts} more</small>}
                        </div>
                      </Col>
                      <Col xl={1} lg={1} sm={1} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Source:</small></p>
                          <small className="badge bg-light text-dark border text-wrap text-start" title="Where this customer came from">
                            {customer.origin_badge || "Unknown"}</small>
                        </div>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Assigned To:</small></p>
                          {canAssign ? (
                            <Form.Select size="sm" value={customer.assigned_to || ""} aria-label="Assigned to"
                              onChange={(e) => handleAssignmentChange(customer._id, e.target.value)}>
                              <option value="">Unassigned</option>
                              {staffList.map((staff) => <option key={staff._id} value={staff._id}>{staff.name}</option>)}
                            </Form.Select>
                          ) : (
                            <p className="text-truncate">{staffName(customer.assigned_to) || customer.assigned_to_name || "Unassigned"}</p>
                          )}
                        </div>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Customer since:</small></p>
                          <p className="ap_field ap_wrap"><AppIcon name="date" />
                            <span>{since ? since.format("MMM D, YYYY") : "N/A"}{since && <small className="d-block text-muted">{since.format("h:mm A")}</small>}</span></p>
                        </div>
                      </Col>
                    </Row>
                  </Col>
                  <Col xl={1} lg={1} sm={1} xs={12} className="lead_status_col">
                    <span className="ap_field" title={`${customer.lead_count ?? 0} leads`}><AppIcon name="lead" />{customer.lead_count ?? 0}</span>
                  </Col>
                  <Col xl={1} lg={2} sm={2} xs={12} className="lead_action_col">
                    <div className="d-flex justify-content-center gap-1">
                      <Button size="sm" variant="custom" title="Open the customer's profile" aria-label="Open the customer's profile"
                        onClick={() => openCustomer(customer._id)}><i className="fa-regular fa-eye" /></Button>
                    </div>
                  </Col>
                </Row>
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

    <Modal show={!!editCustomer} onHide={() => handleEditCustomerChange(null)} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Add Customer</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {editCustomer && <CustomerForm editCustomer={editCustomer} setEditCustomer={handleEditCustomerChange} />}
      </Modal.Body>
    </Modal>
    </>
  );
}
