"use client";
// The lead's owner as a tag that reassigns it (customer profile, the user 28 Nov 2026: "how can we reassign this lead
// from here"): the same change as the Leads list's Assigned To (PUT /api/leads/[id]), for people whose role has
// "Assign Leads"; after it, Undo puts the lead back with whoever had it (POST /api/leads/[id]/undo-reassign).
import { useEffect, useState } from "react";
import { Dropdown } from "react-bootstrap";
import { useCan } from "../../../hooks/PermissionsContext";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export default function OwnerTag({ lead, onChanged }) {
  const canAssign = useCan("Assign Leads");
  const [staff, setStaff] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { text, undo }
  const owner = lead?.assigned_to?.name || "Unassigned";
  const ownerId = lead?.assigned_to?._id || lead?.assigned_to || "";

  useEffect(() => {
    if (!canAssign || !lead?.dealer_id || staff) return;
    fetch(`/api/staff/list?dealer_id=${encodeURIComponent(lead.dealer_id)}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : null)).then((b) => setStaff(b?.staff || [])).catch(() => setStaff([]));
  }, [canAssign, lead?.dealer_id, staff]);

  const assign = async (to) => {
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`/api/leads/${lead._id}`, { method: "PUT", headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: to || null }) });
      if (!res.ok) throw new Error();
      const name = staff?.find((s) => String(s._id) === String(to))?.name || "nobody";
      setNote({ text: `Now assigned to ${name}.`, undo: true });
      onChanged?.();
    } catch {
      setNote({ text: "Could not change the owner." });
    } finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead._id}/undo-reassign`, { method: "POST", headers: auth() });
      setNote({ text: res.ok ? "Put back with the previous owner." : "Could not undo." });
      if (res.ok) onChanged?.();
    } finally { setBusy(false); }
  };

  const tag = (
    <>
      <i className="fa-solid fa-user-tie" /><small>Owner</small>{owner}
      {canAssign && <i className="fa-solid fa-chevron-down ms-1" style={{ fontSize: "0.6rem" }} />}
    </>
  );
  return (
    <>
      {canAssign ? (
        <Dropdown className="d-inline-flex">
          <Dropdown.Toggle as="button" type="button" className="ltag t_owner ltag_btn" disabled={busy} title="Reassign this lead">
            {tag}
          </Dropdown.Toggle>
          <Dropdown.Menu style={{ maxHeight: 320, overflowY: "auto" }}>
            <Dropdown.Header>Reassign this lead to</Dropdown.Header>
            {staff === null && <Dropdown.ItemText className="small text-muted">Loading...</Dropdown.ItemText>}
            {(staff || []).map((s) => (
              <Dropdown.Item key={s._id} active={String(s._id) === String(ownerId)} onClick={() => assign(s._id)}>{s.name}</Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item onClick={() => assign("")} active={!ownerId}>Unassigned</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      ) : (
        <span className="ltag t_owner">{tag}</span>
      )}
      {note && (
        <span className="ltag_note">
          {note.text}
          {note.undo && <button type="button" onClick={undo} disabled={busy}><i className="fa-solid fa-rotate-left me-1" />Undo</button>}
          <button type="button" onClick={() => setNote(null)} aria-label="Close">×</button>
        </span>
      )}
    </>
  );
}
