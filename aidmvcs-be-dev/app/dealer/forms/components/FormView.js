"use client";
// The on-screen form (SOW v6 Deliverable K): one renderer for filling a form for a customer, for viewing a completed
// one, and for the builder's canvas (mode "design": items can be picked, not typed in). Titles, wording with blanks
// inside its sentences (each blank a small input in the line), fields in a grid (full / half / third / quarter),
// boxes, checkboxes, choices, signatures, lines and spaces. A section set to repeat per trade-in shows once for each
// trade-in picked. Values: data[id] (a blank: `${elementId}.${key}`), with `#n` in a repeated section.
import { Badge, Form } from "react-bootstrap";
import { BLANK_TOKEN, blankId } from "../../../lib/forms/schema";

const COL = { full: 12, half: 6, third: 4, quarter: 3 };
const BLANK_W = { short: 90, medium: 180, long: 300 };
const TEXT_SIZE = { small: "0.78rem", normal: "0.92rem", large: "1.1rem" };
export const key = (id, n) => (n == null ? id : `${id}#${n}`);

function Input({ field, value, onChange, readOnly, hidden }) {
  if (hidden) return <Form.Control size="sm" value="Managers only" disabled />;
  const common = { size: "sm", disabled: readOnly, value: value ?? "", onChange: (e) => onChange(e.target.value) };
  switch (field.type) {
    case "textarea": return <Form.Control as="textarea" rows={field.rows || 3} {...common} />;
    case "number": return <Form.Control type="number" {...common} />;
    case "money": return <div className="input-group input-group-sm"><span className="input-group-text">$</span>
      <Form.Control {...common} inputMode="decimal" /></div>;
    case "date": return <Form.Control type="text" placeholder="MM/DD/YYYY" {...common} />;
    case "email": return <Form.Control type="email" {...common} />;
    case "phone": return <Form.Control type="tel" {...common} />;
    case "select": return (
      <Form.Select {...common}><option value="">Choose...</option>
        {field.options.map((o) => <option key={o}>{o}</option>)}</Form.Select>);
    case "radio": return (
      <div>{field.options.map((o) => <Form.Check key={o} type="radio" label={o} disabled={readOnly}
        checked={value === o} onChange={() => onChange(o)} />)}</div>);
    case "signature": return <Form.Control {...common} placeholder="Signed on paper, or type the name"
      style={{ borderTop: 0, borderLeft: 0, borderRight: 0, borderRadius: 0, fontStyle: "italic" }} />;
    default: return <Form.Control {...common} />;
  }
}

// Wording with its blanks as inputs inside the sentence.
function Wording({ f, valueOf, onChange, readOnly, hidden, design }) {
  const parts = [];
  let last = 0;
  for (const m of f.text.matchAll(BLANK_TOKEN)) {
    if (m.index > last) parts.push(f.text.slice(last, m.index));
    const b = (f.blanks || []).find((x) => x.key === m[1]) || { key: m[1], label: m[1], size: "medium" };
    const k = valueOf(blankId(f.id, b.key));
    parts.push(design ? (
      <span key={`${m.index}`} className="d-inline-block border-bottom border-primary text-primary px-1 mx-1 small"
        style={{ minWidth: BLANK_W[b.size] / 1.5 }}>{b.label}{b.source ? " (CRM)" : ""}</span>
    ) : (
      <input key={`${m.index}`} aria-label={b.label} title={b.label} placeholder={b.label} disabled={readOnly}
        className="form-control form-control-sm d-inline-block mx-1 my-1 align-baseline"
        style={{ width: BLANK_W[b.size] || 180, borderTop: 0, borderLeft: 0, borderRight: 0, borderRadius: 0,
          background: hidden.includes(k.key) ? "#f1f3f5" : undefined }}
        value={hidden.includes(k.key) ? "" : k.value ?? ""} onChange={(e) => onChange(k.key, e.target.value)} />
    ));
    last = m.index + m[0].length;
  }
  if (last < f.text.length) parts.push(f.text.slice(last));
  return (
    <div style={{ whiteSpace: "pre-wrap", textAlign: f.align || "left", fontWeight: f.bold ? 600 : undefined,
      fontStyle: f.italic ? "italic" : undefined, fontSize: TEXT_SIZE[f.size] || TEXT_SIZE.normal, lineHeight: 1.9 }}>
      {parts}
    </div>
  );
}

export default function FormView({ schema, data = {}, onChange = () => {}, mode = "fill", trades = 0, hidden = [],
  prefilled = [], selected = null, onSelect = () => {}, showTitle = true }) {
  const design = mode === "design";
  const readOnly = mode === "view" || design;
  return (
    <div className="form_view">
      {showTitle && <h4 className="mb-1 text-center">{schema.title}</h4>}
      {showTitle && schema.description && <p className="small text-muted text-center">{schema.description}</p>}
      {schema.sections.map((s) => {
        const copies = s.repeat === "trade_in" ? Math.max(1, design ? 1 : trades) : 1;
        return Array.from({ length: copies }, (_, n) => (
          <div key={`${s.id}-${n}`} className="mb-3">
            {(s.title || copies > 1) && (
              <div className="px-2 py-1 mb-2 text-white small fw-semibold rounded" style={{ background: "#1f3b63" }}>
                {s.title || "Trade-in"}{copies > 1 ? ` ${n + 1}` : ""}
                {design && s.repeat === "trade_in" && <span className="fw-normal"> (repeats for each trade-in)</span>}
              </div>
            )}
            <div className="row g-2">
              {s.fields.map((f) => {
                const k = key(f.id, s.repeat === "trade_in" ? n : null);
                const valueOf = (id) => { const kk = key(id, s.repeat === "trade_in" ? n : null); return { key: kk, value: data[kk] }; };
                const pick = design ? { role: "button", onClick: () => onSelect(f.id),
                  style: { outline: selected === f.id ? "2px solid #2f6fdf" : "1px dashed #d5dbe5", outlineOffset: 2,
                    borderRadius: 4, cursor: "pointer" } } : {};
                if (f.type === "heading") {
                  const Tag = `h${Math.min(6, (f.level || 2) + 3)}`;
                  return <div key={f.id} className="col-12" {...pick}><Tag className="mb-0 mt-1" style={{ textAlign: f.align || "left" }}>{f.text}</Tag></div>;
                }
                if (f.type === "paragraph") {
                  return <div key={f.id} className="col-12" {...pick}><Wording f={f} valueOf={valueOf} onChange={onChange}
                    readOnly={readOnly} hidden={hidden} design={design} /></div>;
                }
                if (f.type === "divider") return <div key={f.id} className="col-12" {...pick}><hr className="my-1" /></div>;
                if (f.type === "spacer") return <div key={f.id} className="col-12" {...pick} ><div style={{ height: 16 }} /></div>;
                if (f.type === "checkbox") {
                  return (
                    <div key={f.id} className={`col-md-${COL[f.width] || 12}`} {...pick}>
                      <Form.Check id={`c-${k}`} label={f.label} disabled={readOnly} checked={Boolean(data[k])}
                        onChange={(e) => onChange(k, e.target.checked)} />
                    </div>
                  );
                }
                return (
                  <div key={f.id} className={`col-md-${COL[f.width] || 12}`} {...pick}>
                    <Form.Label className="small mb-0">
                      {f.label}{f.required && <span className="text-danger"> *</span>}
                      {design && f.source && <Badge bg="light" text="dark" className="ms-1 border">CRM</Badge>}
                      {!design && prefilled.includes(k) && <small className="text-muted"> (from the CRM)</small>}
                    </Form.Label>
                    <Input field={f} value={data[k]} readOnly={readOnly} hidden={hidden.includes(k)}
                      onChange={(v) => onChange(k, v)} />
                    {f.help && <Form.Text className="small">{f.help}</Form.Text>}
                  </div>
                );
              })}
              {design && !s.fields.length && <div className="col-12 small text-muted">Nothing in this section yet - add an item below.</div>}
            </div>
          </div>
        ));
      })}
    </div>
  );
}
