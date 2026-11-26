"use client";
// One DMS record in a side panel over the page (24 Nov 2026): every field the DMS sent, grouped. Close (✕, Esc or Back)
// returns to exactly where you were. Reuses /api/admin/dms-feed/mirror (dv, dept, key).
import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Offcanvas, Spinner } from "react-bootstrap";
import { call, stampText } from "./shared";

const GROUPS = [
  ["Money", /(Cost|Sale\b|Sales|Price|Gross|Profit|Tax|Fee|Amount|Payment)/],
  ["Customer", /^(Full Name|Salutation|First Name|Middle Name|Last Name|Suffix|Address|City|State|Zip|County|Home Phone|Cell Phone|Work Phone|Work Extension|Email|Birth Date|Individual|Opt Out|Block|Language|Customer )/],
  ["Vehicle", /^(VIN|Year|Make|Model|Trim|Exterior Color|Stock Number|Transmission|Engine|Chassis|License|Mileage|RO Mileage|Mileage Out|Delivery Mileage|Appointment Mileage|Last RO Miles|Description|New\/Used|In Service Date|Tag Number|Accounting Make)/],
  ["People", /(Advisor|Salesman|Manager|Tech Name)/],
  ["Dates", /(Date|Time)$/],
];
const groupOf = (k) => (GROUPS.find(([, rx]) => rx.test(k)) || ["Other"])[0];

export default function RecordPanel({ rec, onClose }) {
  const [dv, dept, key] = rec ? rec.split(":") : [];
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!dv || !dept || !key) return undefined;
    let live = true;
    setD(null); setErr(null);
    call(`/api/admin/dms-feed/mirror?dv=${encodeURIComponent(dv)}&dept=${dept}&key=${encodeURIComponent(key)}`)
      .then((x) => live && setD(x.record)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [dv, dept, key]);
  const groups = useMemo(() => {
    const g = new Map();
    for (const [k, v] of d?.fields || []) { const name = groupOf(k); if (!g.has(name)) g.set(name, []); g.get(name).push([k, v]); }
    return ["Customer", "Vehicle", "People", "Dates", "Money", "Other"].filter((k) => g.has(k)).map((k) => [k, g.get(k)]);
  }, [d]);
  return (
    <Offcanvas show={!!rec} onHide={onClose} placement="end" style={{ width: "min(560px,100vw)" }}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title as="div"><div className="fw-semibold" style={{ fontSize: 18 }}>{d ? `${d.keyLabel} ${key}` : key}</div>
          {d && <div className="dmsx_sub">{d.label} · as the DMS sent it{d.file_stamp ? ` in the file of ${stampText(d.file_stamp, true)}` : ""}</div>}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {err && <Alert variant="danger" className="py-2 small">{err}</Alert>}
        {!d && !err && <Spinner size="sm" />}
        {d && dept !== "parts" && <div className={`mb-3 small ${d.linked.customer ? "text-success" : "text-warning"}`}>
          <i className={`fa-solid ${d.linked.customer ? "fa-link" : "fa-link-slash"} me-1`} />{d.linked.customer ? "On a customer's profile" : "Not on any customer"}</div>}
        {groups.map(([name, rows]) => (
          <section key={name} className="mb-3"><div className="fw-semibold small mb-1 pb-1 border-bottom">{name}</div>
            <dl className="dmsx_kv" style={{ gridTemplateColumns: "44% 1fr", fontSize: 13.5 }}>{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl></section>))}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
