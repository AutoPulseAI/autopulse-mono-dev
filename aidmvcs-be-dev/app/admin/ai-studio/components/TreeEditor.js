"use client";
// The workflow tree (client, 13 Oct 2026: "we need to create a tree - if we make everything a list, things will mess
// up"). Each step is a node: its message, then its branches - "if the customer says X, then Y" - and a branch that
// sends another message carries that message's own node underneath, so the whole if-then flow reads top to bottom.
import { useState } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { CONDITION_LABELS, MessageBlock, OUTCOME_LABELS, STATUS_OPTIONS, summary } from "./shared";

let counter = 0;
const newId = () => `step_${Date.now().toString(36)}_${(counter += 1)}`;
export const newNode = (label = "New message") => ({ id: newId(), label, message: { mode: "fixed", text: "" },
  branches: [{ when: { type: "reply", value: "anything_else" }, then: { action: "ai" } }] });

function Branch({ branch, onChange, onRemove, placeholders, readOnly, depth }) {
  const value = branch.when?.value || "anything_else";
  const action = branch.then?.action || "ai";
  const setWhen = (patch) => onChange({ ...branch, when: { type: "reply", ...branch.when, ...patch } });
  const setThen = (patch) => onChange({ ...branch, then: { ...branch.then, ...patch } });
  return (
    <div className="ps-3 ms-2 mt-2" style={{ borderLeft: "2px solid #c9d3e6" }}>
      <div className="d-flex flex-wrap align-items-center gap-2">
        <span className="small text-muted">If</span>
        <Form.Select size="sm" style={{ width: 250 }} value={value} disabled={readOnly}
          onChange={(e) => setWhen({ value: e.target.value })}>
          {Object.entries(CONDITION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Form.Select>
        {value === "no_reply" && (
          <Form.Select size="sm" style={{ width: 120 }} value={branch.when?.after || "24h"} disabled={readOnly}
            onChange={(e) => setWhen({ after: e.target.value })}>
            {["1h", "3h", "24h", "48h", "3d", "7d"].map((a) => <option key={a} value={a}>{a}</option>)}
          </Form.Select>
        )}
        <span className="small text-muted">then</span>
        <Form.Select size="sm" style={{ width: 260 }} value={action} disabled={readOnly}
          onChange={(e) => {
            const next = e.target.value;
            setThen({ action: next, node: next === "ask" ? (branch.then?.node || newNode()) : undefined });
          }}>
          {Object.entries(OUTCOME_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Form.Select>
        {action === "set_status" && (
          <Form.Select size="sm" style={{ width: 230 }} value={branch.then?.status || ""} disabled={readOnly}
            onChange={(e) => setThen({ status: e.target.value })}>
            <option value="">Choose a status…</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Form.Select>
        )}
        {!readOnly && <Button size="sm" variant="link" className="text-danger p-0" onClick={onRemove}>remove</Button>}
      </div>
      {action === "ask" && branch.then?.node && (
        <Node node={branch.then.node} depth={depth + 1} placeholders={placeholders} readOnly={readOnly}
          onChange={(node) => setThen({ node })} />
      )}
    </div>
  );
}

export function Node({ node, onChange, placeholders, readOnly, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const set = (patch) => onChange({ ...node, ...patch });
  const branches = node.branches || [];
  const escalates = (node.also || []).includes("dealership_action_required");
  return (
    <div className="mt-2">
      <div className={`border rounded ${depth === 0 ? "border-primary" : ""}`} style={{ background: "#fff" }}>
        <div className="d-flex align-items-start gap-2 p-2" role="button" onClick={() => setOpen(!open)}>
          <span className="text-muted">{open ? "▾" : "▸"}</span>
          <div className="flex-grow-1">
            <div className="fw-semibold small">
              {node.label || node.id}
              {escalates && <Badge bg="warning" text="dark" className="ms-2">Dealership Action Required</Badge>}
              {branches.length > 0 && <Badge bg="light" text="dark" className="ms-2">{branches.length} branches</Badge>}
            </div>
            {!open && <div className="small text-muted text-truncate" style={{ maxWidth: 700 }}>{summary(node.message)}</div>}
          </div>
        </div>
        {open && (
          <div className="px-3 pb-3">
            <Form.Control size="sm" className="mb-2" placeholder="Step name (e.g. Ask about trade)" value={node.label || ""}
              disabled={readOnly} onChange={(e) => set({ label: e.target.value })} />
            <MessageBlock message={node.message} placeholders={placeholders} readOnly={readOnly} compact
              onChange={(message) => set({ message })} />
            <Form.Check type="switch" className="mt-2 small" label="Also set Dealership Action Required when this is sent"
              checked={escalates} disabled={readOnly}
              onChange={(e) => set({ also: e.target.checked ? ["dealership_action_required"] : [] })} />
          </div>
        )}
      </div>
      {branches.map((b, i) => (
        <Branch key={i} branch={b} depth={depth} placeholders={placeholders} readOnly={readOnly}
          onChange={(nb) => set({ branches: branches.map((x, j) => (j === i ? nb : x)) })}
          onRemove={() => set({ branches: branches.filter((_, j) => j !== i) })} />
      ))}
      {!readOnly && (
        <div className="ps-3 ms-2 mt-1" style={{ borderLeft: "2px dashed #dfe5f0" }}>
          <Button size="sm" variant="outline-primary" className="me-2"
            onClick={() => set({ branches: [...branches, { when: { type: "reply", value: "yes" },
              then: { action: "ask", node: newNode() } }] })}>+ Add branch with a next message</Button>
          <Button size="sm" variant="outline-secondary"
            onClick={() => set({ branches: [...branches, { when: { type: "reply", value: "no_reply", after: "24h" },
              then: { action: "end" } }] })}>+ Add &quot;no reply&quot; branch</Button>
        </div>
      )}
    </div>
  );
}

export function WorkflowEditor({ content, onChange, placeholders, readOnly }) {
  const trigger = content.trigger || { type: "customer_says", phrases: [] };
  const phrases = trigger.phrases || [];
  return (
    <div>
      <div className="p-3 mb-3 rounded" style={{ background: "#f3f6fb" }}>
        <div className="fw-semibold mb-1">Starts when the customer says…</div>
        <Form.Control size="sm" placeholder="Words or phrases, separated by commas (e.g. buyer's order, purchase order)"
          disabled={readOnly} value={phrases.join(", ")}
          onChange={(e) => onChange({ ...content, trigger: { ...trigger, type: "customer_says",
            phrases: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) } })} />
        {trigger.pattern && (
          <div className="small text-muted mt-1">
            Built-in match: <code style={{ fontSize: 11 }}>{trigger.pattern.slice(0, 160)}{trigger.pattern.length > 160 ? "…" : ""}</code>
          </div>
        )}
      </div>
      <Node node={content.tree} placeholders={placeholders} readOnly={readOnly}
        onChange={(tree) => onChange({ ...content, tree })} />
    </div>
  );
}
