"use client";

import { useEffect, useState, useMemo } from "react";
import { Modal, Button, Form, Alert, Spinner, Card } from "react-bootstrap";
import { AGENT_VIEW_LANGUAGES } from "../utils/agentViewLanguages.js";
import { fetchAgentLanguageOptions } from "../utils/conversationTranslation.js";

const MAX_INTENT_LENGTH = 500;
const DRAFT_API = "/api/conversations/lead/draft";
const LATEST_CONVERSATIONS_COUNT = 4;

function toLanguageOptions(names) {
  return names.map((name) => ({ value: name, label: name }));
}

const LANGUAGE_OPTIONS = toLanguageOptions(AGENT_VIEW_LANGUAGES);

/** Format a single conversation message for display (exclude notes) */
function formatMessageForDisplay(msg) {
  const isIn = msg.status === "incoming" || msg.status === "received";
  const date = msg.timestamp || msg.date;
  const dateStr = date
    ? new Date(date).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const body = (msg.mail_content || msg.body || msg.subject || "").trim();
  const snippet = body.length > 120 ? body.slice(0, 120) + "…" : body;
  const dir = isIn ? <i className="fa-regular fa-arrow-down text-warning"></i> : <i className="fa-regular fa-arrow-up text-success"></i>;
  const subjectLine =
    msg.subject && msg.communication_type === "email"
      ? `Subject: ${msg.subject}\n`
      : "";
  return { dateStr, dir, subjectLine, snippet };
}

export default function WriteWithAIModal({
  show,
  onHide,
  leadId,
  channel,
  onDraftReady,
  dealerId,
  conversationThread = [],
  defaultLanguage,
  lockLanguage = false,
}) {
  const AGENT_VIEW_LANGUAGE_STORAGE_KEY = "dealer_agent_view_language";
  const [intent, setIntent] = useState("");
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [language, setLanguage] = useState("English");
  const [languageOptions, setLanguageOptions] = useState(LANGUAGE_OPTIONS);

  const isEmail = channel === "email";

  const latestConversations = useMemo(() => {
    if (!Array.isArray(conversationThread) || conversationThread.length === 0)
      return [];
    const nonNotes = conversationThread.filter(
      (m) => !m.is_note && (m.mail_content || m.subject || m.body)
    );
    return nonNotes.slice(-LATEST_CONVERSATIONS_COUNT).map(formatMessageForDisplay);
  }, [conversationThread]);

  const hasContext = latestConversations.length > 0;

  useEffect(() => {
    let ignore = false;
    (async () => {
      const langs = await fetchAgentLanguageOptions();
      if (!ignore && langs.length > 0) {
        setLanguageOptions(toLanguageOptions(langs));
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!show) return;
    try {
      const saved = localStorage.getItem(AGENT_VIEW_LANGUAGE_STORAGE_KEY);
      const next =
        (defaultLanguage && languageOptions.some((o) => o.value === defaultLanguage)
          ? defaultLanguage
          : null) ||
        (saved && languageOptions.some((o) => o.value === saved) ? saved : null) ||
        "English";
      setLanguage(next);
    } catch {
      if (defaultLanguage) setLanguage(defaultLanguage);
    }
  }, [show, defaultLanguage, languageOptions]);

  const handleGenerate = async () => {
    if (!leadId || !channel) return;
    setError("");
    setWarning("");
    setLoading(true);
    try {
      const token = localStorage.getItem("dealertoken");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(DRAFT_API, {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead_id: leadId,
          channel,
          intent: intent.slice(0, MAX_INTENT_LENGTH),
          language: language || "English",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to generate draft. Please try again.");
        setDraft("");
        setSubject("");
        return;
      }

      setDraft(data.draft || "");
      if (isEmail && data.subject != null) {
        setSubject(data.subject);
      } else if (isEmail) {
        setSubject("");
      }
      if (data.warning) setWarning(data.warning);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setDraft("");
      setSubject("");
    } finally {
      setLoading(false);
    }
  };

  const handleUseDraft = () => {
    onDraftReady(draft.trim(), isEmail ? subject.trim() : undefined);
    setDraft("");
    setSubject("");
    setIntent("");
    setError("");
    setWarning("");
    onHide();
  };

  const handleClose = () => {
    setDraft("");
    setSubject("");
    setIntent("");
    setError("");
    setWarning("");
    onHide();
  };

  const channelLabel =
    channel === "sms" ? "SMS" : channel === "email" ? "Email" : "Notes";
  const actionButtonLabel =
    channel === "note" ? "Save Notes" : `Use this draft`;

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Write with AI</Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg_gray">
        {error && <Alert variant="danger">{error}</Alert>}
        {warning && <Alert variant="warning">{warning}</Alert>}

        {/* Language selection */}
        <Form.Group className="mb-2 d-flex align-items-center justify-content-between">
          <Form.Label className="d-flex align-items-center gap-1 text-dark">            
            <span className="text-custom">
              <i className="fa-regular fa-globe"></i>
            </span>Your chosen language is:
          </Form.Label>
          <input
            type="text"
            className="form-control form-control-sm border-0 text-center"
            value={language}
            disabled
            style={{ width: "150px", backgroundColor: "#eef2f7", boxShadow: "inset 0 0 0 1px #dce3ee", color: "#1f2a37", opacity: 1 }}
          />

          {/* <Form.Select
            size="sm"
            value={language}
            disabled={lockLanguage}
            className="w-auto"
          >
            {languageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Form.Select> */}
        </Form.Group>

        {/* Conversation context */}
        <div className="mb-3">
          <p className="mb-2"><b>{hasContext ? "Conversation Context" : "No Conversation Context"}</b></p>
          {hasContext ? (
            <Card className="bg-light">
              <Card.Body className="p-2 scroll_bx">
                <ul className="mb-0 ps-3 small">
                  {latestConversations.map((item, idx) => (
                    <li key={idx} className="mb-2">
                      <p className="d-flex align-items-center justify-content-between mb-1">
                        {item.subjectLine && (
                          <span className="d-inline-block fw-bold"> 
                            {item.subjectLine.trim()}
                          </span>
                        )}
                        <span className="text-nowrap">
                          <span className="text-muted">{item.dateStr}</span>{" "}{item.dir}
                        </span>
                      </p>
                      <span className="d-block">{item.snippet}</span>
                    </li>
                  ))}
                </ul>
              </Card.Body>
            </Card>
          ) : (
            <p className="text-muted small mb-0">
              The AI does not have any prior conversation context to refer to.
            </p>
          )}
        </div>

                {/* Message type */}
        <Form.Group className="mb-3 gap-2 d-flex align-items-center">
          <Form.Label className="mb-0">Message Type:</Form.Label>
          <div className="d-flex gap-1 flex-wrap">
            {["Notes", "Email", "SMS"].map((type) => {
              const value = type === "Notes" ? "note" : type.toLowerCase();
              const isActive =
                (value === "note" && channel === "note") ||
                (value === "email" && channel === "email") ||
                (value === "sms" && channel === "sms");
              return (
                <Button
                  key={value}
                  variant={isActive ? "custom" : "outline-secondary"}
                  size="sm"
                  disabled
                  className="text-nowrap opacity-100"
                >
                  {type}
                </Button>
              );
            })}
          </div>
          {/* <Form.Text className="text-muted small d-block mt-1">
            Generating for: <strong>{channelLabel}</strong>
          </Form.Text> */}
        </Form.Group>

        {/* Prompt to the AI */}
        <Form.Group className="mb-2">
          <p className="mb-1"><b>Prompt to the AI</b></p>
          <Form.Text className="d-block text-muted small mb-1">
            Enter your prompt to guide brainstorming:
          </Form.Text>
          <Form.Control
            as="textarea"
            rows={2}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. Note down service pricing ideas that make us competitive"
            maxLength={MAX_INTENT_LENGTH}
          />          
        </Form.Group>

        <div className="mb-3 d-flex justify-content-between gap-2">
          <Form.Text className="text-muted mt-0">
            {intent.length}/{MAX_INTENT_LENGTH} characters
          </Form.Text>
          <Button variant="custom" onClick={handleGenerate} disabled={loading}>
            {loading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Generating...
              </>
            ) : draft ? (
              "Regenerate"
            ) : (
              "Generate Draft"
            )}
          </Button>
        </div>

        {/* AI Generated Ideas */}
        {draft && (
          <>
            <Form.Group className="mb-2">
              <p className="mb-2"><b>AI Generated Ideas</b></p>
              {isEmail && (
                <Form.Group className="d-flex align-items-center gap-2 mb-2">
                  <Form.Label className="small mb-0">Subject:</Form.Label>
                  <Form.Control
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject line"
                  />
                </Form.Group>
              )}
              <Form.Control
                as="textarea"
                rows={8}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Draft will appear here"
              />
            </Form.Group>
            <Button variant="custom" onClick={handleUseDraft}>
              {actionButtonLabel}
            </Button>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
