"use client";

import { useCallback, useEffect, useState } from "react";
import { Accordion, Alert, Button, Col, Pagination, Row, Spinner } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import { formatTimestamp } from "../../../../utils/dateUtils";
import ViewConversations from "../../../leads/components/viewConversations";
import ViewAdfModal, { isAdfLead } from "../../../leads/components/ViewAdfModal";

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

// Unchanged from the pre-360 CustomerDetail.js, per
// docs/dealer-360-customer-view-spec.md §4: "existing lead + conversation
// accordion, unchanged from today". Fetches and paginates independently of
// the 360 endpoint (which only carries a lightweight, unpaginated lead list
// for the Overview feed).
export default function LeadsTab({ customerId }) {
  const { dealerParent, user, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [leads, setLeads] = useState([]);
  const [leadsPagination, setLeadsPagination] = useState(defaultLeadsPagination);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(null);
  const [activeLeadId, setActiveLeadId] = useState(null);
  const [adfModalLeadId, setAdfModalLeadId] = useState(null);

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
    fetchLeads(1);
  }, [fetchLeads]);

  const handleLeadsPageChange = (page) => {
    if (page >= 1 && page <= leadsPagination.totalPages) fetchLeads(page);
  };

  return (
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
                  {/* Only mount the (self-fetching, self-polling) conversation panel while
                      this accordion item is actually open. */}
                  {activeLeadId === lead._id && <ViewConversations lead={lead} embedded />}
                  {isAdfLead(lead) && (
                    <div className="d-flex justify-content-end mt-3">
                      <Button
                        variant="outline-custom"
                        size="sm"
                        onClick={() => setAdfModalLeadId(lead._id)}
                      >
                        <i className="fa-solid fa-file-code me-1" />View ADF
                      </Button>
                    </div>
                  )}
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

      <ViewAdfModal
        show={!!adfModalLeadId}
        onHide={() => setAdfModalLeadId(null)}
        leadId={adfModalLeadId}
      />
    </div>
  );
}
