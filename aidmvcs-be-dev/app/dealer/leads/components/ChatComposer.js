"use client";
// The message box at the bottom of the conversation, like every chat app (the user, 27 Nov 2026: "there must be a plus
// icon ... same as ChatGPT ... also has an attach file option"). Type and send; the + opens everything else: attach a
// photo or file, attach a car (photos and facts), send a dealer link, a template, Write with AI, add a note, call,
// update the status. Sends through POST /api/conversations/reply (the customer's language, opt-outs and the
// dealership's checks all apply there). Enter sends a text; Shift+Enter is a new line.
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Form, Spinner } from "react-bootstrap";
import VehicleCard from "./VehicleCard";
import WriteWithAIModal from "../../components/WriteWithAIModal";
import CallButton from "../../components/CallButton";
import { useUser } from "../../context/UserContext";
import { dealerLinksView, DEALER_LINKS } from "../../../lib/ai/dealerLinks";
import { MAX_STAFF_PHOTOS } from "../../../lib/staffMedia";

const auth = () => {
  const t = localStorage.getItem("dealertoken");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function ChatComposer({ lead, channel, onChannel, canText, canEmail, latestOf, onSent, thread = [],
  leadUserLanguage = "English", onAddNote, onUpdateStatus, onCheckIn, showCall = true, disabledReason = null }) {
  const { dealerParent } = useUser() || {};
  const dealerId = lead?.dealer_id;
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [files, setFiles] = useState([]); // [{ url, name, type }] - photos / files to send
  const [carPhotos, setCarPhotos] = useState([]);
  const [car, setCar] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'menu' | 'car' | 'links' | 'templates'
  const [carQuery, setCarQuery] = useState("");
  const [cars, setCars] = useState([]);
  const [busy, setBusy] = useState(null); // 'send' | 'upload' | 'cars'
  const [error, setError] = useState("");
  const [sentNote, setSentNote] = useState("");
  const [templates, setTemplates] = useState([]);
  const [showAI, setShowAI] = useState(false);
  const fileRef = useRef(null);
  const boxRef = useRef(null);

  const latest = latestOf(channel);
  const links = DEALER_LINKS.map((l) => ({ ...l, url: dealerLinksView(dealerParent)[l.key] })).filter((l) => l.url);
  const media = [...files.map((f) => f.url), ...carPhotos].slice(0, MAX_STAFF_PHOTOS);

  useEffect(() => { setSubject(latest?.subject ? `Re: ${String(latest.subject).replace(/^Re:\s*/i, "")}` : ""); },
    [latest?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dealerId) return;
    fetch(`/api/campaign-templates?dealer_id=${dealerId}&message_type=${channel === "sms" ? "sms" : "email"}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setTemplates(d?.data || [])).catch(() => setTemplates([]));
  }, [dealerId, channel]);
  // The box grows with the text, up to about eight lines.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const addLine = (line) => setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${line}` : line));
  const fill = (s) => String(s || "")
    .replace(/\{\{\s*(first_name|firstname)\s*\}\}/gi, String(lead?.name || "").trim().split(/\s+/)[0] || "")
    .replace(/\{\{\s*(name|customer_name)\s*\}\}/gi, String(lead?.name || "").trim());
  const applyTemplate = (t) => {
    const body = channel === "email" ? fill(t.body) : fill(t.body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    setText(body);
    if (channel === "email" && t.subject) setSubject(fill(t.subject));
    setPanel(null);
  };

  const upload = async (list) => {
    setBusy("upload"); setError("");
    try {
      for (const file of [...list].slice(0, MAX_STAFF_PHOTOS - media.length)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("type", "staff-reply");
        const res = await fetch("/api/upload/file", { method: "POST", headers: auth(), body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url) throw new Error(body.error || `Could not attach ${file.name}`);
        setFiles((prev) => [...prev, { url: body.url, name: file.name, type: file.type }]);
      }
    } catch (e) { setError(e.message); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const findCars = async () => {
    setBusy("cars");
    try {
      const q = carQuery.trim() ? `&search=${encodeURIComponent(carQuery.trim())}` : "";
      const res = await fetch(`/api/vehicles?dealer_id=${dealerId}&page=1&limit=10${q}`, { headers: auth() });
      const body = await res.json().catch(() => ({}));
      setCars(body.data || []);
    } catch { setCars([]); } finally { setBusy(null); }
  };
  useEffect(() => { if (panel === "car" && !cars.length) findCars(); }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!text.trim()) { setError("Type a message first."); return; }
    if (channel === "email" && !subject.trim()) { setError("An email needs a subject."); return; }
    setBusy("send"); setError("");
    try {
      const res = await fetch("/api/conversations/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth() },
        body: JSON.stringify({
          dealerId, leadId: lead._id, parent_message_id: latest?.message_id, content: text, communicationType: channel,
          recipient: latest?.sender, originalMessage: latest?.mail_content || latest?.sms_content,
          ...(channel === "email" ? { subject } : {}), ...(media.length ? { media_urls: media } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "The message was not sent.");
      setText(""); setFiles([]); setCarPhotos([]); setCar(null); setPanel(null);
      setSentNote(channel === "sms" ? "Text sent" : "Email sent");
      setTimeout(() => setSentNote(""), 3000);
      onSent?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const channelOk = channel === "sms" ? canText : canEmail;
  const MenuItem = ({ icon, label, onClick, disabled }) => (
    <button type="button" className="chat_menu_item" onClick={onClick} disabled={disabled}>
      <i className={`fa-regular ${icon}`} aria-hidden="true"></i><span>{label}</span>
    </button>
  );

  return (
    <div className="chat_composer" data-testid="chat-composer">
      {error && <Alert variant="danger" className="py-1 px-2 small mb-2" dismissible onClose={() => setError("")}>{error}</Alert>}
      {sentNote && <div className="small text-success mb-1"><i className="fa-solid fa-check me-1"></i>{sentNote}</div>}

      {panel === "menu" && (
        <div className="chat_menu" role="menu">
          <MenuItem icon="fa-paperclip" label="Attach photo or file" onClick={() => { setPanel(null); fileRef.current?.click(); }}
            disabled={media.length >= MAX_STAFF_PHOTOS} />
          <MenuItem icon="fa-car" label="Attach a car (photos, miles, price...)" onClick={() => setPanel("car")} />
          {links.length > 0 && <MenuItem icon="fa-link" label="Send a link (credit application...)" onClick={() => setPanel("links")} />}
          {templates.length > 0 && <MenuItem icon="fa-file-lines" label="Template" onClick={() => setPanel("templates")} />}
          <MenuItem icon="fa-wand-magic-sparkles" label="Write with AI" onClick={() => { setPanel(null); setShowAI(true); }} />
          {(onAddNote || showCall || onUpdateStatus || onCheckIn) && <div className="chat_menu_sep" />}
          {onAddNote && <MenuItem icon="fa-note-sticky" label="Add note" onClick={() => { setPanel(null); onAddNote(); }} />}
          {showCall && lead?.phone && (
            <div className="chat_menu_call">
              <CallButton phone={lead.phone} leadId={lead._id} dealerId={dealerId} size="sm" variant="link" label="Call" />
            </div>
          )}
          {onUpdateStatus && <MenuItem icon="fa-pen-to-square" label="Update status" onClick={() => { setPanel(null); onUpdateStatus(); }} />}
          {onCheckIn && <MenuItem icon="fa-right-to-bracket" label="Check in (Desk Log)" onClick={() => { setPanel(null); onCheckIn(); }} />}
        </div>
      )}

      {panel === "links" && (
        <div className="chat_panel">
          <div className="d-flex justify-content-between mb-1"><strong className="small">Send a link</strong>
            <Button size="sm" variant="link" onClick={() => setPanel(null)}>Close</Button></div>
          <div className="d-flex flex-wrap gap-1">
            {links.map((l) => (
              <Button key={l.key} size="sm" variant="outline-custom" title={l.url}
                onClick={() => { addLine(`${l.label}: ${l.url}`); setPanel(null); }}>{l.label}</Button>
            ))}
          </div>
        </div>
      )}

      {panel === "templates" && (
        <div className="chat_panel">
          <div className="d-flex justify-content-between mb-1"><strong className="small">Templates</strong>
            <Button size="sm" variant="link" onClick={() => setPanel(null)}>Close</Button></div>
          {templates.map((t) => (
            <button key={t._id} type="button" className="chat_menu_item" onClick={() => applyTemplate(t)}>
              <i className="fa-regular fa-file-lines" aria-hidden="true"></i><span>{t.name}</span>
            </button>
          ))}
        </div>
      )}

      {panel === "car" && !car && (
        <div className="chat_panel">
          <div className="d-flex justify-content-between mb-1"><strong className="small">Attach a car</strong>
            <Button size="sm" variant="link" onClick={() => setPanel(null)}>Close</Button></div>
          <div className="d-flex gap-1 mb-1">
            <Form.Control size="sm" placeholder="Stock #, VIN, make or model" value={carQuery}
              onChange={(e) => setCarQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), findCars())} />
            <Button size="sm" variant="custom" onClick={findCars} disabled={busy === "cars"}>
              {busy === "cars" ? <Spinner size="sm" /> : "Find"}</Button>
          </div>
          <div className="chat_car_list">
            {cars.map((v) => (
              <button key={v._id} type="button" className="chat_menu_item" onClick={() => { setCar(v); setCarPhotos([]); }}>
                <i className="fa-regular fa-car" aria-hidden="true"></i>
                <span><strong>{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}</strong>
                  <small className="text-muted ms-2">#{v.stockNumber || v.stocknumber || v.stock_number || "-"}</small></span>
              </button>
            ))}
            {!cars.length && busy !== "cars" && <div className="small text-muted p-2">No cars found.</div>}
          </div>
        </div>
      )}
      {car && (
        <VehicleCard vehicle={car} picked={carPhotos} onPick={setCarPhotos} onAdd={addLine} channel={channel}
          onRemove={() => { setCar(null); setCarPhotos([]); }} />
      )}

      {(files.length > 0 || carPhotos.length > 0) && (
        <div className="d-flex flex-wrap gap-1 mb-1">
          {files.map((f) => (
            <Badge key={f.url} bg="light" text="dark" className="chat_chip">
              <i className="fa-regular fa-paperclip me-1"></i>{f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.url !== f.url))}>×</button>
            </Badge>
          ))}
          {carPhotos.length > 0 && <Badge bg="success">{carPhotos.length} car photo(s)</Badge>}
        </div>
      )}

      {channel === "email" && (
        <Form.Control size="sm" className="mb-1" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      )}

      <div className="chat_input_row">
        <button type="button" className={`chat_plus ${panel ? "open" : ""}`} aria-label="More: attach, car, links, templates, note, call, status"
          aria-expanded={panel === "menu"} onClick={() => setPanel(panel ? null : "menu")}>
          <i className="fa-solid fa-plus"></i>
        </button>
        <div className="chat_channel" role="group" aria-label="Send by">
          <button type="button" className={channel === "sms" ? "on" : ""} disabled={!canText} onClick={() => onChannel("sms")}
            title={canText ? "Send as a text" : "No phone, or the customer stopped texts"}>Text</button>
          <button type="button" className={channel === "email" ? "on" : ""} disabled={!canEmail} onClick={() => onChannel("email")}
            title={canEmail ? "Send as an email" : "No email, or the customer stopped emails"}>Email</button>
        </div>
        <textarea ref={boxRef} rows={1} className="chat_textarea" value={text}
          placeholder={disabledReason || (channelOk ? `Message ${lead?.name || "the customer"} by ${channel === "sms" ? "text" : "email"}...`
            : channel === "sms" ? "Texting is not possible for this customer" : "Email is not possible for this customer")}
          disabled={Boolean(disabledReason) || !channelOk || busy === "send"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && channel === "sms") { e.preventDefault(); send(); } }} />
        <button type="button" className="chat_send" onClick={send} aria-label="Send"
          disabled={Boolean(disabledReason) || !channelOk || busy === "send" || busy === "upload" || !text.trim()}>
          {busy === "send" ? <Spinner size="sm" /> : <i className="fa-solid fa-paper-plane"></i>}
        </button>
      </div>
      <div className="d-flex justify-content-between small text-muted mt-1">
        <span>{busy === "upload" ? "Attaching..." : channel === "sms" ? "Enter sends · Shift+Enter new line" : ""}</span>
        {channel === "sms" && <span>{text.length} characters</span>}
      </div>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => upload(e.target.files)} />

      {showAI && lead?._id && (
        <WriteWithAIModal show={showAI} onHide={() => setShowAI(false)} leadId={lead._id} channel={channel} dealerId={dealerId}
          defaultLanguage={leadUserLanguage || "English"} lockLanguage conversationThread={thread}
          onDraftReady={(draft, subjectLine) => { setText(draft || ""); if (channel === "email" && subjectLine != null) setSubject(subjectLine); setShowAI(false); }} />
      )}
    </div>
  );
}
