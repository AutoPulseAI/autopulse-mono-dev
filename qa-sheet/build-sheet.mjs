// Builds qa-sheet/features.json for the feature & test sheet (/sheet/<token>).
//   node qa-sheet/build-sheet.mjs
// Sources: catalog.mjs (sections, features, button notes), inventory.json (every page, tab, pop-up, button, link and
// field qa/ui-check.mjs found) and tracker.json (the SOW gap rows: each becomes a feature on the page it lives on).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP, AREAS, SECTIONS, BUTTONS, guess } from "./catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), "utf8"));
const inventory = read("inventory.json");
const tracker = fs.existsSync(path.join(here, "tracker.json")) ? read("tracker.json").rows : {};
const screens = inventory.screens;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";

// Where a sub-screen's buttons sit, in words: "in the 'Actions' menu", "on the 'Notes' tab", "after pressing 'Service'".
function where(sub) {
  if (!sub) return "";
  if (sub.overlay) return `in the window / menu that '${sub.via.replace(/^(Row button|Button|Top bar) '|'$/g, "")}' opens`;
  if (/^Tab '/.test(sub.via || "")) return `on the ${sub.via.replace(/^Tab /, "")} tab`;
  if (/^Show '/.test(sub.via || "")) return `after pressing ${sub.via.replace(/^Show /, "")}`;
  return sub.via || "";
}

function buttonRows(sec, list) {
  const rows = [];
  const seen = new Set();
  for (const { b, sub } of list) {
    const place = where(sub);
    const key = `${b.label}|${b.href || ""}|${place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = BUTTONS[`${sec.id}|${b.label}`] || BUTTONS[b.label];
    const [about, expect] = note || guess(b, sec.title);
    rows.push({
      id: `${sec.id}.b.${slug(place)}.${slug(b.id || b.label)}${b.href ? `.${slug(b.href)}` : ""}`.slice(0, 150),
      label: b.label, kind: b.kind, el: b.id ? `#${b.id}` : null, href: b.href || null,
      panel: [b.panel, place].filter(Boolean).join(" · "),
      about: place ? `${about} (${place})` : about, expect, status: "live",
      access: sec.access || null,
    });
  }
  return rows;
}

function fieldRows(list) {
  const out = [];
  const seen = new Set();
  for (const { f, sub } of list) {
    const key = `${f.id || f.name || f.label}|${f.kind}|${where(sub)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: f.label || f.name || f.id || "(no label)", kind: f.kind, panel: [f.panel, where(sub)].filter(Boolean).join(" · "), tip: "" });
  }
  return out;
}

const trackerFeature = (secId, id) => {
  const t = tracker[id];
  if (!t) throw new Error(`Tracker row not found: ${id} (section ${secId})`);
  const soon = /^(Open|Built|Waiting|Not doing)/.test(t.status);
  return {
    id: `${secId}.t.${id}`, title: `${id} · ${t.feature}`,
    about: `SOW v6 item (${t.order || "tracker"}): ${t.status}${t.live ? ` · live: ${t.live}` : ""}.`,
    steps: t.where && t.where !== "-" ? [`Go to: ${t.where}`, "Use it as described there."] : [],
    expect: "Works as described in 'Go to'; numbers match their lists; no error message.",
    status: soon ? "soon" : "live", why: soon ? `Tracker status: ${t.status}.` : undefined,
    access: /super admin only/i.test(t.live || "") ? "admin" : null, auto: [],
  };
};

const covered = new Set();
const sections = [];
const known = new Set(SECTIONS.map((s) => s.id));
// Pages the crawler found that the catalog does not name yet: listed at the end of their area, with a generic test.
const extra = Object.entries(screens).filter(([k, v]) => !v.parent && !known.has(k)).map(([k, v]) => ({
  id: k, area: k.startsWith("admin") ? "admin" : k.startsWith("dealer") ? "dealer-admin" : "public", title: v.title || k, open: v.route || `/${k}`, who: "—", features: [],
}));
for (const s of [...SECTIONS, ...extra]) {
  const main = screens[s.id];
  const subs = Object.entries(screens).filter(([, v]) => v.parent === s.id).map(([k, v]) => ({ key: k, ...v }));
  covered.add(s.id);
  for (const x of subs) covered.add(x.key);
  const btns = [...(main?.buttons || []).map((b) => ({ b })), ...subs.flatMap((sub) => sub.buttons.map((b) => ({ b, sub })))];
  // Tabs found on the page are also buttons to test (once).
  const fields = [...(main?.fields || []).map((f) => ({ f })), ...subs.flatMap((sub) => sub.fields.map((f) => ({ f, sub })))];
  const features = [];
  for (const f of s.features || []) features.push({ ...f, id: `${s.id}.f.${f.id}`, steps: f.steps || [], status: f.status || "live", auto: f.auto || [], access: f.access || null });
  for (const id of s.tracker || []) features.push(trackerFeature(s.id, id));
  const missing = !main;
  if (!features.length) features.push({ id: `${s.id}.f.opens`, title: `${s.title} opens and shows its data`, about: "", steps: [`Open ${s.open}.`, "Use each button and field below on test data."], expect: "The page opens with no error message; lists, filters and buttons work as their rows below say.", status: "live", auto: [] });
  if (missing) features.unshift({ id: `${s.id}.f.page`, title: "The page exists and opens", about: "The UI check could not open this page (no page at this address, a sign-in redirect, or no example record).", steps: [`Open ${s.open}.`], expect: "The page opens; if it shows 'not found', report it as a Fail.", status: "live", auto: [] });
  sections.push({
    id: s.id, area: s.area, title: s.title, open: s.open, who: s.who, access: s.access || null,
    autoScreen: main ? `UI-${s.id}` : null, landed: main?.landed || null, skipped: main?.skipped || null,
    features, buttons: buttonRows(s, btns), fields: fieldRows(fields), panels: main?.panels || [],
    parts: subs.map((x) => ({ key: x.key, via: x.via, buttons: x.buttons.length, fields: x.fields.length })),
  });
}
const orphans = Object.keys(screens).filter((k) => !covered.has(k));
if (orphans.length) console.warn(`Not on the sheet (no section): ${orphans.join(", ")}`);

// Links that go to a page the CRM does not have (a menu item with no page behind it).
// Every page the CRM has (app/**/page.js), not only the ones the UI check opened.
const routes = new Set();
const walk = (dir, parts) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!["api", "node_modules"].includes(e.name)) walk(path.join(dir, e.name), [...parts, e.name]); }
    else if (/^page\.(js|jsx|tsx)$/.test(e.name)) routes.add("/" + parts.filter((p) => !/^\(.*\)$/.test(p)).join("/"));
  }
};
walk(path.join(here, "..", "aidmvcs-be-dev", "app"), []);
const pattern = [...routes].map((r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/?#]+")}$`));
for (const sec of sections) for (const b of sec.buttons) {
  if (!b.href || /^https?:|^mailto:|^tel:/.test(b.href)) continue;
  const p = b.href.split(/[?#]/)[0].replace(/:id/g, "x");
  if (p.startsWith("/") && !pattern.some((re) => re.test(p))) { b.deadLink = true; b.expect = `${b.expect} (The UI check found no page at ${p.split("?")[0]}: check it.)`; }
}

// Short codes per section (LED-03 feature, LED-B07 button) so testers and developers name a test exactly.
const used = new Set();
for (const sec of sections) {
  const words = sec.title.replace(/\(.*?\)/g, "").split(/[^A-Za-z]+/).filter(Boolean);
  let p = (words.length >= 3 ? words.slice(0, 3).map((w) => w[0]).join("") : words.length === 2 ? words[0].slice(0, 2) + words[1][0] : (words[0] || "SEC").slice(0, 3)).toUpperCase();
  if (sec.area === "admin" && !/^\w+\/_menu$/.test(sec.id)) p = `A${p.slice(0, 2)}`;
  let n = 1;
  while (used.has(p)) p = `${p.slice(0, 2)}${n++}`;
  used.add(p);
  sec.code = p;
  sec.features.forEach((f, i) => { f.code = `${p}-${String(i + 1).padStart(2, "0")}`; });
  sec.buttons.forEach((b, i) => { b.code = `${p}-B${String(i + 1).padStart(2, "0")}`; });
}

const count = (k) => sections.reduce((n, s) => n + s[k].length, 0);
const out = {
  generatedAt: new Date().toISOString(), app: APP, areas: AREAS, inventoryAt: inventory.crawledAt,
  totals: { sections: sections.length, features: count("features"), buttons: count("buttons"), fields: count("fields") },
  sections,
};
fs.writeFileSync(path.join(here, "features.json"), JSON.stringify(out, null, 1));
const dead = sections.flatMap((s) => s.buttons.filter((b) => b.deadLink).map((b) => `${s.code} ${b.label} → ${b.href}`));
console.log(`features.json: ${out.totals.sections} sections, ${out.totals.features} features, ${out.totals.buttons} buttons, ${out.totals.fields} fields`);
if (dead.length) console.log(`Links to no page (${dead.length}):\n  ${[...new Set(dead)].join("\n  ")}`);
const notOpened = sections.filter((s) => !s.autoScreen || s.landed || s.skipped).map((s) => `${s.code} ${s.id}${s.landed ? ` (went to ${s.landed})` : s.skipped ? ` (${s.skipped})` : " (not crawled)"}`);
if (notOpened.length) console.log(`Pages the UI check did not open (${notOpened.length}):\n  ${notOpened.join("\n  ")}`);
