"use client";
// Settings > Dealer Intelligence (SOW v6 Appendix A section 02): this rooftop's policies - fees and disclosures,
// new / used, service and parts, online tools, shipping, local delivery - as Yes / No / Not configured with the details
// a Yes needs (lib/dealerIntelligence/fields.js). Every change is kept (who, when, from, to).
import { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { SECTIONS, TRI, isShown } from "../../../lib/dealerIntelligence/fields";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}`, "Content-Type": "application/json" });

function FeeRows({ rows, onChange, disabled }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <Table size="sm" className="mb-1">
        <thead><tr><th>Fee</th><th style={{ width: 120 }}>Amount ($)</th><th>Applies to</th><th style={{ width: 150 }}>From</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><Form.Control size="sm" value={r.label || ""} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} /></td>
              <td><Form.Control size="sm" type="number" min={0} value={r.amount ?? ""} disabled={disabled} onChange={(e) => set(i, { amount: e.target.value })} /></td>
              <td><Form.Control size="sm" value={r.applies_to || ""} placeholder="All vehicles" disabled={disabled} onChange={(e) => set(i, { applies_to: e.target.value })} /></td>
              <td><Form.Control size="sm" type="date" value={r.effective || ""} disabled={disabled} onChange={(e) => set(i, { effective: e.target.value })} /></td>
              <td><Button size="sm" variant="link" className="text-danger p-0" disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!disabled && <Button size="sm" variant="outline-custom" onClick={() => onChange([...rows, { label: "", amount: "", applies_to: "", effective: "" }])}>+ Add fee</Button>}
    </>
  );
}

function Field({ f, value, onChange, disabled }) {
  switch (f.type) {
    case "tri": return (
      <div>{Object.entries(TRI).map(([k, l]) => <Form.Check key={k} inline type="radio" id={`${f.key}-${k}`} label={l}
        checked={value === k} disabled={disabled} onChange={() => onChange(k)} />)}</div>);
    case "textarea": return <Form.Control as="textarea" rows={2} size="sm" value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case "list": return <Form.Control as="textarea" rows={2} size="sm" placeholder="One per line" disabled={disabled}
      value={Array.isArray(value) ? value.join("\n") : value || ""} onChange={(e) => onChange(e.target.value.split("\n"))} />;
    case "money": return <div className="input-group input-group-sm" style={{ maxWidth: 200 }}><span className="input-group-text">$</span>
      <Form.Control type="number" min={0} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></div>;
    case "number": return <Form.Control size="sm" type="number" min={0} style={{ maxWidth: 160 }} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case "date": return <Form.Control size="sm" type="date" style={{ maxWidth: 200 }} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case "select": return (
      <Form.Select size="sm" style={{ maxWidth: 260 }} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose...</option>{Object.entries(f.options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select>);
    case "fees": return <FeeRows rows={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />;
    default: return <Form.Control size="sm" type={f.type === "url" ? "url" : "text"} placeholder={f.type === "url" ? "https://" : ""}
      value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function DealerIntelligence() {
  const { dealerParent } = useUser();
  const dealerId = dealerParent?.id;
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!dealerId) return;
    fetch(`/api/dealer-intelligence?dealer_id=${dealerId}`, { headers: auth() }).then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); setValues(d.values); }).catch((e) => setError(e.message));
  }, [dealerId]);

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/dealer-intelligence", { method: "PUT", headers: auth(), body: JSON.stringify({ dealer_id: dealerId, values }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      setData(d); setValues(d.values); setNotice(d.changed ? `Saved (${d.changed} change${d.changed > 1 ? "s" : ""}).` : "Nothing changed.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!data) return error ? <Alert variant="danger">{error}</Alert> : <Spinner animation="border" size="sm" />;
  const ro = !data.can_edit || busy;
  return (
    <div className="small">
      <p className="text-muted">Your dealership&apos;s own policies. &quot;Not configured&quot; means unknown - it is never taken
        as No. A Yes needs its details. {data.updated_at && <>Last saved {new Date(data.updated_at).toLocaleString()}
        {data.updated_by ? ` by ${data.updated_by}` : ""}.</>}</p>
      {!data.can_edit && <Alert variant="info" className="py-2">View only - the dealer account or an admin can change these.</Alert>}
      {SECTIONS.map((s) => (
        <div key={s.key} className="w_card mb-3">
          <h6 className="mb-1">{s.title}</h6>
          {s.note && <div className="text-muted mb-2">{s.note}</div>}
          {s.fields.filter((f) => isShown(f, values)).map((f) => (
            <Row key={f.key} className="mb-2 align-items-center">
              <Col md={5}><Form.Label className="mb-0">{f.label}{f.required ? " *" : ""}</Form.Label>
                {f.help && <div className="text-muted">{f.help}</div>}</Col>
              <Col md={7}><Field f={f} value={values[f.key]} disabled={ro} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} /></Col>
            </Row>
          ))}
        </div>
      ))}
      {error && <Alert variant="danger" className="py-2">{error}</Alert>}
      {notice && <Alert variant="success" className="py-2">{notice}</Alert>}
      {data.can_edit && <Button variant="custom" size="sm" disabled={busy} onClick={save}>{busy ? <Spinner size="sm" /> : "Save"}</Button>}
      {data.history.length > 0 && (
        <details className="mt-3"><summary className="text-muted">Change history</summary>
          <ul className="mb-0">{data.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.by_name || "Staff"} ·
            {" "}{h.key}: {JSON.stringify(h.from)} → {JSON.stringify(h.to)}</li>)}</ul></details>
      )}
    </div>
  );
}
