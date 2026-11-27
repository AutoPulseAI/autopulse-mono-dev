"use client";
// Leads on a customer's page (the user, 28 Nov 2026): two parts, as on the Leads page - this list of the customer's
// leads on the left (drawn like the Leads page's list: avatar, status and vehicle, last message, time, waiting, unread,
// hot), the open lead on the right. A customer with no lead can be called or messaged here.
import { Button, ListGroup } from "react-bootstrap";
import { leadStatusLabel } from "@lib/statusLabels";
import { DEPARTMENT_NAMES, leadDepartment } from "@lib/departmentNames";
import CallButton from "../../../components/CallButton";
import { inboxTime, waitingFor } from "../../../leads/components/LeadList";
import "../../../leads/components/chat.css";

const LEAD_COLORS = ["#6366f1", "#0ea5e9", "#f97316", "#10b981", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444"];

export function NoLeads({ customerPhone, dealerId, onNew }) {
  return (
    <div className="w_card text-center py-4">
      <p className="text-muted mb-3">No leads for this customer yet.</p>
      <div className="d-flex justify-content-center gap-2 flex-wrap">
        {customerPhone && <CallButton phone={customerPhone} dealerId={dealerId} size="sm" />}
        <Button size="sm" variant="custom" onClick={onNew}><i className="fa-solid fa-paper-plane me-1" />Send a message</Button>
      </div>
    </div>
  );
}

export default function CustomerLeadList({ leads = [], activeId, onOpen, onNew, timezone }) {
  return (
    <div className="dealer_info position-sticky">
      <div className="w_card cust_inbox">
        <div className="cust_inbox_head">
          <span className="p_bold"><i className="fa-duotone fa-comments me-2" aria-hidden="true" />Leads
            <span className="cp_nav_count ms-2">{leads.length}</span></span>
          <Button size="sm" variant="outline-custom" onClick={onNew} title="New lead for this customer">
            <i className="fa-solid fa-plus me-1" />New lead
          </Button>
        </div>
        <div className="w_card_list">
          <ListGroup as="ul" variant="flush">
            {leads.map((lead, i) => {
              const on = String(lead._id) === String(activeId);
              const last = lead.inbox?.last;
              const wait = waitingFor(last);
              const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
              return (
                <ListGroup.Item as="li" key={lead._id} className={`lead-item w_card_list_box${on ? " active-lead" : ""}`}
                  aria-current={on ? "true" : undefined} onClick={() => onOpen(lead._id)}>
                  <div className="inbox_row">
                    <span className="inbox_avatar" aria-hidden="true" style={{ background: LEAD_COLORS[i % LEAD_COLORS.length], color: "#fff" }}>
                      L{i + 1}
                      {last?.from === "ai" && <span className="inbox_avatar_badge ai" title="The AI wrote last"><i className="fa-solid fa-robot"></i></span>}
                      {last?.from === "customer" && <span className="inbox_avatar_badge cust" title="The customer wrote last"></span>}
                    </span>
                    <span className="inbox_main">
                      <span className="inbox_top">
                        <span className={`inbox_title${lead.inbox?.unread ? " unread" : ""}`}>
                          {leadStatusLabel(lead) || lead.fe_lead_status || "New Lead"}
                        </span>
                        {lead.hot === true && <span className="inbox_hot" title="Marked hot"><i className="fa-solid fa-fire" aria-hidden="true"></i></span>}
                        <span className="inbox_time">{inboxTime(last?.at || lead.createdAt, timezone)}</span>
                      </span>
                      <span className="inbox_bottom">
                        <span className="inbox_snip">{vehicle || "No vehicle"} · {DEPARTMENT_NAMES[leadDepartment(lead)]}</span>
                      </span>
                      <span className="inbox_bottom">
                        <span className="inbox_snip" title="Source · sub-source · owner">
                          <i className="fa-solid fa-filter me-1" aria-hidden="true"></i>{lead.lead_source || lead.source || "Source not set"}
                          {lead.sub_source ? ` · ${lead.sub_source}` : ""} · {lead.assigned_to?.name || "Unassigned"}
                        </span>
                      </span>
                      <span className="inbox_bottom">
                        <span className="inbox_snip">
                          {last ? (
                            <>
                              {last.from === "ai" && <b>AI: </b>}
                              {last.from === "staff" && <b>You: </b>}
                              {last.failed && <i className="fa-solid fa-circle-exclamation text-danger me-1" aria-hidden="true"></i>}
                              {last.channel === "email" && <i className="fa-regular fa-envelope me-1" aria-hidden="true"></i>}
                              {last.text || "(no text)"}
                            </>
                          ) : <span className="text-muted">No messages yet</span>}
                        </span>
                        {wait && <span className="inbox_wait" title="The customer is waiting for an answer">
                          <i className="fa-regular fa-hourglass-half me-1" aria-hidden="true"></i>{wait}</span>}
                        {lead.inbox?.unread > 0 && <span className="inbox_unread">{lead.inbox.unread}</span>}
                      </span>
                    </span>
                  </div>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        </div>
      </div>
    </div>
  );
}
