"use client";
// Bulk Lead details (SOW B4/B5; approved 24 Nov 2026): up type, department, source, sub-source and campaign in one panel.
// Only the fields changed are saved, through the same route as every bulk change; Undo takes all of them back.
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Offcanvas, Spinner } from "react-bootstrap";

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const UP = [["internet", "Internet"], ["phone", "Phone Up"], ["walk_in", "Walk-In"]];
const DEPT = [["sales", "Sales"], ["service", "Service"], ["parts", "Parts"]];
const CLEAR = "__clear__";
const batch = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const retryable = (reason = "") => !/not a lead of this dealership|changed by someone else|refused|cannot|can only|not one of|must be/i.test(reason);

export default function LeadDetailsPanel({ show, dealerId, leads, onHide, onSaved }) {
  const [v, setV] = useState({ contact_type: "", department: "", lead_source: "", sub_source: "", campaign: "" });
  const [options, setOptions] = useState({ sources: [], campaigns: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!show || !dealerId) return;
    fetch(`/api/lead-sources?dealer_id=${encodeURIComponent(dealerId)}`, { headers: auth() }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const names = (l) => [...new Set((l || []).map((x) => x?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      setOptions({ sources: names([...(d?.sources || []), ...(d?.used || [])]), campaigns: names((d?.campaigns || []).filter((c) => c.active !== false)) });
    }).catch(() => setError("Could not load the lead sources."));
  }, [show, dealerId]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const badSource = v.lead_source && !options.sources.includes(v.lead_source);
  const fields = useMemo(() => [
    ["contact_type", "Up type", UP.find(([k]) => k === v.contact_type)?.[1]], ["department", "Department", DEPT.find(([k]) => k === v.department)?.[1]],
    ["lead_source", "Source", v.lead_source], ["sub_source", "Sub-source", v.sub_source === CLEAR ? "None" : v.sub_source],
    ["campaign", "Campaign", v.campaign === CLEAR ? "No campaign" : v.campaign],
  ].filter(([k]) => v[k]), [v]);
  const save = async () => {
    setSaving(true); setError(null);
    const ids = leads.map((l) => l._id);
    const names = new Map(leads.map((l) => [l._id, l.name]));
    const batchIds = [];
    const updated = new Set();
    const failed = new Map();
    for (const [field] of fields) {
      const id = batch();
      batchIds.push(id);
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100);
        try {
          const res = await fetch("/api/leads/bulk-edit", { method: "POST", headers: auth(), body: JSON.stringify({ dealer_id: dealerId, lead_ids: part, action: field,
            value: v[field] === CLEAR ? "" : v[field], confirm: true, batch_id: id }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Could not save");
          const bad = new Set((data.failed || []).map((f) => f.lead_id));
          (data.failed || []).forEach((f) => failed.set(f.lead_id, { ...f, name: f.name || names.get(f.lead_id) || null }));
          if (data.updated) part.filter((x) => !bad.has(x)).forEach((x) => updated.add(x));
        } catch (e) {
          part.forEach((x) => failed.set(x, { lead_id: x, name: names.get(x) || null, reason: e.message || "The server did not answer" }));
        }
      }
    }
    setSaving(false);
    const list = [...failed.values()];
    onSaved({ kind: "source", batchId: batchIds[0], batchIds, targetName: fields.map(([, l, shown]) => `${l} ${shown}`).join(", "), total: ids.length,
      updated: updated.size, unchanged: Math.max(0, ids.length - updated.size - list.length), failed: list, retryIds: list.filter((f) => retryable(f.reason)).map((f) => f.lead_id) });
  };
  const count = leads.length.toLocaleString();
  return (
    <Offcanvas show={show} onHide={saving ? undefined : onHide} placement="end" className="bulk_panel">
      <Offcanvas.Header closeButton={!saving}><Offcanvas.Title>Lead details for {count} {leads.length === 1 ? "lead" : "leads"}</Offcanvas.Title></Offcanvas.Header>
      <Offcanvas.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <p className="text-muted">Only fields you change are saved.</p>
        <div className="ld_row"><Form.Label htmlFor="ld-up">Up type</Form.Label><Form.Select id="ld-up" size="sm" value={v.contact_type} onChange={set("contact_type")}><option value="">Keep as is</option>{UP.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></div>
        <div className="ld_row"><Form.Label htmlFor="ld-dept">Department</Form.Label><Form.Select id="ld-dept" size="sm" value={v.department} onChange={set("department")}><option value="">Keep as is</option>{DEPT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></div>
        <div className="ld_row"><Form.Label htmlFor="ld-src">Source</Form.Label><div><Form.Control id="ld-src" size="sm" list="ld-sources" placeholder={`Keep as is · search ${options.sources.length} sources`} isInvalid={!!badSource} value={v.lead_source} onChange={set("lead_source")} /><datalist id="ld-sources">{options.sources.map((n) => <option key={n} value={n} />)}</datalist>{badSource && <div className="invalid-feedback d-block">Pick a source from the list.</div>}</div></div>
        <div className="ld_row"><Form.Label htmlFor="ld-sub">Sub-source</Form.Label><Form.Control id="ld-sub" size="sm" maxLength={80} placeholder="Keep as is" value={v.sub_source === CLEAR ? "" : v.sub_source} onChange={set("sub_source")} /></div>
        <div className="ld_row"><Form.Label htmlFor="ld-camp">Campaign</Form.Label><Form.Select id="ld-camp" size="sm" value={v.campaign} onChange={set("campaign")}><option value="">Keep as is</option><option value={CLEAR}>No campaign</option>{options.campaigns.map((n) => <option key={n} value={n}>{n}</option>)}</Form.Select></div>
        <div className="ld_sum">{fields.length ? fields.map(([k, l, shown]) => <div key={k}><b>{l}:</b> {shown}</div>) : "No changes yet."}</div>
      </Offcanvas.Body>
      <div className="d-flex gap-2 justify-content-end p-3 border-top">
        <Button size="sm" variant="secondary" disabled={saving} onClick={onHide}>Cancel</Button>
        <Button size="sm" variant="custom" disabled={saving || !fields.length || !!badSource} onClick={save}>{saving ? <Spinner size="sm" /> : `Update ${count} ${leads.length === 1 ? "lead" : "leads"}`}</Button>
      </div>
    </Offcanvas>
  );
}
