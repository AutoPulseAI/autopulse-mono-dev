"use client";
// One lead's appointments and what happened to each (SOW Deliverable E, gap G-031): booked, moved, confirmed,
// cancelled and by whom, showed / no-show. Read from /api/booking/history.
import { useEffect, useState } from "react";
import { Modal, Spinner, Table, Badge } from "react-bootstrap";

const ACTIONS = {
  created: "Booked", rescheduled: "Moved", status_changed: "Status changed", cancelled: "Cancelled",
  showed: "Customer showed", no_show: "No show", reverted: "Move undone", deduplicated: "Duplicate removed",
};
const WHO = { ai: "AI", staff: "Staff", customer: "Customer (booking page)", system: "System", unknown: "Unknown" };

const when = (d) => (d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit" }) : "");
const slot = (v) => (v && (v.date || v.time) ? `${v.date || ""} ${v.time || ""}`.trim() : "");
const day = (d) => (d ? new Date(d).toLocaleDateString() : "Date flexible");

function detail(h) {
  if (h.action === "rescheduled" || h.action === "reverted") {
    const from = slot(h.from), to = slot(h.to);
    return from || to ? `${from || "?"} → ${to || "?"}` : "";
  }
  if (h.action === "status_changed" || h.action === "cancelled") {
    const from = h.from?.booking_status, to = h.to?.booking_status;
    return to ? `${from ? `${from} → ` : ""}${to}` : "";
  }
  if (h.action === "created") return [slot(h.to), h.to?.appointment_type].filter(Boolean).join(" · ");
  return "";
}

export default function AppointmentHistoryModal({ lead, onHide }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!lead?._id) return;
    setData(null); setError(null);
    fetch(`/api/booking/history?lead_id=${lead._id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || "Could not load"); setData(b); })
      .catch((e) => setError(e.message));
  }, [lead?._id]);

  return (
    <Modal show={!!lead} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title as="h6">Appointment history{lead?.name ? ` — ${lead.name}` : ""}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <div className="text-danger small">{error}</div>}
        {!data && !error && <div className="text-center py-3"><Spinner size="sm" /></div>}
        {data && data.bookings.length === 0 && <div className="text-muted small">No appointment records for this lead.</div>}
        {data?.bookings.map((b) => (
          <div key={b._id} className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
              <strong>{day(b.bookingDate)} {b.bookingTime || ""}</strong>
              <Badge bg="light" text="dark">{b.appointment_type === "service" ? "Service" : "Sales"}</Badge>
              <Badge bg={b.booking_status === "cancelled" ? "danger" : b.booking_status === "confirmed" ? "success" : "secondary"}>
                {b.booking_status}
              </Badge>
              {b.showed === true && <Badge bg="success">Showed</Badge>}
              {b.showed === false && <Badge bg="warning" text="dark">No show</Badge>}
              {b.reschedule_count > 0 && <small className="text-muted">moved {b.reschedule_count}×</small>}
              {b.cancelled_by && <small className="text-muted">cancelled by {WHO[b.cancelled_by] || b.cancelled_by}</small>}
            </div>
            {b.history?.length ? (
              <Table size="sm" className="mb-0 small">
                <thead><tr><th>When</th><th>What</th><th>Who</th><th>Detail</th></tr></thead>
                <tbody>
                  {[...b.history].reverse().map((h, i) => (
                    <tr key={i}>
                      <td className="text-nowrap">{when(h.at)}</td>
                      <td>{ACTIONS[h.action] || h.action}</td>
                      <td>{h.actor_name || WHO[h.actor_type] || h.actor_type || ""}</td>
                      <td>{detail(h)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <small className="text-muted">
                Booked {when(b.createdAt)}{b.created_by ? ` by ${WHO[b.created_by] || b.created_by}` : ""}
                {b.created_by_name ? ` (${b.created_by_name})` : ""}. Changes are recorded from 10 Nov 2026 on.
              </small>
            )}
          </div>
        ))}
      </Modal.Body>
    </Modal>
  );
}
