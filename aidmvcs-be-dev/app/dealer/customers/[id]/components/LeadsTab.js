"use client";

import { leadStatusLabel } from "@lib/statusLabels";
import moment from "moment-timezone";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Pagination, Spinner, Table } from "react-bootstrap";
import AppIcon, { IconLabel, statusIconName } from "../../../components/AppIcon";
import { useUser } from "../../../context/UserContext";
import { formatTimestamp } from "../../../../utils/dateUtils";
import ViewConversations from "../../../leads/components/viewConversations";
import { leadTypeName } from "../../../leads/components/LeadInfoCard";
import { DEPARTMENT_NAMES, leadDepartment } from "@lib/departmentNames";
import ViewAdfModal, { isAdfLead } from "../../../leads/components/ViewAdfModal";
import { Modal } from "react-bootstrap";
import LeadForm from "../../../leads/components/LeadForm";
import OpportunityActions from "./OpportunityActions";

const defaultLeadsPagination = {
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 5,
  hasNextPage: false,
  hasPreviousPage: false,
};

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

// The lead (opportunity) at a glance above its conversation (13 Nov 2026 meeting 10.13, DealerSocket's opportunity
// header): its number, department, owner, how old it is against the 90-day follow-up period, and Hot (10.11).
const FOLLOW_UP_DAYS = 90;
function OpportunityHeader({ lead, owner, onHot }) {
  const days = lead.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt)) / 86400000)) : 0;
  const pct = Math.min(100, Math.round((days / FOLLOW_UP_DAYS) * 100));
  return (
    <div className="cp_opp mb-2">
      <span className="fw-semibold">Opportunity #{String(lead._id).slice(-6).toUpperCase()}</span>
      {owner && <span className="small"><i className="fa-solid fa-user-tie me-1" />{owner}</span>}
      <button type="button" className={`cp_hot${lead.hot ? " on" : ""}`} onClick={() => onHot(!lead.hot)}
        title={lead.hot ? "Marked hot - click to unmark" : "Mark this lead hot"}>
        <i className="fa-solid fa-fire me-1" />{lead.hot ? "HOT" : "Mark hot"}</button>
      <span className="cp_age ms-auto" title={`${days} of ${FOLLOW_UP_DAYS} follow-up days`}>
        <span className="cp_age_bar"><span style={{ width: `${pct}%` }} /></span>{days === 1 ? "1 day old" : `${days} days old`}</span>
    </div>
  );
}

export default function LeadsTab({ customerId, onChanged, initialLeadId = null }) {
  const { dealerParent, user, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [leads, setLeads] = useState([]);
  const [leadsPagination, setLeadsPagination] = useState(defaultLeadsPagination);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(null);
  const [activeLeadId, setActiveLeadId] = useState(null);
  // The opportunity row's slot for the lead's SMS Reply / Call / Note / Status / Check in (OpportunityActions).
  const [actionsEl, setActionsEl] = useState(null);
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
      setActiveLeadId(leads.some((l) => String(l._id) === String(initialLeadId)) ? initialLeadId : leads[0]._id);
    }
  }, [leads]);

  const setHot = async (lead, hot) => {
    try {
      const res = await fetch(`/api/leads/${lead._id}/details`, { method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ changes: { hot: { from: lead.hot ?? null, to: String(hot) } } }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      setLeads((list) => list.map((l) => (l._id === lead._id ? { ...l, hot } : l)));
    } catch (e) { setLeadsError(e.message); }
  };

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
        <>
        {/* 13 Nov 2026 meeting (10.10, DealerSocket's Sales tab): the customer's leads as a table - status, department,
            created, source, vehicle, owner; click a row to open that lead. */}
        <div className="table-responsive act_table mb-2">
          <Table hover size="sm" className="mb-0 align-middle">
            <thead><tr><th><IconLabel name="status">Status</IconLabel></th><th><IconLabel name="department">Department</IconLabel></th><th><IconLabel name="date">Created</IconLabel></th><th><IconLabel name="type">Up type</IconLabel></th><th><IconLabel name="source">Source</IconLabel></th><th><IconLabel name="source">Sub-source</IconLabel></th><th><IconLabel name="vehicle">Vehicle</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th></tr></thead>
            <tbody>
              {leads.map((lead) => {
                const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
                return (
                  <tr key={lead._id} className={activeLeadId === lead._id ? "table-primary" : undefined} style={{ cursor: "pointer" }}
                    tabIndex={0} aria-selected={activeLeadId === lead._id} onClick={() => setActiveLeadId(lead._id)}
                    onKeyDown={(e) => { if (e.key === "Enter") setActiveLeadId(lead._id); }}>
                    <td className="fw-semibold"><span className="ap_label"><AppIcon name={statusIconName(lead.fe_lead_status)} />{leadStatusLabel(lead) || "N/A"}</span>
                      {lead.hot && <span className="cp_hot on ms-1 py-0"><i className="fa-solid fa-fire" /></span>}</td>
                    <td>{DEPARTMENT_NAMES[leadDepartment(lead)]}</td>
                    <td className="text-nowrap">{lead.createdAt ? moment(lead.createdAt).format("MMM D, YYYY") : "N/A"}</td>
                    <td>{leadTypeName(lead)}</td><td>{lead.lead_source || lead.source || "Unknown"}</td>
                    <td>{lead.sub_source || <span className="text-muted">None</span>}</td>
                    <td>{vehicle || <span className="text-muted">No vehicle</span>}</td>
                    <td>{details[lead._id]?.owner || <span className="text-muted">Unassigned</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        {leads.filter((lead) => lead._id === activeLeadId).map((lead) => (
          <div key={lead._id}>
                  <OpportunityHeader lead={lead} owner={details[lead._id]?.owner} onHot={(hot) => setHot(lead, hot)} />
                  {activeLeadId === lead._id && <OpportunityActions lead={lead} onChanged={onChanged} actionsRef={setActionsEl} />}
                  <Milestones times={milestones[lead._id]} />
                  {/* The lead's showroom visits (Desk Log), and checking the customer in from here. */}
                  <div className="small mb-2 d-flex flex-wrap align-items-center gap-2">
                    <strong className="me-1"><i className="fa-solid fa-store me-1" />Showroom visits</strong>
                    {(details[lead._id]?.visits || []).length === 0 && <span className="text-muted">none yet</span>}
                  </div>
                  {(details[lead._id]?.visits || []).length > 0 && (
                    <ul className="small list-unstyled mb-2 ps-3">
                      {details[lead._id].visits.map((v) => (
                        <li key={v.id} className="mb-1">
                          {formatTimestamp(v.at)} · {v.department === "service" ? "Service" : "Sales"}
                          {v.stage ? ` · ${v.stage}` : ""}{v.salesperson ? ` · ${v.salesperson}` : ""}
                          {" · "}<strong>{v.outcome || "still open"}</strong>
                          {v.note && <span className="text-muted"> · {v.note}</span>}
                          {" "}<a href={`/dealer/desk-log?visit=${v.id}`}>open in Desk Log</a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {details[lead._id]?.ai === "linked" && (
                    <Alert variant="light" className="border py-2 small mb-2">
                      <i className="fa-solid fa-link me-1" />
                      Its own lead (status, owner, source, appointments). The AI talks to this customer in one
                      conversation, on their lead for {details[lead._id].ai_lead_label?.[0] || "an earlier vehicle"}
                      {details[lead._id].ai_lead_label?.[1] ? ` from ${formatTimestamp(details[lead._id].ai_lead_label[1])}` : ""}
                      ; it is shown below too.
                    </Alert>
                  )}
                  {/* Only mount the (self-fetching, self-polling) conversation panel while
                      this accordion item is actually open. */}
                  {activeLeadId === lead._id && <ViewConversations lead={lead} embedded onLeadSaved={onChanged} actionsTarget={actionsEl} />}
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
          </div>
        ))}
        </>
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
