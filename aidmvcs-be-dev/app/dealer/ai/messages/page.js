"use client";
// AI Messages: every customer we're in touch with, and the conversation itself - three
// panels: Contacts | Messages (texts, through Twilio) | Emails. The AI's messages are tagged.
//   /dealer/ai/messages              the inbox
//   /dealer/ai/messages?lead=<id>    one customer open

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Form, InputGroup, Spinner } from "react-bootstrap";
import LeadAiDrawer from "../components/LeadAiDrawer";
import EmailBody from "../components/EmailBody";
import { aiFetch, formatDateTime, fromNow, leadHref } from "../components/aiShared";

const REFRESH_MS = 20_000;

const css = `
.aim-shell { display: flex; height: calc(100vh - 210px); min-height: 520px; padding: 0; overflow: hidden; }

/* Panel 1: contacts */
.aim-list { width: 320px; flex-shrink: 0; border-right: 1px solid #e6eaf0; display: flex; flex-direction: column; background: #fff; }
.aim-list-scroll { overflow-y: auto; flex: 1; }
.aim-thread { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #f0f2f6; cursor: pointer; border-left: 3px solid transparent; }
.aim-thread:hover { background: #f7f9fc; }
.aim-thread:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.aim-thread.active { background: #eaf3fa; border-left-color: var(--primary); }
.aim-avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0; }
.aim-preview { color: #6c757d; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aim-chan { display: inline-flex; gap: 8px; font-size: 11px; color: #8a94a3; }
.aim-chan i { margin-right: 3px; }

/* Right-hand side: customer header + the two conversation panels */
.aim-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.aim-chat-head { padding: 12px 16px; border-bottom: 1px solid #e6eaf0; display: flex; align-items: center; gap: 10px; background: #fff; }
.aim-panels { flex: 1; display: flex; min-height: 0; }
.aim-pane { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.aim-pane + .aim-pane { border-left: 1px solid #e6eaf0; }
.aim-pane-head { display: flex; align-items: center; gap: 8px; padding: 9px 16px; background: #fff;
  border-bottom: 1px solid #e6eaf0; font-weight: 600; font-size: 13px; color: #3b4656; }
.aim-pane-head .count { background: #eef1f5; color: #5b6676; border-radius: 10px; padding: 0 8px; font-size: 12px; font-weight: 600; }
.aim-pane-body { flex: 1; overflow-y: auto; padding: 16px; background: #f7f9fc; }
.aim-pane-empty { color: #8a94a3; text-align: center; padding: 40px 12px; font-size: 14px; }
.aim-pane-empty i { display: block; font-size: 24px; margin-bottom: 8px; opacity: .7; }
.aim-tabs { display: none; }

/* Panel 2: text messages */
.aim-day { text-align: center; margin: 14px 0 10px; }
.aim-day:first-child { margin-top: 0; }
.aim-day span { background: #e6eaf0; color: #5b6676; font-size: 12px; padding: 2px 10px; border-radius: 10px; }
.aim-row { display: flex; margin-bottom: 10px; }
.aim-row.out { justify-content: flex-end; }
.aim-bubble { max-width: 100%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.45; }
.aim-row.in .aim-bubble { background: #fff; border: 1px solid #e6eaf0; border-bottom-left-radius: 3px; }
.aim-row.out .aim-bubble { background: var(--primary); color: #fff; border-bottom-right-radius: 3px; }
.aim-row.out.ai .aim-bubble { background: var(--primary2); }
.aim-row.out.failed .aim-bubble { background: #fdecea; color: #842029; border: 1px solid #f5c2c7; }
.aim-msgcol { display: flex; flex-direction: column; max-width: 85%; }
.aim-row.out .aim-msgcol { align-items: flex-end; }
.aim-meta { font-size: 11px; color: #8a94a3; margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.aim-row.out .aim-meta { justify-content: flex-end; }
.aim-ai-tag { background: #e7f1ff; color: var(--primary2); border: 1px solid #b6d4fe; font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 8px; white-space: nowrap; }
.aim-media img { max-width: 220px; max-height: 220px; border-radius: 8px; margin-top: 6px; display: block; }

/* Panel 3: emails */
.aim-mail { background: #fff; border: 1px solid #e6eaf0; border-radius: 10px; margin-bottom: 14px; overflow: hidden;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
.aim-mail.out { border-left: 3px solid var(--primary); }
.aim-mail.out.ai { border-left-color: var(--primary2); }
.aim-mail.failed { border-color: #f5c2c7; border-left: 3px solid #dc3545; }
.aim-mail-head { padding: 12px 16px 10px; border-bottom: 1px solid #f0f2f6; }
.aim-mail-subject { font-size: 15px; font-weight: 600; color: #1f2933; margin: 0 0 8px; word-break: break-word; line-height: 1.3; }
.aim-mail-line { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.6; min-width: 0; }
.aim-mail-line .k { color: #8a94a3; width: 34px; flex-shrink: 0; }
.aim-mail-line .v { color: #3b4656; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aim-mail-line .v small { color: #8a94a3; }
.aim-mail-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; font-size: 11.5px; color: #8a94a3; }
.aim-dir { font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 8px; letter-spacing: .02em; }
.aim-dir.in { background: #e8f5e9; color: #1b6e2e; border: 1px solid #b7dfbd; }
.aim-dir.out { background: #eef1f5; color: #4a5565; border: 1px solid #d9dfe7; }
.aim-mail-body { padding: 14px 16px; font-size: 14px; line-height: 1.55; color: #1f2933; overflow-wrap: anywhere; }
.aim-mail-body.clamped { max-height: 340px; overflow: hidden; position: relative; }
.aim-mail-body.clamped::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 64px;
  background: linear-gradient(rgba(255,255,255,0), #fff); pointer-events: none; }
.aim-mail-p { margin: 0 0 12px; }
.aim-mail-p:last-child { margin-bottom: 0; }
.aim-mail-body a { color: #0b66c3; }
.aim-mail-frame { width: 100%; border: 0; display: block; background: transparent; }
.aim-mail-more { display: block; width: 100%; border: 0; border-top: 1px solid #f0f2f6; background: #fafbfd; color: #0b66c3;
  font-size: 12.5px; font-weight: 600; padding: 7px; }
.aim-mail-more:hover { background: #f1f5fa; }
.aim-mail-files { padding: 0 16px 14px; display: flex; flex-wrap: wrap; gap: 8px; }
.aim-mail-files img { max-width: 160px; max-height: 120px; border-radius: 6px; border: 1px solid #e6eaf0; display: block; }
.aim-file { font-size: 12.5px; border: 1px solid #e6eaf0; border-radius: 6px; padding: 4px 10px; background: #fafbfd; text-decoration: none; }
.aim-quote-toggle { border: 1px solid #d9dfe7; background: #f4f6f9; color: #5b6676; border-radius: 6px; font-size: 12px;
  padding: 1px 10px; margin: 8px 0 0; }
.aim-quote-toggle:hover { background: #e9edf2; }
.aim-quote { margin-top: 8px; padding-left: 12px; border-left: 3px solid #d5dbe3; color: #5b6676; }

.aim-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #8a94a3; background: #f7f9fc; }

/* Medium screens: contacts + one conversation panel at a time, switched by tabs */
@media (max-width: 1399px) {
  .aim-tabs { display: flex; background: #fff; border-bottom: 1px solid #e6eaf0; }
  .aim-tab { flex: 1; border: 0; background: none; padding: 9px 8px; font-size: 13px; font-weight: 600; color: #6c757d;
    border-bottom: 2px solid transparent; }
  .aim-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
  .aim-pane-head { display: none; }
  .aim-panels[data-pane="sms"] .aim-pane.mail,
  .aim-panels[data-pane="email"] .aim-pane.sms { display: none; }
  .aim-pane + .aim-pane { border-left: 0; }
}
/* Small screens: one panel at a time (contacts, then the conversation) */
@media (max-width: 991px) {
  .aim-list { width: 100%; border-right: 0; }
  .aim-shell.has-open .aim-list { display: none; }
  .aim-shell:not(.has-open) .aim-main { display: none; }
  .aim-msgcol { max-width: 92%; }
}
`;

const initials = (name, phone) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0][0] + (words[1]?.[0] || "")).toUpperCase();
  return phone ? "#" : "?";
};

const dayLabel = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

const timeLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

function senderLabel(m, leadName) {
  if (m.direction === "inbound") return leadName || m.from || "Customer";
  if (m.ai) return null;
  return m.staff || "Auto-reply";
}

// "Jane Doe <jane@x.com>" -> { name: "Jane Doe", address: "jane@x.com" }
function parseAddress(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), address: m[2].trim() };
  return { name: "", address: raw };
}

function Person({ value }) {
  const { name, address } = parseAddress(value);
  if (!address && !name) return <span className="v">Unknown</span>;
  return (
    <span className="v" title={address}>
      {name ? <>{name} <small>&lt;{address}&gt;</small></> : address}
    </span>
  );
}

function Attachments({ media }) {
  if (!media.length) return null;
  return media.map((a) => (a.type.startsWith("image/") || !a.type
    ? <a key={a.url} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name || "Attachment"} /></a>
    : <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="aim-file">
        <i className="fa-regular fa-paperclip me-1" />{a.name || "Attachment"}
      </a>));
}

function EmailCard({ mail, leadName }) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef(null);
  const [tall, setTall] = useState(false);
  const out = mail.direction === "outbound";
  const failed = mail.status === "failed";
  const who = senderLabel(mail, leadName);
  const images = mail.media.filter((a) => a.type.startsWith("image/") || !a.type);
  const files = mail.media.filter((a) => !(a.type.startsWith("image/") || !a.type));

  // Fold very long emails; measured after the (possibly framed) body has laid out.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => setTall(el.scrollHeight > 360);
    measure();
    const frame = el.querySelector("iframe");
    frame?.addEventListener("load", measure);
    const timer = setTimeout(measure, 400);
    return () => { frame?.removeEventListener("load", measure); clearTimeout(timer); };
  }, [mail.body]);

  return (
    <article className={`aim-mail ${out ? "out" : "in"} ${mail.ai ? "ai" : ""} ${failed ? "failed" : ""}`}>
      <header className="aim-mail-head">
        <h4 className="aim-mail-subject">{mail.subject || "(no subject)"}</h4>
        <div className="aim-mail-line"><span className="k">From</span><Person value={mail.from} /></div>
        <div className="aim-mail-line"><span className="k">To</span><Person value={mail.to} /></div>
        <div className="aim-mail-badges">
          <span className={`aim-dir ${out ? "out" : "in"}`}>{out ? "SENT" : "RECEIVED"}</span>
          {mail.ai && <span className="aim-ai-tag"><i className="fa-regular fa-message-bot me-1" />AI</span>}
          {who && out && <span>{who}</span>}
          <span title={formatDateTime(mail.at)}><i className="fa-regular fa-clock me-1" />{formatDateTime(mail.at)}</span>
          {failed && <span className="text-danger"><i className="fa-solid fa-circle-exclamation me-1" />Not delivered</span>}
        </div>
      </header>
      <div ref={bodyRef} className={`aim-mail-body ${tall && !expanded ? "clamped" : ""}`}>
        <EmailBody body={mail.body} />
      </div>
      {tall && (
        <button type="button" className="aim-mail-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show full email"}
        </button>
      )}
      {(images.length > 0 || files.length > 0) && (
        <div className="aim-mail-files pt-2"><Attachments media={[...images, ...files]} /></div>
      )}
    </article>
  );
}

function MessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("lead");

  const [threads, setThreads] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");

  const [chat, setChat] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pane, setPane] = useState("sms"); // which conversation panel shows on narrower screens
  const smsRef = useRef(null);
  const mailRef = useRef(null);
  const lastCountRef = useRef({ sms: 0, email: 0 });

  const loadThreads = useCallback(async (quiet = false) => {
    if (!quiet) setListLoading(true);
    setListError("");
    try {
      const data = await aiFetch("/api/dealer-ai/messages");
      setThreads(data.threads || []);
    } catch (err) {
      setListError(err.message);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadChat = useCallback(async (leadId, quiet = false) => {
    if (!leadId) return;
    if (!quiet) setChatLoading(true);
    setChatError("");
    try {
      const data = await aiFetch(`/api/dealer-ai/messages/${leadId}`);
      setChat(data);
    } catch (err) {
      setChatError(err.message);
      if (!quiet) setChat(null);
    } finally {
      setChatLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    lastCountRef.current = { sms: 0, email: 0 };
    setChat(null);
    loadChat(openId);
  }, [openId, loadChat]);

  // Open on whichever channel the customer most recently used.
  const openThreadChannel = threads.find((t) => t.lead_id === openId)?.last_channel;
  useEffect(() => {
    if (openThreadChannel) setPane(openThreadChannel === "email" ? "email" : "sms");
  }, [openId, openThreadChannel]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadThreads(true);
      if (openId) loadChat(openId, true);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [openId, loadThreads, loadChat]);

  // Scroll each panel to its newest item when a conversation opens or something new arrives.
  useEffect(() => {
    const counts = { sms: chat?.messages?.length || 0, email: chat?.emails?.length || 0 };
    const refs = { sms: smsRef, email: mailRef };
    for (const key of ["sms", "email"]) {
      const el = refs[key].current;
      if (counts[key] !== lastCountRef.current[key] && el) el.scrollTop = el.scrollHeight;
    }
    lastCountRef.current = counts;
  }, [chat, pane]);

  const openThread = (leadId) => router.push(`/dealer/ai/messages?lead=${leadId}`, { scroll: false });
  const closeThread = () => router.push("/dealer/ai/messages", { scroll: false });

  const q = search.trim().toLowerCase();
  const shown = q
    ? threads.filter((t) => [t.name, t.phone, t.email, t.vehicle, t.last_text].some((v) => v && String(v).toLowerCase().includes(q)))
    : threads;
  const current = threads.find((t) => t.lead_id === openId);
  const leadName = chat?.lead?.name || current?.name;
  const leadPhone = chat?.lead?.phone || current?.phone;
  const leadEmail = chat?.lead?.email || current?.email;
  const smsCount = chat?.messages?.length ?? current?.sms_count ?? 0;
  const emailCount = chat?.emails?.length ?? current?.email_count ?? 0;

  const spinner = <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>;
  let lastDay = "";
  return (
    <div className="page_content">
      <style>{css}</style>
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0 me-auto">AI Messages</h3>
              <Button variant="outline-custom" size="sm" disabled={listLoading}
                onClick={() => { loadThreads(); if (openId) loadChat(openId); }}>
                <i className={`fa-solid fa-rotate-right me-1 ${listLoading ? "fa-spin" : ""}`} />Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {listError && <Alert variant="danger">{listError}</Alert>}

        <div className={`w_card aim-shell ${openId ? "has-open" : ""}`}>
          {/* Panel 1: contacts */}
          <div className="aim-list">
            <div className="p-2 border-bottom">
              <InputGroup size="sm">
                <InputGroup.Text><i className="fa-regular fa-magnifying-glass" /></InputGroup.Text>
                <Form.Control placeholder="Search name, phone, email or message" value={search}
                  onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
              </InputGroup>
            </div>
            <div className="aim-list-scroll">
              {listLoading && !threads.length ? spinner : !shown.length ? (
                <p className="text-secondary-light text-center py-4 mb-0">
                  {q ? "No contacts match your search." : "No text or email conversations yet."}
                </p>
              ) : shown.map((t) => (
                <div key={t.lead_id} className={`aim-thread ${t.lead_id === openId ? "active" : ""}`}
                  role="button" tabIndex={0} onClick={() => openThread(t.lead_id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openThread(t.lead_id); } }}>
                  <div className="aim-avatar">{initials(t.name, t.phone)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="d-flex align-items-center gap-1">
                      <strong className="text-truncate me-auto">{t.name || t.phone || t.email || "Unknown customer"}</strong>
                      <small className="text-secondary-light text-nowrap" title={formatDateTime(t.last_at)}>
                        {fromNow(t.last_at)}
                      </small>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      <div className="aim-preview me-auto">
                        <i className={`fa-regular ${t.last_channel === "email" ? "fa-envelope" : "fa-comment"} me-1`} />
                        {t.last_direction === "outbound" && (t.last_ai ? "AI: " : "You: ")}{t.last_text}
                      </div>
                      {t.unread > 0 && <Badge pill bg="danger">{t.unread}</Badge>}
                    </div>
                    <div className="aim-chan">
                      {t.sms_count > 0 && <span title="Text messages"><i className="fa-regular fa-comment" />{t.sms_count}</span>}
                      {t.email_count > 0 && <span title="Emails"><i className="fa-regular fa-envelope" />{t.email_count}</span>}
                      {t.name && t.phone && <span className="text-truncate">{t.phone}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Panels 2 and 3: the open customer's messages and emails */}
          <div className="aim-main">
            {!openId ? (
              <div className="aim-empty">
                <i className="fa-regular fa-messages fa-2x mb-2" />
                <span>Select a contact to read their messages and emails.</span>
              </div>
            ) : (
              <>
                <div className="aim-chat-head">
                  <Button variant="link" className="d-lg-none p-0 me-1" onClick={closeThread} aria-label="Back to contacts">
                    <i className="fa-solid fa-arrow-left" />
                  </Button>
                  <div className="aim-avatar">{initials(leadName, leadPhone)}</div>
                  <div className="me-auto" style={{ minWidth: 0 }}>
                    <strong className="d-block text-truncate">{leadName || leadPhone || leadEmail || "Unknown customer"}</strong>
                    <small className="text-secondary-light d-block text-truncate">
                      {[leadPhone, leadEmail, chat?.lead?.vehicle].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <div className="d-flex flex-wrap gap-1">
                    <Button size="sm" variant="outline-secondary" onClick={() => setDrawerOpen(true)}>AI details</Button>
                    <Button size="sm" variant="outline-custom" as={Link} href={leadHref(openId)}>Open lead</Button>
                  </div>
                </div>

                <div className="aim-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={pane === "sms"} className={`aim-tab ${pane === "sms" ? "active" : ""}`}
                    onClick={() => setPane("sms")}><i className="fa-regular fa-comment me-1" />Messages ({smsCount})</button>
                  <button type="button" role="tab" aria-selected={pane === "email"} className={`aim-tab ${pane === "email" ? "active" : ""}`}
                    onClick={() => setPane("email")}><i className="fa-regular fa-envelope me-1" />Emails ({emailCount})</button>
                </div>

                <div className="aim-panels" data-pane={pane}>
                  {/* Panel 2: texts */}
                  <section className="aim-pane sms" aria-label="Messages">
                    <div className="aim-pane-head">
                      <i className="fa-regular fa-comment" />Messages<span className="count">{smsCount}</span>
                    </div>
                    <div className="aim-pane-body" ref={smsRef}>
                      {chatError && <Alert variant="danger">{chatError}</Alert>}
                      {chatLoading && !chat ? spinner : !chat?.messages?.length ? (
                        !chatError && (
                          <div className="aim-pane-empty"><i className="fa-regular fa-comment" />No text messages with this contact.</div>
                        )
                      ) : chat.messages.map((m) => {
                        const day = dayLabel(m.at);
                        const showDay = day !== lastDay;
                        lastDay = day;
                        const out = m.direction === "outbound";
                        const failed = m.status === "failed";
                        const who = senderLabel(m, leadName);
                        return (
                          <div key={m.id}>
                            {showDay && <div className="aim-day"><span>{day}</span></div>}
                            <div className={`aim-row ${out ? "out" : "in"} ${m.ai ? "ai" : ""} ${failed ? "failed" : ""}`}>
                              <div className="aim-msgcol">
                                <div className="aim-bubble">
                                  {m.text}
                                  {m.media.length > 0 && <div className="aim-media"><Attachments media={m.media} /></div>}
                                </div>
                                <div className="aim-meta">
                                  {m.ai && <span className="aim-ai-tag"><i className="fa-regular fa-message-bot me-1" />AI</span>}
                                  {who && <span>{who}</span>}
                                  <span title={formatDateTime(m.at)}>{timeLabel(m.at)}</span>
                                  {failed && <span className="text-danger"><i className="fa-solid fa-circle-exclamation me-1" />Not delivered</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Panel 3: emails */}
                  <section className="aim-pane mail" aria-label="Emails">
                    <div className="aim-pane-head">
                      <i className="fa-regular fa-envelope" />Emails<span className="count">{emailCount}</span>
                    </div>
                    <div className="aim-pane-body" ref={mailRef}>
                      {chatLoading && !chat ? spinner : !chat?.emails?.length ? (
                        !chatError && (
                          <div className="aim-pane-empty"><i className="fa-regular fa-envelope" />No emails with this contact.</div>
                        )
                      ) : chat.emails.map((mail) => <EmailCard key={mail.id} mail={mail} leadName={leadName} />)}
                    </div>
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <LeadAiDrawer
        show={drawerOpen}
        onHide={() => setDrawerOpen(false)}
        leadId={openId}
        title={leadName || "Lead"}
      />
    </div>
  );
}

export default function AiMessagesPage() {
  return (
    <Suspense fallback={
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: "300px" }}>
          <div className="spinner-border text-dark" role="status"><span className="visually-hidden">Loading...</span></div>
        </div>
      </div>
    }>
      <MessagesContent />
    </Suspense>
  );
}
