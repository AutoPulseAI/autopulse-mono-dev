import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { formatDateTime } from "../time";
import type { ConversationItem, Lead } from "../types";
import { StatusBadge } from "./ui";

interface Props {
  dealerId: string;
  // The offline (rule-based) model is running: its test tags work.
  offline: boolean;
  leads: Lead[];
  selectedLeadId: string | null;
  onSelectLead: (id: string) => void;
  conversation: ConversationItem[];
  onChanged: () => void;
  onError: (message: string) => void;
}

// Test tags the offline model acts on (agent/offline_model.py); a real model
// would just read them as text, so they're shown only with the offline model.
const HINTS: { tag: string; explains: string }[] = [
  { tag: "#retry", explains: "The first draft breaks a rule, so the guard sends it back for one rewrite." },
  { tag: "#fallback", explains: "Every draft breaks a rule, so the safe template reply is sent instead." },
  { tag: "#reject", explains: "Extract returns a value that isn't in the message, so Validate rejects it." },
];

export function Simulator({ dealerId, offline, leads, selectedLeadId, onSelectLead, conversation, onChanged, onError }: Props) {
  const [showNew, setShowNew] = useState(false);
  const lead = leads.find((l) => l.id === selectedLeadId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Simulator · leads</div>
        <button
          type="button"
          onClick={() => setShowNew((s) => !s)}
          className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white"
        >
          {showNew ? "Close" : "+ New lead"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showNew && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-line"
          >
            <NewLeadForm
              dealerId={dealerId}
              onCreated={(leadId) => {
                setShowNew(false);
                onChanged();
                onSelectLead(leadId);
              }}
              onError={onError}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="scroll-thin max-h-[34%] min-h-24 overflow-y-auto border-b border-line">
        {leads.length === 0 && (
          <div className="p-3 text-[12px] text-muted">
            No leads yet. Run <code className="font-mono">make ai-seed</code> or create one.
          </div>
        )}
        {leads.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onSelectLead(l.id)}
            className="flex w-full items-center gap-2 border-b border-line/60 px-3 py-1.5 text-left hover:bg-panel-2"
            style={{ background: l.id === selectedLeadId ? "var(--accent-soft)" : undefined }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold">{l.name}</div>
              <div className="truncate text-[11px] text-muted">
                {l.lead_type ?? "?"} · {l.channel}
              </div>
            </div>
            <StatusBadge status={l.status} />
          </button>
        ))}
      </div>

      {lead ? (
        <Chat dealerId={dealerId} lead={lead} conversation={conversation} offline={offline} onChanged={onChanged} onError={onError} />
      ) : (
        <div className="p-3 text-[12px] text-muted">Pick a lead to chat as the customer.</div>
      )}
    </div>
  );
}

const DEFAULT_COMMENTS: Record<string, string> = {
  sales: "Hi, I'm interested in a new Toyota RAV4.",
  trade_in: "Hi, I'd like to trade in my 2018 Honda Civic.",
  service: "Hi, my check engine light is on. Can I book a service appointment?",
  general: "Hi, I have a question about your dealership.",
};

function NewLeadForm({ dealerId, onCreated, onError }: { dealerId: string; onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [name, setName] = useState("Test Customer");
  const [leadType, setLeadType] = useState("sales");
  const [channel, setChannel] = useState("sms");
  const [comments, setComments] = useState(DEFAULT_COMMENTS.sales);
  const [commentsTouched, setCommentsTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeLeadType = (value: string) => {
    setLeadType(value);
    if (!commentsTouched) {
      setComments(DEFAULT_COMMENTS[value] ?? "");
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.newLead({ dealer_id: dealerId, lead_type: leadType, channel, name, comments });
      onCreated(res.lead_id);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-md border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent";
  return (
    <div className="space-y-1.5 p-3">
      <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
      <div className="flex gap-1.5">
        <select className={field} value={leadType} onChange={(e) => changeLeadType(e.target.value)}>
          <option value="sales">Sales</option>
          <option value="trade_in">Trade-in</option>
          <option value="service">Service</option>
          <option value="general">General</option>
        </select>
        <select className={field} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </select>
      </div>
      <textarea
        className={`${field} h-14 resize-none`}
        value={comments}
        onChange={(e) => {
          setComments(e.target.value);
          setCommentsTouched(true);
        }}
        placeholder="What the lead said (DMS comments)"
      />
      <button
        type="button"
        disabled={busy || !name}
        onClick={submit}
        className="w-full rounded-md bg-accent py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Sending…" : "Create lead → send lead-created event"}
      </button>
    </div>
  );
}

// How an outbound message's send status reads under its bubble.
function statusLabel(m: ConversationItem): string {
  switch (m.status) {
    case "sent":
      return `sent${m.latency_ms != null ? ` in ${m.latency_ms} ms` : ""}${m.to ? ` to ${m.to}` : ""}`;
    case "failed":
      return `FAILED · ${m.reason ?? ""}`;
    case "suppressed":
      return `not sent · ${m.reason ?? ""}`;
    case "shadow":
      return "shadow draft · not sent";
    case "unknown":
      return "send status unknown";
    default:
      return m.kind === "draft" ? `${m.outcome ?? ""} · draft, not sent` : (m.status ?? "");
  }
}

function outboundStyle(m: ConversationItem): React.CSSProperties {
  if (m.status === "sent") return { background: "var(--accent)" };
  if (m.status === "failed") return { background: "var(--bad)" };
  if (m.status === "suppressed" || m.status === "unknown") return { background: "var(--warn)" };
  return { background: "color-mix(in srgb, var(--accent) 70%, transparent)", border: "1px dashed var(--accent)" };
}

function chatTranscript(lead: Lead, conversation: ConversationItem[]): string {
  const lines = conversation.map((m) => {
    const at = m.at ? formatDateTime(m.at, true) : "—";
    const who = m.direction === "inbound" ? lead.name : "AI";
    const detail = m.direction === "inbound" ? (m.kind === "lead" ? "lead comments" : m.channel.toUpperCase())
      : `${m.channel.toUpperCase()} · ${statusLabel(m)}`;
    return `[${at}] ${who} (${detail}):\n${m.text}`;
  });
  return `Chat with ${lead.name} (${lead.id})\n\n${lines.join("\n\n")}`;
}

function Chat({ dealerId, lead, conversation, offline, onChanged, onError }: {
  dealerId: string;
  lead: Lead;
  offline: boolean;
  conversation: ConversationItem[];
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">(lead.channel);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const copyChat = async () => {
    try {
      await navigator.clipboard.writeText(chatTranscript(lead, conversation));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      onError(String(e));
    }
  };

  useEffect(() => {
    setChannel(lead.channel);
  }, [lead.id, lead.channel]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation.length]);

  const send = async (body: string) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.reply({ dealer_id: dealerId, lead_id: lead.id, channel, text: body });
      setText("");
      onChanged();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (action: "pause" | "resume") => {
    try {
      await api.leadAction(dealerId, lead.id, action);
      window.setTimeout(onChanged, 400);
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="text-[11px] text-muted">
          Chatting as <span className="font-semibold text-ink">{lead.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyChat()}
            disabled={conversation.length === 0}
            className="text-[11px] font-semibold text-muted disabled:opacity-40"
            title="Copy this chat as text"
          >
            {copied ? "Copied ✓" : "Copy chat"}
          </button>
          {lead.status === "paused" ? (
            <button type="button" onClick={() => toggle("resume")} className="text-[11px] font-semibold text-ok">
              Resume AI
            </button>
          ) : (
            <button type="button" onClick={() => toggle("pause")} className="text-[11px] font-semibold text-warn">
              Pause AI
            </button>
          )}
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-1.5 overflow-y-auto px-3 pb-2">
        <AnimatePresence initial={false}>
          {conversation.map((m, i) => (
            <motion.div
              key={`${m.at}-${i}`}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-2.5 py-1.5 text-[12px] ${
                  m.direction === "inbound" ? "rounded-bl-sm bg-panel-2" : "rounded-br-sm text-white"
                }`}
                style={m.direction === "outbound" ? outboundStyle(m) : undefined}
                title={m.reason ?? undefined}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                <div className={`mt-0.5 text-[9px] ${m.direction === "inbound" ? "text-muted" : "text-white/80"}`}>
                  {m.channel.toUpperCase()}
                  {m.kind === "lead" && " · lead comments"}
                  {m.direction === "outbound" && ` · ${statusLabel(m)}`}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottom} />
      </div>
      <div className="border-t border-line p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {(["sms", "email"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{
                background: channel === c ? "var(--accent-soft)" : "var(--panel-2)",
                color: channel === c ? "var(--accent)" : "var(--muted)",
              }}
            >
              {c}
            </button>
          ))}
          {offline && <span className="mx-1 h-3 w-px bg-line" />}
          {offline &&
            HINTS.map((h) => (
              <button
                key={h.tag}
                type="button"
                title={`Test tag (offline model only): ${h.explains}`}
                onClick={() => setText((t) => `${t} ${h.tag}`.trim())}
                className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-ink"
              >
                {h.tag}
              </button>
            ))}
          <button
            type="button"
            onClick={() => send("STOP")}
            className="ml-auto rounded bg-bad-soft px-1.5 py-0.5 text-[10px] font-semibold text-bad"
          >
            STOP
          </button>
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply as the customer…"
            className="flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-md bg-accent px-3 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
