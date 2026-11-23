"use client";
// Admin > DMS feed (super admin; rebuilt 24 Nov 2026 - docs/superpowers/specs/2026-11-24-dms-feed-design.md). Three
// questions, one tab each: Needs you (what a person has to decide), Feed health (is every store's feed arriving and
// importing), Look up (why does a customer's value look like this). A store picker (search by dealer name or store ID)
// and filters narrow every tab; nothing lists everything; every number opens exactly what it counts. The view lives in
// the address, so Back and refresh keep it; a record opens in a side panel. Rules (source precedence) is a button.
import { useEffect, useRef, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { SourcePrecedenceCard } from "./FieldCards";
import DateRangePickerComponent from "../components/DateRangePicker";
import NeedsYou from "./v3/NeedsYou";
import FeedHealth from "./v3/FeedHealth";
import LookUp from "./v3/LookUp";
import RecordPanel from "./v3/RecordPanel";
import { API, CSS, TYPE, TYPES, call, n, useAddress, useView } from "./v3/shared";

function StorePicker({ addr }) {
  const dv = addr.get("dv");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [name, setName] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => call(`${API}?view=stores&q=${encodeURIComponent(q)}`).then((d) => setList(d.stores)).catch(() => setList([])), 200);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    if (!dv) { setName(null); return; }
    call(`${API}?view=stores&q=${encodeURIComponent(dv)}`).then((d) => setName(d.stores.find((s) => s.dv === dv)?.dealer?.name || null)).catch(() => {});
  }, [dv]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const pick = (s) => { setOpen(false); setQ(""); addr.go({ dv: s, kind: null, page: null, open: null, file: null, outcome: null, fpage: null, cust: null }); };
  if (dv) {
    return <span className="dmsx_chip"><i className="fa-solid fa-store" /><b>{name || "Not linked"}</b><span className="dmsx_sub">{dv}</span>
      <button type="button" onClick={() => pick(null)} aria-label="Show all stores" title="All stores"><i className="fa-solid fa-xmark" /></button></span>;
  }
  return (
    <div className="dmsx_picker" ref={box}>
      <Form.Control size="sm" value={q} placeholder="All stores · search a dealer name or store ID" onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} aria-label="Pick a store" />
      {open && (
        <div className="dmsx_picker_menu" role="listbox">
          {!list ? <div className="p-2"><Spinner size="sm" /></div> : !list.length ? <div className="p-2 dmsx_sub">No store matches.</div>
            : list.map((s) => (
              <button key={s.dv} type="button" role="option" aria-selected="false" onClick={() => pick(s.dv)}>
                {s.dealer ? <b>{s.dealer.name}</b> : <b className="text-danger">Not linked</b>}<small>{s.dv}</small></button>))}
          {list && list.length >= 20 && <div className="p-2 dmsx_sub">Showing 20. Type more of the name.</div>}
        </div>)}
    </div>
  );
}

export default function DmsFeedPage() {
  const addr = useAddress();
  const tab = ["needs", "health", "lookup"].includes(addr.get("tab")) ? addr.get("tab") : "needs";
  const scope = { dv: addr.get("dv"), type: addr.get("type"), from: addr.get("from"), to: addr.get("to") };
  const ymd = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null);
  const dayOf = (s) => (s ? new Date(`${s}T00:00:00`) : null);
  const needs = useView(addr.ready ? { view: "needs", ...scope } : null);
  const [rules, setRules] = useState(false);
  const [dealers, setDealers] = useState([]);
  useEffect(() => { if (rules && !dealers.length) call("/api/admin/dms-feed/stores").then((d) => setDealers(d.dealers)).catch(() => {}); }, [rules, dealers.length]);
  const needCount = (needs.data?.groups || []).filter((g) => g.count > 0).length;
  const setTab = (t) => addr.go({ tab: t === "needs" ? null : t, kind: null, page: null, file: null, outcome: null, fpage: null, cust: null, type: t === "lookup" ? null : addr.get("type") || null });

  return (
    <div className="page_content dmsx">
      <style>{CSS}</style>
      <div className="page_head d-flex align-items-center gap-2 flex-wrap">
        <h3 className="page_title mb-0 me-auto">DMS feed</h3>
        <Button size="sm" variant="outline-secondary" onClick={() => setRules(true)}><i className="fa-solid fa-scale-balanced me-1" />Rules</Button>
        <Button size="sm" variant="outline-secondary" onClick={() => needs.reload()}>Refresh</Button>
      </div>
      <div className="page_body">
        <div className="dmsx_scope">
          <StorePicker addr={addr} />
          {tab !== "lookup" && !(tab === "health" && addr.get("dv")) && (
            <Form.Select size="sm" style={{ width: "auto" }} value={addr.get("type")} onChange={(e) => addr.go({ type: e.target.value || null, page: null, file: null }, { replace: true })} aria-label="File type">
              <option value="">All file types</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE[t]}</option>)}
            </Form.Select>)}
          <div style={{ minWidth: 200 }} title="Dates: files, rejected rows, held files and changes on these days">
            <DateRangePickerComponent dateRange={{ startDate: dayOf(scope.from), endDate: dayOf(scope.to) }}
              onDateRangeChange={({ startDate, endDate }) => { if (ymd(startDate) !== (scope.from || null) || ymd(endDate) !== (scope.to || null)) addr.go({ from: ymd(startDate), to: ymd(endDate), page: null, fpage: null }, { replace: true }); }} />
          </div>
        </div>
        <div className="dmsx_tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "needs"} className={tab === "needs" ? "on" : ""} onClick={() => setTab("needs")}>
            Needs you {needs.data && (needCount ? <span className="c">{n(needCount)}</span> : <i className="fa-solid fa-circle-check text-success" />)}</button>
          <button type="button" role="tab" aria-selected={tab === "health"} className={tab === "health" ? "on" : ""} onClick={() => setTab("health")}>Feed health</button>
          <button type="button" role="tab" aria-selected={tab === "lookup"} className={tab === "lookup" ? "on" : ""} onClick={() => setTab("lookup")}>Customer details</button>
        </div>
        {needs.error && tab === "needs" && <div className="text-danger small mb-2">{needs.error}</div>}
        {!addr.ready ? <Spinner size="sm" /> : <>
        {tab === "needs" && <NeedsYou scope={scope} addr={addr} groups={needs.data?.groups} onChanged={needs.reload} />}
        {tab === "health" && <FeedHealth addr={addr} />}
        {tab === "lookup" && <LookUp addr={addr} />}
        </>}
      </div>
      <RecordPanel rec={addr.get("rec") || null} onClose={() => addr.back({ rec: null })} />
      <Modal show={rules} onHide={() => setRules(false)} size="xl">
        <Modal.Header closeButton><Modal.Title>Rules: which customer details we keep</Modal.Title></Modal.Header>
        <Modal.Body><SourcePrecedenceCard dealers={dealers} /></Modal.Body>
      </Modal>
    </div>
  );
}
