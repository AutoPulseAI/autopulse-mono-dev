// Feature & test sheet (/sheet/<token>/): the checklist built from features.json, each tester's own results
// (one record per test and tester), the issues they found (open → fixed → verified) and the automated results.
// Unsaved notes, the tester name, the open tab and the filters are kept in this browser, so a refresh loses nothing.
const $ = (id) => document.getElementById(id);
// Every request goes under /sheet/<token>/ (the page itself is served at /sheet/<token>, without the slash).
const ROOT = `${location.pathname.replace(/\/+$/, "")}/`;
const LABEL = { pass: "Pass", fail: "Fail", blocked: "Blocked" };
const ISSUE = { open: "Open", fixed: "Fixed · awaiting review", verified: "Closed (verified)" };
const state = { data: null, auto: null, results: [], byRow: new Map(), rows: [], rowById: new Map(), sections: [], leads: ["Lead tester"], developer: "Lead developer" };

// ---------- small helpers ----------
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) node.append(c);
  return node;
}
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let toastTimer;
function toast(text, err = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = `toast${err ? " err" : ""}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2200);
}
async function api(path, body) {
  const res = await fetch(ROOT + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
  return data;
}
const when = (ms) => (ms ? new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const keyOf = (name) => String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
const me = () => $("tester").value.trim().replace(/\s+/g, " ");
const draftKey = (rowId) => `qa-draft|${keyOf(me())}|${rowId}`;
function needName() {
  if (me()) return me();
  const el = $("tester").hidden ? $("tester-pick") : $("tester");
  el.classList.add("need");
  el.focus();
  toast("Choose or add your name at the top first", true);
  return null;
}
function lightbox(src) {
  $("lightbox-img").src = src;
  $("lightbox").hidden = false;
}

// ---------- results index ----------
function indexResults(list) {
  state.results = list;
  state.byRow = new Map();
  for (const r of list) {
    if (!state.byRow.has(r.id)) state.byRow.set(r.id, new Map());
    state.byRow.get(r.id).set(keyOf(r.tester), r);
  }
}
function upsertResult(r) {
  const i = state.results.findIndex((x) => x.id === r.id && keyOf(x.tester) === keyOf(r.tester));
  if (i >= 0) state.results[i] = r; else state.results.push(r);
  if (!state.byRow.has(r.id)) state.byRow.set(r.id, new Map());
  state.byRow.get(r.id).set(keyOf(r.tester), r);
}
const mine = (rowId) => state.byRow.get(rowId)?.get(keyOf(me())) || null;
const others = (rowId) => [...(state.byRow.get(rowId)?.values() || [])].filter((r) => keyOf(r.tester) !== keyOf(me()) && (r.status || r.shots?.length));

// ---------- general problems, per screen ----------
// A problem that is not one of the listed tests is filed under its screen ("General problems on this screen"):
// its own result with id "<section>.x.<unique>", status fail, a note and any number of screenshots (up to 10).
// Each one is a separate issue (Fixed / Verified / Reopen). Older "general.x.*" reports show under "General".
const GENERAL = { id: "general", title: "General (no screen chosen)", code: "GEN", area: "" };
const isReport = (id) => /\.x\./.test(id);
const reportSec = (id) => (id.startsWith("general.x.") ? GENERAL : state.sections.find((x) => id.startsWith(`${x.id}.x.`)) || GENERAL);
function rowInfo(id) {
  const row = state.rowById.get(id);
  if (row) return row;
  if (!isReport(id)) return null;
  const sec = reportSec(id);
  return { id, code: `${sec.code}-G`, kind: "report", label: "General problem on this screen", sec };
}
const reportsFor = (secId) => state.results.filter((r) => isReport(r.id) && reportSec(r.id).id === secId).sort((a, b) => (b.at || 0) - (a.at || 0));

async function readImage(f) {
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) throw new Error(`${f.name}: use PNG, JPEG or WebP`);
  if (f.size > 5 * 1024 * 1024) throw new Error(`${f.name}: must be under 5 MB`);
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error(`${f.name}: could not be read`)); r.readAsDataURL(f); });
}
async function uploadAll(id, files, name) {
  let result = null;
  for (const f of files) result = (await api("results/shot", { id, dataUrl: await readImage(f), name: f.name, tester: name })).result;
  return result;
}
function refreshReports(secId) {
  const sec = secId === "general" ? GENERAL : state.sections.find((x) => x.id === secId);
  if (sec === GENERAL) paintGeneral(); else if (sec) paintReports(sec);
  refreshCounts();
  renderResults();
}

function reportCard(r) {
  const own = keyOf(r.tester) === keyOf(me());
  const st = r.issue?.state || "open";
  const card = h("article", { class: `report st-${st}` });
  const paint = (editing = false) => {
    const files = h("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp", "aria-label": "Add screenshots" });
    files.addEventListener("change", async () => {
      const list = [...(files.files || [])];
      if (!list.length) return;
      try {
        const res = await uploadAll(r.id, list, me());
        if (res) { upsertResult(res); r = res; }
        toast(`${list.length} screenshot${list.length > 1 ? "s" : ""} added`);
        refreshReports(reportSec(r.id).id);
      } catch (e) { toast(e.message, true); }
    });
    const dk = `qa-report-edit|${r.id}`;
    const edit = h("textarea", { maxlength: "4000", "aria-label": "Edit the description" });
    edit.value = store.get(dk, null) ?? (r.note || "");
    edit.addEventListener("input", () => store.set(dk, edit.value));
    card.replaceChildren(...[
      h("div", { class: "i-head" },
        h("span", { class: `pill i-${st}`, text: ISSUE[st] }),
        h("b", { text: r.tester }), h("span", { class: "muted small", text: when(r.at) })),
      editing ? edit : h("div", { class: "note", text: r.note || "No description." }),
      (r.shots || []).length ? h("div", { class: "shots" }, r.shots.map((sh) => h("div", { class: "shot" },
        h("img", { src: `${ROOT}shots/${sh.file}`, alt: `Screenshot by ${r.tester}`, loading: "lazy", onclick: () => lightbox(`${ROOT}shots/${sh.file}`) }),
        own ? h("button", { type: "button", title: "Remove this screenshot", "aria-label": "Remove screenshot", text: "×", onclick: async () => {
          if (!confirm("Remove this screenshot?")) return;
          try { const { result } = await api("results/shot/remove", { id: r.id, tester: me(), file: sh.file }); upsertResult(result); refreshReports(reportSec(r.id).id); } catch (e) { toast(e.message, true); }
        } }) : null))) : null,
      own ? h("div", { class: "tools" },
        editing
          ? [h("button", { type: "button", class: "btn small primary", text: "Save", onclick: async () => {
              try { const { result } = await api("results", { id: r.id, status: "fail", note: edit.value, tester: me() }); upsertResult(result); store.del(dk); toast("Saved"); refreshReports(reportSec(r.id).id); } catch (e) { toast(e.message, true); }
            } }), h("button", { type: "button", class: "btn small", text: "Cancel", onclick: () => { store.del(dk); paint(false); } })]
          : [h("button", { type: "button", class: "btn small", text: "Edit description", onclick: () => paint(true) }), h("span", { class: "btn small file-btn" }, "Add screenshots", files)]) : null,
    ].filter(Boolean));
  };
  paint(store.get(`qa-report-edit|${r.id}`, null) != null && own);
  return card;
}

function reportList(secId) {
  const list = reportsFor(secId);
  if (!list.length) return null;
  return h("div", { class: "reports" },
    h("div", { class: "sub-head", text: `General problems on this screen · ${list.length}` }),
    h("div", { class: "tests" }, list.map(reportCard)));
}

function reportForm(sec, host, onDone) {
  const dk = () => `qa-report|${keyOf(me())}|${sec.id}`;
  const note = h("textarea", { placeholder: "What went wrong? Where exactly, the error message, steps to repeat…", maxlength: "4000", "aria-label": "Describe the problem" });
  note.value = store.get(dk(), "") || "";
  note.addEventListener("input", () => (note.value ? store.set(dk(), note.value) : store.del(dk())));
  const file = h("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp", "aria-label": "Screenshots" });
  const fileName = h("span", { class: "muted small" });
  file.addEventListener("change", () => { const n = file.files?.length || 0; fileName.textContent = n ? `${n} screenshot${n > 1 ? "s" : ""} chosen` : ""; });
  const send = h("button", { type: "button", class: "btn primary", text: "Report problem" });
  send.addEventListener("click", async () => {
    const name = needName();
    if (!name) return;
    if (!note.value.trim()) { toast("Describe the problem first", true); note.focus(); return; }
    const files = [...(file.files || [])];
    if (files.length > 10) { toast("Up to 10 screenshots per problem", true); return; }
    send.disabled = true;
    try {
      for (const f of files) await readImage(f).then(() => null); // check them all before saving anything
      const id = `${sec.id}.x.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      let { result } = await api("results", { id, status: "fail", note: note.value, tester: name });
      if (files.length) result = (await uploadAll(id, files, name)) || result;
      upsertResult(result);
      store.del(dk());
      toast(`Problem reported on ${sec.title}`);
      onDone();
    } catch (e) {
      toast(e.message, true);
    } finally {
      send.disabled = false;
    }
  });
  host.replaceChildren(h("div", { class: "report-form" },
    h("b", { text: `General problem on: ${sec.title}` }),
    h("p", { class: "muted small", text: "For a problem on this screen that is not one of the tests listed. Report each problem separately; each becomes its own issue. You can add several screenshots now and more later. Your text is kept if you refresh." }),
    note,
    h("div", { class: "tools" }, h("span", { class: "btn small file-btn" }, "Add screenshots", file), fileName),
    h("div", { class: "tools" }, send, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { host.replaceChildren(); } }))));
  note.focus();
}

function paintReports(sec) {
  const slot = sec.reportSlot;
  if (!slot) return;
  slot.replaceChildren(...[reportList(sec.id)].filter(Boolean));
}
function paintGeneral() {
  const host = $("general-reports");
  host.replaceChildren(...[reportList("general")].filter(Boolean));
}

// ---------- automated ----------
function autoTest(id) {
  for (const s of Object.values(state.auto?.suites || {})) { const t = s.tests?.find((x) => x.id === id); if (t) return t; }
  return null;
}
function autoPill(id) {
  const t = autoTest(id);
  if (!t) return h("span", { class: "pill auto-none", title: "Automated test (no result published yet)", text: `⚙ ${id}` });
  return h("span", { class: `pill ${t.ok ? "auto-ok" : "auto-bad"}`, title: `Automated: ${t.name}${t.note ? ` — ${t.note}` : ""}`, text: `${t.ok ? "✓" : "✗"} ${id}` });
}
function renderAuto() {
  const names = { ui: "UI check (every page, tab and pop-up in Chrome)" };
  const sum = $("auto-sum");
  const grid = $("auto-grid");
  sum.replaceChildren();
  grid.replaceChildren();
  for (const key of Object.keys(names)) {
    const s = state.auto?.suites?.[key];
    const tests = s?.tests || [];
    const ok = tests.filter((t) => t.ok).length;
    const cls = !tests.length ? "auto-none" : ok === tests.length ? "auto-ok" : "auto-bad";
    sum.append(h("span", { class: `pill ${cls}`, text: `${names[key]}: ${tests.length ? `${ok}/${tests.length}` : "not run"}` }));
    grid.append(h("div", { class: "suite" },
      h("h3", {}, names[key], h("span", { class: `pill ${cls}`, text: tests.length ? `${ok}/${tests.length} pass` : "not run" })),
      h("div", { class: "muted small", text: s?.runAt ? `Run ${when(Date.parse(s.runAt))}` : "No results published yet" }),
      tests.length ? h("ul", {}, tests.map((t) => h("li", {}, `${t.ok ? "✓" : "✗"} `, h("b", { text: t.id }), ` ${t.name}`, !t.ok && t.note ? h("div", { class: "muted", text: t.note }) : null))) : null));
  }
}

// "admin": only AutoPulse super admins (or "Login as" from the admin portal) see it until it is switched on for dealers.
function accessPill(access) {
  if (access !== "admin") return null;
  return h("span", { class: "pill access-admin", title: "Shown only to AutoPulse super admins (and Login as) until it is switched on for dealers (app/lib/reporting/featureFlags.js).", text: "Super admin only for now" });
}

// ---------- one test card ----------
function resultPanel(row) {
  const box = h("div", { class: "side-r" });
  row.paint = () => {
    if (row.status === "soon") {
      // Not open to dealers yet (or not built): nothing to test. Earlier results stay visible.
      const earlier = [...(state.byRow.get(row.id)?.values() || [])].filter((x) => x.status);
      box.replaceChildren(...[
        h("div", { class: "soon-note" }, h("b", { text: "Coming soon" }), h("span", { text: row.why || "Not testable yet." })),
        earlier.length ? h("div", { class: "others" }, h("span", { class: "lbl", text: `Earlier results (${earlier.length})` }),
          earlier.map((o) => h("div", { class: "other" }, h("span", { class: `pill s-${o.status}`, text: LABEL[o.status] }), h("span", { class: "nm", text: o.tester }), h("span", { class: "muted", text: when(o.at) })))) : null,
      ].filter(Boolean));
      row.el.classList.add("is-soon");
      return;
    }
    const r = mine(row.id);
    const status = r?.status || null;
    const name = me();
    const draft = name ? store.get(draftKey(row.id)) : null;
    const showNote = row.kind === "feature" || status === "fail" || status === "blocked" || r?.note || draft != null || row.noteOpen;
    const note = h("textarea", { placeholder: "What went wrong? Error message, what you saw, steps to repeat…", maxlength: "4000", "aria-label": `Note for ${row.code}` });
    note.value = draft != null ? draft : r?.note || "";
    const hint = h("div", { class: "draft", text: "Unsaved note (kept if you refresh) — press Save note" });
    hint.hidden = draft == null || draft === (r?.note || "");
    note.addEventListener("input", () => {
      if (!me()) return;
      if (note.value === (r?.note || "")) store.del(draftKey(row.id)); else store.set(draftKey(row.id), note.value);
      hint.hidden = note.value === (r?.note || "");
    });
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", "aria-label": `Attach screenshot to ${row.code}`, onchange: (e) => upload(row, e.target.files?.[0], e.target) });
    const parts = [
      h("div", { class: "choice", role: "group", "aria-label": `Your result for ${row.code}` },
        ["pass", "fail", "blocked"].map((s) => h("button", { type: "button", class: `${s}${status === s ? " on" : ""}`, "aria-pressed": String(status === s), text: LABEL[s],
          onclick: () => save(row, status === s ? "clear" : s, note.value) }))),
      showNote ? note : h("button", { type: "button", class: "link", text: "+ Add a note or screenshot", onclick: () => { row.noteOpen = true; row.paint(); } }),
      showNote ? hint : null,
      showNote ? h("div", { class: "tools" },
        h("button", { type: "button", class: "btn small", text: "Save note", onclick: () => save(row, status || "fail", note.value) }),
        h("span", { class: "btn small file-btn" }, "Add screenshot", file)) : null,
      (r?.shots || []).length ? h("div", { class: "shots" }, r.shots.map((s) => h("div", { class: "shot" },
        h("img", { src: `${ROOT}shots/${s.file}`, alt: "Screenshot", loading: "lazy", onclick: () => lightbox(`${ROOT}shots/${s.file}`) }),
        h("button", { type: "button", title: "Remove this screenshot", "aria-label": "Remove screenshot", text: "×", onclick: () => removeShot(row, s.file) })))) : null,
      r?.at ? h("div", { class: "by" }, r.status ? h("span", { class: `pill s-${r.status}`, text: LABEL[r.status] }) : "Cleared", ` by you · ${when(r.at)} `,
        r.issue ? h("span", { class: `pill i-${r.issue.state}`, text: `Issue: ${ISSUE[r.issue.state]}`, title: r.issue.fixNote || r.issue.note || "" }) : null) : null,
    ];
    const oth = others(row.id);
    if (oth.length) parts.push(h("div", { class: "others" }, h("span", { class: "lbl", text: `Other testers (${oth.length})` }),
      oth.map((o) => h("div", { class: "other" },
        o.status ? h("span", { class: `pill s-${o.status}`, text: LABEL[o.status] }) : null,
        h("span", { class: "nm", text: o.tester }), h("span", { class: "muted", text: when(o.at) }),
        o.issue ? h("span", { class: `pill i-${o.issue.state}`, text: ISSUE[o.issue.state] }) : null,
        o.note ? h("span", { class: "nt", text: o.note }) : null,
        (o.shots || []).length ? h("div", { class: "shots" }, o.shots.map((s) => h("div", { class: "shot" }, h("img", { src: `${ROOT}shots/${s.file}`, alt: `Screenshot by ${o.tester}`, loading: "lazy", onclick: () => lightbox(`${ROOT}shots/${s.file}`) })))) : null))));
    box.replaceChildren(...parts.filter(Boolean));
    row.el.classList.remove("r-pass", "r-fail", "r-blocked");
    if (status) row.el.classList.add(`r-${status}`);
  };
  return box;
}

function featureCard(sec, f) {
  const row = { id: f.id, code: f.code, kind: "feature", sec, status: f.status, why: f.why, label: f.title, text: `${f.code} ${sec.title} ${f.title} ${f.about || ""} ${f.expect || ""}`.toLowerCase() };
  row.el = h("article", { class: "test", id: `t-${f.code}` });
  row.el.append(
    h("div", { class: "body" },
      h("div", { class: "t-head" }, h("span", { class: "t-code", text: f.code }), h("span", { class: "t-title", text: f.title }),
        f.status === "soon" ? h("span", { class: "pill soon", text: "Coming soon" }) : null, accessPill(f.access || sec.access), (f.auto || []).map(autoPill)),
      f.about ? h("p", { class: "about", text: f.about }) : null,
      f.steps?.length ? h("ol", {}, f.steps.map((s) => h("li", { text: s }))) : null,
      f.expect ? h("div", { class: "exp" }, h("b", { text: "Expected:" }), f.expect) : null),
    resultPanel(row));
  return row;
}
function buttonCard(sec, b) {
  const row = { id: b.id, code: b.code, kind: "button", sec, status: b.status, why: b.why, label: b.label, text: `${b.code} ${sec.title} ${b.label} ${b.el || ""} ${b.href || ""} ${b.about} ${b.expect}`.toLowerCase() };
  row.el = h("article", { class: "test compact", id: `t-${b.code}` });
  const kind = { link: "Link", tab: "Tab", field: "Field" }[b.kind] || "Button";
  row.el.append(
    h("div", { class: "body" },
      h("div", { class: "t-head" }, h("span", { class: "t-code", text: b.code }), h("span", { class: "t-title", text: `${kind}: ${b.label}` }), b.status === "soon" ? h("span", { class: "pill soon", text: "Coming soon" }) : null, accessPill(b.access)),
      h("div", { class: "el" }, b.el ? h("code", { text: b.el }) : null, b.panel ? ` in “${b.panel}”` : "", b.href ? h("span", { class: "muted" }, " → ", h("code", { text: b.href })) : null),
      h("p", { class: "about", text: b.about }),
      h("div", { class: "exp" }, h("b", { text: "Expected:" }), b.expect)),
    resultPanel(row));
  return row;
}

// ---------- checklist ----------
function renderChecklist() {
  const { data } = state;
  $("scope").textContent = `${data.app.scope} ${data.app.testStore}`;
  for (const id of ["area", "i-area"]) for (const a of data.areas) $(id).append(h("option", { value: a.id, text: a.title }));
  const host = $("sections");
  const toc = $("toc");
  for (const a of data.areas) {
    const secs = data.sections.filter((s) => s.area === a.id);
    if (!secs.length) continue;
    host.append(h("div", { class: "area-title", "data-area-title": a.id, text: a.title }));
    toc.append(h("div", { class: "grp", "data-area-title": a.id, text: a.title }));
    for (const sec of secs) {
      const fRows = sec.features.map((f) => featureCard(sec, f));
      const bRows = sec.buttons.map((b) => buttonCard(sec, b));
      for (const r of [...fRows, ...bRows]) { state.rows.push(r); state.rowById.set(r.id, r); }
      sec.rowsAll = [...fRows, ...bRows];
      sec.card = h("section", { class: "sec", id: `sec-${sec.id}`, "data-area": a.id },
        h("div", { class: "sec-head" },
          h("div", {}, h("h3", {}, h("span", { class: "sec-code", text: sec.code }), sec.title),
            h("div", { class: "meta" }, h("b", { text: "Open: " }), sec.open, "   ·   ", h("b", { text: "Who: " }), sec.who)),
          h("div", { class: "sec-tools" },
            sec.autoScreen ? autoPill(sec.autoScreen) : null,
            h("button", { type: "button", class: "btn small report-btn", text: "⚑ Report a general problem on this screen", onclick: () => {
              setOpen(sec, true);
              reportForm(sec, sec.formSlot, () => { sec.formSlot.replaceChildren(); paintReports(sec); refreshCounts(); renderResults(); });
              sec.formSlot.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } }),
            h("button", { type: "button", class: "btn small sec-toggle", "aria-expanded": "false", "aria-controls": `body-${sec.id}` }, h("span", { class: "chev", text: "▸" }), h("span", { class: "lbl", text: "Show tests" })))),
        (sec.body = h("div", { class: "sec-body" },
        (sec.formSlot = h("div", { class: "form-slot" })),
        fRows.length ? h("div", { class: "sub-head", text: `Features · ${fRows.length}` }) : null,
        fRows.length ? h("div", { class: "tests" }, fRows.map((r) => r.el)) : null,
        bRows.length ? h("div", { class: "sub-head btn-head", text: `Every button on this screen · ${bRows.length}` }) : null,
        bRows.length ? h("div", { class: "tests btn-tests" }, bRows.map((r) => r.el)) : null,
        sec.fields.length ? h("details", { class: "fields" }, h("summary", { text: `Every field on this screen (${sec.fields.length})` }),
          h("div", { class: "field-list" }, sec.fields.map((f) => h("div", {}, h("b", { text: f.label || "(no label)" }), h("span", { class: "muted", text: ` · ${f.kind}${f.panel ? ` · ${f.panel}` : ""}` }), f.tip ? h("div", { class: "muted", text: f.tip }) : null)))) : null,
        (sec.reportSlot = h("div", { class: "report-slot" })))));
      host.append(sec.card);
      sec.card.querySelector(".sec-head").addEventListener("click", (e) => { if (!e.target.closest("button:not(.sec-toggle), a, input, select, textarea, .sec-tools > *:not(.sec-toggle)")) setOpen(sec, sec.card.classList.contains("collapsed")); });
      setOpen(sec, openSecs.has(sec.id), false);
      sec.body.id = `body-${sec.id}`;
      sec.tocLink = h("a", { href: `#sec-${sec.id}`, "data-area": a.id, onclick: () => setOpen(sec, true) }, h("span", { text: `${sec.code} · ${sec.title}` }), h("span", { class: "prog" }));
      toc.append(sec.tocLink);
      state.sections.push(sec);
    }
  }
  $("foot").textContent = `Built ${when(Date.parse(data.generatedAt))} from the app's own screens (checked ${when(Date.parse(data.inventoryAt))}): ${data.totals.sections} sections, ${data.totals.features} features, ${data.totals.buttons} buttons, ${data.totals.fields} fields.`;
}

// ---------- open / closed sections ----------
// Every section starts closed; the ones a tester opens stay open in this browser (kept across a refresh).
const openSecs = new Set(store.get("qa-open-secs", []) || []);
function setOpen(sec, open, remember = true) {
  sec.card.classList.toggle("collapsed", !open);
  if (open) openSecs.add(sec.id); else openSecs.delete(sec.id);
  if (remember) store.set("qa-open-secs", [...openSecs]);
  paintToggle(sec);
}
function paintToggle(sec) {
  const shown = !sec.card.classList.contains("collapsed") || sec.card.classList.contains("force-open");
  const b = sec.card.querySelector(".sec-toggle");
  b.setAttribute("aria-expanded", String(shown));
  const n = sec.rowsAll.length;
  b.querySelector(".lbl").textContent = shown ? "Hide tests" : `Show tests (${n})`;
}

// ---------- tester name: pick from everyone who has tested, or add a new one ----------
const NEW_NAME = "__new__";
function knownTesters() {
  const m = new Map();
  for (const r of [...state.results].sort((a, b) => (a.at || 0) - (b.at || 0))) if (r.tester) m.set(keyOf(r.tester), r.tester.trim());
  const mine = me();
  if (mine) m.set(keyOf(mine), mine);
  return [...m.values()].sort((a, b) => a.localeCompare(b));
}
function paintTesterPick() {
  const pick = $("tester-pick");
  const cur = keyOf(me());
  const names = knownTesters();
  pick.replaceChildren(h("option", { value: "", text: "Choose your name…" }),
    ...names.map((n) => h("option", { value: n, text: n })),
    h("option", { value: NEW_NAME, text: "+ Add a new name…" }));
  if (!$("tester").hidden) pick.value = NEW_NAME;
  else pick.value = names.find((n) => keyOf(n) === cur) || "";
}
function useName(name) {
  $("tester").value = name;
  $("tester-pick").classList.remove("need");
  $("tester").classList.remove("need");
  store.set("qa-tester", me());
  paintAll();
  applyFilters();
}

function paintAll() {
  for (const r of state.rows) r.paint();
  for (const sec of state.sections) paintReports(sec);
  paintGeneral();
  refreshCounts();
}

function refreshCounts() {
  const name = me();
  const testable = state.rows.filter((r) => r.status !== "soon");
  const n = { pass: 0, fail: 0, blocked: 0 };
  for (const r of testable) { const s = mine(r.id)?.status; if (s) n[s] += 1; }
  const done = n.pass + n.fail + n.blocked;
  $("me-done").textContent = name ? `${done} / ${testable.length}` : "–";
  $("me-of").textContent = name ? `tests done by ${name}` : "Type your name above to start";
  $("me-bar").style.width = `${testable.length ? (done / testable.length) * 100 : 0}%`;
  for (const k of ["pass", "fail", "blocked"]) $(`me-${k}`).textContent = name ? n[k] : "–";
  $("n-soon").textContent = state.rows.length - testable.length;
  for (const sec of state.sections) {
    const rows = sec.rowsAll.filter((r) => r.status !== "soon");
    const st = rows.map((r) => mine(r.id)?.status);
    const d = st.filter(Boolean).length;
    const bad = st.some((s) => s === "fail" || s === "blocked");
    const p = sec.tocLink.querySelector(".prog");
    p.textContent = rows.length ? (name ? `${d}/${rows.length}` : `${rows.length}`) : "soon";
    p.className = `prog${bad ? " bad" : d && d === rows.length ? " done" : ""}`;
  }
  const open = state.results.filter((r) => r.issue?.state === "open").length;
  $("open-count").textContent = open;
  $("open-count").hidden = !open;
}

function applyFilters() {
  const q = $("q").value.trim().toLowerCase();
  const area = $("area").value;
  const show = $("show").value;
  const buttons = $("show-buttons").checked;
  const fields = $("show-fields").checked;
  store.set("qa-filters", { q: $("q").value, area, show, buttons, fields });
  for (const r of state.rows) {
    const s = mine(r.id)?.status;
    let ok = (!q || r.text.includes(q)) && (!area || r.sec.area === area) && (buttons || r.kind !== "button");
    if (ok && show === "mine-open") ok = r.status !== "soon" && !s;
    if (ok && show === "mine-bad") ok = s === "fail" || s === "blocked";
    if (ok && show === "mine-pass") ok = s === "pass";
    if (ok && show === "anyone-bad") ok = [...(state.byRow.get(r.id)?.values() || [])].some((x) => x.status === "fail" || x.status === "blocked");
    if (ok && show === "soon") ok = r.status === "soon";
    r.el.classList.toggle("hide", !ok);
  }
  const filtering = q || show || !buttons;
  for (const sec of state.sections) {
    const any = sec.rowsAll.some((r) => !r.el.classList.contains("hide"));
    const visible = (!area || sec.area === area) && (any || !filtering);
    sec.card.classList.toggle("hide", !visible);
    sec.card.classList.toggle("force-open", Boolean(visible && filtering && any));
    paintToggle(sec);
    sec.tocLink.classList.toggle("hide", !visible);
    sec.card.querySelector(".btn-head")?.classList.toggle("hide", !buttons);
    sec.card.querySelector(".btn-tests")?.classList.toggle("hide", !buttons);
    sec.card.querySelector("details.fields")?.classList.toggle("hide", !fields);
  }
  for (const el of document.querySelectorAll("[data-area-title]")) {
    const a = el.dataset.areaTitle;
    el.classList.toggle("hide", !state.sections.some((s) => s.area === a && !s.card.classList.contains("hide")));
  }
}

// ---------- saving ----------
async function save(row, status, note) {
  const name = needName();
  if (!name) return;
  try {
    const { result } = await api("results", { id: row.id, status, note, tester: name });
    upsertResult(result);
    store.del(draftKey(row.id));
    row.paint();
    refreshCounts();
    renderResults();
    toast(status === "clear" ? `${row.code}: result cleared` : `${row.code}: ${LABEL[status]} saved`);
  } catch (e) {
    toast(e.message, true);
  }
}
async function upload(row, file, input) {
  const name = needName();
  if (!name || !file) { input.value = ""; return; }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast("Attach a PNG, JPEG or WebP image", true); input.value = ""; return; }
  if (file.size > 5 * 1024 * 1024) { toast("The image must be under 5 MB", true); input.value = ""; return; }
  const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
  try {
    const { result } = await api("results/shot", { id: row.id, dataUrl, name: file.name, tester: name });
    upsertResult(result);
    row.paint();
    renderResults();
    toast(`${row.code}: screenshot added`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    input.value = "";
  }
}
async function removeShot(row, fileName) {
  const name = needName();
  if (!name || !confirm("Remove this screenshot?")) return;
  try {
    const { result } = await api("results/shot/remove", { id: row.id, tester: name, file: fileName });
    upsertResult(result);
    row.paint();
    renderResults();
    toast("Screenshot removed");
  } catch (e) {
    toast(e.message, true);
  }
}
async function setIssue(r, issueState, note) {
  const by = needName();
  if (!by) return;
  try {
    const { result } = await api("results/issue", { id: r.id, tester: r.tester, by, state: issueState, note });
    upsertResult(result);
    store.del(`qa-fixnote|${r.id}|${keyOf(r.tester)}`);
    state.rowById.get(r.id)?.paint();
    if (isReport(r.id)) { const sec = reportSec(r.id); if (sec.id === "general") paintGeneral(); else paintReports(sec); }
    refreshCounts();
    renderResults();
    toast(`Issue marked ${ISSUE[issueState]}`);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- results & issues ----------
function renderResults() {
  if (!state.data) return;
  const testable = state.rows.filter((r) => r.status !== "soon").length;
  const testers = new Map();
  for (const r of state.results) {
    if (!r.status) continue;
    const k = keyOf(r.tester);
    const t = testers.get(k) || { name: r.tester, pass: 0, fail: 0, blocked: 0, last: 0 };
    t[r.status] += 1;
    t.last = Math.max(t.last, r.at || 0);
    testers.set(k, t);
  }
  const body = $("testers").querySelector("tbody");
  body.replaceChildren();
  const list = [...testers.values()].sort((a, b) => b.last - a.last);
  if (!list.length) body.append(h("tr", {}, h("td", { colspan: "7", class: "muted", text: "No results yet. Testers appear here after their first Pass, Fail or Blocked." })));
  for (const t of list) {
    const done = t.pass + t.fail + t.blocked;
    const pct = (n) => `${testable ? (n / testable) * 100 : 0}%`;
    const bar = h("span", { class: "mini-meter" });
    for (const [n, c] of [[t.pass, "var(--ok)"], [t.fail, "var(--bad)"], [t.blocked, "var(--warn)"]]) { const s = h("span"); s.style.width = pct(n); s.style.background = c; bar.append(s); }
    body.append(h("tr", {},
      h("td", {}, h("b", { text: t.name })),
      h("td", {}, bar, `${done} / ${testable}`),
      h("td", { class: "num", text: t.pass }), h("td", { class: "num", text: t.fail }), h("td", { class: "num", text: t.blocked }),
      h("td", { text: when(t.last) }),
      h("td", {}, h("button", { type: "button", class: "btn small", text: "Show issues", onclick: () => { $("i-tester").value = keyOf(t.name); store.set("qa-ifilters", issueFilters()); renderIssues(); $("issues").scrollIntoView({ behavior: "smooth" }); } }))));
  }
  const sel = $("i-tester");
  const keep = sel.value;
  sel.replaceChildren(h("option", { value: "", text: "All testers" }), ...list.map((t) => h("option", { value: keyOf(t.name), text: t.name })));
  sel.value = keep;
  renderIssues();
}

function issueFilters() {
  return { state: document.querySelector("#state-seg button.on")?.dataset.state ?? "open", tester: $("i-tester").value, area: $("i-area").value, screen: $("i-screen").value, q: $("i-q").value };
}

function renderIssues() {
  const f = issueFilters();
  const all = state.results.filter((r) => r.issue);
  const count = (s) => all.filter((r) => r.issue.state === s).length;
  for (const s of ["open", "fixed", "verified"]) $(`c-${s}`).textContent = `(${count(s)})`;
  $("issue-total").textContent = `· ${count("open")} open, ${count("fixed")} fixed, ${count("verified")} verified`;
  const q = f.q.trim().toLowerCase();
  const order = { open: 0, fixed: 1, verified: 2 };
  const shown = all.filter((r) => {
    const row = rowInfo(r.id);
    return (!f.state || r.issue.state === f.state) && (!f.tester || keyOf(r.tester) === f.tester) && (!f.area || row?.sec.area === f.area) && (!f.screen || row?.sec.id === f.screen)
      && (!q || `${row?.code} ${row?.label} ${row?.sec.title} ${r.note} ${r.tester}`.toLowerCase().includes(q));
  }).sort((a, b) => order[a.issue.state] - order[b.issue.state] || (b.at || 0) - (a.at || 0));
  const host = $("issues");
  host.replaceChildren();
  if (!shown.length) { host.append(h("div", { class: "empty-state", text: all.length ? "No issues match these filters." : "No issues yet. When a tester marks a test Fail or Blocked, it shows up here." })); return; }
  // Reports on the same test are grouped: one heading per test, each tester's report (note, screenshots,
  // history, actions) inside it. Groups with an open report come first, newest activity first.
  const groups = new Map();
  for (const r of shown) {
    if (!groups.has(r.id)) groups.set(r.id, []);
    groups.get(r.id).push(r);
  }
  const rank = (list) => Math.min(...list.map((r) => order[r.issue.state]));
  const latest = (list) => Math.max(...list.map((r) => r.at || 0));
  const sorted = [...groups.values()].sort((x, y) => rank(x) - rank(y) || latest(y) - latest(x));
  for (const list of sorted) {
    const row = rowInfo(list[0].id);
    const title = row ? (row.kind === "button" ? `Button: ${row.label}` : row.kind === "report" ? `General problem · ${row.sec.title}` : row.label) : list[0].id;
    const testers = [...new Set(list.map((r) => r.tester))];
    const counts = ["open", "fixed", "verified"].map((k) => [k, list.filter((r) => r.issue.state === k).length]).filter(([, n]) => n);
    host.append(h("section", { class: "issue-group" },
      h("div", { class: "g-head" },
        h("span", { class: "t-code", text: row?.code || list[0].id }),
        h("b", { class: "g-title", text: title }),
        h("span", { class: "muted small", text: `${row?.sec.title || ""} · ${testers.length > 1 ? `reported by ${testers.length} testers: ${testers.join(", ")}` : `reported by ${testers[0]}`}` }),
        h("span", { class: "g-counts" }, counts.map(([k, n]) => h("span", { class: `pill i-${k}`, text: `${n} ${ISSUE[k]}` }))),
        row ? h("button", { type: "button", class: "btn small", text: "Go to test", onclick: () => goTo(row) }) : null),
      bugSummary(list),
      bugHistory(list),
      list.map((r) => issueCard(r))));
  }
}

// Bug status across its reports: Open / Reopened / Fixed · awaiting review / Closed, plus who reported it (when),
// who fixed it and which lead tester verified it.
function bugStatus(list) {
  if (list.some((r) => r.issue.state === "open")) {
    const reopened = list.some((r) => r.issue.state === "open" && (r.issue.log || []).filter((l) => l.state === "open").length > 1);
    return reopened ? ["reopened", "Reopened"] : ["open", "Open"];
  }
  if (list.some((r) => r.issue.state === "fixed")) return ["fixed", "Fixed · awaiting lead tester"];
  return ["verified", "Closed (verified)"];
}
function bugSummary(list) {
  const logs = list.flatMap((r) => (r.issue.log || []).map((l) => ({ ...l, about: r.tester })));
  const lastOf = (st) => logs.filter((l) => l.state === st).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  const firstReports = list.map((r) => ({ tester: r.tester, at: (r.issue.log || []).find((l) => l.state === "open")?.at || r.at })).sort((a, b) => a.at - b.at);
  const fixed = lastOf("fixed");
  const verified = lastOf("verified");
  const [cls, label] = bugStatus(list);
  const cell = (k, v) => h("div", { class: "b-cell" }, h("span", { class: "b-k", text: k }), h("div", { class: "b-v" }, v));
  return h("div", { class: "bug-summary" },
    cell("Status", h("span", { class: `pill big i-${cls === "reopened" ? "open" : cls}`, text: label })),
    cell("Reported by", firstReports.map((x) => h("div", {}, h("b", { text: x.tester }), h("span", { class: "muted", text: ` · ${when(x.at)}` })))),
    cell("Fixed by (developer)", fixed ? [h("div", {}, h("b", { text: fixed.by }), h("span", { class: "muted", text: ` · ${when(fixed.at)}` })), fixed.note ? h("div", { class: "muted small", text: fixed.note }) : null] : h("span", { class: "muted", text: "Not fixed yet" })),
    cell(`Verified by (lead tester: ${state.leads.join(", ")})`, verified && cls === "verified" ? h("div", {}, h("b", { text: verified.by }), h("span", { class: "muted", text: ` · ${when(verified.at)}` })) : h("span", { class: "muted", text: cls === "fixed" ? "Waiting for the lead tester to re-test" : "—" })));
}

// The whole story of one bug across every tester, oldest first: each report and its note, every screenshot,
// re-tests, fixes, comments, reopenings and verification.
function bugHistory(list) {
  const steps = [];
  for (const r of list) {
    (r.issue?.log || []).forEach((l, i) => steps.push({ at: l.at || 0, kind: l.state === "open" && (l.reopened || i > 0) ? "reopen" : l.state, by: l.by, note: l.note, result: l.result, about: r.tester }));
    for (const sh of r.shots || []) steps.push({ at: sh.at || 0, kind: "shot", by: r.tester, file: sh.file, about: r.tester });
  }
  if (!steps.length) return null;
  steps.sort((a, b) => a.at - b.at);
  const shots = steps.filter((x) => x.kind === "shot").length;
  const testers = new Set(list.map((r) => r.tester)).size;
  const items = steps.map((x) => {
    const [icon, label] = x.kind === "shot" ? ["📷", "Screenshot added"] : STEP[x.kind] || ["•", x.kind];
    return h("li", { class: `step s-${x.kind}` },
      h("span", { class: "ic", text: icon }),
      h("div", {},
        h("div", {}, h("b", { text: label }), x.result ? h("span", { class: `pill s-${x.result}`, text: LABEL[x.result] || x.result }) : null,
          " by ", h("b", { text: x.by }), x.by !== x.about ? h("span", { class: "muted", text: ` (on ${x.about}'s report)` }) : null, h("span", { class: "muted", text: ` · ${when(x.at)}` })),
        x.note ? h("div", { class: "step-note", text: x.note }) : null,
        x.file ? h("div", { class: "shots" }, h("div", { class: "shot" }, h("img", { src: `${ROOT}shots/${x.file}`, alt: `Screenshot by ${x.by}`, loading: "lazy", onclick: () => lightbox(`${ROOT}shots/${x.file}`) }))) : null));
  });
  return h("details", { class: "timeline bug-history", open: true },
    h("summary", { text: `Full history of this bug · ${steps.length} step${steps.length > 1 ? "s" : ""}, ${shots} screenshot${shots === 1 ? "" : "s"}, ${testers} tester${testers > 1 ? "s" : ""}` }),
    h("ol", {}, items));
}

function issueCard(r) {
  const fixKey = `qa-fixnote|${r.id}|${keyOf(r.tester)}`;
  const fix = h("textarea", { placeholder: "Developer: what was fixed and where (PR). Reviewer: what you re-tested. Or a comment. (Kept if you refresh)", maxlength: "2000", "aria-label": `Note for ${r.tester}'s report` });
  fix.value = store.get(fixKey, "") || "";
  fix.addEventListener("input", () => (fix.value ? store.set(fixKey, fix.value) : store.del(fixKey)));
  const st = r.issue.state;
  return h("article", { class: `issue st-${st}` },
    h("div", {},
      h("div", { class: "i-head" },
        h("span", { class: `pill i-${st}`, text: ISSUE[st] }),
        r.status ? h("span", { class: `pill s-${r.status}`, text: LABEL[r.status] }) : h("span", { class: "pill auto-none", text: "Result cleared by tester" }),
        h("b", { text: r.tester }), h("span", { class: "muted small", text: when(r.at) })),
      h("div", { class: `note${r.note ? "" : " empty"}`, text: r.note || "No note was written." }),
      (r.shots || []).length ? h("div", { class: "shots" }, r.shots.map((s) => h("div", { class: "shot" }, h("img", { src: `${ROOT}shots/${s.file}`, alt: `Screenshot by ${r.tester}`, loading: "lazy", onclick: () => lightbox(`${ROOT}shots/${s.file}`) })))) : null,
      timeline(r)),
    h("div", { class: "actions" },
      fix,
      h("div", { class: "row-btns" },
        st === "open" ? h("button", { type: "button", class: "btn primary", text: "Mark fixed (developer)", title: "Say what was changed and where (PR); it then waits for the lead tester", onclick: () => setIssue(r, "fixed", fix.value) }) : null,
        st === "fixed" ? h("button", { type: "button", class: "btn ok", text: "Close · verified (lead tester)", title: "Lead tester only: re-tested and it works", onclick: () => setIssue(r, "verified", fix.value) }) : null,
        st !== "open" ? h("button", { type: "button", class: "btn danger", text: "Reopen", title: "It still fails", onclick: () => setIssue(r, "open", fix.value) }) : null,
        h("button", { type: "button", class: "btn", text: "Add comment", onclick: () => setIssue(r, "comment", fix.value) }))));
}

// Every step of an issue, oldest first: reported, re-tests, fixes, comments, reopenings, verification.
const STEP = {
  open: ["🔴", "Reported"], reopen: ["🔴", "Reopened"], retest: ["🔁", "Re-tested"], fixed: ["🔧", "Fixed by developer · awaiting review"],
  verified: ["✅", "Closed · verified by lead tester"], comment: ["💬", "Comment"],
};
function timeline(r) {
  const log = r.issue?.log || [];
  if (!log.length) return null;
  const items = log.map((l, i) => {
    const kind = l.state === "open" && (l.reopened || i > 0) ? "reopen" : l.state;
    const [icon, label] = STEP[kind] || ["•", l.state];
    return h("li", { class: `step s-${kind}` },
      h("span", { class: "ic", text: icon }),
      h("div", {},
        h("div", {}, h("b", { text: label }), l.result ? h("span", { class: `pill s-${l.result}`, text: LABEL[l.result] || l.result }) : null, " by ", h("b", { text: l.by }), h("span", { class: "muted", text: ` · ${when(l.at)}` })),
        l.note ? h("div", { class: "step-note", text: l.note }) : null));
  });
  return h("details", { class: "timeline" }, h("summary", { text: `This tester's history (${log.length} step${log.length > 1 ? "s" : ""})` }), h("ol", {}, items));
}

function goTo(row) {
  switchTab("test");
  if (row.kind === "report") {
    for (const [id, v] of [["q", ""], ["area", ""], ["show", ""]]) $(id).value = v;
    applyFilters();
    if (row.sec?.card) setOpen(row.sec, true);
    (row.sec.id === "general" ? $("general-box") : row.sec.card)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  for (const [id, v] of [["q", ""], ["area", ""], ["show", ""]]) $(id).value = v;
  if (row.kind === "button") $("show-buttons").checked = true;
  applyFilters();
  if (row.sec?.card) setOpen(row.sec, true);
  row.el.scrollIntoView({ behavior: "smooth", block: "center" });
  row.el.animate([{ boxShadow: "0 0 0 3px #1f6feb" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1600 });
}

// ---------- CSV ----------
function csv(name, header, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
}
const shotLinks = (r) => (r.shots || []).map((s) => new URL(`${ROOT}shots/${s.file}`, location.href).href).join(" ");
function csvAll() {
  const rows = [];
  for (const row of state.rows) {
    const res = [...(state.byRow.get(row.id)?.values() || [])].filter((r) => r.status);
    if (!res.length) rows.push([row.code, row.sec.title, row.kind, row.label, row.status === "soon" ? "Coming soon" : "Live", "", "", "", "", "", ""]);
    for (const r of res) rows.push([row.code, row.sec.title, row.kind, row.label, row.status === "soon" ? "Coming soon" : "Live", r.tester, LABEL[r.status], r.note, r.issue && r.status !== "pass" ? ISSUE[r.issue.state] : "", new Date(r.at).toISOString(), shotLinks(r)]);
  }
  for (const r of state.results.filter((x) => isReport(x.id))) {
    const info = rowInfo(r.id);
    rows.push([info.code, info.sec.title, "general problem", "General problem on this screen", "Live", r.tester, LABEL[r.status] || "", r.note, r.issue ? ISSUE[r.issue.state] : "", new Date(r.at).toISOString(), shotLinks(r)]);
  }
  csv("autopulse-crm-test-results", ["Code", "Section", "Type", "Test", "Availability", "Tester", "Result", "Note", "Issue", "When", "Screenshots"], rows);
}
function csvIssues() {
  const rows = state.results.filter((r) => r.issue).map((r) => {
    const row = rowInfo(r.id);
    const last = r.issue.log?.at(-1);
    return [row?.code || r.id, row?.sec.title || "", row?.label || "", r.tester, r.status ? LABEL[r.status] : "", r.note, ISSUE[r.issue.state], last ? `${last.by}: ${last.note || ""}` : "", new Date(r.at).toISOString(), shotLinks(r)];
  });
  csv("autopulse-crm-issues", ["Code", "Section", "Test", "Found by", "Result", "Note", "Issue state", "Last action", "When", "Screenshots"], rows);
}

// ---------- testing overview ----------
const DAY = 86400000;
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let ovDays = 7;
let ovShown = 100;

/** Every step on the sheet, oldest first: test results and each issue's reported / fixed / closed / reopened / comment. */
function allEvents() {
  const out = [];
  for (const r of state.results) {
    const info = rowInfo(r.id);
    const base = { id: r.id, code: info?.code || r.id, test: info ? (info.kind === "button" ? `Button: ${info.label}` : info.kind === "report" ? "General problem" : info.label) : r.id, screen: info?.sec?.title || "", screenId: info?.sec?.id || "" };
    for (const h of r.history || []) if (h.status && h.status !== "clear") out.push({ ...base, at: Number(h.at) || 0, kind: "result", result: h.status, by: r.tester, note: h.note || "" });
    (r.issue?.log || []).forEach((l, i) => {
      if (l.state === "retest") return; // the test result above already shows it
      const kind = l.state === "open" ? (l.reopened || i > 0 ? "reopen" : "open") : l.state;
      out.push({ ...base, at: Number(l.at) || 0, kind, by: l.by, note: l.note || "", result: l.result || "" });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

function kpi(label, value, hint, color) {
  const el = h("div", { class: "kpi" }, h("span", { class: "k", text: label }), h("span", { class: "v", text: value }), hint ? h("span", { class: "h", text: hint }) : null);
  el.style.setProperty("--kc", color);
  return el;
}

function renderOverview() {
  if (!state.data) return;
  const events = allEvents();
  const issues = state.results.filter((r) => r.issue);
  const tested = state.results.filter((r) => r.status);
  const testable = state.rows.filter((r) => r.status !== "soon");
  const coveredRows = new Set(tested.map((r) => r.id).filter((id) => state.rowById.has(id)));
  const reopenedIssues = issues.filter((r) => (r.issue.log || []).some((l, i) => l.state === "open" && (l.reopened || i > 0)));
  const fixTimes = issues.map((r) => { const log = r.issue.log || []; const o = log.find((l) => l.state === "open"); const f = log.find((l) => l.state === "fixed"); return o && f ? f.at - o.at : null; }).filter((x) => x != null && x >= 0);
  const closeTimes = issues.map((r) => { const log = r.issue.log || []; const o = log.find((l) => l.state === "open"); const v = [...log].reverse().find((l) => l.state === "verified"); return o && v && r.issue.state === "verified" ? v.at - o.at : null; }).filter((x) => x != null && x >= 0);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const dur = (ms) => (ms == null ? "–" : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 2 * DAY ? `${(ms / 3600000).toFixed(1)} h` : `${(ms / DAY).toFixed(1)} days`);
  const count = (st) => issues.filter((r) => r.issue.state === st).length;
  const testers = new Set(state.results.filter((r) => r.status || r.issue).map((r) => keyOf(r.tester)));
  $("ov-kpis").replaceChildren(
    kpi("Tests recorded", tested.length, `${coveredRows.size} of ${testable.length} tests covered`, "var(--accent)"),
    kpi("Testers", testers.size, "people who recorded results", "var(--accent)"),
    kpi("Issues reported", issues.length, "fails, blocked and general problems", "var(--bad)"),
    kpi("Open", count("open"), "waiting for the developer", "var(--bad)"),
    kpi("Fixed · awaiting review", count("fixed"), "waiting for the lead tester", "var(--fixed)"),
    kpi("Closed", count("verified"), "verified by the lead tester", "var(--ok)"),
    kpi("Reopened", reopenedIssues.length, "failed again after a fix", "var(--warn)"),
    kpi("Time to fix", dur(avg(fixTimes)), `average, reported → fixed (${fixTimes.length})`, "var(--fixed)"),
    kpi("Time to close", dur(avg(closeTimes)), `average, reported → closed (${closeTimes.length})`, "var(--ok)"));

  // Activity per day: grouped bars for reported / fixed / closed / reopened.
  const series = [["open", "Reported", "var(--bad)"], ["fixed", "Fixed", "var(--fixed)"], ["verified", "Closed", "var(--ok)"], ["reopen", "Reopened", "var(--warn)"]];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: ovDays }, (_, i) => dayKey(today.getTime() - (ovDays - 1 - i) * DAY));
  const per = Object.fromEntries(days.map((d) => [d, { open: 0, fixed: 0, verified: 0, reopen: 0 }]));
  for (const e of events) { const d = dayKey(e.at); if (per[d] && per[d][e.kind] != null) per[d][e.kind] += 1; }
  const peak = Math.max(1, ...days.flatMap((d) => series.map(([k]) => per[d][k])));
  const step = Math.max(1, Math.ceil(peak / 4));
  const max = step * Math.ceil(peak / step); // the top gridline is at or above the tallest bar
  const W = 900, H = 230, L = 34, B = 26, T = 10, gw = (W - L - 10) / days.length, bw = Math.max(3, Math.min(14, (gw - 10) / series.length));
  const NS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Issues reported, fixed, closed and reopened per day" });
  for (let v = 0; v <= max; v += step) {
    const y = H - B - ((H - B - T) * v) / max;
    svg.append(sv("line", { x1: L, x2: W - 6, y1: y, y2: y, class: "gl" }), sv("text", { x: L - 6, y: y + 4, "text-anchor": "end" }, String(v)));
  }
  days.forEach((d, i) => {
    const x0 = L + i * gw + (gw - bw * series.length) / 2;
    series.forEach(([k, name, color], j) => {
      const v = per[d][k];
      if (!v) return;
      const hgt = ((H - B - T) * v) / max;
      const rect = sv("rect", { x: x0 + j * bw, y: H - B - hgt, width: bw - 1, height: hgt, rx: 2, fill: color });
      rect.append(sv("title", {}, `${d}: ${v} ${name.toLowerCase()}`));
      svg.append(rect);
    });
    if (ovDays <= 14 || i % 2 === 0) svg.append(sv("text", { x: L + i * gw + gw / 2, y: H - 8, "text-anchor": "middle" }, new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })));
  });
  $("ov-daily").replaceChildren(h("div", { class: "legend" }, series.map(([, name, color]) => { const i = h("i"); i.style.background = color; return h("span", {}, i, name); })), svg);

  // Issues by screen (stacked by state).
  const bySec = new Map();
  for (const r of issues) {
    const info = rowInfo(r.id);
    const sec = info?.sec || { id: "other", title: "Other" };
    const cur = bySec.get(sec.id) || { sec, open: 0, fixed: 0, verified: 0 };
    cur[r.issue.state] = (cur[r.issue.state] || 0) + 1;
    bySec.set(sec.id, cur);
  }
  const secRows = [...bySec.values()].sort((a, b) => (b.open + b.fixed + b.verified) - (a.open + a.fixed + a.verified));
  const secMax = Math.max(1, ...secRows.map((x) => x.open + x.fixed + x.verified));
  $("ov-screens").replaceChildren(
    h("div", { class: "legend" }, [["c-open", "Open"], ["c-fixed", "Fixed · awaiting review"], ["c-verified", "Closed"]].map(([c, t]) => h("span", {}, h("i", { class: c }), t))),
    secRows.length ? h("div", { class: "hbars" }, secRows.map((x) => {
      const total = x.open + x.fixed + x.verified;
      const track = h("span", { class: "track" });
      for (const k of ["open", "fixed", "verified"]) if (x[k]) { const seg = h("span", { class: `c-${k}`, title: `${x[k]} ${k === "verified" ? "closed" : k}` }); seg.style.width = `${(x[k] / secMax) * 100}%`; track.append(seg); }
      return h("div", { class: "hbar" },
        h("button", { type: "button", class: "nm", text: `${x.sec.code ? `${x.sec.code} · ` : ""}${x.sec.title}`, onclick: () => { $("i-screen").value = x.sec.id; for (const bb of document.querySelectorAll("#state-seg button")) bb.classList.toggle("on", bb.dataset.state === ""); store.set("qa-ifilters", issueFilters()); switchTab("results"); renderIssues(); } }),
        track, h("span", { class: "n", text: total }));
    })) : h("div", { class: "empty-state", text: "No issues reported yet." }));

  // Testers.
  const tmap = new Map();
  for (const r of state.results) {
    const k = keyOf(r.tester);
    const t = tmap.get(k) || { name: r.tester, pass: 0, fail: 0, blocked: 0, issues: 0 };
    if (r.status) t[r.status] += 1;
    if (r.issue) t.issues += 1;
    tmap.set(k, t);
  }
  const trows = [...tmap.values()].filter((t) => t.pass + t.fail + t.blocked + t.issues).sort((a, b) => (b.pass + b.fail + b.blocked) - (a.pass + a.fail + a.blocked));
  const tmax = Math.max(1, ...trows.map((t) => t.pass + t.fail + t.blocked));
  $("ov-testers").replaceChildren(
    h("div", { class: "legend" }, [["c-pass", "Pass"], ["c-fail", "Fail"], ["c-blocked", "Blocked"]].map(([c, t]) => h("span", {}, h("i", { class: c }), t))),
    trows.length ? h("div", { class: "hbars" }, trows.map((t) => {
      const track = h("span", { class: "track" });
      for (const k of ["pass", "fail", "blocked"]) if (t[k]) { const seg = h("span", { class: `c-${k}`, title: `${t[k]} ${k}` }); seg.style.width = `${(t[k] / tmax) * 100}%`; track.append(seg); }
      return h("div", { class: "hbar" }, h("span", { class: "nm", text: t.name, title: `${t.issues} issue${t.issues === 1 ? "" : "s"} reported` }), track, h("span", { class: "n", text: t.pass + t.fail + t.blocked }));
    })) : h("div", { class: "empty-state", text: "No results yet." }));

  // Reopened issues.
  $("ov-reopened").replaceChildren(reopenedIssues.length
    ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["Test", "Screen", "Reported by", "Times reopened", "Now"].map((x) => h("th", { text: x })))),
        h("tbody", {}, reopenedIssues.map((r) => {
          const info = rowInfo(r.id);
          const times = (r.issue.log || []).filter((l, i) => l.state === "open" && (l.reopened || i > 0)).length;
          return h("tr", {}, h("td", {}, h("span", { class: "t-code", text: info?.code || r.id }), " ", info?.label || ""), h("td", { text: info?.sec?.title || "" }), h("td", { text: r.tester }), h("td", { class: "num", text: times }), h("td", {}, h("span", { class: `pill i-${r.issue.state}`, text: ISSUE[r.issue.state] })));
        }))))
    : h("div", { class: "empty-state", text: "Nothing has been reopened." }));

  // All activity, newest first, filterable.
  const who = $("ov-f-who"), scr = $("ov-f-screen");
  const keepWho = who.value, keepScr = scr.value;
  const people = [...new Set(events.map((e) => e.by).filter(Boolean))].sort();
  who.replaceChildren(h("option", { value: "", text: "Everyone" }), ...people.map((x) => h("option", { value: x, text: x })));
  who.value = keepWho;
  const screens = [...new Map(events.filter((e) => e.screenId).map((e) => [e.screenId, e.screen])).entries()];
  scr.replaceChildren(h("option", { value: "", text: "All screens" }), ...screens.map(([id, t]) => h("option", { value: id, text: t })));
  scr.value = keepScr;
  paintLog(events);
}

const STEP_LABEL = { result: "Test result", open: "Reported", reopen: "Reopened", fixed: "Fixed", verified: "Closed", comment: "Comment" };
function filteredLog(events) {
  const kind = $("ov-f-kind").value, who = $("ov-f-who").value, scr = $("ov-f-screen").value;
  return events.filter((e) => (!kind || e.kind === kind) && (!who || e.by === who) && (!scr || e.screenId === scr)).reverse();
}
function paintLog(events = allEvents()) {
  const list = filteredLog(events);
  const body = $("ov-log").querySelector("tbody");
  body.replaceChildren(...list.slice(0, ovShown).map((e) => h("tr", {},
    h("td", { text: when(e.at) }),
    h("td", {}, e.kind === "result" ? h("span", { class: `pill s-${e.result}`, text: LABEL[e.result] || e.result }) : h("span", { class: `pill i-${e.kind === "reopen" ? "open" : e.kind === "comment" ? "fixed" : e.kind}`, text: STEP_LABEL[e.kind] || e.kind })),
    h("td", { text: e.by || "" }),
    h("td", {}, h("span", { class: "t-code", text: e.code }), " ", e.test),
    h("td", { text: e.screen }),
    h("td", { class: "note", text: e.note }))));
  if (!list.length) body.append(h("tr", {}, h("td", { colspan: "6", class: "muted", text: "Nothing yet." })));
  $("ov-more").hidden = list.length <= ovShown;
}
function csvLog() {
  const rows = filteredLog(allEvents()).map((e) => [new Date(e.at).toISOString(), STEP_LABEL[e.kind] || e.kind, e.result ? LABEL[e.result] || e.result : "", e.by, e.code, e.test, e.screen, e.note]);
  csv("autopulse-crm-test-activity", ["When", "Step", "Result", "By", "Code", "Test", "Screen", "Note"], rows);
}

// ---------- tabs ----------
function switchTab(tab) {
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  $("pane-test").hidden = tab !== "test";
  $("pane-results").hidden = tab !== "results";
  $("pane-overview").hidden = tab !== "overview";
  store.set("qa-tab", tab);
  if (tab === "results") renderResults();
  if (tab === "overview") renderOverview();
}

// ---------- start ----------
async function init() {
  $("tester").value = store.get("qa-tester", "") || "";
  const [data, auto, res] = await Promise.all([
    fetch(`${ROOT}assets/features.json`).then((r) => r.json()),
    fetch(`${ROOT}assets/automated.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    api("results").catch(() => ({ results: [] })),
  ]);
  state.data = data;
  state.auto = auto;
  indexResults(res.results || []);
  if (Array.isArray(res.leadTesters) && res.leadTesters.length) state.leads = res.leadTesters;
  if (res.developer) state.developer = res.developer;
  renderAuto();
  renderChecklist();

  const f = store.get("qa-filters", {}) || {};
  if (f.q) $("q").value = f.q;
  if (f.area) $("area").value = f.area;
  if (f.show) $("show").value = f.show;
  if (f.buttons === false) $("show-buttons").checked = false;
  if (f.fields) $("show-fields").checked = true;
  const fi = store.get("qa-ifilters", {}) || {};
  if (fi.state != null) for (const b of document.querySelectorAll("#state-seg button")) b.classList.toggle("on", b.dataset.state === fi.state);
  if (fi.area) $("i-area").value = fi.area;
  if (fi.q) $("i-q").value = fi.q;

  paintAll();
  applyFilters();
  renderResults();
  if (fi.tester) { $("i-tester").value = fi.tester; renderIssues(); }

  let nameTimer;
  paintTesterPick();
  $("tester-pick").addEventListener("change", (e) => {
    if (e.target.value === NEW_NAME) {
      $("tester").hidden = false;
      $("tester").value = "";
      $("tester").focus();
      useName("");
      return;
    }
    $("tester").hidden = true;
    useName(e.target.value);
  });
  $("tester").addEventListener("input", (e) => {
    e.target.classList.remove("need");
    store.set("qa-tester", me());
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { paintAll(); applyFilters(); }, 350);
  });
  // A new name joins the list once typed (Enter or leaving the box), so it can be picked next time.
  const commitNew = () => {
    if (!me()) return;
    const typed = me();
    const known = knownTesters().find((n) => keyOf(n) === keyOf(typed) && n !== typed);
    if (known) $("tester").value = known;
    $("tester").hidden = true;
    paintTesterPick();
    useName(me());
  };
  $("tester").addEventListener("keydown", (e) => { if (e.key === "Enter") commitNew(); });
  $("tester").addEventListener("change", commitNew);
  $("expand-all").addEventListener("click", () => { for (const sec of state.sections) if (!sec.card.classList.contains("hide")) setOpen(sec, true); });
  $("collapse-all").addEventListener("click", () => { for (const sec of state.sections) setOpen(sec, false); });
  for (const id of ["q", "area", "show", "show-buttons", "show-fields"]) $(id).addEventListener("input", applyFilters);
  const saveIssueFilters = () => { store.set("qa-ifilters", issueFilters()); renderIssues(); };
  for (const sec of state.sections) $("i-screen").append(h("option", { value: sec.id, text: `${sec.code} · ${sec.title}` }));
  if (fi.screen) { $("i-screen").value = fi.screen; renderIssues(); }
  for (const id of ["i-tester", "i-area", "i-screen", "i-q"]) $(id).addEventListener("input", saveIssueFilters);
  for (const b of document.querySelectorAll("#state-seg button")) b.addEventListener("click", () => {
    for (const x of document.querySelectorAll("#state-seg button")) x.classList.toggle("on", x === b);
    saveIssueFilters();
  });
  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => switchTab(b.dataset.tab));
  const pick = $("general-screen");
  for (const sec of state.sections) pick.append(h("option", { value: sec.id, text: `${sec.code} · ${sec.title}` }));
  pick.value = store.get("qa-general-screen", "") || "";
  pick.addEventListener("change", () => store.set("qa-general-screen", pick.value));
  $("general-report").addEventListener("click", () => {
    const sec = state.sections.find((x) => x.id === pick.value);
    if (!sec) { toast("Choose the screen the problem is on", true); pick.focus(); return; }
    reportForm(sec, $("general-form"), () => { $("general-form").replaceChildren(); paintReports(sec); refreshCounts(); renderResults(); });
  });
  $("csv-all").addEventListener("click", csvAll);
  $("csv-issues").addEventListener("click", csvIssues);
  $("lightbox").addEventListener("click", () => { $("lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lightbox").hidden = true; });

  for (const b of document.querySelectorAll("#ov-days button")) b.addEventListener("click", () => {
    ovDays = Number(b.dataset.days) || 7;
    for (const x of document.querySelectorAll("#ov-days button")) x.classList.toggle("on", x === b);
    renderOverview();
  });
  for (const id of ["ov-f-kind", "ov-f-who", "ov-f-screen"]) $(id).addEventListener("input", () => { ovShown = 100; paintLog(); });
  $("ov-more").addEventListener("click", () => { ovShown += 200; paintLog(); });
  $("ov-csv").addEventListener("click", csvLog);
  const savedTab = store.get("qa-tab", "test");
  switchTab(["results", "overview"].includes(savedTab) ? savedTab : "test");
  // Back where the tester was: the scroll position is kept across a refresh.
  const y = store.get("qa-scroll", 0);
  if (location.hash) {
    const sec = state.sections.find((x) => `#sec-${x.id}` === location.hash);
    if (sec) setOpen(sec, true);
    document.querySelector(location.hash)?.scrollIntoView();
  }
  else if (y) window.scrollTo(0, y);
  let st;
  window.addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => store.set("qa-scroll", window.scrollY), 300); }, { passive: true });
}

init().catch((e) => toast(`Could not load the sheet: ${e.message}`, true));
