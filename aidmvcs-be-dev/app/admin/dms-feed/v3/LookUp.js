"use client";
// Customer details (24 Nov 2026): find a customer by name, phone, email, DMS customer number, RO, deal number or VIN,
// see where each of their details came from (every value, its source, date, decision and reason, newest first) and act on
// it: "Use this value" (staff confirm it; later DMS files can't undo it) or "Customer says it's wrong" (the DMS never
// brings it back). SOW Appendix B 3-4.
import { useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import { API, DECISION, SOURCE, call, dayText, fieldName, n, useView } from "./shared";


const show = (v) => (typeof v === "number" ? n(v) : String(v ?? ""));

function History({ id, addr }) {
  const v = useView({ view: "customer", id });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const act = async (f, r, action) => {
    const what = `${fieldName(f.field)} ${show(r.value)}`;
    if (!window.confirm(action === "confirm" ? `Make ${what} the current value? Later DMS files won't change it.` : `Record that the customer says ${what} is wrong? The DMS will never bring it back.`)) return;
    setBusy(`${f.field}${r.value}`);
    try {
      await call(API, { method: "POST", body: JSON.stringify({ action, customer_id: id, field: f.field, value: r.value }) });
      setMsg(action === "confirm" ? `${what} is now the current value.` : `Recorded: the customer says ${what} is wrong.`);
      await v.reload();
    } catch (e) { setMsg(e.message); }
    setBusy(null);
  };
  if (!v.data) return v.error ? <Alert variant="danger" className="py-2 small">{v.error}</Alert> : <Spinner size="sm" />;
  const c = v.data;
  return (
    <div className="dmsx_card">
      <div className="d-flex align-items-start gap-2 mb-3">
        <Button size="sm" variant="outline-secondary" onClick={() => addr.back({ cust: null })} title="Back to the results"><i className="fa-solid fa-arrow-left" /></Button>
        <div><div className="fw-semibold" style={{ fontSize: 17 }}>{c.name}</div>
          <div className="dmsx_sub">{c.dealer} · on the profile now: {[...c.profile.phones, ...c.profile.emails].join(", ") || "no phone or email"}</div></div>
      </div>
      {msg && <Alert variant="info" className="py-2 small" dismissible onClose={() => setMsg(null)}>{msg}</Alert>}
      {!c.fields.length ? <div className="dmsx_empty">Nothing from the DMS has been decided for this customer yet.</div> : c.fields.map((f) => (
        <div key={f.field} className="mb-3">
          <div className="d-flex align-items-baseline gap-3 flex-wrap mb-1"><b>{fieldName(f.field)}</b>
            <span className="dmsx_sub">Current: <b className="text-dark">{f.current ? show(f.current.value) : "nothing used yet"}</b>{f.current ? ` (from ${SOURCE[f.current.source] || f.current.source}, ${dayText(f.current.date)})` : ""}</span></div>
          <table className="dmsx_tbl"><thead><tr><th>Date</th><th>Value</th><th>From</th><th>Decision</th><th>Why</th><th /></tr></thead>
            <tbody>{f.rows.map((r, i) => (
              <tr key={i}><td className="text-nowrap">{dayText(r.date) || "no date"}<div className="dmsx_sub">{r.record ? `${r.type === "sale" ? "Deal" : "RO"} ${r.record}` : r.file || ""}</div></td>
                <td>{show(r.value)}</td><td>{SOURCE[r.source] || r.source}</td>
                <td>{r.open ? <span className="dmsx_word held">Waiting for a decision</span> : r.status === "CUSTOMER_DISPUTED" ? "Customer says it's wrong" : r.status === "DEALER_USER_CONFIRMED" ? "Confirmed by staff" : DECISION[r.decision]}{r.by && <div className="dmsx_sub">{r.by}</div>}</td>
                <td className="dmsx_sub">{r.reason}</td>
                <td><div className="dmsx_acts">{i === f.rows.findIndex((x) => x.value === r.value) && (<>
                  {f.field.startsWith("mileage:") && f.current?.value !== r.value && !(f.disputed || []).includes(r.value) && (
                    <Button size="sm" variant="outline-secondary" disabled={busy === `${f.field}${r.value}`} onClick={() => act(f, r, "confirm")}>Use this value</Button>)}
                  {!(f.disputed || []).includes(r.value) ? (
                    <Button size="sm" variant="outline-secondary" disabled={busy === `${f.field}${r.value}`} onClick={() => act(f, r, "dispute")}>Customer says it&apos;s wrong</Button>)
                    : <span className="dmsx_word late">Customer says it&apos;s wrong</span>}</>)}</div></td></tr>))}</tbody></table>
        </div>))}
    </div>
  );
}

export default function LookUp({ addr }) {
  const [q, setQ] = useState(addr.get("lq"));
  const cust = addr.get("cust");
  const v = useView(!cust ? { view: "lookup", q: addr.get("lq"), dv: addr.get("dv"), from: addr.get("from"), to: addr.get("to") } : null);
  if (cust) return <History id={cust} addr={addr} />;
  return (
    <div className="dmsx_card">
      <form className="d-flex gap-2 flex-wrap mb-2" onSubmit={(e) => { e.preventDefault(); addr.go({ lq: q.trim() || null }); }}>
        <Form.Control size="sm" style={{ maxWidth: 360 }} placeholder="Customer name, phone, email, DMS number, RO, deal or VIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Look up" />
        <Button size="sm" variant="custom" type="submit">Look up</Button>
      </form>
      <div className="dmsx_note">Open a customer to see where each detail came from (the DMS, staff, the customer, the lead form), fix a wrong mileage with <b>Use this value</b>, or record that <b>the customer says a value is wrong</b> so the DMS never brings it back.</div>
      {v.loading && !v.data ? <Spinner size="sm" /> : v.error ? <Alert variant="danger" className="py-2 small">{v.error}</Alert> : !v.data?.rows.length ? (
        <div className="dmsx_empty">{addr.get("lq") ? <>No customer matches “{addr.get("lq")}”{addr.get("dv") ? " in this store" : ""}.</> : "No customer details have come from the DMS yet."}</div>
      ) : (
        <>{v.data.recent && <div className="fw-semibold mb-2">Customers the DMS changed most recently</div>}
        <table className="dmsx_tbl"><thead><tr><th>Customer</th><th>Dealer</th><th>Phone</th><th>Email</th><th>{v.data.recent ? "Last change" : "DMS number"}</th><th /></tr></thead>
          <tbody>{v.data.rows.map((r) => (
            <tr key={r.id} className="go" onClick={() => addr.go({ cust: r.id })}><td><b>{r.name}</b></td><td>{r.dealer}</td><td>{r.phone || "-"}</td><td>{r.email || "-"}</td>
              <td>{r.last ? <>{fieldName(r.last.field)}: {typeof r.last.value === "number" ? n(r.last.value) : r.last.value}<div className="dmsx_sub">{DECISION[r.last.decision]}, {dayText(r.last.at)}</div></> : r.numbers.join(", ") || "-"}</td>
              <td className="text-end"><i className="fa-solid fa-chevron-right dmsx_sub" /></td></tr>))}</tbody></table></>
      )}
    </div>
  );
}
