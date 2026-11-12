"use client";
// The on-screen form (SOW v6 Deliverable K): one renderer for filling a form for a customer, for viewing a completed
// one, and for the builder's canvas (mode "design": fields can be picked, not typed in). A section set to repeat per
// trade-in shows once for each trade-in picked. Values: data[fieldId] or data[`${fieldId}#n`] in a repeated section.
import { Badge, Form } from "react-bootstrap";

const COL = { full: 12, half: 6, third: 4 };
export const key = (fieldId, n) => (n == null ? fieldId : `${fieldId}#${n}`);

function Input({ field, value, onChange, readOnly, hidden }) {
  if (hidden) return <Form.Control size="sm" value="Managers only" disabled />;
  const common = { size: "sm", disabled: readOnly, value: value ?? "", onChange: (e) => onChange(e.target.value) };
  switch (field.type) {
    case "textarea": return <Form.Control as="textarea" rows={3} {...common} />;
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
      <div>{field.options.map((o) => <Form.Check key={o} inline type="radio" label={o} disabled={readOnly}
        checked={value === o} onChange={() => onChange(o)} />)}</div>);
    case "signature": return <Form.Control {...common} placeholder="Signed on paper, or type the name"
      style={{ borderTop: 0, borderLeft: 0, borderRight: 0, borderRadius: 0, fontStyle: "italic" }} />;
    default: return <Form.Control {...common} />;
  }
}

export default function FormView({ schema, data = {}, onChange = () => {}, mode = "fill", trades = 0, hidden = [],
  prefilled = [], selected = null, onSelect = () => {} }) {
  const design = mode === "design";
  const readOnly = mode === "view" || design;
  return (
    <div className="form_view">
      <h4 className="mb-1">{schema.title}</h4>
      {schema.description && <p className="small text-muted">{schema.description}</p>}
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
                const pick = design ? { role: "button", onClick: () => onSelect(f.id),
                  style: { outline: selected === f.id ? "2px solid #2f6fdf" : "1px dashed #d5dbe5", outlineOffset: 2,
                    borderRadius: 4, cursor: "pointer" } } : {};
                if (f.type === "heading") return <div key={f.id} className="col-12" {...pick}><h6 className="mb-0 mt-1">{f.text}</h6></div>;
                if (f.type === "paragraph") return <div key={f.id} className="col-12 small text-body" {...pick} style={{ whiteSpace: "pre-wrap", ...pick.style }}>{f.text}</div>;
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
              {design && !s.fields.length && <div className="col-12 small text-muted">No fields in this section yet.</div>}
            </div>
          </div>
        ));
      })}
    </div>
  );
}
