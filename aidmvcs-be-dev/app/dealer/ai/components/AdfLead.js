"use client";
// A lead-provider email (Cars.com, CarGurus, AutoTrader...) arrives as ADF XML:
//   <adf><prospect><vehicle>..</vehicle><customer>..</customer><vendor>..</vendor>..
// This turns it into a readable lead card instead of a wall of tags.

import { useMemo, useState } from "react";

const ADF_START = /<adf[\s>]/i;
const ESCAPED_ADF = /&lt;adf[\s&>]/i;

export const looksLikeAdf = (text) => ADF_START.test(text) || ESCAPED_ADF.test(text);

// The XML itself, or null when it won't parse (the caller then shows it as plain text).
function parseAdf(text) {
  let xml = text;
  if (!ADF_START.test(xml)) {
    xml = xml.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }
  const m = xml.match(/<adf[\s\S]*<\/adf>/i);
  if (!m) return null;
  // Bare ampersands (e.g. in URLs) and HTML-only entities would make the XML invalid.
  const safe = m[0].replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;");
  const doc = new DOMParser().parseFromString(safe, "text/xml");
  return doc.querySelector("parsererror") ? null : doc;
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const text = (root, sel) => clean(root?.querySelector(sel)?.textContent);
const all = (root, sel) => [...(root?.querySelectorAll(sel) || [])];

function personName(contact) {
  const full = text(contact, 'name[part="full"]');
  if (full) return full;
  const parts = ["first", "middle", "last"].map((p) => text(contact, `name[part="${p}"]`)).filter(Boolean);
  return parts.length ? parts.join(" ") : text(contact, "name");
}

function addressLines(address) {
  if (!address) return [];
  const streets = all(address, "street").map((s) => clean(s.textContent)).filter(Boolean);
  const cityLine = [text(address, "city"), [text(address, "regioncode"), text(address, "postalcode")].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  return [...streets, cityLine, text(address, "country")].filter(Boolean);
}

const money = (node) => {
  const n = Number(clean(node?.textContent).replace(/[^0-9.]/g, ""));
  if (!n) return "";
  const currency = node.getAttribute("currency") || "USD";
  try {
    return n.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return `$${n.toLocaleString()}`;
  }
};

const titleCase = (s) => String(s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "Exterior Color: Alfa White, Fuel Type: Gasoline, Engine: 2L I-4, MultiAir2..." -> [[key, value]...]
function keyValues(s) {
  const parts = s.split(/,\s*(?=[A-Z][^,:]{1,30}:\s)/);
  const pairs = parts.map((p) => p.match(/^([^:]{1,32}):\s*(.+)$/)).filter(Boolean);
  return pairs.length >= 2 && pairs.length === parts.length ? pairs.map((m) => [m[1].trim(), m[2].trim()]) : null;
}

function vehicleModel(v) {
  const odometer = v.querySelector("odometer");
  const colors = [text(v, "colorcombination exteriorcolor"), text(v, "colorcombination interiorcolor")];
  const options = all(v, "option").map((o) => clean(o.querySelector("optionname")?.textContent || o.textContent)).filter(Boolean);
  const features = [];
  const disclaimers = [];
  let listing = null;
  for (const o of options) {
    const kv = keyValues(o);
    if (kv) listing = kv;
    else if (o.length > 500) disclaimers.push(o);
    else features.push(...o.split(/,\s*/).filter(Boolean));
  }
  const odo = clean(odometer?.textContent);
  return {
    title: [text(v, "year"), text(v, "make"), text(v, "model"), text(v, "trim")].filter(Boolean).join(" "),
    interest: v.getAttribute("interest"),
    status: v.getAttribute("status"),
    price: money(v.querySelector("price")),
    priceType: v.querySelector("price")?.getAttribute("type"),
    specs: [
      ["VIN", text(v, "vin")],
      ["Stock #", text(v, "stock")],
      ["Mileage", odo ? `${Number(odo).toLocaleString()} ${odometer.getAttribute("units") || "mi"}` : ""],
      ["Body", text(v, "bodystyle")],
      ["Transmission", text(v, "transmission")],
      ["Doors", text(v, "doors")],
      ["Exterior", colors[0]],
      ["Interior", colors[1]],
    ].filter(([, val]) => val),
    listing: (listing || []).filter(([k]) => !/^(stock|mileage|transmission|exterior color|interior color)$/i.test(k)),
    features,
    disclaimers,
  };
}

function Linked({ value }) {
  return String(value).split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g).map((part, i) => (i % 2
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part.length > 60 ? `${part.slice(0, 57)}…` : part}</a>
    : part));
}

function Vehicle({ v }) {
  const [showAll, setShowAll] = useState(false);
  const shownFeatures = showAll ? v.features : v.features.slice(0, 12);
  return (
    <section className="aim-adf-sec">
      <h5 className="aim-adf-h"><i className="fa-regular fa-car me-2" />Vehicle of interest</h5>
      <div className="aim-adf-vehicle-top">
        <div className="aim-adf-vtitle">{v.title || "Vehicle"}</div>
        {v.price && <div className="aim-adf-price">{v.price}{v.priceType && <small>{titleCase(v.priceType)}</small>}</div>}
      </div>
      <div className="aim-adf-tags">
        {v.status && <span className="aim-adf-tag">{titleCase(v.status)}</span>}
        {v.interest && <span className="aim-adf-tag">{titleCase(v.interest)}</span>}
      </div>
      <dl className="aim-adf-grid">
        {[...v.specs, ...v.listing].map(([k, val]) => (
          <div key={k}><dt>{k}</dt><dd>{val}</dd></div>
        ))}
      </dl>
      {v.features.length > 0 && (
        <>
          <div className="aim-adf-sub">Features</div>
          <div className="aim-adf-chips">
            {shownFeatures.map((f, i) => <span key={`${f}-${i}`} className="aim-adf-chip">{f}</span>)}
            {v.features.length > 12 && (
              <button type="button" className="aim-adf-chip more" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : `+${v.features.length - 12} more`}
              </button>
            )}
          </div>
        </>
      )}
      {v.disclaimers.length > 0 && (
        <details className="aim-adf-fine">
          <summary>Dealer disclaimer</summary>
          {v.disclaimers.map((d, i) => <p key={i}>{d}</p>)}
        </details>
      )}
    </section>
  );
}

export default function AdfLead({ raw }) {
  const model = useMemo(() => {
    const doc = parseAdf(raw);
    if (!doc) return null;
    const prospect = doc.querySelector("prospect") || doc.documentElement;
    const contact = prospect.querySelector("customer contact");
    const vendor = prospect.querySelector("vendor");
    const provider = prospect.querySelector("provider");
    const requested = new Date(text(prospect, "requestdate"));
    return {
      status: prospect.getAttribute("status"),
      requested: Number.isNaN(requested.getTime()) ? "" : requested.toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
      source: text(provider, "service") || text(provider, "name") || prospect.querySelector("id")?.getAttribute("source") || "",
      name: personName(contact),
      email: text(contact, "email"),
      phone: text(contact, "phone"),
      address: addressLines(contact?.querySelector("address")),
      comments: (prospect.querySelector("customer comments")?.textContent || "").replace(/\r/g, "").trim(),
      vehicles: all(prospect, "vehicle").map(vehicleModel),
      vendor: vendor && {
        name: text(vendor, "vendorname"),
        email: text(vendor, "contact email"),
        phone: text(vendor, "contact phone"),
        address: addressLines(vendor.querySelector("contact address")),
      },
    };
  }, [raw]);

  if (!model) return <pre className="aim-adf-raw">{raw}</pre>;
  const { comments } = model;
  return (
    <div className="aim-adf">
      <div className="aim-adf-banner">
        <i className="fa-regular fa-bullseye-arrow me-2" />
        New lead{model.source ? ` from ${model.source}` : ""}
        {model.requested && <span className="ms-auto">{model.requested}</span>}
      </div>

      <section className="aim-adf-sec">
        <h5 className="aim-adf-h"><i className="fa-regular fa-user me-2" />Customer</h5>
        <div className="aim-adf-name">{model.name || "Unknown"}</div>
        <dl className="aim-adf-grid">
          {model.email && <div><dt>Email</dt><dd><a href={`mailto:${model.email}`}>{model.email}</a></dd></div>}
          {model.phone && <div><dt>Phone</dt><dd><a href={`tel:${model.phone}`}>{model.phone}</a></dd></div>}
          {model.address.length > 0 && <div><dt>Address</dt><dd>{model.address.join(", ")}</dd></div>}
        </dl>
      </section>

      {comments && (
        <section className="aim-adf-sec">
          <h5 className="aim-adf-h"><i className="fa-regular fa-message-lines me-2" />Customer comments</h5>
          {comments.split(/\n{2,}/).map((p, i) => (
            <p key={i} className="aim-adf-comment"><Linked value={p.replace(/&#39;/g, "'").trim()} /></p>
          ))}
        </section>
      )}

      {model.vehicles.map((v, i) => <Vehicle key={i} v={v} />)}

      {model.vendor?.name && (
        <footer className="aim-adf-foot">
          Sent to <strong>{model.vendor.name}</strong>
          {[model.vendor.email, model.vendor.phone].filter(Boolean).map((x) => <span key={x}> · {x}</span>)}
        </footer>
      )}
    </div>
  );
}
