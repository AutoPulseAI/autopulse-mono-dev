"use client";
// Admin > DMS feed, top of the page (23 Nov 2026): the dealer's DMS as we hold it. Pick a DealerVault store; see every
// file it sent in the last five weeks (one mark per file, coloured by what happened to it), its four departments the
// way the DMS keeps them - Sales, Service, Appointments, Parts - filed under the dealer's own categories, every field
// of one record, and the records that need a person (with what it means, what fixes it, and "Mark checked").
// /api/admin/dms-feed/mirror.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Form, Offcanvas, Spinner, Table } from "react-bootstrap";

const call = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

const n = (v) => Number(v || 0).toLocaleString("en-US");
const money = (v) => {
  const x = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : String(v);
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A DMS date (MM/DD/YYYY, YYYYMMDD, ISO) as "12 Nov 2026"; anything else as it came. */
const dmsDate = (v) => {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${+m[2]} ${MON[+m[1] - 1]} ${m[3]}`;
  m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
  return s;
};
const isoDay = (d) => (d ? `${new Date(d).getUTCDate()} ${MON[new Date(d).getUTCMonth()]} ${new Date(d).getUTCFullYear()}` : null);
const stampText = (s) => (s ? `${+s.slice(6, 8)} ${MON[+s.slice(4, 6) - 1]}, ${s.slice(8, 10)}:${s.slice(10, 12)} UTC` : "");
const daysSince = (stamp) => (stamp ? Math.floor((Date.now() - Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8))) / 86400000) : null);

const TYPE = { SL: "Sales", SV: "Service ROs", SV_APPT: "Appointments", PTINV: "Parts", OPENRO: "Open ROs" };
const STATE = {
  imported: { label: "Imported", color: "#2f855a" },
  imported_unlinked: { label: "Imported, some records not linked", color: "#d69e2e" },
  problem: { label: "Imported with errors", color: "#dd6b20" },
  held: { label: "Held, nothing imported", color: "#c53030" },
  importing: { label: "Importing", color: "#3182ce" },
  waiting: { label: "In storage, not imported", color: "#a0aec0" },
  discarded: { label: "Discarded", color: "#4a5568" },
  stored: { label: "Kept, not used (open ROs)", color: "#cbd5e0" },
};
const DEPT = {
  sales: { icon: "fa-handshake", label: "Sales" },
  service: { icon: "fa-wrench", label: "Service" },
  appointments: { icon: "fa-calendar-check", label: "Appointments" },
  parts: { icon: "fa-boxes-stacked", label: "Parts" },
};

// Which section of the record drawer a DMS column belongs to (first match wins).
const GROUPS = [
  ["Customer", /^(Full Name|Salutation|First Name|Middle Name|Last Name|Suffix|Address|City|State|Zip|County|Home Phone|Cell Phone|Work Phone|Work Extension|Email|Birth Date|Individual|Opt Out|Block|Language|Customer )/],
  ["Co-buyer", /^Co[- ]Buyer/],
  ["Vehicle", /^(VIN|Year|Make|Model|Trim|Exterior Color|Stock Number|Transmission|Engine|Chassis|License|Mileage|RO Mileage|Mileage Out|Delivery Mileage|Appointment Mileage|Last RO Miles|Description|New\/Used|In Service Date|Tag Number|Accounting Make)/],
  ["Trade-ins", /^Trade \d/],
  ["People", /(Advisor|Salesman|Manager|Tech Name|Tech Number)/],
  ["Work", /^(Operation|Labor|Parts? |Part Number|Part Description|Part Quantity|Recommend|Complaint|Cause|Correction|Comment|Upsell|Tech Labor|Estimate)/],
  ["Money", /(Cost|Sale\b|Sales|Price|Gross|Profit|Tax|Fee|Commission|Amount|Payment|APR|Rebate|Down|Value|Payoff|Reserve|Incentive|Holdback|Balloon|Deposit|Residual|Rate|MSRP|Pack|Net)/],
  ["Dates", /(Date|Time)$/],
  ["Warranty and add-ons", /^(Warranty|Fee\/Aftermarket|Service Contract)/],
];
const groupOf = (k) => (GROUPS.find(([, rx]) => rx.test(k)) || ["Other"])[0];

function Calendar({ cal }) {
  const ticks = cal.days.map((d, i) => ({ d, i })).filter(({ i }) => (cal.days.length - 1 - i) % 7 === 0);
  return (
    <div className="dmsm_cal">
      <div className="dmsm_cal_grid" style={{ gridTemplateColumns: `minmax(92px,auto) repeat(${cal.days.length}, minmax(9px,1fr)) minmax(120px,auto)` }}>
        {cal.rows.map((r) => {
          const since = daysSince(r.last);
          const late = since != null && since > 1;
          return (
            <Fragment key={r.type}>
              <div className="dmsm_cal_type">{TYPE[r.type] || r.type}</div>
              {r.cells.map((files, i) => (
                <div key={i} className={`dmsm_cal_day ${files.length ? "" : "empty"}`}
                  title={files.length ? files.map((f) => `${stampText(f.stamp)}: ${STATE[f.state].label}${f.reasons?.length ? ` (${f.reasons[0]})` : ""}`).join("\n")
                    : `${dmsDate(cal.days[i])}: no file`}>
                  {files.slice(0, 4).map((f) => <span key={f.file} style={{ background: STATE[f.state].color }} />)}
                </div>
              ))}
              <div className={`dmsm_cal_last ${late ? "late" : ""}`}>
                {!r.last ? "Never sent" : late ? `No file for ${since} days` : `Last ${stampText(r.last)}`}
              </div>
            </Fragment>
          );
        })}
        <div />
        {cal.days.map((d, i) => <div key={d} className="dmsm_cal_tick">{ticks.some((t) => t.i === i) ? dmsDate(d).replace(/ \d{4}$/, "") : ""}</div>)}
        <div />
      </div>
      <div className="dmsm_legend">
        {Object.entries(STATE).filter(([k]) => cal.rows.some((r) => r.cells.some((c) => c.some((f) => f.state === k))))
          .map(([k, s]) => <span key={k}><i style={{ background: s.color }} />{s.label}</span>)}
        <span><i className="empty" />No file that day</span>
      </div>
    </div>
  );
}

function DeptBook({ id, h, active, onOpen }) {
  const d = DEPT[id];
  let count = "";
  let lines = [];
  if (id === "sales") {
    count = `${n(h.n)} deals`;
    lines = [h.last ? `Latest contract ${isoDay(h.last)}` : "No contract dates",
      h.n ? `${n(h.new)} new, ${n(h.n - h.new)} used` : null,
      h.n ? `Front ${money(h.front)}, back ${money(h.back)}` : null];
  } else if (id === "service") {
    count = `${n(h.n)} repair orders`;
    lines = [h.last ? `Latest ${isoDay(h.last)}` : null];
  } else if (id === "appointments") {
    count = `${n(h.n)} appointments`;
    lines = [h.upcoming ? `${n(h.upcoming)} coming up, next ${isoDay(h.next)}` : "None coming up", h.last ? `Latest booked for ${isoDay(h.last)}` : null];
  } else {
    count = `${n(h.n)} part numbers`;
    lines = [`${n(h.stocked)} in stock, ${n(h.units)} units`, `${money(h.value)} on hand at cost`];
  }
  const split = id === "service" && (h.cp || h.wty || h.int) ? [["Customer pay", h.cp, "#0272b4"], ["Warranty", h.wty, "#6b46c1"], ["Internal", h.int, "#a0aec0"]] : null;
  const total = split ? split.reduce((s, [, v]) => s + v, 0) : 0;
  return (
    <button type="button" className={`dmsm_book ${active ? "active" : ""} ${h.n ? "" : "none"}`} onClick={onOpen} aria-pressed={active}>
      <span className="dmsm_book_head"><i className={`fa-solid ${d.icon}`} aria-hidden="true" />{d.label}</span>
      <span className="dmsm_book_count">{count}</span>
      {lines.filter(Boolean).map((l) => <span key={l} className="dmsm_book_line">{l}</span>)}
      {split && <>
        <span className="dmsm_split">{split.map(([l, v, c]) => v > 0 && <i key={l} style={{ width: `${(v / total) * 100}%`, background: c }} title={`${l}: ${money(v)}`} />)}</span>
        <span className="dmsm_split_key">{split.map(([l, v, c]) => <span key={l}><i style={{ background: c }} />{l} {money(v)}</span>)}</span>
      </>}
      {!h.n && <span className="dmsm_book_line">Nothing imported yet</span>}
    </button>
  );
}

function RecordDrawer({ dv, open, onHide }) {
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!open) return;
    setRec(null); setErr(null);
    call(`/api/admin/dms-feed/mirror?dv=${dv}&dept=${open.dept}&key=${encodeURIComponent(open.key)}`)
      .then((d) => setRec(d.record)).catch((e) => setErr(e.message));
  }, [dv, open]);
  const groups = useMemo(() => {
    const g = new Map();
    for (const [k, v] of rec?.fields || []) {
      const name = groupOf(k);
      if (!g.has(name)) g.set(name, []);
      g.get(name).push([k, v]);
    }
    const order = ["Customer", "Vehicle", "People", "Dates", "Work", "Money", "Trade-ins", "Warranty and add-ons", "Co-buyer", "Other"];
    return order.filter((k) => g.has(k)).map((k) => [k, g.get(k)]);
  }, [rec]);
  return (
    <Offcanvas show={!!open} onHide={onHide} placement="end" className="dmsm_drawer">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title as="div">
          <div className="dmsm_drawer_title">{open ? `${rec?.keyLabel || ""} ${open.key}` : ""}</div>
          {rec && <div className="dmsm_sub">As the DMS sent it{rec.file_stamp ? ` in the file of ${stampText(rec.file_stamp)}` : ""}</div>}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {err && <Alert variant="danger" className="py-2 small">{err}</Alert>}
        {!rec && !err && <Spinner size="sm" />}
        {rec && <>
          <div className="dmsm_links">
            <span className={rec.linked.customer ? "ok" : "no"}><i className={`fa-solid ${rec.linked.customer ? "fa-link" : "fa-link-slash"}`} />
              {rec.linked.customer ? "Linked to a customer" : "Not linked to a customer"}</span>
            {rec.dept !== "parts" && <span className={rec.linked.vehicle ? "ok" : "no"}><i className={`fa-solid ${rec.linked.vehicle ? "fa-link" : "fa-link-slash"}`} />
              {rec.linked.vehicle ? "Linked to a car" : "Not linked to a car"}</span>}
          </div>
          {groups.map(([name, rows]) => (
            <section key={name} className="dmsm_fields">
              <h4>{name}</h4>
              <dl>{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{/(Date)$/.test(k) ? dmsDate(v) : v}</dd></Fragment>)}</dl>
            </section>
          ))}
          {rec.lines.length > 0 && (
            <section className="dmsm_fields">
              <h4>Repair lines</h4>
              {rec.lines.map((l, i) => {
                const parts = Object.entries(l).filter(([k, v]) => k !== "group_index" && [].concat(v).some((x) => String(x).trim()));
                return parts.length ? (
                  <dl key={i} className="dmsm_line">{parts.map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, " ")}</dt>
                    <dd>{[].concat(v).filter((x) => String(x).trim()).join(", ")}</dd></Fragment>)}</dl>) : null;
              })}
            </section>
          )}
        </>}
      </Offcanvas.Body>
    </Offcanvas>
  );
}

function Ledger({ dv, dept, issue, issueText, onIssueClear, onChecked }) {
  const [state, setState] = useState({ filters: [], q: "", page: 1, checked: false });
  const [qInput, setQInput] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setState({ filters: [], q: "", page: 1, checked: false }); setQInput(""); }, [dv, dept, issue]);
  const load = useCallback(async () => {
    setBusy(true);
    const p = new URLSearchParams({ dv, dept, page: String(state.page) });
    for (const f of state.filters) p.append("f", `${f.col}::${f.value}`);
    if (state.q) p.set("q", state.q);
    if (issue) { p.set("issue", issue); if (state.checked) p.set("checked", "1"); }
    try { setData(await call(`/api/admin/dms-feed/mirror?${p}`)); setErr(null); } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [dv, dept, issue, state]);
  useEffect(() => { load(); }, [load]);
  const toggle = (col, value) => setState((s) => {
    const on = s.filters.some((f) => f.col === col && f.value === value);
    return { ...s, page: 1, filters: on ? s.filters.filter((f) => !(f.col === col && f.value === value))
      : [...s.filters.filter((f) => f.col !== col), { col, value }] };
  });
  const mark = async (key, undo) => {
    try { await call("/api/admin/dms-feed/mirror", { method: "POST", body: JSON.stringify({ dv, dept, issue, key, undo }) }); await load(); onChecked?.(); }
    catch (e) { setErr(e.message); }
  };
  const text = issue && issueText?.[issue];
  return (
    <div className="dmsm_ledger">
      {text && (
        <div className="dmsm_issue_head">
          <div>
            <div className="dmsm_issue_title">{DEPT[dept].label}: {text.label}</div>
            <p><strong>What it means.</strong> {text.means}</p>
            <p><strong>What fixes it.</strong> {text.fix}</p>
            <p className="dmsm_sub mb-0">Records stay listed here until they link or someone marks them checked.</p>
          </div>
          <div className="d-flex flex-column align-items-end gap-2">
            <Button size="sm" variant="outline-secondary" onClick={onIssueClear}>Show all {DEPT[dept].label.toLowerCase()}</Button>
            <Form.Check type="switch" id="dmsm_checked" className="small" label="Show the ones marked checked"
              checked={state.checked} onChange={(e) => setState((s) => ({ ...s, checked: e.target.checked, page: 1 }))} />
          </div>
        </div>
      )}
      {err && <Alert variant="danger" className="py-2 small">{err}</Alert>}
      {data && data.categories.length > 0 && (
        <div className="dmsm_cats">
          {data.categories.map((c) => (
            <div key={c.col} className="dmsm_cat">
              <div className="dmsm_cat_name">{c.col}</div>
              <div className="dmsm_chips">
                {c.values.map((v) => {
                  const on = state.filters.some((f) => f.col === c.col && f.value === v.value);
                  return (
                    <button key={v.value || "(blank)"} type="button" className={`dmsm_chip ${on ? "on" : ""} ${v.value ? "" : "blank"}`}
                      onClick={() => toggle(c.col, v.value)} aria-pressed={on}>
                      {v.value || "Blank"}<span>{n(v.n)}</span>
                    </button>);
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="dmsm_search" onSubmit={(e) => { e.preventDefault(); setState((s) => ({ ...s, q: qInput.trim(), page: 1 })); }}>
        <Form.Control size="sm" value={qInput} onChange={(e) => setQInput(e.target.value)}
          placeholder={dept === "parts" ? "Part number or description" : "Number, customer name or VIN"} aria-label="Search records" />
        <Button size="sm" type="submit" variant="custom">Search</Button>
        {(state.filters.length > 0 || state.q) && <Button size="sm" variant="link" onClick={() => { setQInput(""); setState((s) => ({ ...s, filters: [], q: "", page: 1 })); }}>Clear</Button>}
        {busy && <Spinner size="sm" className="ms-1" />}
        {data && <span className="dmsm_sub ms-auto">{n(data.total)} {data.total === 1 ? "record" : "records"}</span>}
      </form>
      {data && (!data.rows.length ? (
        <div className="dmsm_empty">{issue ? (state.checked ? "Nothing marked checked yet." : "Nothing left to look at here.") : "No records match."}</div>
      ) : (
        <Table responsive hover className="dmsm_tbl small mb-0">
          <thead><tr><th>{data.keyLabel}</th>{data.columns.map((c) => <th key={c.label} className={c.kind === "money" || c.kind === "num" ? "num" : ""}>{c.label}</th>)}{issue && <th />}</tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.key} onClick={() => setOpen({ dept, key: r.key })} className="dmsm_row">
              <td className="text-nowrap fw-semibold">{r.key}
                {dept !== "parts" && (!r.linked.customer || !r.linked.vehicle) && (
                  <i className="fa-solid fa-link-slash ms-2 dmsm_unlinked" title={[!r.linked.customer && "Not linked to a customer", !r.linked.vehicle && (r.linked.vin ? "VIN not matched to a car" : "No VIN")].filter(Boolean).join(", ")} />)}
              </td>
              {r.cells.map((v, i) => {
                const k = data.columns[i].kind;
                return <td key={i} className={k === "money" || k === "num" ? "num" : ""}>{v == null ? <span className="dmsm_none">-</span>
                  : k === "money" ? money(v) : k === "date" ? <span className="text-nowrap">{dmsDate(v)}</span> : v}</td>;
              })}
              {issue && <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                {r.checked ? <span className="dmsm_sub">Checked by {r.checked.by}, {isoDay(r.checked.at)}{" "}
                  <Button size="sm" variant="link" className="p-0" onClick={() => mark(r.key, true)}>undo</Button></span>
                  : <Button size="sm" variant="outline-secondary" onClick={() => mark(r.key, false)}>Mark checked</Button>}
              </td>}
            </tr>))}</tbody>
        </Table>
      ))}
      {data && data.pages > 1 && (
        <div className="dmsm_pager">
          <Button size="sm" variant="outline-secondary" disabled={data.page <= 1} onClick={() => setState((s) => ({ ...s, page: s.page - 1 }))}>Previous</Button>
          <span>Page {n(data.page)} of {n(data.pages)}</span>
          <Button size="sm" variant="outline-secondary" disabled={data.page >= data.pages} onClick={() => setState((s) => ({ ...s, page: s.page + 1 }))}>Next</Button>
        </div>
      )}
      <RecordDrawer dv={dv} open={open} onHide={() => setOpen(null)} />
    </div>
  );
}

function LinkStore({ store, dealers, onLinked }) {
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const free = dealers.filter((d) => !d.dv);
  const link = async () => {
    const name = free.find((d) => d.id === pick)?.name;
    if (!window.confirm(`Link ${store.dv} to ${name}? Its files will be imported into ${name}, and its customers become ${name}'s customers.`)) return;
    setBusy(true);
    try { await call("/api/admin/dms-feed/stores", { method: "PUT", body: JSON.stringify({ dealer_id: pick, dv: store.dv }) }); onLinked(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="dmsm_unlinked_panel">
      <div>
        <div className="dmsm_issue_title">{store.dv} isn&apos;t linked to a dealer</div>
        <p className="mb-1">DealerVault sends this store&apos;s files ({store.types.map((t) => TYPE[t] || t).join(", ")}), but no AutoPulse
          dealer has this ID, so nothing from them was imported. {store.held ? `${n(store.held)} files are held.` : ""}</p>
        <p className="dmsm_sub mb-0">Only link it if you know whose store this is. Once linked, its held files can be imported from
          &quot;How the files were imported&quot; below.</p>
      </div>
      <div className="d-flex gap-2 align-items-start">
        <Form.Select size="sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Dealer for ${store.dv}`}>
          <option value="">Pick the dealer</option>
          {free.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Form.Select>
        <Button size="sm" variant="custom" disabled={!pick || busy} onClick={link}>Link</Button>
      </div>
      {err && <Alert variant="danger" className="py-2 small mt-2 mb-0">{err}</Alert>}
    </div>
  );
}

export default function DmsMirror({ onStoresChanged }) {
  const [stores, setStores] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [dv, setDv] = useState("");
  const [view, setView] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dept, setDept] = useState(null);
  const [issue, setIssue] = useState(null);
  const ledgerRef = useRef(null);

  const loadStores = useCallback(async () => {
    try {
      const d = await call("/api/admin/dms-feed/mirror");
      setStores(d.stores); setDealers(d.dealers);
      setDv((cur) => cur || d.stores[0]?.dv || "");
      if (d.storage_error) setErr(`Storage couldn't be listed (${d.storage_error}).`);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { loadStores(); }, [loadStores]);
  const loadView = useCallback(async () => {
    if (!dv) return;
    setLoading(true);
    try { setView(await call(`/api/admin/dms-feed/mirror?dv=${dv}`)); setErr(null); } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [dv]);
  useEffect(() => { setView(null); setDept(null); setIssue(null); loadView(); }, [loadView]);

  const openDept = (id, iss = null) => {
    setDept(id); setIssue(iss);
    setTimeout(() => ledgerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const store = view?.store;

  return (
    <div className="dmsm">
      <style>{CSS}</style>
      {err && <Alert variant="warning" className="py-2 small" dismissible onClose={() => setErr(null)}>{err}</Alert>}
      <div className="dmsm_stores" role="tablist" aria-label="DealerVault stores">
        {!stores && <Spinner size="sm" />}
        {stores?.map((s) => {
          const since = daysSince(s.last);
          return (
            <button key={s.dv} type="button" role="tab" aria-selected={s.dv === dv} className={`dmsm_store ${s.dv === dv ? "on" : ""} ${s.dealer ? "" : "unlinked"}`}
              onClick={() => setDv(s.dv)}>
              <span className="dmsm_store_name">{s.dealer?.name || "Not linked"}</span>
              <span className="dmsm_store_meta">{s.dv}{s.last ? `, last file ${since === 0 ? "today" : since === 1 ? "yesterday" : `${since} days ago`}` : ", no files"}</span>
              {s.held > 0 && <Badge bg="danger" className="dmsm_store_held">{n(s.held)} held</Badge>}
            </button>);
        })}
      </div>

      {dv && !view && loading && <div className="w_card"><Spinner size="sm" /></div>}
      {view && (
        <>
          {!store.dealer && <LinkStore store={store} dealers={dealers} onLinked={() => { loadStores(); loadView(); onStoresChanged?.(); }} />}

          <div className="w_card">
            <div className="d-flex align-items-baseline flex-wrap gap-2 mb-2">
              <h3 className="w_card_title mb-0 me-auto">What {store.dealer?.name || store.dv}&apos;s DMS sent, last five weeks</h3>
              <span className="dmsm_sub">One mark per file. Hover a day for its files.</span>
            </div>
            <Calendar cal={view.calendar} />
          </div>

          {store.dealer && view.departments && (
            <>
              {view.issues.length > 0 && (
                <div className="dmsm_look">
                  <span className="dmsm_look_title">Needs a look</span>
                  {view.issues.map((x) => (
                    <button key={`${x.dept}|${x.issue}`} type="button" className={`dmsm_look_item ${dept === x.dept && issue === x.issue ? "on" : ""}`}
                      onClick={() => openDept(x.dept, x.issue)} title={x.means}>
                      <span className="d">{x.deptLabel}</span>{x.label}<span className="c">{n(x.open)}</span>
                    </button>))}
                </div>
              )}
              <div className="dmsm_books">
                {Object.keys(DEPT).map((id) => <DeptBook key={id} id={id} h={view.departments[id]} active={dept === id && !issue} onOpen={() => openDept(id)} />)}
              </div>
              <div ref={ledgerRef}>
                {dept ? (
                  <div className="w_card">
                    {!issue && <h3 className="w_card_title">{DEPT[dept].label}, filed the way {store.dealer.name}&apos;s DMS files it</h3>}
                    <Ledger dv={dv} dept={dept} issue={issue} issueText={view.issue_text} onIssueClear={() => setIssue(null)} onChecked={loadView} />
                  </div>
                ) : <div className="dmsm_hint">Open a department to see its records, filed under the DMS&apos;s own categories.</div>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const CSS = `
.dmsm{--ink:#1f2a44;--muted:#6b7489;--line:#e6e9ef;--soft:#f6f8fb}
.dmsm_sub{font-size:12px;color:var(--muted)}
.dmsm_stores{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.dmsm_store{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:200px;max-width:100%;padding:10px 14px;
  border:1px solid var(--line);border-left:4px solid #2f855a;border-radius:8px;background:#fff;text-align:left;color:var(--ink)}
.dmsm_store.unlinked{border-left-color:#c53030}
.dmsm_store.on{border-color:var(--primary);border-left-color:var(--primary);box-shadow:0 0 0 1px var(--primary)}
.dmsm_store:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.dmsm_store_name{font-weight:600;font-size:14px}
.dmsm_store.unlinked .dmsm_store_name{color:#c53030}
.dmsm_store_meta{font-size:12px;color:var(--muted)}
.dmsm_store_held{position:absolute;top:8px;right:8px;font-weight:500}
.dmsm_cal{overflow-x:auto}
.dmsm_cal_grid{display:grid;column-gap:3px;row-gap:6px;align-items:center;min-width:560px}
.dmsm_cal_type{font-size:13px;color:var(--ink);padding-right:10px;white-space:nowrap}
.dmsm_cal_day{height:26px;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;border-radius:3px;background:var(--soft);padding:2px 1px;cursor:default}
.dmsm_cal_day span{display:block;height:5px;border-radius:2px}
.dmsm_cal_day.empty{background:repeating-linear-gradient(135deg,#f1f3f7 0 3px,#fff 3px 6px);border:1px dashed #dfe3ea}
.dmsm_cal_last{font-size:12px;color:var(--muted);padding-left:12px;white-space:nowrap}
.dmsm_cal_last.late{color:#c53030;font-weight:600}
.dmsm_cal_tick{font-size:11px;color:var(--muted);white-space:nowrap;overflow:visible;height:14px}
.dmsm_legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12px;color:var(--muted)}
.dmsm_legend span{display:inline-flex;align-items:center;gap:6px}
.dmsm_legend i{width:12px;height:5px;border-radius:2px;display:inline-block}
.dmsm_legend i.empty{height:10px;width:10px;border:1px dashed #cfd5df;background:#fff}
.dmsm_look{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px}
.dmsm_look_title{font-weight:600;color:#975a16;margin-right:4px;font-size:14px}
.dmsm_look_item{display:inline-flex;align-items:center;gap:8px;border:1px solid #f0d9a8;background:#fffaf0;color:var(--ink);border-radius:999px;padding:4px 6px 4px 12px;font-size:13px}
.dmsm_look_item .d{color:var(--muted)}
.dmsm_look_item .c{background:#d69e2e;color:#fff;border-radius:999px;padding:1px 8px;font-weight:600;font-variant-numeric:tabular-nums}
.dmsm_look_item.on{border-color:#d69e2e;box-shadow:0 0 0 1px #d69e2e}
.dmsm_look_item:focus-visible,.dmsm_book:focus-visible,.dmsm_chip:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.dmsm_books{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
@media (max-width:1199px){.dmsm_books{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:575px){.dmsm_books{grid-template-columns:1fr}.dmsm_store{min-width:0;width:100%}}
.dmsm_book{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;color:var(--ink);min-width:0}
.dmsm_book:hover{border-color:#b9c6d8}
.dmsm_book.active{border-color:var(--primary);box-shadow:inset 0 -3px 0 var(--primary)}
.dmsm_book.none{opacity:.7}
.dmsm_book_head{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.dmsm_book_head i{color:var(--primary);width:16px;text-align:center}
.dmsm_book_count{font-size:22px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums}
.dmsm_book_line{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.dmsm_split{display:flex;gap:2px;width:100%;height:6px;border-radius:3px;overflow:hidden;background:#eef1f5;margin-top:6px}
.dmsm_split i{display:block;height:100%}
.dmsm_split_key{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;color:var(--muted)}
.dmsm_split_key span{display:inline-flex;align-items:center;gap:4px}
.dmsm_split_key i{width:8px;height:8px;border-radius:2px;display:inline-block}
.dmsm_hint{padding:18px;text-align:center;color:var(--muted);font-size:14px;border:1px dashed var(--line);border-radius:10px;margin-bottom:16px}
.dmsm_cats{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}
.dmsm_cat{display:grid;grid-template-columns:170px 1fr;gap:10px;align-items:start}
@media (max-width:767px){.dmsm_cat{grid-template-columns:1fr;gap:4px}}
.dmsm_cat_name{font-size:13px;color:var(--muted);padding-top:4px}
.dmsm_chips{display:flex;flex-wrap:wrap;gap:6px}
.dmsm_chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:6px;padding:3px 8px;font-size:13px;max-width:100%;overflow-wrap:anywhere;text-align:left}
.dmsm_chip span{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px}
.dmsm_chip.blank{font-style:italic;color:var(--muted)}
.dmsm_chip:hover{border-color:#b9c6d8}
.dmsm_chip.on{background:var(--primary);border-color:var(--primary);color:#fff}
.dmsm_chip.on span{color:#d6e9f7}
.dmsm_search{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.dmsm_search .form-control{max-width:300px;min-width:0;flex:1 1 200px}
.dmsm_tbl th{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}
.dmsm_tbl td{vertical-align:middle}
.dmsm_tbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dmsm_row{cursor:pointer}
.dmsm_none{color:#c3c9d4}
.dmsm_unlinked{color:#d69e2e;font-size:11px}
.dmsm_empty{padding:24px;text-align:center;color:var(--muted);font-size:14px}
.dmsm_pager{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:10px;font-size:13px;color:var(--muted)}
.dmsm_issue_head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#fffaf0;border:1px solid #f0d9a8;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:14px}
.dmsm_issue_head p{margin-bottom:4px;max-width:72ch}
.dmsm_issue_title{font-weight:600;font-size:15px;margin-bottom:6px;color:var(--ink)}
.dmsm_unlinked_panel{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#fff5f5;border:1px solid #f3c4c4;border-radius:10px;padding:14px 16px;margin-bottom:16px;font-size:14px}
.dmsm_unlinked_panel p{max-width:72ch}
.dmsm_unlinked_panel .form-select{min-width:200px}
.dmsm_drawer{width:min(560px,100vw)!important}
.dmsm_drawer_title{font-weight:600;font-size:17px}
.dmsm_links{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-bottom:14px}
.dmsm_links .ok{color:#2f855a}.dmsm_links .no{color:#b7791f}
.dmsm_links i{margin-right:6px}
.dmsm_fields{margin-bottom:16px}
.dmsm_fields h4{font-size:13px;font-weight:600;color:var(--ink);margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.dmsm_fields dl{display:grid;grid-template-columns:minmax(120px,42%) 1fr;gap:3px 12px;margin:0;font-size:13px}
.dmsm_fields dt{font-weight:400;color:var(--muted);overflow-wrap:anywhere}
.dmsm_fields dd{margin:0;color:var(--ink);overflow-wrap:anywhere}
.dmsm_line{padding:6px 0;border-bottom:1px dashed var(--line)}
`;
