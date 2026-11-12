"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Accordion, Alert, Button, Col, Pagination, Row, Spinner } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import { formatTimestamp } from "../../../../utils/dateUtils";
import ViewConversations from "../../../leads/components/viewConversations";
import ViewAdfModal, { isAdfLead } from "../../../leads/components/ViewAdfModal";
import { Modal } from "react-bootstrap";
import LeadForm from "../../../leads/components/LeadForm";

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
// Each lead's funnel times (SOW B b4, G-009), from /api/leads/milestones. A step not reached yet shows "-".
const MILESTONES = [
  ["received", "Received"], ["first_response", "First response"], ["first_reply", "Customer replied"],
  ["appointment", "Appointment set"], ["visit", "Showroom visit"], ["sold", "Sold"], ["lost", "Closed - lost"],
];

function Milestones({ times }) {
  if (!times) return null;
  // Its own block above the conversation; a grid whose cells wrap their text, so long dates never push into the
  // next cell or out of the card (user, 13 Nov 2026).
  return (
    <div className="border rounded p-2 mb-3 small" aria-label="Lead milestones"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px 12px" }}>
      {MILESTONES.filter(([key]) => key !== "lost" || times.lost).map(([key, label]) => (
        <div key={key} style={{ minWidth: 0 }}>
          <div className="text-muted text-truncate" style={{ fontSize: "0.75rem" }} title={label}>{label}</div>
          <div className={`text-break ${times[key] ? "" : "text-muted"}`}>{times[key] ? formatTimestamp(times[key]) : "-"}</div>
        </div>
      ))}
    </div>
  );
}

export default function LeadsTab({ customerId }) {
  const { dealerParent, user, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [leads, setLeads] = useState([]);
  const [leadsPagination, setLeadsPagination] = useState(defaultLeadsPagination);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(null);
  const [activeLeadId, setActiveLeadId] = useState(null);
  const [adfModalLeadId, setAdfModalLeadId] = useState(null);
  const [milestones, setMilestones] = useState({});
  const [details, setDetails] = useState({});
  const [newLead, setNewLead] = useState(null); // prefilled LeadForm for a new opportunity (G-005)
  const hasAutoOpenedRef = useRef(false);

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
      const ids = (data.data || []).map((l) => l._id).join(",");
      if (ids) {
        // Not fatal: the leads still show without their milestones.
        fetch(`/api/leads/milestones?lead_ids=${ids}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (b) { setMilestones(b.milestones || {}); setDetails(b.details || {}); } }).catch(() => {});
      }
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

  // Land directly on the most-recent lead's conversation instead of making the
  // dealer expand the accordion themselves. Guarded by a ref (not activeLeadId
  // itself) so this only ever fires once - collapsing the accordion afterward
  // sets activeLeadId back to null and must NOT force it back open.
  useEffect(() => {
    if (!hasAutoOpenedRef.current && leads.length > 0) {
      hasAutoOpenedRef.current = true;
      setActiveLeadId(leads[0]._id);
    }
  }, [leads]);

  const handleLeadsPageChange = (page) => {
    if (page >= 1 && page <= leadsPagination.totalPages) fetchLeads(page);
  };

  return (
    <div className="w_card">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="w_card_title mb-0">Leads</h3>
        {leads.length > 0 && (
          <Button size="sm" variant="outline-custom" onClick={() => setNewLead({ name: leads[0].name || "",
            email: leads[0].email || "", phone: leads[0].phone || "" })}>
            <i className="fa-solid fa-plus me-1" />New lead for this customer
          </Button>
        )}
      </div>

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
                    <Col md={2}>{lead.fe_lead_status || "N/A"}
                      {details[lead._id] && <div className="text-muted">{details[lead._id].owner}</div>}</Col>
                    <Col md={3}>{lead.email || lead.phone || "No contact"}</Col>
                    <Col md={2} className="text-md-end text-muted">
                      {lead.createdAt ? formatTimestamp(lead.createdAt) : "N/A"}
                    </Col>
                  </Row>
                </Accordion.Header>
                <Accordion.Body>
                  <Milestones times={milestones[lead._id]} />
                  {details[lead._id]?.ai === "linked" && (
                    <Alert variant="light" className="border py-2 small mb-2">
                      <i className="fa-solid fa-link me-1" />
                      Its own lead (status, owner, source, appointments). The AI talks to this customer in one
                      conversation, on their lead for {details[lead._id].ai_lead_label?.[0] || "an earlier vehicle"}
                      {details[lead._id].ai_lead_label?.[1] ? ` from ${formatTimestamp(details[lead._id].ai_lead_label[1])}` : ""}
                      ; it is shown below too.
                    </Alert>
                  )}
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

      <Modal show={!!newLead} onHide={() => setNewLead(null)} size="lg" centered>
        <Modal.Header closeButton><Modal.Title as="h6">New lead for this customer</Modal.Title></Modal.Header>
        <Modal.Body>
          {newLead && <LeadForm editLead={newLead} setEditLead={() => { setNewLead(null); setTimeout(() => fetchLeads(1), 3000); }} />}
        </Modal.Body>
      </Modal>

      <ViewAdfModal
        show={!!adfModalLeadId}
        onHide={() => setAdfModalLeadId(null)}
        leadId={adfModalLeadId}
      />
    </div>
  );
}
