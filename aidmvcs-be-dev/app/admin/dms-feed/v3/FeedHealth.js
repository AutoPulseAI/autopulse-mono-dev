"use client";
// Feed health (24 Nov 2026). All stores: one row per store, a word per file type, problem stores first (25 a page,
// searchable, filterable). One store: its file types; a type opens its files; a file opens under its row with its exact
// counts and, per outcome, exactly those rows; a row opens the record panel.
import { Fragment, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import { DEPT, Pager, TYPE, TYPES, ago, n, plural, stampText, useView, words } from "./shared";

const WORD = { "on time": ["ok", "On time"], late: ["late", "Late"], held: ["held", "Held"], "never sent": ["none", "Never sent"] };
const Word = ({ t }) => {
  if (!t) return <span className="dmsx_word none">Not sent</span>;
  const [cls, label] = WORD[t.word] || ["none", t.word];
  return <span className={`dmsx_word ${cls}`} title={stampText(t.last_stamp, true)}>{label}{t.word === "late" ? `: ${Math.floor(t.hours / 24)} days` : ""}</span>;
};
const STATE = { not_linked: "Not linked", late: "Late", held: "Held", ok: "On time" };
const OUTCOME = [
  ["new", "New", "Records AutoPulse didn't have; added."],
  ["updated", "Updated", "Records AutoPulse had; this file's newer values replaced the old ones. A blank field in the file kept its value."],
  ["older", "Skipped, older", "A newer file had already updated these records, so this older file changed nothing."],
  ["not_on_customer", "Not on a customer", "Saved, but the DMS customer matched no AutoPulse customer, so they aren't on anyone's profile."],
  ["rejected", "Rejected", "Rows that couldn't be used at all (for example no RO number). Nothing from them was written."],
  ["importing", "Importing", "Still being imported."],
];

function StoresTable({ addr }) {
  const page = Number(addr.get("page")) || 1;
  const [q, setQ] = useState(addr.get("q"));
  const v = useView({ view: "health", q: addr.get("q"), status: addr.get("status"), type: addr.get("type"), page });
  return (
    <div className="dmsx_card">
      <form className="d-flex gap-2 flex-wrap align-items-center mb-2" onSubmit={(e) => { e.preventDefault(); addr.go({ q: q.trim() || null, page: null }); }}>
        <Form.Control size="sm" style={{ maxWidth: 280 }} placeholder="Dealer name or store ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stores" />
        <Button size="sm" variant="custom" type="submit">Search</Button>
        <div className="dmsx_switch ms-2" role="group" aria-label="Status">
          {[["", "All"], ["not_linked", "Not linked"], ["late", "Late"], ["held", "Held"], ["ok", "On time"]].map(([k, l]) => (
            <button key={k || "all"} type="button" className={addr.get("status") === k ? "on" : ""} onClick={() => addr.go({ status: k || null, page: null }, { replace: true })}>{l}</button>))}
        </div>
        {v.loading && <Spinner size="sm" />}
      </form>
      {v.error && <Alert variant="danger" className="py-2 small">{v.error}</Alert>}
      {v.data && (!v.data.rows.length ? <div className="dmsx_empty">No store matches.</div> : (
        <div className="table-responsive"><table className="dmsx_tbl">
          <thead><tr><th>Store</th>{TYPES.map((t) => <th key={t}>{TYPE[t]}</th>)}<th className="num">Files kept back</th><th /></tr></thead>
          <tbody>{v.data.rows.map((r) => (
            <tr key={r.dv} className="go" onClick={() => addr.go({ dv: r.dv, page: null, status: null, q: null })}>
              <td>{r.dealer ? <b>{r.dealer}</b> : <b className="text-danger">Not linked</b>}<div className="dmsx_sub">{r.dv} · {STATE[r.state]}</div></td>
              {TYPES.map((t) => <td key={t}><Word t={r.types[t]} />{r.types[t] && <div className="dmsx_sub">{ago(r.types[t].hours)}</div>}</td>)}
              <td className="num">{r.held ? <b className="text-danger">{n(r.held)}</b> : <span className="zero">0</span>}</td>
              <td className="text-end"><i className="fa-solid fa-chevron-right dmsx_sub" /></td></tr>))}</tbody></table></div>))}
      {v.data && <Pager page={v.data.page} pages={v.data.pages} total={v.data.total} noun="store" onPage={(p) => addr.go({ page: p > 1 ? p : null })} />}
    </div>
  );
}

function FileRows({ file, outcome, addr, dv }) {
  const [page, setPage] = useState(1);
  const v = useView({ view: "rows", file, outcome, page });
  if (!v.data) return v.error ? <Alert variant="danger" className="py-2 small">{v.error}</Alert> : <Spinner size="sm" />;
  const d = v.data;
  return (
    <>
      {!d.rows.length ? <div className="dmsx_empty">None.</div> : (
        <table className="dmsx_tbl bg-white"><thead><tr><th>{d.key_label}</th><th>Customer in the DMS</th><th>{d.type === "PTINV" ? "Part" : "Vehicle"}</th>{["rejected", "not_on_customer", "older"].includes(outcome) && <th>Why</th>}</tr></thead>
          <tbody>{d.rows.map((r, i) => (
            <tr key={`${r.key}${i}`} className={r.key && outcome !== "rejected" ? "go" : ""} onClick={() => r.key && outcome !== "rejected" && addr.go({ rec: `${dv}:${DEPT[d.type]}:${r.key}` })}>
              <td className="fw-semibold">{r.key || <span className="zero">none</span>}</td><td>{r.customer || <span className="zero">-</span>}{r.number && <div className="dmsx_sub">DMS customer {r.number}</div>}</td>
              <td>{r.detail || <span className="zero">-</span>}</td>{["rejected", "not_on_customer", "older"].includes(outcome) && <td className="dmsx_sub">{r.why.map(words).join(", ")}</td>}</tr>))}</tbody></table>)}
      <Pager page={d.page} pages={d.pages} total={d.total} noun="row" onPage={setPage} />
    </>
  );
}

function FilesOfType({ dv, type, addr }) {
  const page = Number(addr.get("fpage")) || 1;
  const v = useView({ view: "files", dv, type, page, ...(addr.get("from") ? { from: addr.get("from") } : {}), ...(addr.get("to") ? { to: addr.get("to") } : {}) });
  const open = addr.get("file");
  if (!v.data) return v.error ? <Alert variant="danger" className="py-2 small">{v.error}</Alert> : <Spinner size="sm" />;
  const d = v.data;
  return (
    <div className="dmsx_inl">
      {!d.rows.length ? <div className="dmsx_empty">No {TYPE[type]} file in this period.</div> : (
        <table className="dmsx_tbl">
          <thead><tr><th>File time</th><th className="num">Rows</th><th className="num">New</th><th className="num">Updated</th><th className="num">Skipped, older</th>
            <th className="num">Not on a customer</th><th className="num">Rejected</th><th /></tr></thead>
          <tbody>{d.rows.map((f) => {
            const on = open === f.file;
            const c = f.counts;
            return (
              <Fragment key={f.file}>
                <tr className={`go ${on ? "open" : ""}`} onClick={() => addr.go({ file: on ? null : f.file, outcome: null }, { replace: true })}>
                  <td><i className={`fa-solid fa-chevron-${on ? "down" : "right"} me-2 dmsx_sub`} /><b>{stampText(f.stamp, true)}</b></td>
                  <td className="num">{n(f.rows)}</td>
                  {c ? ["new", "updated", "older", "not_on_customer", "rejected"].map((k) => <td key={k} className={`num ${c[k] ? "" : "zero"}`}>{n(c[k])}</td>)
                    : <td colSpan={5} className={f.state === "held" ? "text-danger" : "dmsx_sub"}>{f.state === "held" ? "Held, nothing imported: " : "Discarded: "}{(f.reasons || []).join("; ")}</td>}
                  <td>{f.state === "importing" && <span className="dmsx_word none">Importing</span>}</td>
                </tr>
                {on && c && (
                  <tr><td colSpan={8} style={{ background: "#fff" }}>
                    <div className="dmsx_switch" role="tablist">
                      {OUTCOME.filter(([k]) => k !== "importing" || c.importing).map(([k, l]) => (
                        <button key={k} type="button" role="tab" aria-selected={(addr.get("outcome") || firstOutcome(c)) === k} className={(addr.get("outcome") || firstOutcome(c)) === k ? "on" : ""}
                          disabled={!c[k]} onClick={() => addr.go({ outcome: k }, { replace: true })}>{l}<span>{n(c[k])}</span></button>))}
                    </div>
                    <div className="dmsx_note">{OUTCOME.find(([k]) => k === (addr.get("outcome") || firstOutcome(c)))?.[2]}</div>
                    <FileRows file={f.file} outcome={addr.get("outcome") || firstOutcome(c)} addr={addr} dv={dv} />
                  </td></tr>)}
              </Fragment>);
          })}</tbody></table>)}
      <Pager page={d.page} pages={d.pages} total={d.total} noun="file" onPage={(p) => addr.go({ fpage: p > 1 ? p : null, file: null })} />
    </div>
  );
}
const firstOutcome = (c) => ["rejected", "not_on_customer", "new", "updated", "older", "importing"].find((k) => c[k]) || "updated";

function StoreSheet({ dv, addr }) {
  const v = useView({ view: "health", q: dv, page: 1 });
  const row = v.data?.rows.find((r) => r.dv === dv);
  const openType = addr.get("open");
  if (!v.data) return <Spinner size="sm" />;
  if (!row) return <div className="dmsx_empty">This store has sent no files.</div>;
  return (
    <div className="dmsx_card">
      {!row.dealer && <Alert variant="danger" className="py-2">No dealer is linked to {dv}, so nothing from its files was imported. Link it from Needs you, then import its held files.</Alert>}
      <table className="dmsx_tbl">
        <thead><tr><th>File</th><th>Status</th><th>Last file</th><th className="num">Files, last 30 days</th><th /></tr></thead>
        <tbody>{TYPES.filter((t) => row.types[t]).map((t) => {
          const on = openType === t;
          return (
            <Fragment key={t}>
              <tr className={`go ${on ? "open" : ""}`} onClick={() => addr.go({ open: on ? null : t, file: null, outcome: null, fpage: null })}>
                <td><i className={`fa-solid fa-chevron-${on ? "down" : "right"} me-2 dmsx_sub`} /><b>{TYPE[t]}</b></td><td><Word t={row.types[t]} /></td>
                <td>{stampText(row.types[t].last_stamp, true)}<div className="dmsx_sub">{ago(row.types[t].hours)}</div></td><td className="num">{n(row.types[t].files_30d)}</td>
                <td className="text-end dmsx_sub">{on ? "Hide files" : "Files"}</td></tr>
              {on && <tr><td colSpan={5} className="p-0">{row.types[t].word === "late" && (
                <div className="dmsx_inl text-danger fw-semibold" style={{ borderLeftColor: "#b02a37" }}>No {TYPE[t]} file since {stampText(row.types[t].last_stamp, true)}: {plural(Math.floor(row.types[t].hours / 24), "day")}. The files below are the last ones that came.</div>)}
                {row.dealer ? <FilesOfType dv={dv} type={t} addr={addr} />
                : <div className="dmsx_inl text-danger">Not imported: the store is not linked to a dealer ({plural(row.held, "file")} kept back).</div>}</td></tr>}
            </Fragment>);
        })}</tbody>
      </table>
      {TYPES.filter((t) => !row.types[t]).length > 0 && <div className="dmsx_sub mt-2">Never sent: {TYPES.filter((t) => !row.types[t]).map((t) => TYPE[t]).join(", ")}.</div>}
    </div>
  );
}

export default function FeedHealth({ addr }) {
  const dv = addr.get("dv");
  return dv ? <StoreSheet dv={dv} addr={addr} /> : <StoresTable addr={addr} />;
}
