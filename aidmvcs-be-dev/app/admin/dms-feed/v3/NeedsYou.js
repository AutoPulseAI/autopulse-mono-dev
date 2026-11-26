"use client";
// Needs you (24 Nov 2026): what a person has to decide or act on, grouped by kind, each one sentence with its count;
// opening a group lists exactly the stores, files or records it counted (25 a page) with the action for each.
import { Fragment, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import { API, DEPT, Pager, TYPE, call, dayText, n, plural, stampText, useView, words } from "./shared";

const KIND = {
  late: { icon: "fa-triangle-exclamation", tone: "red",
    title: (g) => `${plural(g.count, "feed")} stopped arriving`,
    sub: () => "No file for more than 36 hours. DealerVault has to restart them; the dealer's other files may still come." },
  not_linked: { icon: "fa-store-slash", tone: "red",
    title: (g) => `${plural(g.count, "store")} ${g.count === 1 ? "sends" : "send"} files no dealer is linked to`,
    sub: (g) => `${plural(g.held || 0, "file")} kept back. Nothing from them is in AutoPulse until the store is linked.` },
  held: { icon: "fa-box-archive", tone: "red",
    title: (g) => `${plural(g.count, "file")} held by the checks`,
    sub: () => "Broken, or much smaller than the store's usual file. Nothing from them was written." },
  value_review: { icon: "fa-gauge-high", tone: "amber",
    title: (g) => `${plural(g.count, "value")} ${g.count === 1 ? "looks" : "look"} wrong`,
    sub: () => "For example a mileage that drops. Not used until someone picks the right one." },
  no_customer: { icon: "fa-user-slash", tone: "amber",
    title: (g) => `${plural(g.count, "record")} ${g.count === 1 ? "isn't" : "aren't"} on any customer`,
    sub: () => "The DMS customer on them matched no AutoPulse customer, so they don't show on anyone's profile." },
  rejected: { icon: "fa-ban", tone: "amber",
    title: (g) => `${plural(g.count, "row")} couldn't be used`,
    sub: () => "In files of the last 7 days. Usually the DMS sent a row without its number." },
};

// A late feed: AutoPulse only receives DealerVault's files, so a feed that stops has to be restarted by DealerVault.
// The panel says that, shows the exact message to send them, and how to reach them.
function TellDealerVault({ r }) {
  const [copied, setCopied] = useState(false);
  const text = `Hello DealerVault support,\n\nWe are AutoPulse, a vendor receiving ${r.dealer || "a dealer"}'s data (DealerVault store ${r.dv}). We have not received the ${r.type} (${TYPE[r.type]}) file since ${stampText(r.last_stamp, true)}. Could you check this feed, restart it, and resend the files we missed?\n\nThank you,\nAutoPulse`;
  return (
    <div className="dmsx_inl">
      <p className="mb-2"><b>Why you have to do something:</b> DealerVault sends us {r.dealer || "this store"}&apos;s DMS files; AutoPulse only receives them. Its {TYPE[r.type]} file stopped coming {plural(r.days, "day")} ago, so {TYPE[r.type].toLowerCase()} since then aren&apos;t in AutoPulse. Only DealerVault can restart it.</p>
      <p className="mb-2"><b>What to do:</b> send DealerVault support the message below (phone 1-866-289-3283, or the support form in the DealerVault portal). When the file comes again, this item disappears by itself.</p>
      <Form.Control as="textarea" rows={6} readOnly value={text} className="mb-2" style={{ fontSize: 13, maxWidth: 760 }} aria-label="Message for DealerVault" />
      <Button size="sm" variant="custom" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
        <i className={`fa-${copied ? "solid fa-check" : "regular fa-copy"} me-1`} />{copied ? "Copied" : "Copy the message"}</Button>
    </div>
  );
}

function Rows({ kind, scope, addr, onChanged }) {
  const page = Number(addr.get("page")) || 1;
  const [tell, setTell] = useState(null);
  const v = useView({ view: "needs", kind, ...scope, page });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const act = async (id, fn, ok) => {
    setBusy(id);
    try { await fn(); setMsg({ v: "success", t: ok }); await v.reload(); onChanged(); } catch (e) { setMsg({ v: "danger", t: e.message }); }
    setBusy(null);
  };
  if (v.loading && !v.data) return <Spinner size="sm" />;
  if (v.error) return <Alert variant="danger" className="py-2 small">{v.error}</Alert>;
  const d = v.data;
  const openStore = (dv, type, file) => addr.go({ tab: "health", dv, open: type, type: null, file: file || null, kind: null, page: null });
  let table = null;
  if (kind === "late") {
    table = (
      <table className="dmsx_tbl"><thead><tr><th>Dealer</th><th>File</th><th>Last file</th><th>Silent for</th><th /></tr></thead>
        <tbody>{d.rows.map((r) => {
          const id = `${r.dv}${r.type}`;
          const on = tell === id;
          return (
            <Fragment key={id}>
              <tr><td><b>{r.dealer || "Not linked"}</b><div className="dmsx_sub">{r.dv}</div></td><td>{TYPE[r.type]}</td>
                <td>{stampText(r.last_stamp, true)}</td><td className="text-danger fw-semibold">{plural(r.days, "day")}</td>
                <td><div className="dmsx_acts">
                  <Button size="sm" variant={on ? "secondary" : "outline-secondary"} onClick={() => setTell(on ? null : id)}>What to do</Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => openStore(r.dv, r.type)}>See its files</Button></div></td></tr>
              {on && <tr><td colSpan={5}><TellDealerVault r={r} /></td></tr>}
            </Fragment>);
        })}</tbody></table>);
  } else if (kind === "not_linked") {
    table = (
      <table className="dmsx_tbl"><thead><tr><th>Store</th><th>Sends</th><th>Last file</th><th className="num">Files kept back</th><th /></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.dv}><td><b className="text-danger">Not linked</b><div className="dmsx_sub">{r.dv}</div></td><td>{r.types.map((t) => TYPE[t] || t).join(", ")}</td>
            <td>{stampText(r.last_stamp, true)}</td><td className="num">{n(r.held)}</td>
            <td className="text-end"><LinkStore dv={r.dv} onDone={() => act(r.dv, async () => {}, `${r.dv} linked. Its held files can now be imported from Feed health.`)} /></td></tr>))}</tbody></table>);
  } else if (kind === "held") {
    table = (
      <table className="dmsx_tbl"><thead><tr><th>Dealer</th><th>File</th><th className="num">Rows</th><th>Why it was held</th><th /></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.id}><td><b>{r.dealer}</b><div className="dmsx_sub">{r.dv}</div></td><td>{TYPE[r.type]}<div className="dmsx_sub">{r.file}</div></td>
            <td className="num">{n(r.rows)}{r.expected ? <div className="dmsx_sub">usually {n(Math.round(r.expected))}</div> : null}</td>
            <td>{r.reasons.map((x) => <div key={x}>{x}</div>)}</td>
            <td><div className="dmsx_acts">
              <Button size="sm" variant="outline-secondary" disabled={busy === r.id}
                onClick={() => window.confirm(`Import ${r.file} anyway? Its ${n(r.rows)} rows will be applied.`) && act(r.id, () => call(`/api/admin/dms-feed/held/${r.id}`, { method: "POST", body: JSON.stringify({ action: "release" }) }), "Import requested. It runs within a minute.")}>Import anyway</Button>
              <Button size="sm" variant="outline-secondary" disabled={busy === r.id}
                onClick={() => window.confirm(`Discard ${r.file}? It will never be imported.`) && act(r.id, () => call(`/api/admin/dms-feed/held/${r.id}`, { method: "POST", body: JSON.stringify({ action: "discard" }) }), "Discarded.")}>Discard</Button></div></td></tr>))}</tbody></table>);
  } else if (kind === "value_review") {
    table = (
      <table className="dmsx_tbl"><thead><tr><th>Customer</th><th>What</th><th>What we have</th><th>What the DMS sent</th><th>Why we stopped</th><th /></tr></thead>
        <tbody>{d.rows.map((r) => {
          const id = `${r.customer_id}${r.field}`;
          const resolve = (choice) => act(id, () => call(API, { method: "POST", body: JSON.stringify({ action: "resolve", customer_id: r.customer_id, field: r.field, choice }) }),
            choice === "accept" ? `Now ${n(r.incoming.value)}.` : `Kept ${n(r.current?.value)}.`);
          return (
            <tr key={id}><td><b>{r.customer || "Unnamed"}</b><div className="dmsx_sub">{r.dealer}</div></td><td>{r.field.startsWith("mileage:") ? <>Mileage<div className="dmsx_sub">VIN {r.field.slice(8)}</div></> : r.field}</td>
              <td>{r.current ? <>{n(r.current.value)}<div className="dmsx_sub">RO {r.current.record}, {dayText(r.current.date)}</div></> : <span className="zero">nothing yet</span>}</td>
              <td>{n(r.incoming.value)}<div className="dmsx_sub">RO {r.incoming.record}, {dayText(r.incoming.date)}{r.observations > 1 ? ` (and ${r.observations - 1} more)` : ""}</div></td>
              <td className="dmsx_sub" style={{ maxWidth: 260 }}>{r.reason}</td>
              <td><div className="dmsx_acts">
                {r.current && <Button size="sm" variant="outline-secondary" disabled={busy === id} onClick={() => resolve("keep")}>{n(r.current.value)} is right</Button>}
                <Button size="sm" variant="outline-secondary" disabled={busy === id} onClick={() => resolve("accept")}>{n(r.incoming.value)} is right</Button></div></td></tr>);
        })}</tbody></table>);
  } else if (kind === "no_customer") {
    table = (
      <table className="dmsx_tbl"><thead><tr><th>Record</th><th>Customer in the DMS</th><th>Dealer</th><th /></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={`${r.type}${r.key}`} className="go" onClick={() => addr.go({ rec: `${r.dv}:${DEPT[r.type]}:${r.key}` })}>
            <td><b>{TYPE[r.type]} {r.key}</b></td><td>{r.customer || "No name"}<div className="dmsx_sub">DMS customer {r.number || "-"}</div></td><td>{r.dealer}</td>
            <td className="text-end"><i className="fa-solid fa-chevron-right dmsx_sub" /></td></tr>))}</tbody></table>);
  } else {
    table = (
      <table className="dmsx_tbl"><thead><tr><th>File</th><th>Dealer</th><th className="num">Rows not used</th><th>Why</th><th /></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.file} className="go" onClick={() => addr.go({ tab: "health", dv: r.dv, open: r.type, type: null, file: r.file, outcome: "rejected", kind: null, page: null })}>
            <td><b>{TYPE[r.type]}</b><div className="dmsx_sub">{r.file}</div></td><td>{r.dealer}</td><td className="num">{n(r.rows)}</td>
            <td>{r.codes.map(words).join(", ")}</td><td className="text-end"><i className="fa-solid fa-chevron-right dmsx_sub" /></td></tr>))}</tbody></table>);
  }
  return (
    <div className="dmsx_card">
      {msg && <Alert variant={msg.v} className="py-2 small" dismissible onClose={() => setMsg(null)}>{msg.t}</Alert>}
      {!d.rows.length ? <div className="dmsx_empty">Nothing left here.</div> : <div className="table-responsive">{table}</div>}
      <Pager page={d.page} pages={d.pages} total={d.total} noun={kind === "value_review" ? "value" : kind === "late" ? "feed" : kind === "not_linked" ? "store" : kind === "held" ? "file" : kind === "rejected" ? "file" : "record"}
        onPage={(p) => addr.go({ page: p > 1 ? p : null })} />
    </div>
  );
}

function LinkStore({ dv, onDone }) {
  const [open, setOpen] = useState(false);
  const [dealers, setDealers] = useState(null);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState(null);
  const start = async () => {
    setOpen(true);
    try { const d = await call("/api/admin/dms-feed/stores"); setDealers(d.dealers.filter((x) => !x.dv)); } catch (e) { setErr(e.message); }
  };
  if (!open) return <Button size="sm" variant="outline-secondary" onClick={start}>Link to a dealer</Button>;
  const link = async () => {
    const name = dealers.find((x) => x.id === pick)?.name;
    if (!window.confirm(`Link ${dv} to ${name}? Its files will be imported into ${name}, and its customers become ${name}'s customers.`)) return;
    try { await call("/api/admin/dms-feed/stores", { method: "PUT", body: JSON.stringify({ dealer_id: pick, dv }) }); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="d-flex gap-1 justify-content-end">
      {err && <span className="text-danger small me-2">{err}</span>}
      <Form.Select size="sm" style={{ maxWidth: 220 }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Dealer for ${dv}`}>
        <option value="">{dealers ? "Pick the dealer" : "Loading…"}</option>
        {(dealers || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Form.Select>
      <Button size="sm" variant="custom" disabled={!pick} onClick={link}>Link</Button>
    </div>
  );
}

export default function NeedsYou({ scope, addr, groups, onChanged }) {
  const open = addr.get("kind");
  if (!groups) return <Spinner size="sm" />;
  const active = groups.filter((g) => g.count > 0);
  if (!active.length) {
    return <div className="dmsx_clear"><i className="fa-solid fa-circle-check fa-lg" />Nothing needs you. Every feed arrived on time and imported{scope.dv ? " for this store" : ""}.</div>;
  }
  return (
    <div>
      {active.map((g) => {
        const k = KIND[g.kind];
        const on = open === g.kind;
        return (
          <div key={g.kind}>
            <button type="button" className={`dmsx_item ${on ? "on" : ""}`} aria-expanded={on}
              onClick={() => addr.go({ kind: on ? null : g.kind, page: null })}>
              <span className={`i ${k.tone}`}><i className={`fa-solid ${k.icon}`} /></span>
              <span><span className="t d-block">{k.title(g)}</span><span className="s d-block">{k.sub(g, scope.days)}{!scope.dv && g.stores ? ` ${g.stores === 1 ? "1 store." : `${n(g.stores)} stores.`}` : ""}</span></span>
              <span className="act">{on ? "Hide" : "Show"} <i className={`fa-solid fa-chevron-${on ? "up" : "down"} ms-1`} /></span>
            </button>
            {on && <Rows kind={g.kind} scope={scope} addr={addr} onChanged={onChanged} />}
          </div>
        );
      })}
    </div>
  );
}
