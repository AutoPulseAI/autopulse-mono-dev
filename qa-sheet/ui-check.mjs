// UI check of the CRM in headless Chrome: every page (dealer, super admin, sign-in and public), every tab on it and
// every pop-up a safe button opens (Add / New / Edit / Filter / date range …). For each one it records script errors,
// server errors (5xx) and every visible button, link and field. With --write-inventory it writes qa-sheet/inventory.json
// (the list the feature & test sheet is built from); otherwise it compares the page with that list.
//
//   node qa-sheet/ui-check.mjs --write-inventory                    (local copy, see qa-sheet/README.md)
//   APP_URL=http://127.0.0.1:3137 DEALER_TOKEN=… ADMIN_TOKEN=… node qa-sheet/ui-check.mjs --json /tmp/qa-ui.json
//
// It never presses Delete, Send, Save, Submit, Sync, Approve or similar buttons, so it is safe on any copy, but run
// it on a local or test copy: opening a page can still load data.
// No packages: Chrome is driven over its DevTools protocol (Node 22+ has fetch and WebSocket).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APPDIR = path.join(here, "..", "aidmvcs-be-dev", "app");
const INVENTORY = path.join(here, "inventory.json");
const BASE = (process.env.APP_URL || "http://127.0.0.1:3137").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "google-chrome";
const PORT = Number(process.env.CDP_PORT || 9341);
const tokenFrom = (v, f) => v || (f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "");
const LOCAL = path.join(here, "..", "..", "local-test");
const DEALER_TOKEN = tokenFrom(process.env.DEALER_TOKEN, path.join(LOCAL, "own-admin"));
const ADMIN_TOKEN = tokenFrom(process.env.ADMIN_TOKEN, path.join(LOCAL, "admin"));
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
// Errors to leave out, e.g. the AI service that a local copy does not run: IGNORE_ERRORS='/api/dealer-ai/'.
const IGNORE = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Buttons that open a window or a menu and change nothing (clicked to list what is inside).
const OPENER = /^(\+\s*)?(add|new|create|import|upload|edit|filter|filters|columns|more|options|actions|bulk|customi[sz]e|settings|view|details|manage|select|choose|pick|change|assign|schedule|book|check[- ]?in|log|note|task|reply|compose|date|today|this|last|custom|range|preview|help|info|profile|⋮|…|\.\.\.)/i;
// Never pressed: they change data, send something or leave.
const DANGER = /(delete|remove|send|save|submit|confirm|sync|run|approve|reject|merge|dismiss|logout|log out|sign out|disconnect|archive|restore|reset|clear|cancel|close|pay|subscribe|buy|unsubscribe|opt|stop|start|pause|resume|enable|disable|turn|activate|deactivate|impersonat|login as|export|download|csv|print|copy|test)/i;

// ---------- pages, from app/**/page.js ----------
function pages() {
  const out = [];
  const walk = (dir, parts) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!["api", "components", "node_modules", "middleware", "hooks", "utils", "lib"].includes(e.name)) walk(path.join(dir, e.name), [...parts, e.name]); }
      else if (/^page\.(js|jsx|tsx)$/.test(e.name)) {
        const segs = parts.filter((p) => !/^\(.*\)$/.test(p));
        out.push({ file: path.join("app", ...parts, e.name), route: "/" + segs.join("/"), dynamic: segs.some((s) => s.startsWith("[")) });
      }
    }
  };
  walk(APPDIR, []);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

// ---------- Chrome over CDP ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "qa-ui-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
let tabs;
for (let i = 0; i < 60 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); } }
if (!tabs) { console.error(`Chrome did not start (${CHROME}); set CHROME_PATH`); process.exit(2); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || { error: m.error }); pending.delete(m.id); return; }
  // A confirm() / alert() would freeze the page: always answer Cancel (nothing is ever confirmed).
  if (m.method === "Page.javascriptDialogOpening") { ws.send(JSON.stringify({ id: ++seq, method: "Page.handleJavaScriptDialog", params: { accept: false } })); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(`script error: ${(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").split("\n")[0].slice(0, 200)}`);
  if (m.method === "Network.responseReceived") {
    const { url, status } = m.params.response;
    if (url.includes("/api/") && status >= 500 && !(IGNORE && IGNORE.test(url))) errors.push(`server ${status} ${url.replace(BASE, "").split("?")[0]}`);
  }
};
// Every call gives up after 20 s (a page that hangs must not stop the whole check).
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); errors.push(`no answer from the page (${method})`); r({}); }, 20000);
  pending.set(id, (v) => { clearTimeout(timer); r(v); });
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (fn, ...args) => {
  const r = await send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};
await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const host = new URL(BASE).hostname;
// Sign-in pages clear the session: the cookies are put back before every page.
const signIn = async () => { for (const [name, value] of [["dealertoken", DEALER_TOKEN], ["admintoken", ADMIN_TOKEN]]) if (value) await send("Network.setCookie", { name, value, domain: host, path: "/" }); };
await signIn();
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{${DEALER_TOKEN ? `localStorage.setItem('dealertoken',${JSON.stringify(DEALER_TOKEN)});` : ""}${ADMIN_TOKEN ? `localStorage.setItem('token',${JSON.stringify(ADMIN_TOKEN)});` : ""}}catch(e){}` });
async function go(url) {
  await signIn();
  await send("Page.navigate", { url });
  // Wait until the page stops loading data (no spinner) or 12 s.
  for (let i = 0; i < 24; i++) {
    await sleep(500);
    const busy = await run(() => document.readyState !== "complete" || Boolean(document.querySelector(".spinner-border:not([hidden]), .loader, [aria-busy=true]")));
    if (!busy && i >= 4) break;
  }
  await sleep(600);
}
const here_ = () => run(() => location.pathname + location.search);

// ---------- what is on the screen ----------
// root: a CSS selector; only what is inside it (and visible) is listed. skip: a selector whose contents are left out.
function collect(rootSel, skipSel) {
  const roots = [...document.querySelectorAll(rootSel)];
  if (!roots.length) return null;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]"); };
  const skip = (el) => skipSel && el.closest(skipSel);
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const icon = (el) => { const i = el.querySelector("i[class], svg[class], span[class*=icon]"); const c = i ? String(i.getAttribute("class") || "") : ""; const m = /(?:bi|fa|fas|far|ri|ti|mdi|feather)-([a-z0-9-]+)/.exec(c); return m ? m[1].replace(/-(fill|line|outline|o)$/, "") : ""; };
  const label = (el) => {
    let t = clean(el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || el.getAttribute("data-bs-original-title") || "");
    if (!t) { const ic = icon(el); t = ic ? `(${ic} icon)` : ""; }
    return t.slice(0, 80);
  };
  const HEAD = ".modal-title, .offcanvas-title, .card-header, .card-title, h1, h2, h3, h4, h5, h6, legend";
  const panelOf = (el) => {
    for (let box = el.parentElement, n = 0; box && box !== document.body && n < 12; box = box.parentElement, n++) {
      const heads = [...box.querySelectorAll(HEAD)].filter((h) => !h.contains(el) && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && vis(h));
      if (heads.length) return clean(heads[heads.length - 1].innerText).replace(/\(\d{1,2}\/\d{1,2}\/\d{4}.*?\)/g, "").replace(/\s*\?$/, "").slice(0, 60);
    }
    return "";
  };
  const out = { title: "", panels: [], buttons: [], fields: [], tabs: [] };
  for (const root of roots) {
    const h = root.querySelector("h1, h2, h3, .page-title, .modal-title, .offcanvas-title");
    if (!out.title && h && vis(h)) out.title = clean(h.innerText).slice(0, 80);
    for (const hd of root.querySelectorAll("h1, h2, h3, h4, h5, h6, .card-header, .card-title, .modal-title, .offcanvas-title, legend")) if (vis(hd) && !skip(hd)) { const t = clean(hd.innerText).replace(/\s*\?$/, "").slice(0, 60); if (t && !out.panels.includes(t)) out.panels.push(t); }
    for (const e of root.querySelectorAll("button, a[href], [role=tab], [role=button], summary, input[type=button], input[type=submit], .nav-link, .dropdown-item")) {
      if (!vis(e) || skip(e) || (e.tagName !== "BUTTON" && e.closest("button"))) continue;
      const tab = e.getAttribute("role") === "tab" || Boolean(e.closest(".nav-tabs, .nav-pills, [role=tablist]"));
      const row = e.closest("tbody tr, .list-group-item, li.lead-row, .kanban-card, .fc-event");
      const item = { kind: tab ? "tab" : e.tagName === "A" ? "link" : "button", label: label(e), id: e.id || null, panel: panelOf(e), disabled: Boolean(e.disabled || e.getAttribute("aria-disabled") === "true"), inRow: Boolean(row), cls: String(e.getAttribute("class") || "").slice(0, 60), href: e.tagName === "A" ? e.getAttribute("href") : null };
      if (tab) out.tabs.push(item.label);
      out.buttons.push(item);
    }
    for (const e of root.querySelectorAll("input:not([type=hidden]):not([type=button]):not([type=submit]), select, textarea, [contenteditable=true]")) {
      if (!vis(e) || skip(e)) continue;
      const lab = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null;
      const wrap = e.closest(".form-group, .mb-3, .col, [class*=col-]")?.querySelector("label, .form-label");
      out.fields.push({ kind: e.tagName.toLowerCase() + (e.tagName === "INPUT" ? `:${e.type}` : ""), label: clean(lab?.innerText || e.closest("label")?.innerText || wrap?.innerText || e.getAttribute("aria-label") || e.placeholder || e.name || "").slice(0, 80), id: e.id || null, name: e.getAttribute("name") || null, panel: panelOf(e), inRow: Boolean(e.closest("tbody tr")) });
    }
  }
  return out;
}

// Rows of a table are data, not buttons: keep one of each row action ("Row: Edit"); drop data links (names, e-mails).
// Cards show live numbers and dates ("12 Total Leads Nov 26, 2026"): keep the name only, so the list stays the same.
const DATE = /(\(?\d{1,2}\/\d{1,2}\/\d{4}[^)]*\)?|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b)/g;
export function tidy(label) {
  let t = String(label || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^[\d,.%$]+\s+(?=[A-Za-z])/, "");
  t = t.replace(/\s(?:SMS: |Email: |Booked by |Need attention|Marked |Leads that|\d+ of \d+ |from \d|to \d).*$/, "");
  t = t.replace(DATE, "").replace(/\s*·\s*$/, "").replace(/\s[\d,.%]+$/, "").replace(/(Today|Date): .*$/, "$1").replace(/\s+/g, " ").trim();
  return t;
}
function normalise(screen) {
  const buttons = new Map();
  for (const b of screen.buttons || []) {
    let label = tidy(b.label);
    if (!label && !b.id) continue;
    if (b.inRow) {
      if (b.kind === "link" && !/^\(.+ icon\)$/.test(label) && !/btn/.test(b.cls)) continue; // a customer name, phone or e-mail
      if (/^\d[\d,.\s%$]*$/.test(label)) continue;
      label = `Row: ${label.replace(/\d{3,}/g, "#")}`.slice(0, 60);
    }
    if (/@/.test(label) && !b.id) continue;
    if (/^https?:\/\//.test(label)) continue;
    if (/^(\d+|«|»|‹|›|<|>|Previous|Next|First|Last)$/i.test(label) && /page/.test(b.cls + b.panel)) label = "Page buttons (previous / next / number)";
    if (/^\d+$/.test(label)) label = "Page buttons (previous / next / number)";
    const key = b.id || `${b.kind}|${b.panel}|${label}`;
    const href = b.href && !/^(#|javascript)/.test(b.href) ? b.href.replace(/[a-f0-9]{24}/g, ":id").replace(/=\d{4}-\d{2}-\d{2}[^&]*/g, "=:date") : null;
    if (!buttons.has(key)) buttons.set(key, { label, id: b.id, kind: b.kind, panel: tidy(b.panel), href, row: b.inRow || undefined, disabled: b.disabled || undefined });
  }
  const fields = new Map();
  for (const f of screen.fields || []) {
    if (f.inRow && f.kind === "input:checkbox") { fields.set("row-checkbox", { label: "Row checkbox (select a row)", kind: f.kind, panel: f.panel }); continue; }
    const key = f.id || f.name || `${f.panel}|${f.label}|${f.kind}`;
    if (!fields.has(key)) fields.set(key, { label: f.label, id: f.id, name: f.name, kind: f.kind, panel: f.panel || "" });
  }
  const panels = [...new Set((screen.panels || []).map(tidy).filter((p) => p && !/^[\d,.%$+=\s]+$/.test(p)))];
  return { title: tidy(screen.title), panels, tabs: [...new Set(screen.tabs)], buttons: [...buttons.values()], fields: [...fields.values()] };
}

const screens = {};
const record = (key, raw, errs, extra = {}) => { if (raw) screens[key] = { ...extra, ...normalise(raw), errors: errs }; };
const PAGE_ROOT = "body";
const OVERLAY = ".modal.show, .offcanvas.show, [role=dialog]:not([aria-hidden=true]), .dropdown-menu.show, .daterangepicker, .rdrDateRangePickerWrapper, .popover.show";
// The menu (sidebar) and the top bar are the same on every page: listed once per portal (dealer/_menu, admin/_menu).
const CHROME_SEL = ".sidebar, .topbar_main";
const PAGE_SKIP = `${OVERLAY}, ${CHROME_SEL}`;
const doneChrome = new Set();

async function crawlChrome(portal, url) {
  if (doneChrome.has(portal)) return;
  doneChrome.add(portal);
  const key = `${portal}/_menu`;
  const before = errors.length;
  // Open every collapsed menu group first (AI Assistant, Admin …), so their links are listed too.
  await run(() => { for (const b of document.querySelectorAll(".sidebar button, .sidebar [aria-expanded=false]")) if (b.getAttribute("aria-expanded") !== "true") b.click(); });
  await sleep(800);
  record(key, await run(collect, CHROME_SEL, OVERLAY), errors.slice(before), { route: `/${portal}`, url: url.replace(BASE, ""), chrome: true });
  const openers = await run(() => [...document.querySelectorAll(".topbar_main button, .topbar_main .dropdown-toggle, .topbar_main a[role=button]")].filter((e) => e.offsetParent).map((e, i) => ({ i, label: (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60) })));
  for (const o of openers || []) {
    if (!o.label || DANGER.test(o.label) || /^menu$/i.test(o.label)) continue;
    const b2 = errors.length;
    await run((i) => [...document.querySelectorAll(".topbar_main button, .topbar_main .dropdown-toggle, .topbar_main a[role=button]")].filter((e) => e.offsetParent)[i]?.click(), o.i);
    await sleep(1200);
    if ((await here_()).split("?")[0] !== new URL(url).pathname) { screens[key].leadsTo = { ...(screens[key].leadsTo || {}), [o.label]: await here_() }; await go(url); continue; }
    const raw = await run(collect, OVERLAY);
    if (raw && (raw.buttons.length || raw.fields.length)) record(`${key}::${tidy(o.label)}`, raw, errors.slice(b2), { route: `/${portal}`, parent: key, via: `Top bar '${tidy(o.label)}'`, overlay: true, chrome: true });
    await closeOverlays();
  }
}

async function closeOverlays() {
  await run(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.activeElement?.blur?.(); });
  await sleep(300);
  await run(() => { for (const b of document.querySelectorAll(".modal.show .btn-close, .offcanvas.show .btn-close, .modal.show [aria-label=Close], .offcanvas.show [aria-label=Close]")) b.click(); });
  await sleep(400);
  await run(() => { if (document.querySelector(".dropdown-menu.show, .daterangepicker")) document.body.click(); });
  await sleep(200);
}

async function crawlPage(route, url) {
  const key = route.replace(/^\//, "") || "home";
  const before = errors.length;
  await go(url);
  const landed = await here_();
  const redirected = landed.split("?")[0] !== new URL(url).pathname;
  record(key, await run(collect, PAGE_ROOT, PAGE_SKIP), errors.slice(before), { route, url: url.replace(BASE, ""), landed: redirected ? landed : undefined });
  if (redirected) return;
  const portal = route.split("/")[1];
  if (["dealer", "admin"].includes(portal) && await run(() => Boolean(document.querySelector(".sidebar")))) { await crawlChrome(portal, url); await go(url); }
  // Tabs: click each, list what that tab adds.
  const tabLabels = await run(() => [...document.querySelectorAll("[role=tab], .nav-tabs .nav-link, .nav-pills .nav-link")].filter((e) => e.offsetParent && !e.closest(".modal, .offcanvas")).map((e, i) => ({ i, label: (e.innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 50) })));
  for (const t of (tabLabels || []).slice(0, 15)) {
    if (!t.label || DANGER.test(t.label)) continue;
    const b2 = errors.length;
    const clicked = await run((i) => { const els = [...document.querySelectorAll("[role=tab], .nav-tabs .nav-link, .nav-pills .nav-link")].filter((e) => e.offsetParent && !e.closest(".modal, .offcanvas")); const e = els[i]; if (!e || e.tagName === "A" && /^\/|^http/.test(e.getAttribute("href") || "")) return false; e.click(); return true; }, t.i);
    if (!clicked) continue;
    await sleep(1800);
    if ((await here_()).split("?")[0] !== new URL(url).pathname) { await go(url); continue; }
    record(`${key}#tab:${t.label}`, await run(collect, ".tab-content > .active, .tab-pane.active, [role=tabpanel]:not([hidden])", OVERLAY), errors.slice(b2), { route, url: url.replace(BASE, ""), parent: key, via: `Tab '${t.label}'` });
  }
  // Show / hide parts (report tags, "More filters", accordions): press each, list what it adds, press it again.
  const toggles = await run((d) => {
    const DG = new RegExp(d, "i");
    return [...document.querySelectorAll("[aria-pressed=false], [aria-expanded=false], .accordion-button.collapsed")]
      .filter((e) => e.offsetParent && !e.closest(".modal, .offcanvas, .sidebar, .topbar_main, tbody tr, .dropdown"))
      .map((e, i) => ({ i, label: (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60) }))
      .filter((x) => x.label && !DG.test(x.label));
  }, DANGER.source);
  const pageLabels = new Set((screens[key]?.buttons || []).map((b) => b.label));
  for (const t of (toggles || []).slice(0, 20)) {
    const b4 = errors.length;
    const sel = "[aria-pressed=false], [aria-expanded=false], .accordion-button.collapsed";
    const ok = await run((s2, label) => { const e = [...document.querySelectorAll(s2)].find((x) => x.offsetParent && !x.closest(".modal, .offcanvas, .sidebar, .topbar_main, tbody tr, .dropdown") && (x.getAttribute("aria-label") || x.innerText || x.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60) === label); if (!e) return false; e.click(); return true; }, sel, t.label);
    if (!ok) continue;
    await sleep(2200);
    if ((await here_()).split("?")[0] !== new URL(url).pathname) { await go(url); continue; }
    const raw = await run(collect, PAGE_ROOT, PAGE_SKIP);
    if (raw) {
      const n = normalise(raw);
      const pageFields = new Set((screens[key]?.fields || []).map((f) => f.id || f.name || f.label));
      const added = { ...n, buttons: n.buttons.filter((b) => !pageLabels.has(b.label)), fields: n.fields.filter((f) => !pageFields.has(f.id || f.name || f.label)), panels: n.panels.filter((p) => !(screens[key]?.panels || []).includes(p)) };
      if (added.buttons.length || added.panels.length) screens[`${key}~${tidy(t.label)}`] = { ...added, route, url: url.replace(BASE, ""), parent: key, via: `Show '${tidy(t.label)}'`, errors: errors.slice(b4) };
    }
    await go(url);
  }
  // Pop-ups: press each safe opener once and list what the window or menu holds.
  const openers = await run((o, d) => {
    const OP = new RegExp(o, "i"), DG = new RegExp(d, "i");
    const vis = (e) => e.offsetParent && e.getBoundingClientRect().width > 0;
    const lab = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const all = [...document.querySelectorAll("button, [role=button], .dropdown-toggle, a[data-bs-toggle], a[href='#']")].filter((e) => vis(e) && !e.closest(".modal, .offcanvas, nav.sidebar, .sidebar, aside, .topbar_main"));
    const seen = new Set();
    return all.map((e, i) => ({ i, label: lab(e), row: Boolean(e.closest("tbody tr")), toggle: e.classList.contains("dropdown-toggle") || e.getAttribute("aria-haspopup") === "true" || e.hasAttribute("data-bs-toggle") }))
      .filter((x) => x.label && (OP.test(x.label) || x.toggle) && !DG.test(x.label))
      .filter((x) => { const k = (x.row ? "row|" : "") + x.label; if (seen.has(k)) return false; seen.add(k); return true; });
  }, OPENER.source, DANGER.source);
  for (const o of (openers || []).slice(0, 25)) {
    const b3 = errors.length;
    const ok = await run((i, label) => {
      const vis = (e) => e.offsetParent && e.getBoundingClientRect().width > 0;
      const lab = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const all = [...document.querySelectorAll("button, [role=button], .dropdown-toggle, a[data-bs-toggle], a[href='#']")].filter((e) => vis(e) && !e.closest(".modal, .offcanvas, nav.sidebar, .sidebar, aside, .topbar_main"));
      const e = all.find((x) => lab(x) === label) || all[i];
      if (!e) return false;
      e.click();
      return true;
    }, o.i, o.label);
    if (!ok) continue;
    await sleep(1500);
    const now = await here_();
    if (now.split("?")[0] !== new URL(url).pathname) {
      screens[key].leadsTo = { ...(screens[key].leadsTo || {}), [o.label]: now.replace(/[a-f0-9]{24}/g, ":id") };
      await go(url);
      continue;
    }
    const raw = await run(collect, OVERLAY);
    if (raw && (raw.buttons.length || raw.fields.length)) {
      record(`${key}::${o.row ? "Row: " : ""}${o.label}`, raw, errors.slice(b3), { route, url: url.replace(BASE, ""), parent: key, via: `${o.row ? "Row button" : "Button"} '${o.label}'`, overlay: true });
    }
    await closeOverlays();
    if (await run(() => Boolean(document.querySelector(".modal.show, .offcanvas.show")))) await go(url);
  }
}

// ---------- run ----------
const all = pages();
// Signed-in pages first, then sign-in and public pages (they may sign the browser out).
const PUBLIC = /^\/(dealer|admin)(\/(forgot-password|reset|register|two-factor-verification))?$|^\/(?!dealer\/|admin\/)/;
const statics = all.filter((p) => !p.dynamic && !/^\/(agency)(\/|$)/.test(p.route) && (!ONLY || ONLY.test(p.route)))
  .sort((a, b) => Number(PUBLIC.test(a.route)) - Number(PUBLIC.test(b.route)) || a.route.localeCompare(b.route));
const dynamics = all.filter((p) => p.dynamic && (!ONLY || ONLY.test(p.route)));
console.log(`${statics.length} pages, ${dynamics.length} detail pages`);
for (const p of statics) {
  process.stdout.write(`  ${p.route} … `);
  await crawlPage(p.route, BASE + p.route);
  const s = screens[p.route.replace(/^\//, "") || "home"];
  console.log(s ? `${s.buttons.length} buttons, ${s.fields.length} fields${s.landed ? ` (went to ${s.landed})` : ""}${s.errors.length ? `, ${s.errors.length} errors` : ""}` : "no page");
}
// Detail pages ([id]): open the first link to one found on any page crawled above.
const links = new Set(Object.values(screens).flatMap((s) => (s.buttons || []).map((b) => b.href).filter(Boolean)));
for (const p of dynamics) {
  const pattern = new RegExp("^" + p.route.replace(/\[[^\]]+\]/g, "[^/?#]+") + "$");
  // The inventory keeps ":id"; find a real link on the page that lists them.
  const parentKey = p.route.split("/[")[0].replace(/^\//, "");
  await go(BASE + "/" + parentKey);
  // A real record's link, never a sibling page ("/dealer/customers/duplicates" is not a customer).
  const statics_ = all.filter((x) => !x.dynamic).map((x) => x.route);
  const real = await run((src, skip) => { const re = new RegExp(src); return [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href").split("?")[0]).find((h) => re.test(h) && !skip.includes(h)) || null; }, pattern.source, statics_);
  // No link: lists that open a record on a row click (Customers) - click the first row and see where it goes.
  let found = real;
  if (!found) {
    for (const sel of ["tbody tr td", "tbody tr", ".list-group-item button", "ul li button.text-start", ".list-group-item"]) {
      const clicked = await run((q) => { const e = [...document.querySelectorAll(q)].find((x) => x.offsetParent && !x.closest(".sidebar, .topbar_main")); if (!e) return false; e.click(); return true; }, sel);
      if (!clicked) continue;
      await sleep(2500);
      const now = (await here_()).split("?")[0];
      if (pattern.test(now) && !statics_.includes(now)) { found = now; break; }
      if (now !== "/" + parentKey) await go(BASE + "/" + parentKey);
    }
  }
  process.stdout.write(`  ${p.route} … `);
  if (!found) { console.log("no example link found (skipped)"); screens[p.route.replace(/^\//, "")] = { route: p.route, skipped: "no example record linked from its list page", panels: [], tabs: [], buttons: [], fields: [], errors: [] }; continue; }
  await crawlPage(p.route, BASE + found);
  const s = screens[p.route.replace(/^\//, "")];
  console.log(s ? `${s.buttons.length} buttons, ${s.fields.length} fields` : "no page");
}
void links;
ws.close();
chrome.kill();
await sleep(1000);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still closing: the temp folder stays */ }

if (process.argv.includes("--write-inventory")) {
  // With ONLY, the pages checked replace theirs in the existing inventory; the others are kept.
  const keep = ONLY && fs.existsSync(INVENTORY) ? Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(INVENTORY, "utf8")).screens).filter(([, v]) => !ONLY.test(v.route || ""))) : {};
  const out = { crawledAt: new Date().toISOString(), app: BASE, screens: { ...keep, ...Object.fromEntries(Object.entries(screens).map(([k, v]) => { const { errors: _e, ...rest } = v; return [k, rest]; })) } };
  fs.writeFileSync(INVENTORY, JSON.stringify(out, null, 1));
  console.log(`inventory written: ${Object.keys(screens).length} screens`);
}

// Compare with the inventory the sheet lists: every screen opens, has no script/server errors, and keeps its buttons.
const expected = fs.existsSync(INVENTORY) ? JSON.parse(fs.readFileSync(INVENTORY, "utf8")).screens : {};
const tests = [];
for (const [key, exp] of Object.entries(expected)) {
  if (exp.skipped) continue;
  if (ONLY && !ONLY.test(exp.route || "")) continue;
  const got = screens[key];
  const labels = new Set((got?.buttons || []).map((b) => b.id || b.label));
  const missing = (exp.buttons || []).filter((b) => !b.row && !labels.has(b.id || b.label)).map((b) => b.label);
  const errs = got?.errors || [];
  const ok = Boolean(got) && !missing.length && !errs.length;
  tests.push({ id: `UI-${key}`, name: `${key}: opens, ${exp.buttons?.length || 0} buttons, no script/server errors`, ok,
    note: !got ? "screen not found" : [missing.length ? `missing: ${missing.slice(0, 8).join(", ")}` : "", errs.slice(0, 3).join("; ")].filter(Boolean).join(" | ") || `${got.buttons.length} buttons, ${got.fields.length} fields seen` });
}
const failed = tests.filter((t) => !t.ok);
for (const t of tests) console.log(`${t.ok ? "PASS" : "FAIL"} ${t.id.slice(0, 60).padEnd(60)} ${t.note.slice(0, 140)}`);
console.log(`\n${tests.length - failed.length}/${tests.length} passed`);
const out = process.argv.indexOf("--json");
if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify({ suite: "ui", runAt: new Date().toISOString(), base: BASE, tests }, null, 1));
process.exitCode = failed.length ? 1 : 0;
