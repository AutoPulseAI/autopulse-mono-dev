"use client";
// AI Messages: every customer we're texting with, and the conversation itself -
// what came in through Twilio and what went out, with the AI's messages tagged.
//   /dealer/ai/messages              the inbox
//   /dealer/ai/messages?lead=<id>    one conversation open

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Form, InputGroup, Spinner } from "react-bootstrap";
import LeadAiDrawer from "../components/LeadAiDrawer";
import { aiFetch, formatDateTime, fromNow, leadHref } from "../components/aiShared";

const REFRESH_MS = 20_000;

const css = `
.aim-shell { display: flex; height: calc(100vh - 210px); min-height: 480px; padding: 0; overflow: hidden; }
.aim-list { width: 340px; flex-shrink: 0; border-right: 1px solid #e6eaf0; display: flex; flex-direction: column; }
.aim-list-scroll { overflow-y: auto; flex: 1; }
.aim-thread { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #f0f2f6; cursor: pointer; }
.aim-thread:hover { background: #f7f9fc; }
.aim-thread.active { background: #eaf3fa; border-left: 3px solid var(--primary); padding-left: 11px; }
.aim-avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0; }
.aim-preview { color: #6c757d; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aim-chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.aim-chat-head { padding: 12px 16px; border-bottom: 1px solid #e6eaf0; display: flex; align-items: center; gap: 10px; }
.aim-chat-body { flex: 1; overflow-y: auto; padding: 16px; background: #f7f9fc; }
.aim-day { text-align: center; margin: 14px 0 10px; }
.aim-day span { background: #e6eaf0; color: #5b6676; font-size: 12px; padding: 2px 10px; border-radius: 10px; }
.aim-row { display: flex; margin-bottom: 10px; }
.aim-row.out { justify-content: flex-end; }
.aim-bubble { max-width: 70%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
.aim-row.in .aim-bubble { background: #fff; border: 1px solid #e6eaf0; border-bottom-left-radius: 3px; }
.aim-row.out .aim-bubble { background: var(--primary); color: #fff; border-bottom-right-radius: 3px; }
.aim-row.out.ai .aim-bubble { background: var(--primary2); }
.aim-row.out.failed .aim-bubble { background: #fdecea; color: #842029; border: 1px solid #f5c2c7; }
.aim-meta { font-size: 11px; color: #8a94a3; margin-top: 3px; display: flex; gap: 6px; align-items: center; }
.aim-row.out .aim-meta { justify-content: flex-end; }
.aim-ai-tag { background: #e7f1ff; color: var(--primary2); border: 1px solid #b6d4fe; font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 8px; }
.aim-media img { max-width: 220px; max-height: 220px; border-radius: 8px; margin-top: 6px; display: block; }
.aim-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #8a94a3; }
@media (max-width: 991px) {
  .aim-list { width: 100%; border-right: 0; }
  .aim-shell.has-open .aim-list { display: none; }
  .aim-shell:not(.has-open) .aim-chat { display: none; }
  .aim-bubble { max-width: 85%; }
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
  const bodyRef = useRef(null);
  const lastCountRef = useRef(0);

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
    lastCountRef.current = 0;
    setChat(null);
    loadChat(openId);
  }, [openId, loadChat]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadThreads(true);
      if (openId) loadChat(openId, true);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [openId, loadThreads, loadChat]);

  // Scroll to the newest message when a conversation opens or a new one arrives.
  useEffect(() => {
    const count = chat?.messages?.length || 0;
    if (count !== lastCountRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
    lastCountRef.current = count;
  }, [chat]);

  const openThread = (leadId) => router.push(`/dealer/ai/messages?lead=${leadId}`, { scroll: false });
  const closeThread = () => router.push("/dealer/ai/messages", { scroll: false });

  const q = search.trim().toLowerCase();
  const shown = q
    ? threads.filter((t) => [t.name, t.phone, t.vehicle, t.last_text].some((v) => v && String(v).toLowerCase().includes(q)))
    : threads;
  const current = threads.find((t) => t.lead_id === openId);
  const leadName = chat?.lead?.name || current?.name;
  const leadPhone = chat?.lead?.phone || current?.phone;

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
          <div className="aim-list">
            <div className="p-2 border-bottom">
              <InputGroup size="sm">
                <InputGroup.Text><i className="fa-regular fa-magnifying-glass" /></InputGroup.Text>
                <Form.Control placeholder="Search name, phone or message" value={search}
                  onChange={(e) => setSearch(e.target.value)} />
              </InputGroup>
            </div>
            <div className="aim-list-scroll">
              {listLoading && !threads.length ? (
                <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>
              ) : !shown.length ? (
                <p className="text-secondary-light text-center py-4 mb-0">
                  {q ? "No conversations match your search." : "No text conversations yet."}
                </p>
              ) : shown.map((t) => (
                <div key={t.lead_id} className={`aim-thread ${t.lead_id === openId ? "active" : ""}`}
                  onClick={() => openThread(t.lead_id)}>
                  <div className="aim-avatar">{initials(t.name, t.phone)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="d-flex align-items-center gap-1">
                      <strong className="text-truncate me-auto">{t.name || t.phone || "Unknown customer"}</strong>
                      <small className="text-secondary-light text-nowrap" title={formatDateTime(t.last_at)}>
                        {fromNow(t.last_at)}
                      </small>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      <div className="aim-preview me-auto">
                        {t.last_direction === "outbound" && (t.last_ai ? "AI: " : "You: ")}{t.last_text}
                      </div>
                      {t.unread > 0 && <Badge pill bg="danger">{t.unread}</Badge>}
                    </div>
                    {t.name && t.phone && <small className="text-secondary-light">{t.phone}</small>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="aim-chat">
            {!openId ? (
              <div className="aim-empty">
                <i className="fa-regular fa-messages fa-2x mb-2" />
                <span>Select a conversation to read it.</span>
              </div>
            ) : (
              <>
                <div className="aim-chat-head">
                  <Button variant="link" className="d-lg-none p-0 me-1" onClick={closeThread} aria-label="Back">
                    <i className="fa-solid fa-arrow-left" />
                  </Button>
                  <div className="aim-avatar">{initials(leadName, leadPhone)}</div>
                  <div className="me-auto" style={{ minWidth: 0 }}>
                    <strong className="d-block text-truncate">{leadName || leadPhone || "Unknown customer"}</strong>
                    <small className="text-secondary-light">
                      {[leadPhone, chat?.lead?.vehicle].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <div className="d-flex flex-wrap gap-1">
                    <Button size="sm" variant="outline-secondary" onClick={() => setDrawerOpen(true)}>AI details</Button>
                    <Button size="sm" variant="outline-custom" as={Link} href={leadHref(openId)}>Open lead</Button>
                  </div>
                </div>

                <div className="aim-chat-body" ref={bodyRef}>
                  {chatError && <Alert variant="danger">{chatError}</Alert>}
                  {chatLoading && !chat ? (
                    <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>
                  ) : !chat?.messages?.length ? (
                    !chatError && <p className="text-secondary-light text-center py-4 mb-0">No text messages on this lead.</p>
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
                          <div style={{ maxWidth: "100%", display: "flex", flexDirection: "column", alignItems: out ? "flex-end" : "flex-start" }}>
                            <div className="aim-bubble">
                              {m.text}
                              {m.media.length > 0 && (
                                <div className="aim-media">
                                  {m.media.map((a) => (a.type.startsWith("image/") || !a.type
                                    ? <a key={a.url} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="Attachment" /></a>
                                    : <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="d-block mt-1">Attachment</a>))}
                                </div>
                              )}
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
