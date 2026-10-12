"use client";
// The workflow as a map (client, 13 Oct 2026: the nested tree with every field open was "very complex - even for a
// developer"). Seeing and editing are separate: the map reads left to right like a flowchart - each box is one message
// (its name and first line), each arrow is the customer's answer (Yes / No / Anything else / No reply), and the ends
// are pills (AI carries on, End, Book, Dealership Action Required). Clicking a box opens just that step in a side panel.
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Form, Offcanvas } from "react-bootstrap";
import { HowTo, MessageBlock, OUTCOME_LABELS, STATUS_OPTIONS, WordChips, fill, patternToWords } from "./shared";

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

const LINE = "#cfd8e6";

function IconButton({ title, onClick, children, danger }) {
  return (
    <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="btn btn-sm border-0 px-2 py-1"
      style={{ color: danger ? "#c0392b" : "#5b6b85", background: "#f3f6fa", borderRadius: 8, fontSize: 12 }}>
      {children}
    </button>
  );
}

function Box({ node, path, onOpen, selected, actions }) {
  const escalates = (node.also || []).includes("dealership_action_required");
  const isSelected = selected && selected.join(".") === path.join(".");
  const accent = escalates ? "#e0a100" : "#3b7ddd";
  return (
    <div role="button" onClick={() => onOpen(path)}
      style={{ width: 260, background: "#fff", borderRadius: 12, padding: "10px 12px 10px 14px", cursor: "pointer",
        boxShadow: isSelected ? "0 0 0 2px #3b7ddd, 0 4px 14px rgba(30,60,120,.12)" : "0 1px 3px rgba(30,60,120,.10), 0 4px 14px rgba(30,60,120,.06)",
        borderLeft: `4px solid ${accent}`, flexShrink: 0, textAlign: "left" }}>
      <div className="d-flex align-items-center gap-2 mb-1">
        <span style={{ width: 26, height: 26, borderRadius: 8, background: escalates ? "#fff4d6" : "#e8f0fd",
          display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>💬</span>
        <span className="fw-semibold" style={{ fontSize: 13.5, color: "#1f2a44" }}>{node.label || "Message"}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "#5b6b85", lineHeight: 1.35 }}>{firstLine(node.message)}</div>
      {escalates && <div className="mt-1" style={{ fontSize: 11.5, color: "#9a6b00" }}>⚠ Also alerts the dealership</div>}
      {actions && (
        <div className="d-flex gap-1 mt-2">
          <IconButton title="Edit this message" onClick={() => onOpen(path)}>✎ Edit</IconButton>
          {!actions.readOnly && <IconButton title="Add a message after this one" onClick={() => actions.addNext(path)}>
            ＋ Next</IconButton>}
          {!actions.readOnly && path.length > 0 && <IconButton danger title="Delete this step and what follows it"
            onClick={() => actions.remove(path)}>🗑</IconButton>}
        </div>
      )}
    </div>
  );
}

function Pill({ then }) {
  const [label, bg, color] = END_STYLE[then?.action] || END_STYLE.ai;
  return (
    <span style={{ background: bg, color, borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 600,
      whiteSpace: "nowrap", display: "inline-block" }}>
      {then?.action === "set_status" && then.status ? `Status: ${then.status}` : label}
    </span>
  );
}

const VLine = ({ h = 22 }) => <div style={{ width: 2, height: h, background: LINE, margin: "0 auto" }} />;

// Top to bottom, like a workflow builder: the card, a line down, and - when the answer decides what comes next - the
// line splits into one column per answer, each headed by the answer.
function MapNode({ node, path, onOpen, selected, actions }) {
  const branches = node.branches || [];
  return (
    <div className="d-flex flex-column align-items-center">
      <Box node={node} path={path} onOpen={onOpen} selected={selected} actions={actions} />
      {branches.length > 0 && (
        <>
          <VLine />
          <div className="d-flex align-items-start" style={{ position: "relative" }}>
            {branches.map((b, i) => (
              <div key={i} className="d-flex flex-column align-items-center px-2" style={{ position: "relative" }}>
                {branches.length > 1 && (
                  <div style={{ position: "absolute", top: 0, height: 2, background: LINE,
                    left: i === 0 ? "50%" : 0, right: i === branches.length - 1 ? "50%" : 0 }} />
                )}
                <VLine h={14} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "#3b4a66", background: "#eef2f8",
                  border: `1px solid ${LINE}`, borderRadius: 20, padding: "2px 10px", whiteSpace: "nowrap" }}>
                  {answerLabel(b.when)}
                </span>
                <VLine h={14} />
                {b.then?.action === "ask" && b.then.node
                  ? <MapNode node={b.then.node} path={[...path, i]} onOpen={onOpen} selected={selected} actions={actions} />
                  : <Pill then={b.then} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TriggerCard({ words }) {
  return (
    <div style={{ width: 300, background: "#fff", borderRadius: 12, padding: "10px 14px",
      boxShadow: "0 1px 3px rgba(30,60,120,.10), 0 4px 14px rgba(30,60,120,.06)", borderLeft: "4px solid #7c4dff" }}>
      <div className="d-flex align-items-center gap-2 mb-1">
        <span style={{ width: 26, height: 26, borderRadius: 8, background: "#efe9ff", display: "inline-flex",
          alignItems: "center", justifyContent: "center", fontSize: 13 }}>⚡</span>
        <span className="fw-semibold" style={{ fontSize: 13.5, color: "#1f2a44" }}>Trigger</span>
      </div>
      <div style={{ fontSize: 12.5, color: "#5b6b85" }}>
        When the customer says: {words.length ? words.slice(0, 4).join(", ") + (words.length > 4 ? "…" : "") : "(add phrases above)"}
      </div>
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

export function WorkflowEditor({ content: content_, onChange, placeholders, readOnly }) {
  const [open, setOpen] = useState(null);
  const [zoom, setZoom] = useState(0.85);
  const canvas = useRef(null);
  const content = useRef(null);
  // Fit the whole flow on screen, and start with the first message in view.
  const fit = () => {
    const box = canvas.current;
    const inner = content.current;
    if (!box || !inner) return;
    const ratio = (box.clientWidth - 48) / ((inner.scrollWidth || 1) / zoom);
    setZoom(Math.max(0.4, Math.min(1, +ratio.toFixed(2))));
  };
  useEffect(() => {
    const box = canvas.current;
    const inner = content.current;
    if (!box || !inner) return;
    const width = inner.scrollWidth;
    box.scrollLeft = Math.max(0, (width - box.clientWidth) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const trigger = content_.trigger || { type: "customer_says", phrases: [] };
  const phrases = trigger.phrases || [];
  const tree = content_.tree;
  const node = open ? getAt(tree, open) : null;
  const update = (path, next) => onChange({ ...content_, tree: setAt(tree, path, next) });
  const addNext = (path) => {
    const parent = getAt(tree, path);
    const used = new Set((parent.branches || []).map((b) => b.when?.value));
    const answer = ["yes", "no", "anything_else"].find((a) => !used.has(a)) || "no_reply";
    const branches = [...(parent.branches || []).filter((b) => !(b.when?.value === answer && b.then?.action !== "ask")),
      { when: { type: "reply", value: answer }, then: { action: "ask", node: newNode() } }];
    update(path, { ...parent, branches });
    setOpen([...path, branches.length - 1]);
  };
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
        <WordChips words={phrases.length ? phrases : patternToWords(trigger.pattern)} readOnly={readOnly}
          placeholder="Add a phrase the customer would use (e.g. purchase order) and press Enter"
          onChange={(next) => onChange({ ...content_, trigger: { ...trigger, type: "customer_says", phrases: next } })} />
      </div>
      <HowTo>each box is one message the AI sends; the arrows are the customer&apos;s answers. <b>✎ Edit</b> changes a
        message and what happens after each answer. <b>+ Next step</b> adds a new message after this one (you choose the
        answer that leads to it). <b>🗑</b> removes a step and everything after it. Then Save draft and Publish.</HowTo>
      <div className="d-flex justify-content-end gap-1 mb-2">
        {[["−", () => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))],
          [`${Math.round(zoom * 100)}%`, () => setZoom(1)],
          ["+", () => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))],
          ["Fit", fit]].map(([label, onClick]) => (
          <button key={label} type="button" onClick={onClick} className="btn btn-sm btn-light border"
            style={{ minWidth: 40, fontSize: 12 }}>{label}</button>
        ))}
      </div>
      <div ref={canvas} className="p-4 rounded-3" style={{ overflow: "auto", maxHeight: "75vh", background: "#f4f6fa",
        backgroundImage: "radial-gradient(#dfe5ee 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
        <div ref={content} className="d-flex flex-column align-items-center"
          style={{ minWidth: "max-content", zoom,
            width: "max-content" }}>
          <TriggerCard words={phrases.length ? phrases : patternToWords(trigger.pattern)} />
          <VLine h={26} />
          {tree && <MapNode node={tree} path={[]} onOpen={setOpen} selected={open}
            actions={{ readOnly, addNext, remove: removeAt }} />}
        </div>
      </div>
      {node && (
        <StepPanel node={node} placeholders={placeholders} readOnly={readOnly} onClose={() => setOpen(null)}
          onChange={(next) => update(open, next)} onRemove={open.length ? () => removeAt(open) : null} />
      )}
    </div>
  );
}
