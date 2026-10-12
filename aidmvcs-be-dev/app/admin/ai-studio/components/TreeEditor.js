"use client";
// The workflow as a map (client, 13 Oct 2026: the nested tree with every field open was "very complex - even for a
// developer"). Seeing and editing are separate: the map reads left to right like a flowchart - each box is one message
// (its name and first line), each arrow is the customer's answer (Yes / No / Anything else / No reply), and the ends
// are pills (AI carries on, End, Book, Dealership Action Required). Clicking a box opens just that step in a side panel.
import { useState } from "react";
import { Badge, Button, Form, Offcanvas } from "react-bootstrap";
import { MessageBlock, OUTCOME_LABELS, STATUS_OPTIONS, fill } from "./shared";

let counter = 0;
const newId = () => `step_${Date.now().toString(36)}_${(counter += 1)}`;
export const newNode = (label = "New message") => ({ id: newId(), label, message: { mode: "fixed", text: "" },
  branches: [{ when: { type: "reply", value: "anything_else" }, then: { action: "ai" } }] });

const ANSWER = { yes: "Yes", no: "No", anything_else: "Anything else", picks_a_time: "Picks a time",
  mentions_trade: "Mentions trade", mentions_credit: "Mentions credit", mentions_price: "Mentions price",
  no_reply: "No reply" };
const answerLabel = (when) => (when?.value === "no_reply" ? `No reply ${when.after || "24h"}` : ANSWER[when?.value]
  || "Anything else");
const END_STYLE = { ai: ["AI carries on", "#e8f1ff", "#2c5aa0"], end: ["End", "#f1f1f1", "#555"],
  book: ["Book the time", "#e7f6ec", "#1f7a3a"], escalate: ["Dealership Action Required", "#fff4d6", "#8a5a00"],
  set_status: ["Set status", "#f3e8ff", "#6b2fa0"], call_task: ["Call task", "#e8f7f7", "#16696b"] };

const firstLine = (message) => {
  if (!message) return "";
  if (message.mode === "ai") return `AI writes: ${message.instruction || "…"}`;
  const text = fill(message.text || message.fallback || "");
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

// --- Path helpers: a node is addressed by the list of branch indexes from the root ---------------------------------
const getAt = (root, path) => path.reduce((n, i) => n?.branches?.[i]?.then?.node, root);
const setAt = (root, path, node) => {
  if (!path.length) return node;
  const [i, ...rest] = path;
  const branches = root.branches.map((b, j) => (j === i ? { ...b, then: { ...b.then, node: setAt(b.then.node, rest, node) } } : b));
  return { ...root, branches };
};

function Box({ node, path, onOpen, selected }) {
  const escalates = (node.also || []).includes("dealership_action_required");
  const isSelected = selected && selected.join(".") === path.join(".");
  return (
    <div role="button" onClick={() => onOpen(path)} className="shadow-sm"
      style={{ width: 230, flexShrink: 0, minHeight: 70, borderRadius: 10, padding: "8px 10px", background: "#fff",
        border: `2px solid ${isSelected ? "#0d6efd" : path.length ? "#c9d3e6" : "#0d6efd"}` }}>
      <div className="fw-semibold small">
        {node.label || "Step"}
        {escalates && <span title="Also sets Dealership Action Required"> ⚠</span>}
      </div>
      <div className="small text-muted" style={{ lineHeight: 1.25 }}>{firstLine(node.message)}</div>
    </div>
  );
}

function Pill({ then }) {
  const [label, bg, color] = END_STYLE[then?.action] || END_STYLE.ai;
  return (
    <span className="small fw-semibold" style={{ background: bg, color, borderRadius: 20, padding: "4px 12px",
      whiteSpace: "nowrap" }}>{then?.action === "set_status" && then.status ? `Status: ${then.status}` : label}</span>
  );
}

function MapNode({ node, path, onOpen, selected }) {
  const branches = node.branches || [];
  return (
    <div className="d-flex align-items-start">
      <Box node={node} path={path} onOpen={onOpen} selected={selected} />
      {branches.length > 0 && (
        <div className="d-flex flex-column gap-3 ps-2" style={{ borderLeft: "2px solid #c9d3e6", marginLeft: 0 }}>
          {branches.map((b, i) => (
            <div key={i} className="d-flex align-items-start">
              <div className="d-flex align-items-center" style={{ minWidth: 120, paddingTop: 22 }}>
                <span style={{ width: 14, borderTop: "2px solid #c9d3e6" }} />
                <Badge bg="light" text="dark" className="border">{answerLabel(b.when)}</Badge>
                <span style={{ flex: 1, minWidth: 14, borderTop: "2px solid #c9d3e6" }} />
                <span style={{ color: "#c9d3e6" }}>▶</span>
              </div>
              <div style={{ paddingTop: b.then?.action === "ask" ? 0 : 18 }}>
                {b.then?.action === "ask" && b.then.node
                  ? <MapNode node={b.then.node} path={[...path, i]} onOpen={onOpen} selected={selected} />
                  : <Pill then={b.then} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepPanel({ node, onChange, onClose, onRemove, placeholders, readOnly }) {
  const set = (patch) => onChange({ ...node, ...patch });
  const branches = node.branches || [];
  const setBranch = (i, patch) => set({ branches: branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const escalates = (node.also || []).includes("dealership_action_required");
  return (
    <Offcanvas show onHide={onClose} placement="end" style={{ width: 560 }}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title className="w-100">
          <Form.Control size="sm" value={node.label || ""} disabled={readOnly} placeholder="Step name"
            onChange={(e) => set({ label: e.target.value })} />
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        <div className="fw-semibold mb-2">1. What the AI sends</div>
        <MessageBlock message={node.message} placeholders={placeholders} readOnly={readOnly} compact
          onChange={(message) => set({ message })} />
        <Form.Check type="switch" className="mt-2 small" label="Also set Dealership Action Required when this is sent"
          checked={escalates} disabled={readOnly}
          onChange={(e) => set({ also: e.target.checked ? ["dealership_action_required"] : [] })} />

        <div className="fw-semibold mt-4 mb-2">2. What happens next</div>
        {branches.map((b, i) => (
          <div key={i} className="d-flex gap-2 align-items-center mb-2">
            <Form.Select size="sm" style={{ width: 170 }} value={b.when?.value || "anything_else"} disabled={readOnly}
              onChange={(e) => setBranch(i, { when: { type: "reply", value: e.target.value,
                ...(e.target.value === "no_reply" ? { after: b.when?.after || "24h" } : {}) } })}>
              {Object.entries(ANSWER).map(([k, l]) => <option key={k} value={k}>If: {l}</option>)}
            </Form.Select>
            {b.when?.value === "no_reply" && (
              <Form.Select size="sm" style={{ width: 80 }} value={b.when.after || "24h"} disabled={readOnly}
                onChange={(e) => setBranch(i, { when: { ...b.when, after: e.target.value } })}>
                {["1h", "3h", "24h", "48h", "3d", "7d"].map((a) => <option key={a}>{a}</option>)}
              </Form.Select>
            )}
            <span>→</span>
            <Form.Select size="sm" value={b.then?.action || "ai"} disabled={readOnly}
              onChange={(e) => setBranch(i, { then: { action: e.target.value,
                node: e.target.value === "ask" ? (b.then?.node || newNode()) : undefined } })}>
              {Object.entries(OUTCOME_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Form.Select>
            {b.then?.action === "set_status" && (
              <Form.Select size="sm" value={b.then.status || ""} disabled={readOnly}
                onChange={(e) => setBranch(i, { then: { ...b.then, status: e.target.value } })}>
                <option value="">Status…</option>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </Form.Select>
            )}
            {!readOnly && <Button size="sm" variant="link" className="text-danger p-0"
              onClick={() => set({ branches: branches.filter((_, j) => j !== i) })}>✕</Button>}
          </div>
        ))}
        {!readOnly && (
          <div className="d-flex gap-2 mt-2">
            <Button size="sm" variant="outline-primary" onClick={() => set({ branches: [...branches,
              { when: { type: "reply", value: "yes" }, then: { action: "ask", node: newNode() } }] })}>
              + Add answer with a next message</Button>
            <Button size="sm" variant="outline-secondary" onClick={() => set({ branches: [...branches,
              { when: { type: "reply", value: "no_reply", after: "24h" }, then: { action: "end" } }] })}>
              + If no reply</Button>
          </div>
        )}
        {!readOnly && onRemove && (
          <Button size="sm" variant="outline-danger" className="mt-4" onClick={onRemove}>Delete this step</Button>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
}

export function WorkflowEditor({ content, onChange, placeholders, readOnly }) {
  const [open, setOpen] = useState(null);
  const trigger = content.trigger || { type: "customer_says", phrases: [] };
  const phrases = trigger.phrases || [];
  const tree = content.tree;
  const node = open ? getAt(tree, open) : null;
  const update = (path, next) => onChange({ ...content, tree: setAt(tree, path, next) });
  const removeAt = (path) => {
    const parent = path.slice(0, -1);
    const parentNode = getAt(tree, parent);
    const idx = path[path.length - 1];
    update(parent, { ...parentNode, branches: parentNode.branches.map((b, j) => (j === idx
      ? { ...b, then: { action: "ai" } } : b)) });
    setOpen(null);
  };
  return (
    <div>
      <div className="p-3 mb-3 rounded" style={{ background: "#f3f6fb" }}>
        <div className="fw-semibold mb-1">Starts when the customer says…</div>
        <Form.Control size="sm" placeholder="Words or phrases, separated by commas (e.g. buyer's order, purchase order)"
          disabled={readOnly} value={phrases.join(", ")}
          onChange={(e) => onChange({ ...content, trigger: { ...trigger, type: "customer_says",
            phrases: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) } })} />
        {trigger.pattern && !phrases.length && <div className="small text-muted mt-1">Using the built-in match.</div>}
      </div>
      <div className="small text-muted mb-2">Click a box to edit that message and what happens after it.</div>
      <div className="p-3 border rounded" style={{ overflowX: "auto", background: "#fafbfd" }}>
        {tree && <MapNode node={tree} path={[]} onOpen={setOpen} selected={open} />}
      </div>
      {node && (
        <StepPanel node={node} placeholders={placeholders} readOnly={readOnly} onClose={() => setOpen(null)}
          onChange={(next) => update(open, next)} onRemove={open.length ? () => removeAt(open) : null} />
      )}
    </div>
  );
}
