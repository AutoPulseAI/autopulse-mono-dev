"use client";
// "360 View" as a side panel over a list (19 Nov 2026, SOW reference B4 - DealerSocket opens the customer's history and
// tasks beside the list, so staff keep their place). Opened from the Leads list and the Desk Log: who the customer is,
// Call / Message, their open tasks and the full activity, read from the same /api/customers/[id]/360 as the profile and
// shown with the profile's own parts (OpenTasks, OverviewTab). "Open full profile" goes to the whole page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Offcanvas, Spinner } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import CallButton from "./CallButton";
import OpenTasks from "../customers/[id]/components/OpenTasks";
import OverviewTab from "../customers/[id]/components/OverviewTab";
import { primaryContact } from "../customers/[id]/components/CustomerHeader";
import { customerHref, leadHref } from "../ai/components/aiShared";

export default function Customer360Panel({ show, onHide, customerId, leadId, name, dnd = false }) {
  const { user, dealerParent } = useUser();
  const dealerId = dealerParent?.id || user?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show || !customerId || !dealerId) return undefined;
    let gone = false;
    setLoading(true);
    setError("");
    setData(null);
    fetch(`/api/customers/${customerId}/360?${new URLSearchParams({ dealer_id: dealerId })}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || "The customer could not be loaded");
        if (!gone) setData(body.data);
      })
      .catch((e) => { if (!gone) setError(e.message); })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [show, customerId, dealerId]);

  const customer = data?.customer;
  const phone = primaryContact(customer?.phones)?.value || null;
  const email = primaryContact(customer?.emails)?.value || null;
  const callLead = leadId || data?.leads?.[0]?._id || null;

  return (
    <Offcanvas show={show} onHide={onHide} placement="end" className="c360_panel">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>
          <i className="fa-regular fa-id-card me-2" />{customer?.name || name || "Customer"}
          <small className="d-block text-muted fw-normal fs-6">360 View</small>
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {!customerId && (
          <Alert variant="light" className="small">
            This lead has no customer profile yet, so there is no history to show beyond its conversation.
          </Alert>
        )}
        <div className="d-flex flex-wrap gap-2 mb-3">
          {!dnd && phone && <CallButton phone={phone} leadId={callLead} dealerId={dealerId} />}
          {callLead && (
            <Button as={Link} href={leadHref(callLead)} variant="outline-custom" size="sm" onClick={onHide}>
              <i className="fa-regular fa-comment-dots me-1" />{dnd ? "Conversation" : "Text / Email"}
            </Button>
          )}
          {customerId && (
            <Button as={Link} href={customerHref(customerId)} variant="custom" size="sm" onClick={onHide}>
              <i className="fa-regular fa-user me-1" />Open full profile
            </Button>
          )}
        </div>
        {dnd && <Alert variant="warning" className="py-2 small">Do not contact (DND)</Alert>}
        {loading && <div className="text-center py-4"><Spinner size="sm" /> Loading...</div>}
        {error && <Alert variant="danger" className="small">{error}</Alert>}
        {customer && (
          <>
            <div className="c360_contact small mb-3">
              {phone && <div><i className="fa-regular fa-phone me-2" />{phone}</div>}
              {email && <div><i className="fa-regular fa-envelope me-2" />{email}</div>}
            </div>
            <OpenTasks tasks={data.open_tasks} />
            <OverviewTab overview={data.overview} activity={data.activity || []} />
          </>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
