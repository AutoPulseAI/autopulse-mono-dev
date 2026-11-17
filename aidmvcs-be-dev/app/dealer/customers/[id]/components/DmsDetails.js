"use client";
// "Key information" on the customer profile: what the dealership's DMS sales file says about this customer
// (17 Nov 2026, BB's DealerSocket / VinSolutions screenshots): birthday, middle name, company or individual, other
// emails, the DMS's Do Not Call / Email / Mail, the co-buyer, and each financed or leased car with its last payment
// date. The yellow bar shows when the latest lease ends (DealerSocket's "eol" bar). Read-only (app/lib/dmsProfile.js);
// empty when the customer has no DMS sale.
import { useState } from "react";
import { formatCurrency } from "../../../../utils/formatCurrency";

const day = (v) => (v ? new Date(v).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : null);
const fullName = (p) => p?.full_name || [p?.first_name, p?.middle_name, p?.last_name, p?.suffix].filter(Boolean).join(" ");

function Row({ icon, label, children }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className="cp_kv"><i className={`fa-solid ${icon}`} /><span className="cp_kv_label">{label}</span><span>{children}</span></div>
  );
}

function DoNot({ flags }) {
  const on = [["call", "Do Not Call"], ["email", "Do Not Email"], ["mail", "Do Not Mail"], ["opt_out", "Opted out (DMS)"]]
    .filter(([k]) => flags?.[k]);
  if (!on.length) return null;
  return (
    <div className="d-flex flex-wrap gap-1 mt-1">
      {on.map(([k, l]) => <span key={k} className="badge text-bg-danger">{l}</span>)}
    </div>
  );
}

function Person({ p }) {
  return (
    <>
      <Row icon="fa-user" label="Full name">{fullName(p)}</Row>
      <Row icon="fa-cake-candles" label="Birthday">{day(p.birth_date)}</Row>
      <Row icon="fa-building" label="Type">{p.business == null ? null : p.business ? "Company" : "Individual"}</Row>
      <Row icon="fa-language" label="Language">{p.language}</Row>
      <Row icon="fa-map" label="County">{p.county}</Row>
      <Row icon="fa-phone" label="Phones">{p.phones?.length ? p.phones.map((x) => `${x.label} ${x.value}`).join(" · ") : null}</Row>
      <Row icon="fa-envelope" label="Emails">{p.emails?.length ? p.emails.join(" · ") : null}</Row>
      <Row icon="fa-location-dot" label="Address">{p.address}</Row>
      <DoNot flags={p.do_not} />
    </>
  );
}

export function LeaseBar({ dms }) {
  const end = dms?.lease_end;
  if (!end?.date) return null;
  const past = new Date(end.date) < new Date();
  return (
    <div className="cp_lease_bar mb-3">
      <i className="fa-solid fa-calendar-xmark" />
      <span>Lease {past ? "ended" : "ends"} <strong>{day(end.date)}</strong> · {end.vehicle}</span>
      <small className="ms-auto">from the DMS (first payment + term)</small>
    </div>
  );
}

export default function DmsDetails({ dms }) {
  const [open, setOpen] = useState(true);
  if (!dms?.person && !dms?.finance?.length) return null;
  return (
    <div className="cp_card cp_keyinfo mb-3">
      <button type="button" className="cp_keyinfo_head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <i className={`fa-solid fa-chevron-${open ? "down" : "right"}`} />
        <i className="fa-solid fa-circle-info" />Key information
        <small className="ms-2">from the DMS{dms.as_of?.date ? `, deal ${dms.as_of.deal_number || ""} of ${day(dms.as_of.date)}` : ""}</small>
      </button>
      {open && (
        <div className="cp_body">
          <section className="cp_section">
            <h6 className="cp_section_title"><i className="fa-solid fa-id-card" />Customer</h6>
            {dms.person ? <Person p={dms.person} /> : <p className="small text-muted mb-0">No buyer details in the DMS.</p>}
          </section>
          <section className="cp_section">
            <h6 className="cp_section_title"><i className="fa-solid fa-user-group" />Co-buyer</h6>
            {dms.co_buyer ? <Person p={dms.co_buyer} /> : <p className="small text-muted mb-0">No co-buyer on the latest deal.</p>}
          </section>
          <section className="cp_section">
            <h6 className="cp_section_title"><i className="fa-solid fa-file-invoice-dollar" />Finance &amp; lease</h6>
            {!dms.finance?.length && <p className="small text-muted mb-0">No financed or leased deal (cash or none).</p>}
            {dms.finance?.slice(0, 4).map((f) => (
              <div key={f.deal_number || f.vehicle} className="cp_fin">
                <div className="fw-semibold">{f.vehicle}
                  <span className={`badge ms-1 ${f.lease ? "text-bg-warning" : "text-bg-info"}`}>{f.deal_type || (f.lease ? "Lease" : "Finance")}</span>
                  {f.sale_type && <span className="badge text-bg-light ms-1">{f.sale_type}</span>}
                </div>
                <div className="small text-muted">
                  {[f.monthly_payment != null && `${formatCurrency(f.monthly_payment)}/mo`, f.term_months && `${f.term_months} mo`,
                    f.apr != null && `${f.apr}% APR`, f.bank].filter(Boolean).join(" · ")}
                </div>
                <div className="small">
                  {f.first_payment && <>First payment {day(f.first_payment)}</>}
                  {f.ends_at && <> · <strong>{f.lease ? "Lease ends" : "Last payment"} {day(f.ends_at)}</strong></>}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
