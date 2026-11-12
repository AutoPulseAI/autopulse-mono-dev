"use client";
// Lead Source on the manual lead form, from the dealer's own list (gap G-009, /api/lead-sources). Staff with
// "Manage Leads" can edit the list here ("Edit list"): add, rename (the dealer's leads with that source are renamed
// too, so reports don't split it) or remove (leads keep their source; it's only no longer offered).
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Form, InputGroup, Modal, Spinner, Table } from "react-bootstrap";

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export default function LeadSourcePicker({ dealerId, value, onChange, disabled }) {
  const [list, setList] = useState({ sources: [], can_edit: false, history: [] });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState(null); // { name, to }

  const load = useCallback(async () => {
    if (!dealerId) return;
    const res = await fetch(`/api/lead-sources?dealer_id=${encodeURIComponent(dealerId)}`, { headers: auth() });
    if (res.ok) setList(await res.json());
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const change = async (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/lead-sources", { method: "PUT", headers: auth(),
        body: JSON.stringify({ dealer_id: dealerId, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not save (${res.status})`);
      setList(data); setAdding(""); setEditing(null);
      if (body.action === "rename" && value === body.name) onChange(body.to);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const names = list.sources.map((s) => s.name);
  const options = value && !names.some((n) => n.toLowerCase() === String(value).toLowerCase()) ? [value, ...names] : names;

  return (
    <>
      <InputGroup>
        <Form.Select value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          aria-label="Lead source">
          <option value="">{names.length ? "Choose..." : "No sources yet"}</option>
          {options.map((n) => <option key={n} value={n}>{n}</option>)}
        </Form.Select>
        {list.can_edit && (
          <Button variant="outline-custom" onClick={() => { setError(null); setShow(true); }}>Edit list</Button>
        )}
      </InputGroup>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">Lead sources</Modal.Title></Modal.Header>
        <Modal.Body>
          <p className="small text-muted mb-2">
            The sources staff can pick on a lead they enter by hand. Internet leads keep the source their provider sends.
          </p>
          {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
          <InputGroup size="sm" className="mb-3">
            <Form.Control placeholder="New source, e.g. Referral" value={adding} maxLength={60}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) change({ action: "add", name: adding }); }} />
            <Button variant="custom" disabled={busy || !adding.trim()} onClick={() => change({ action: "add", name: adding })}>
              {busy ? <Spinner size="sm" /> : "Add"}
            </Button>
          </InputGroup>
          {list.sources.length === 0 ? <p className="small text-muted mb-0">No sources yet.</p> : (
            <Table size="sm" className="small mb-0">
              <thead><tr><th>Source</th><th className="text-end">Leads</th><th /></tr></thead>
              <tbody>
                {list.sources.map((s) => (
                  <tr key={s.name}>
                    <td>
                      {editing?.name === s.name ? (
                        <Form.Control size="sm" value={editing.to} maxLength={60} autoFocus
                          onChange={(e) => setEditing({ ...editing, to: e.target.value })} />
                      ) : s.name}
                    </td>
                    <td className="text-end">{s.leads}</td>
                    <td className="text-end text-nowrap">
                      {editing?.name === s.name ? (
                        <>
                          <Button size="sm" variant="custom" disabled={busy || !editing.to.trim()}
                            onClick={() => change({ action: "rename", name: s.name, to: editing.to },
                              s.leads ? `${s.leads} lead(s) with "${s.name}" will be renamed to "${editing.to.trim()}" too.` : null)}>
                            Save
                          </Button>
                          <Button size="sm" variant="link" onClick={() => setEditing(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="link" onClick={() => setEditing({ name: s.name, to: s.name })}>Rename</Button>
                          <Button size="sm" variant="link" className="text-danger" disabled={busy}
                            onClick={() => change({ action: "remove", name: s.name },
                              `Remove "${s.name}" from the list? Leads that have it keep it.`)}>
                            Remove
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {list.history.length > 0 && (
            <details className="mt-3 small">
              <summary className="text-muted">Changes</summary>
              <ul className="mb-0 ps-3">
                {list.history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.at).toLocaleString()} · {h.by_name || "Staff"} ·{" "}
                    {h.action === "add" ? `added "${h.to}"` : h.action === "remove" ? `removed "${h.from}"`
                      : `renamed "${h.from}" to "${h.to}"${h.leads_renamed ? ` (${h.leads_renamed} leads)` : ""}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
