"use client";
// Renders one email body for the AI Messages screen.
//   - Plain text (what the AI writes): paragraphs, line breaks, clickable links, and the
//     quoted earlier thread folded away behind "Show quoted text".
//   - ADF XML (a lead from Cars.com, CarGurus...): a formatted lead card (AdfLead).
//   - HTML (customer replies, the dealer's branded template): drawn inside a sandboxed
//     iframe with no scripts, so a stray <script>, <style> or CSS from the message can
//     neither run nor restyle our page. The frame grows to fit its content.

import { useEffect, useMemo, useRef, useState } from "react";
import AdfLead, { looksLikeAdf } from "./AdfLead";

const HTML_TAG = /<\/?(html|body|div|p|br|table|tr|td|span|a|img|h[1-6]|ul|ol|li|strong|b|em|i|center|font)\b/i;
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
// "On Tue, Jan 2, 2024 at 3:04 PM Jane <j@x.com> wrote:" and Outlook's "-----Original Message-----"
const QUOTE_START = /^(On .{10,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+\r?\n(Sent|Date):\s)/im;

// Quoted-printable leftovers (=3D, soft line breaks) that survived the mail parser.
function decodeLeftovers(raw) {
  if (!/=3D|=\r?\n|=C2=A0|=E2=80/.test(raw)) return raw;
  const bytes = [];
  const text = raw.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(text[i]));
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return raw;
  }
}

function Linkified({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => (i % 2
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : part));
}

function PlainText({ text }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return paragraphs.map((p, i) => (
    <p key={i} className="aim-mail-p">
      {p.split("\n").map((line, j, lines) => (
        <span key={j}><Linkified text={line} />{j < lines.length - 1 && <br />}</span>
      ))}
    </p>
  ));
}

function PlainBody({ text }) {
  const [showQuote, setShowQuote] = useState(false);
  const cut = text.search(QUOTE_START);
  // A ">"-prefixed block is a quote too; fold from the first such line.
  const gt = text.search(/^>/m);
  const at = [cut, gt].filter((n) => n > 0).sort((a, b) => a - b)[0] ?? -1;
  const fresh = (at > 0 ? text.slice(0, at) : text).trim();
  const quoted = at > 0 ? text.slice(at).trim() : "";
  return (
    <>
      <PlainText text={fresh} />
      {quoted && (
        <>
          <button type="button" className="aim-quote-toggle" onClick={() => setShowQuote((v) => !v)}
            aria-expanded={showQuote}>
            <i className="fa-solid fa-ellipsis" /> {showQuote ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showQuote && <div className="aim-quote"><PlainText text={quoted.replace(/^>\s?/gm, "")} /></div>}
        </>
      )}
    </>
  );
}

const FRAME_CSS = `
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font: 14px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2933;
    word-break: break-word; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #0b66c3; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #d5dbe3; color: #5b6676; }
  pre { white-space: pre-wrap; }
`;

function HtmlBody({ html }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(60);
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">`
      + `<meta name="referrer" content="no-referrer"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`,
    [html],
  );

  const fit = () => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.ceil(body.scrollHeight) + 4);
  };

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    let observer;
    const onLoad = () => {
      fit();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(fit);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  return (
    <iframe ref={ref} title="Email content" srcDoc={doc} sandbox="allow-same-origin allow-popups"
      className="aim-mail-frame" style={{ height }} />
  );
}

export default function EmailBody({ body }) {
  const text = useMemo(() => decodeLeftovers(String(body || "")).replace(/\r\n/g, "\n"), [body]);
  if (!text.trim()) return <p className="text-secondary-light fst-italic mb-0">This email has no content.</p>;
  if (looksLikeAdf(text)) return <AdfLead raw={text} />;
  if (HTML_TAG.test(text)) return <HtmlBody html={text} />;
  return <PlainBody text={text} />;
}
