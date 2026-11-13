"use client";
// The builder's side panel for the item picked on the form: its type and everything about it - a field's label, CRM
// value, choices, width, size of a box, required; a title's size and alignment; wording's text, style and its blanks
// (each blank: what goes there, its type, length, CRM value, required). "Insert blank" puts a blank where the cursor is.
import { useRef } from "react";
import { Button, ButtonGroup, Form } from "react-bootstrap";
import { ALIGNS, BLANK_SIZES, BLANK_TYPES, FIELD_TYPES, INPUT_TYPES, TEXT_SIZES, WIDTHS, blanksInText } from "../../../lib/forms/schema";

export function SourceSelect({ sources, value, onChange, repeat }) {
  const groups = new Map();
  for (const s of sources) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); }
  return (
    <Form.Select size="sm" value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Typed in by staff</option>
      {[...groups.entries()].map(([group, items]) => (
        <optgroup key={group} label={group === "Trade-in" && !repeat ? "Trade-in (the first one picked)" : group}>
          {items.map((s) => <option key={s.key} value={s.key}>{s.label}{s.sensitive ? " (managers only)" : ""}</option>)}
        </optgroup>
      ))}
    </Form.Select>
  );
}

// The wording's blanks kept in step with its text: a blank keeps its settings, a new {{key}} gets defaults.
export function syncBlanks(text, blanks = []) {
  const by = new Map(blanks.map((b) => [b.key, b]));
  return blanksInText(text).map((key) => by.get(key) || { key, label: key.replace(/_/g, " "), type: "text",
    required: false, source: null, size: "medium" });
}

const Row2 = ({ children }) => <div className="d-flex gap-2 mb-2">{children}</div>;

export default function ItemPanel({ item, section, sources, onChange }) {
  const area = useRef(null);
  const f = item;
  const set = (patch) => onChange(patch);
  const changeType = (type) => {
    if (type === f.type) return;
    const base = { id: f.id, type };
    const words = f.text || f.label || "";
    if (type === "heading") return onChange({ ...base, text: words || "Title", level: 2, align: "left" }, true);
    if (type === "paragraph") return onChange({ ...base, text: words || "Text", align: "left", bold: false, italic: false, size: "normal", blanks: [] }, true);
    if (type === "divider" || type === "spacer") return onChange(base, true);
    return onChange({ ...base, label: f.label || f.text || FIELD_TYPES[type], required: Boolean(f.required), width: f.width || "full",
      options: type === "select" || type === "radio" ? (f.options?.length ? f.options : ["Option 1", "Option 2"]) : [],
      source: INPUT_TYPES.includes(f.type) ? f.source : null, help: f.help || null, rows: type === "textarea" ? 3 : null }, true);
  };
  const insertBlank = () => {
    const el = area.current;
    const used = new Set(blanksInText(f.text));
    let n = 1; while (used.has(`blank_${n}`)) n += 1;
    const token = `{{blank_${n}}}`;
    const at = el ? el.selectionStart : f.text.length;
    const text = f.text.slice(0, at) + token + f.text.slice(at);
    set({ text, blanks: syncBlanks(text, f.blanks) });
  };
  const setBlank = (key, patch) => set({ blanks: f.blanks.map((b) => (b.key === key ? { ...b, ...patch } : b)) });
  const removeBlank = (key) => {
    const text = f.text.replaceAll(`{{${key}}}`, "");
    set({ text, blanks: syncBlanks(text, f.blanks) });
  };

  return (
    <>
      <Form.Group className="mb-2"><Form.Label className="mb-0">Type</Form.Label>
        <Form.Select size="sm" value={f.type} onChange={(e) => changeType(e.target.value)}>
          {Object.entries(FIELD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></Form.Group>

      {f.type === "heading" && (
        <>
          <Form.Group className="mb-2"><Form.Label className="mb-0">Title</Form.Label>
            <Form.Control size="sm" value={f.text} onChange={(e) => set({ text: e.target.value })} /></Form.Group>
          <Row2>
            <Form.Select size="sm" value={f.level} onChange={(e) => set({ level: Number(e.target.value) })} aria-label="Size">
              <option value={1}>Large</option><option value={2}>Medium</option><option value={3}>Small</option></Form.Select>
            <Form.Select size="sm" value={f.align} onChange={(e) => set({ align: e.target.value })} aria-label="Alignment">
              {Object.entries(ALIGNS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select>
          </Row2>
        </>
      )}

      {f.type === "paragraph" && (
        <>
          <Form.Group className="mb-1"><Form.Label className="mb-0">Text</Form.Label>
            <Form.Control ref={area} as="textarea" rows={8} value={f.text}
              onChange={(e) => set({ text: e.target.value, blanks: syncBlanks(e.target.value, f.blanks) })} /></Form.Group>
          <div className="d-flex align-items-center gap-2 mb-2">
            <Button size="sm" variant="outline-custom" onClick={insertBlank}>+ Insert blank</Button>
            <small className="text-muted">A blank is written {"{{name}}"} in the text.</small>
          </div>
          <Row2>
            <Form.Select size="sm" value={f.size} onChange={(e) => set({ size: e.target.value })} aria-label="Text size">
              {Object.entries(TEXT_SIZES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select>
            <Form.Select size="sm" value={f.align} onChange={(e) => set({ align: e.target.value })} aria-label="Alignment">
              {Object.entries(ALIGNS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select>
          </Row2>
          <ButtonGroup size="sm" className="mb-2">
            <Button variant={f.bold ? "secondary" : "light"} onClick={() => set({ bold: !f.bold })}><b>B</b></Button>
            <Button variant={f.italic ? "secondary" : "light"} onClick={() => set({ italic: !f.italic })}><i>I</i></Button>
          </ButtonGroup>
          {f.blanks.length > 0 && <div className="fw-semibold mb-1">Blanks in this text</div>}
          {f.blanks.map((b) => (
            <div key={b.key} className="border rounded p-2 mb-2">
              <div className="d-flex align-items-center mb-1"><code className="me-auto">{`{{${b.key}}}`}</code>
                <Button size="sm" variant="link" className="text-danger p-0" onClick={() => removeBlank(b.key)}>Remove</Button></div>
              <Form.Control size="sm" className="mb-1" placeholder="What goes here" value={b.label}
                onChange={(e) => setBlank(b.key, { label: e.target.value })} />
              <Row2>
                <Form.Select size="sm" value={b.type} onChange={(e) => setBlank(b.key, { type: e.target.value })} aria-label="Type">
                  {Object.entries(BLANK_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select>
                <Form.Select size="sm" value={b.size} onChange={(e) => setBlank(b.key, { size: e.target.value })} aria-label="Length">
                  {Object.entries(BLANK_SIZES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select>
              </Row2>
              <SourceSelect sources={sources} value={b.source} repeat={section.repeat === "trade_in"} onChange={(source) => setBlank(b.key, { source })} />
              <Form.Check id={`req-${b.key}`} className="mt-1" label="Required" checked={b.required}
                onChange={(e) => setBlank(b.key, { required: e.target.checked })} />
            </div>
          ))}
        </>
      )}

      {INPUT_TYPES.includes(f.type) && (
        <>
          <Form.Group className="mb-2"><Form.Label className="mb-0">Label</Form.Label>
            <Form.Control size="sm" value={f.label} onChange={(e) => set({ label: e.target.value })} /></Form.Group>
          {f.type !== "checkbox" && f.type !== "signature" && (
            <Form.Group className="mb-2"><Form.Label className="mb-0">Filled from the CRM</Form.Label>
              <SourceSelect sources={sources} value={f.source} repeat={section.repeat === "trade_in"} onChange={(source) => set({ source })} />
              <Form.Text>Staff can still change it on the form.</Form.Text></Form.Group>
          )}
          {(f.type === "select" || f.type === "radio") && (
            <Form.Group className="mb-2"><Form.Label className="mb-0">Choices (one per line)</Form.Label>
              <Form.Control as="textarea" rows={4} value={f.options.join("\n")} onChange={(e) => set({ options: e.target.value.split("\n") })} /></Form.Group>
          )}
          {f.type === "textarea" && (
            <Form.Group className="mb-2"><Form.Label className="mb-0">Box height (lines)</Form.Label>
              <Form.Control size="sm" type="number" min={2} max={20} value={f.rows || 3} onChange={(e) => set({ rows: Number(e.target.value) })} /></Form.Group>
          )}
          <Form.Group className="mb-2"><Form.Label className="mb-0">Width</Form.Label>
            <Form.Select size="sm" value={f.width} onChange={(e) => set({ width: e.target.value })}>
              {Object.entries(WIDTHS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></Form.Group>
          <Form.Group className="mb-2"><Form.Label className="mb-0">Help text (optional)</Form.Label>
            <Form.Control size="sm" value={f.help || ""} onChange={(e) => set({ help: e.target.value })} /></Form.Group>
          {f.type !== "checkbox" && <Form.Check id="f-req" label="Required (the form can't be completed without it)"
            checked={f.required} onChange={(e) => set({ required: e.target.checked })} />}
        </>
      )}
      {(f.type === "divider" || f.type === "spacer") && <p className="text-muted mb-0">{f.type === "divider" ? "A line across the form." : "Empty space."}</p>}
    </>
  );
}
