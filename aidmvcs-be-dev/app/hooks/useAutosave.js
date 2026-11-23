"use client";
// Autosave (gap G-082: "immediate-action server persistence; saving / saved / error; failed saves never false
// Saved"). `save(value)` is called 1.5 s after the last change, at once on flush() (a field losing focus, the dialog
// closing), and never twice at the same time; a change made while a save is running is saved right after it.
// status: 'idle' | 'saving' | 'saved' | 'error' (with `error`), shown by <SaveStatus />.
// delayMs: null = no timer, the value is saved only on flush() (a typed field saves when it loses focus or on Enter,
// so a half-typed phone or email is never saved). While anything is unsaved, leaving the page asks first.
import { useCallback, useEffect, useRef, useState } from "react";

export default function useAutosave(save, { delayMs = 1500 } = {}) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const pending = useRef(null); // the latest unsaved value, wrapped: { value }
  const running = useRef(null);
  const timer = useRef(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (running.current) { await running.current; }
    if (!pending.current) return;
    const { value } = pending.current;
    pending.current = null;
    setStatus("saving"); setError(null);
    let failed = false;
    running.current = (async () => {
      try { await saveRef.current(value); setStatus(pending.current ? "pending" : "saved"); }
      catch (e) {
        failed = true;
        pending.current = pending.current || { value }; // kept: "Try again" (flush) saves it; never shown as saved
        setStatus("error"); setError(e?.message || "Could not save");
      }
    })();
    await running.current;
    running.current = null;
    // A change typed while this save ran is saved next; after a failure only on the user's "Try again" or next change.
    if (!failed && pending.current && !timer.current && delayMs != null) timer.current = setTimeout(() => { timer.current = null; flush(); }, delayMs);
  }, [delayMs]);

  const change = useCallback((value) => {
    pending.current = { value };
    setStatus("pending");
    clearTimeout(timer.current);
    timer.current = delayMs == null ? null : setTimeout(() => { timer.current = null; flush(); }, delayMs);
  }, [delayMs, flush]);

  // Drop an unsaved value (Escape / "Cancel" on a field): nothing is sent.
  const discard = useCallback(() => {
    clearTimeout(timer.current); timer.current = null; pending.current = null;
    setStatus((s) => (s === "pending" || s === "error" ? "idle" : s)); setError(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  // Leaving the page (closing the tab, reload) with a change not yet saved asks first.
  useEffect(() => {
    if (status !== "pending" && status !== "saving" && status !== "error") return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  return { status, error, change, flush, discard, unsaved: () => Boolean(pending.current || running.current) };
}

export function SaveStatus({ status, error, onRetry }) {
  if (status === "idle") return null;
  if (status === "error") {
    return (
      <span className="small text-danger" role="status">
        Not saved: {error}{onRetry && <> · <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={onRetry}>Try again</button></>}
      </span>
    );
  }
  const text = { pending: "Unsaved changes…", saving: "Saving…", saved: "All changes saved" }[status];
  return <span className={`small ${status === "saved" ? "text-success" : "text-muted"}`} role="status">{text}</span>;
}
