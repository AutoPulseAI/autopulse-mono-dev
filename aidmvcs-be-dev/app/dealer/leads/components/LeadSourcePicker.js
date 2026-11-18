"use client";
// Lead Source on the manual lead form, from the dealer's own list (gap G-009, /api/lead-sources). Staff with
// "Manage Leads" can edit the list here ("Edit list"): add, rename (the dealer's leads with that source are renamed
// too, so reports don't split it) or remove (leads keep their source; it's only no longer offered).
// The dropdown also offers every source already on the dealer's leads and the usual providers, so it is never empty,
// and "+ Add a new source" right in it (same permission) adds one to the list and picks it (17 Nov 2026).
// The dealer account / super admin also sees Campaigns and tracking codes in the same window (CampaignList.js).
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Form, InputGroup, Modal, Spinner, Table } from "react-bootstrap";
import CampaignList from "./CampaignList";

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export default function LeadSourcePicker({ dealerId, value, onChange, disabled }) {
  const [list, setList] = useState({ sources: [], used: [], common: [], can_edit: false, history: [], campaigns: [],
    can_edit_campaigns: false });
  const [quick, setQuick] = useState(null); // the "+ Add a new source" box under the dropdown: its text
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
      return true;
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const names = list.sources.map((s) => s.name);
  const used = (list.used || []).map((s) => s.name);
  const common = list.common || [];
  const all = [...names, ...used, ...common];
  const extra = value && !all.some((n) => n.toLowerCase() === String(value).toLowerCase()) ? [value] : [];
  const ADD = "__add_new_source__";
  const pick = (v) => {
    if (v === ADD) { setError(null); setQuick(""); return; }
    onChange(v);
  };
  const addQuick = async () => {
    const name = quick.trim().replace(/\s+/g, " ");
    const existing = all.find((n) => n.toLowerCase() === name.toLowerCase());
    if (existing && names.includes(existing)) { onChange(existing); setQuick(null); return; }
    if (await change({ action: "add", name })) { onChange(name); setQuick(null); }
  };

  return (
    <>
      <InputGroup>
        <Form.Select value={value || ""} onChange={(e) => pick(e.target.value)} disabled={disabled}
          aria-label="Lead source">
          <option value="">Choose...</option>
          {extra.map((n) => <option key={n} value={n}>{n}</option>)}
          {names.length > 0 && <optgroup label="Your sources">{names.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
          {used.length > 0 && <optgroup label="On your leads">{used.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
          {common.length > 0 && <optgroup label="Common sources">{common.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
          {list.can_edit ? <option value={ADD}>+ Add a new source...</option>
            : <option disabled>Not listed? A manager can add it</option>}
        </Form.Select>
        {(list.can_edit || list.can_edit_campaigns) && (
          <Button variant="outline-custom" onClick={() => { setError(null); setShow(true); }}>Edit list</Button>
        )}
      </InputGroup>
      {quick != null && (
        <>
          <InputGroup size="sm" className="mt-1">
            <Form.Control autoFocus placeholder="New source, e.g. Referral" value={quick} maxLength={60}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && quick.trim()) { e.preventDefault(); addQuick(); } }} />
            <Button variant="custom" disabled={busy || !quick.trim()} onClick={addQuick}>{busy ? <Spinner size="sm" /> : "Add"}</Button>
            <Button variant="outline-custom" onClick={() => setQuick(null)}>Cancel</Button>
          </InputGroup>
          {error && !show && <small className="text-danger">{error}</small>}
        </>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">Lead sources{list.can_edit_campaigns ? " and campaigns" : ""}</Modal.Title></Modal.Header>
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
          {list.can_edit_campaigns && <CampaignList campaigns={list.campaigns || []} busy={busy} change={change} />}
          {list.history.length > 0 && (
            <details className="mt-3 small">
              <summary className="text-muted">Changes</summary>
              <ul className="mb-0 ps-3">
                {list.history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.at).toLocaleString()} · {h.by_name || "Staff"} ·{" "}
                    {h.action === "add" ? `added "${h.to}"` : h.action === "remove" ? `removed "${h.from}"`
                      : h.action === "campaign_add" ? `added campaign ${h.to}${h.leads_renamed ? ` (${h.leads_renamed} leads tagged)` : ""}`
                      : h.action === "campaign_remove" ? `removed campaign ${h.from}`
                      : h.action === "campaign_update" ? `changed campaign ${h.from} to ${h.to}${h.leads_renamed ? ` (${h.leads_renamed} leads tagged)` : ""}`
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
