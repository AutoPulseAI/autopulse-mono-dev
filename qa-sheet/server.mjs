// The feature & test sheet as its own small web server. It is not part of the CRM: no CRM code, no CRM database,
// no packages. The testers' results and screenshots are plain files in DATA_DIR. nginx sends
// https://www.autopulse.ai/test/… here; nothing else on the site changes.
//
//   node qa-sheet/server.mjs
// Like the first testing sheet: anyone who has the link opens it, types their name at the top and starts testing.
// The link carries a key (QA_SHEET_KEY), so the address can't be guessed; a wrong key is a plain 404.
// Settings (environment, or KEY=value lines in <QA_DATA_DIR>/settings.env):
//   PORT=3990                    listens on 127.0.0.1 only
//   SHEET_BASE=/test/testing-sheet   QA_SHEET_KEY=<random>  → the link is https://www.autopulse.ai/test/testing-sheet/<key>/
//   QA_DATA_DIR=/var/www/html/qa-sheet-data   results.json and shots/ (outside every app folder)
//   QA_LEAD_TESTERS="Name, Name" the only people who may close a bug;  QA_DEVELOPER: name shown for fixes
//
// Addresses (under the link): /  page · /assets/<file> · /results (GET all, POST mine) · /results/shot ·
// /results/shot/remove · /results/issue · /shots/<file>; SHEET_BASE/health answers without the key
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Settings may also sit in <data dir>/settings.env (KEY=value lines), so a deploy or restart never loses them.
const settingsFile = path.join(path.resolve(process.env.QA_DATA_DIR || "/var/www/html/qa-sheet-data"), "settings.env");
if (fs.existsSync(settingsFile)) for (const line of fs.readFileSync(settingsFile, "utf8").split("\n")) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
const PORT = Number(process.env.PORT || 3990);
const ROOT_PATH = (process.env.SHEET_BASE || "/test/testing-sheet").replace(/\/+$/, "");
const KEY = String(process.env.QA_SHEET_KEY || "").trim();
const BASE = KEY ? `${ROOT_PATH}/${encodeURIComponent(KEY)}` : ROOT_PATH;
const DATA = path.resolve(process.env.QA_DATA_DIR || "/var/www/html/qa-sheet-data");
const SHOTS_DIR = path.join(DATA, "shots");
const RESULTS_FILE = path.join(DATA, "results.json");
if (KEY && KEY.length < 16) { console.error("QA_SHEET_KEY must be 16+ characters"); process.exit(2); }
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const FILES = { "sheet.js": "text/javascript; charset=utf-8", "sheet.css": "text/css; charset=utf-8", "features.json": "application/json; charset=utf-8", "automated.json": "application/json; charset=utf-8" };
const STATUSES = new Set(["pass", "fail", "blocked", "clear"]);
const ISSUE_STATES = new Set(["open", "fixed", "verified", "comment"]);
const SHOT_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const EXT_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const MAX_SHOTS = 10;
const MAX_HISTORY = 500;
const MAX_BODY = 8 * 1024 * 1024;

class Bad extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new Bad(400, m);

// ---------- the results file: one document per test row and tester, written whole and atomically ----------
let docs = {};
try { docs = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")); } catch { docs = {}; }
let writing = Promise.resolve();
function persist() {
  writing = writing.then(() => {
    const tmp = `${RESULTS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(docs));
    fs.renameSync(tmp, RESULTS_FILE);
  }).catch((e) => console.error("results not saved:", e.message));
  return writing;
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const rowId = (v) => { const id = clean(v, 160); if (!/^[a-z0-9_[][\w.:~#/[\] '&?=,-]*$/i.test(id)) throw bad("Unknown feature"); return id; };
const testerName = (v) => { const n = clean(v, 80).replace(/\s+/g, " "); if (!n) throw bad("Enter your name first"); return n; };
const testerKey = (n) => n.toLowerCase().replace(/\s+/g, " ").trim();
const leadTesters = () => String(process.env.QA_LEAD_TESTERS || "Lead tester").split(",").map((x) => x.trim()).filter(Boolean);
const docId = (row, name) => `${row}::${testerKey(name)}`;
const view = (d) => ({ id: d.row, tester: d.tester, status: d.status || null, note: d.note || "", at: d.at || null, shots: d.shots || [], history: d.history || [], issue: d.issue || null });

async function saveResult(body) {
  const row = rowId(body.id), tester = testerName(body.tester);
  const status = clean(body.status, 10).toLowerCase();
  if (!STATUSES.has(status)) throw bad("Choose Pass, Fail or Blocked");
  const note = clean(body.note, 4000), at = Date.now(), id = docId(row, tester);
  const prev = docs[id];
  const d = { ...(prev || {}), row, tester, status: status === "clear" ? null : status, note, at };
  const log = (e) => [...(prev?.issue?.log || []), e].slice(-MAX_HISTORY);
  if ((status === "fail" || status === "blocked") && (!prev?.issue || prev.issue.state !== "open")) {
    // A Fail/Blocked opens an issue; failing again after a fix (or after it was verified) reopens it.
    d.issue = { ...(prev?.issue || {}), state: "open", by: tester, at, log: log({ state: "open", by: tester, at, note, result: status, reopened: Boolean(prev?.issue) }) };
  } else if (prev?.issue && (prev.status !== status || note !== (prev.note || ""))) {
    d.issue = { ...prev.issue, log: log({ state: "retest", by: tester, at, note, result: status }) };
  }
  d.history = [...(prev?.history || []), { status, note, at }].slice(-MAX_HISTORY);
  docs[id] = d;
  await persist();
  return view(d);
}

async function setIssue(body) {
  const row = rowId(body.id), owner = testerName(body.tester), by = testerName(body.by);
  const action = clean(body.state, 10).toLowerCase();
  if (!ISSUE_STATES.has(action)) throw bad("Choose Open, Fixed, Verified or Comment");
  const prev = docs[docId(row, owner)];
  if (!prev?.issue) throw new Bad(404, "No issue on this row for that tester");
  const note = clean(body.note, 2000);
  if ((action === "fixed" || action === "comment") && !note) throw bad(action === "fixed" ? "Say what was fixed" : "Write the comment");
  if (action === "verified") {
    if (prev.issue.state !== "fixed") throw bad("Only a fixed issue can be verified");
    if (prev.issue.fixedBy && testerKey(prev.issue.fixedBy) === testerKey(by)) throw bad("A reviewer other than the person who fixed it must verify it");
    const leads = leadTesters();
    if (!leads.some((l) => testerKey(l) === testerKey(by))) throw bad(`Only the lead tester (${leads.join(", ")}) can close a bug`);
  }
  const at = Date.now();
  const issue = { ...prev.issue, log: [...(prev.issue.log || []), { state: action, by, at, note }].slice(-MAX_HISTORY) };
  if (action !== "comment") Object.assign(issue, { state: action, by, at, note: note || prev.issue.note || "" });
  if (action === "fixed") Object.assign(issue, { fixedBy: by, fixedAt: at, fixNote: note });
  if (action === "verified") Object.assign(issue, { verifiedBy: by, verifiedAt: at });
  prev.issue = issue;
  await persist();
  return view(prev);
}

function looksLike(type, data) {
  if (type === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  return data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP";
}

async function addShot(body) {
  const row = rowId(body.id), tester = testerName(body.tester);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ""));
  if (!m) throw bad("Attach a PNG, JPEG or WebP image");
  const data = Buffer.from(m[2], "base64");
  if (!data.length || data.length > MAX_SHOT_BYTES) throw bad("The image must be under 5 MB");
  if (!looksLike(m[1], data)) throw bad("That file is not a valid image");
  const id = docId(row, tester);
  const d = docs[id] || (docs[id] = { row, tester });
  if ((d.shots || []).length >= MAX_SHOTS) throw bad(`Up to ${MAX_SHOTS} screenshots per result`);
  const file = `${crypto.randomBytes(12).toString("hex")}.${SHOT_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(SHOTS_DIR, file), data, { mode: 0o640 });
  d.shots = [...(d.shots || []), { file, at: Date.now(), name: clean(body.name, 120) }];
  await persist();
  return view(d);
}

async function removeShot(body) {
  const row = rowId(body.id), tester = testerName(body.tester), file = String(body.file || "");
  if (!/^[a-f0-9]{24}\.(png|jpg|webp)$/.test(file)) throw bad("Unknown screenshot");
  const d = docs[docId(row, tester)];
  if (!(d?.shots || []).some((s) => s.file === file)) throw new Bad(404, "Not your screenshot");
  d.shots = d.shots.filter((s) => s.file !== file);
  fs.rmSync(path.join(SHOTS_DIR, file), { force: true });
  await persist();
  return view(d);
}

// ---------- http ----------
const HEAD = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
const send = (res, status, body, type = "application/json; charset=utf-8", extra = {}) => {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, { ...HEAD, "Content-Type": type, "Content-Length": data.length, "Cache-Control": "no-store", ...extra });
  res.end(data);
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(bad("Too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { reject(bad("Not JSON")); } });
    req.on("error", reject);
  });
}
const POSTS = { "results": saveResult, "results/shot": addShot, "results/shot/remove": removeShot, "results/issue": setIssue };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === `${ROOT_PATH}/health`) return send(res, 200, { ok: true });
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return send(res, 404, { error: "Not found" });
    if (url.pathname === BASE) { res.writeHead(302, { ...HEAD, Location: `${BASE}/` }); return res.end(); }
    const sub = decodeURIComponent(url.pathname.slice(BASE.length + 1));
    if (req.method === "GET" && sub === "") return send(res, 200, fs.readFileSync(path.join(here, "sheet.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && sub.startsWith("assets/")) {
      const name = sub.slice(7);
      if (!FILES[name]) throw new Bad(404, "Not found");
      const file = path.join(here, name);
      if (!fs.existsSync(file)) return name === "automated.json" ? send(res, 200, { suites: {} }) : send(res, 404, { error: "Not found" });
      return send(res, 200, fs.readFileSync(file), FILES[name]);
    }
    if (req.method === "GET" && sub === "results") return send(res, 200, { results: Object.values(docs).filter((d) => d.row).map(view), leadTesters: leadTesters(), developer: process.env.QA_DEVELOPER || "Lead developer" });
    if (req.method === "GET" && sub.startsWith("shots/")) {
      const m = /^shots\/([a-f0-9]{24})\.(png|jpg|webp)$/.exec(sub);
      const file = m && path.join(SHOTS_DIR, `${m[1]}.${m[2]}`);
      if (!file || !fs.existsSync(file)) throw new Bad(404, "Not found");
      return send(res, 200, fs.readFileSync(file), EXT_TYPES[m[2]], { "Cache-Control": "private, max-age=86400" });
    }
    if (req.method === "POST" && POSTS[sub]) return send(res, 200, { result: await POSTS[sub](await readBody(req)) });
    throw new Bad(404, "Not found");
  } catch (e) {
    if (e instanceof Bad) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: "Something went wrong" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Testing sheet on http://127.0.0.1:${PORT}${KEY ? `${ROOT_PATH}/<key>` : BASE}/ (data in ${DATA})`));
