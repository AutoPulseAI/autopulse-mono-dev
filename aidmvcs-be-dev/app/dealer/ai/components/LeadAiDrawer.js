"use client";
// Side drawer with the AI panel for one lead, used on the Call Tasks and AI Alerts
// pages so staff can see the whole picture without leaving the list.

import Link from "next/link";
import { Button, Offcanvas } from "react-bootstrap";
import AiLeadPanel from "./AiLeadPanel";
import { customerHref, leadHref } from "./aiShared";

export default function LeadAiDrawer({ show, onHide, leadId, customerId, title }) {
  return (
    <Offcanvas show={show} onHide={onHide} placement="end">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>{title || "Lead"}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        <div className="d-flex gap-2 mb-3">
          {leadId && (
            <Button as={Link} href={leadHref(leadId)} variant="outline-custom" size="sm">
              <i className="fa-regular fa-messages me-1" />Open in Leads
            </Button>
          )}
          {customerId && (
            <Button as={Link} href={customerHref(customerId)} variant="outline-secondary" size="sm">
              <i className="fa-regular fa-user me-1" />Customer
            </Button>
          )}
        </div>
        {leadId && <AiLeadPanel key={leadId} leadId={leadId} className="position-relative" />}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
