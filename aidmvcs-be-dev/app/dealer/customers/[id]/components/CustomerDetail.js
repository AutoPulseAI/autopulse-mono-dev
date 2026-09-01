"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Accordion, Alert, Badge, Button, Col, Pagination, Row, Spinner } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import { formatTimestamp } from "../../../../utils/dateUtils";
import ViewConversations from "../../../leads/components/viewConversations";

const defaultLeadsPagination = {
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 5,
  hasNextPage: false,
  hasPreviousPage: false,
};

function getLeadSource(lead) {
  return lead.source || lead.lead_source || "Unknown";
}

function getVehicleInterest(lead) {
  const parts = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function isAdfLead(lead) {
  return lead?.data?.format === "adf/xml";
}

export default function CustomerDetail({ customerId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();

  const [customer, setCustomer] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerError, setCustomerError] = useState(null);

  const [leads, setLeads] = useState([]);
  const [leadsPagination, setLeadsPagination] = useState(defaultLeadsPagination);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(null);
  const [activeLeadId, setActiveLeadId] = useState(null);

  const [adfText, setAdfText] = useState(null);
  const [adfLoading, setAdfLoading] = useState(false);
  const [adfError, setAdfError] = useState(null);

  const fetchCustomer = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !customerId) return;
    setCustomerLoading(true);
    setCustomerError(null);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/customers/${customerId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load customer");
      setCustomer(data.data);
    } catch (fetchError) {
      setCustomerError(fetchError.message || "Failed to load customer");
    } finally {
      setCustomerLoading(false);
    }
  }, [activeEntity?.id, customerId, loadingParent]);

  const fetchLeads = useCallback(async (page = 1) => {
    if (loadingParent || !activeEntity?.id || !customerId) return;
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const params = new URLSearchParams({
        dealer_id: activeEntity.id,
        customer_id: customerId,
        page: String(page),
        limit: String(defaultLeadsPagination.itemsPerPage),
      });
      const response = await fetch(`/api/leads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load leads");
      setLeads(data.data || []);
      setLeadsPagination(data.pagination || { ...defaultLeadsPagination, currentPage: page });
    } catch (fetchError) {
      setLeadsError(fetchError.message || "Failed to load leads");
    } finally {
      setLeadsLoading(false);
    }
  }, [activeEntity?.id, customerId, loadingParent]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  useEffect(() => {
    fetchLeads(1);
  }, [fetchLeads]);

  useEffect(() => {
    const activeLead = leads.find((lead) => lead._id === activeLeadId);
    if (!activeLeadId || !isAdfLead(activeLead)) {
      setAdfText(null);
      setAdfError(null);
      setAdfLoading(false);
      return;
    }

    let cancelled = false;
    setAdfLoading(true);
    setAdfError(null);
    setAdfText(null);

    (async () => {
      try {
        const response = await fetch(`/api/leads/${activeLeadId}/adf`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Failed to load ADF");
        if (!cancelled) setAdfText(data.data.raw_xml);
      } catch (fetchError) {
        if (!cancelled) setAdfError(fetchError.message || "Failed to load ADF");
      } finally {
        if (!cancelled) setAdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeLeadId, leads]);

  const handleLeadsPageChange = (page) => {
    if (page >= 1 && page <= leadsPagination.totalPages) fetchLeads(page);
  };

  if (loadingParent || customerLoading) {
    return <div className="w_card text-center py-4">Loading customer...</div>;
  }

  if (customerError) {
    return (
      <div className="w_card">
        <Alert variant="danger">{customerError}</Alert>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/customers")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Customers
        </Button>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <>
      <div className="w_card mb-3">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h3 className="w_card_title mb-0">{customer.name || "Unnamed customer"}</h3>
          <Button variant="custom" size="sm" onClick={() => router.push("/dealer/customers")}>
            <i className="fa-solid fa-arrow-left me-2" />Back to Customers
          </Button>
        </div>
        <Row className="gy-3">
          <Col md={6}>
            <strong>Emails:</strong>
            {customer.emails?.length ? (
              <ul className="list-unstyled mb-0 mt-1">
                {customer.emails.map((entry) => (
                  <li key={entry.value}>
                    {entry.value}
                    {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                    <span className="text-muted small ms-2">({entry.source || "unknown"})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted">No emails on file</div>
            )}
          </Col>
          <Col md={6}>
            <strong>Phones:</strong>
            {customer.phones?.length ? (
              <ul className="list-unstyled mb-0 mt-1">
                {customer.phones.map((entry) => (
                  <li key={entry.value}>
                    {entry.value}
                    {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                    {entry.sms_opt_in && <Badge bg="success" className="ms-2">SMS opt-in</Badge>}
                    <span className="text-muted small ms-2">({entry.source || "unknown"})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted">No phones on file</div>
            )}
          </Col>
          <Col md={4}><strong>Follow-up preference:</strong> {customer.followup_preference || "N/A"}</Col>
          <Col md={4}><strong>Preferred contact mode:</strong> {customer.preferred_communication_mode || "N/A"}</Col>
          <Col md={4}><strong>Language:</strong> {customer.user_language || "N/A"}</Col>
          <Col md={4}><strong>Leads:</strong> {customer.lead_count ?? 0}</Col>
          <Col md={4}><strong>Customer since:</strong> {customer.createdAt ? formatTimestamp(customer.createdAt) : "N/A"}</Col>
          <Col md={4}><strong>Last updated:</strong> {customer.updatedAt ? formatTimestamp(customer.updatedAt) : "N/A"}</Col>
        </Row>
      </div>

      <div className="w_card">
        <h3 className="w_card_title mb-3">Leads</h3>

        {leadsError && (
          <Alert variant="danger" dismissible onClose={() => setLeadsError(null)}>{leadsError}</Alert>
        )}

        {leadsLoading && leads.length === 0 ? (
          <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
        ) : leads.length === 0 ? (
          <div className="text-center py-4 text-muted">No leads found for this customer.</div>
        ) : (
          <Accordion activeKey={activeLeadId} onSelect={(key) => setActiveLeadId(key)}>
            {leads.map((lead) => {
              const vehicleInterest = getVehicleInterest(lead);
              return (
                <Accordion.Item eventKey={lead._id} key={lead._id}>
                  <Accordion.Header>
                    <Row className="align-items-center w-100 me-2 small">
                      <Col md={3} className="p_bold">{lead.name || "Unnamed lead"}</Col>
                      <Col md={2}>{getLeadSource(lead)}</Col>
                      <Col md={2}>{lead.fe_lead_status || "N/A"}</Col>
                      <Col md={3}>{lead.email || lead.phone || "No contact"}</Col>
                      <Col md={2} className="text-md-end text-muted">
                        {lead.createdAt ? formatTimestamp(lead.createdAt) : "N/A"}
                      </Col>
                    </Row>
                  </Accordion.Header>
                  <Accordion.Body>
                    {(vehicleInterest || lead.vin) && (
                      <div className="small text-muted mb-2">
                        <i className="fa-solid fa-car me-1" />
                        {vehicleInterest || "Vehicle interest unknown"}
                        {lead.vin && <span> &middot; VIN: {lead.vin}</span>}
                      </div>
                    )}
                    {activeLeadId === lead._id && isAdfLead(lead) && (
                      <div className="mb-3">
                        <div className="small text-muted mb-1">ADF payload</div>
                        {adfLoading ? (
                          <div className="text-muted small">
                            <Spinner animation="border" size="sm" className="me-2" />
                            Loading ADF...
                          </div>
                        ) : adfError ? (
                          <div className="text-danger small">{adfError}</div>
                        ) : adfText ? (
                          <pre
                            className="small bg-light border rounded p-2 mb-0"
                            style={{ maxHeight: 240, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                          >
                            {adfText}
                          </pre>
                        ) : null}
                      </div>
                    )}
                    {/* Only mount the (self-fetching, self-polling) conversation panel while
                        this accordion item is actually open. */}
                    {activeLeadId === lead._id && <ViewConversations lead={lead} embedded />}
                  </Accordion.Body>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )}

        {leadsPagination.totalPages > 1 && (
          <Pagination size="sm" className="justify-content-center mt-3 mb-0">
            <Pagination.Prev
              disabled={!leadsPagination.hasPreviousPage || leadsLoading}
              onClick={() => handleLeadsPageChange(leadsPagination.currentPage - 1)}
            />
            <Pagination.Item active>{leadsPagination.currentPage}</Pagination.Item>
            <Pagination.Next
              disabled={!leadsPagination.hasNextPage || leadsLoading}
              onClick={() => handleLeadsPageChange(leadsPagination.currentPage + 1)}
            />
          </Pagination>
        )}
      </div>
    </>
  );
}
