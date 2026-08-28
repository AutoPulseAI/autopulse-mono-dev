import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
});

/**
 * Thrown when a payload is clearly ADF (contains an <adf> tag) but a usable lead
 * couldn't be extracted from it, even after sanitization. Callers should catch this
 * specifically and fall back to the AI/n8n pipeline rather than dropping the lead.
 */
export class AdfParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdfParseError";
  }
}

const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];

const child = (value, name) => {
  if (!value || typeof value !== "object") return undefined;
  const key = Object.keys(value).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? value[key] : undefined;
};

const attribute = (value, name) => {
  if (!value || typeof value !== "object") return undefined;
  const key = Object.keys(value).find(
    (candidate) => candidate.toLowerCase() === `@_${name}`.toLowerCase()
  );
  return key ? value[key] : undefined;
};

const text = (value) => {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized || undefined;
  }
  return text(child(value, "#text"));
};

const firstText = (value) => {
  for (const entry of asArray(value)) {
    const normalized = text(entry);
    if (normalized) return normalized;
  }
  return undefined;
};

// Decodes markup only when the entire ADF block was HTML-escaped (raw XML may
// legitimately contain entities such as &amp;, which must stay encoded), then
// returns everything from the first <adf tag onward. Returns null when no <adf
// marker is present at all - i.e. this isn't ADF content.
function findAdfStart(content) {
  if (typeof content !== "string") return null;

  const decoded = /<adf\b/i.test(content)
    ? content
    : content
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, "&");
  const start = decoded.search(/<adf\b/i);
  if (start < 0) return null;

  return decoded.slice(start);
}

function extractAdfBlock(content) {
  const remainder = findAdfStart(content);
  if (remainder == null) return null;

  const end = remainder.search(/<\/adf\s*>/i);
  if (end < 0) {
    throw new AdfParseError("ADF XML is missing its closing </adf> element");
  }

  const closingTag = remainder.match(/<\/adf\s*>/i)[0];
  return remainder.slice(0, end + closingTag.length);
}

/**
 * Best-effort capture of raw ADF text for later inspection/reprocessing, not for
 * parsing. Unlike extractAdfBlock, does NOT require a closing </adf> tag - the goal
 * here is to grab whatever's available even when the payload is too broken to
 * parse, not to produce well-formed XML. Returns null when no <adf marker is found.
 */
export function extractRawAdfText(content) {
  return findAdfStart(content);
}

/**
 * Cleans up the common ways real-world ADF feeds produce technically-invalid XML,
 * mirroring the sanitization the n8n "Sanitizing the xml" node used to perform:
 * unescaped ampersands, unclosed CDATA, unclosed HTML tags leaking into free-text
 * fields, BOM/NUL bytes, and curly quotes/dashes.
 */
function sanitizeAdfXml(xml) {
  let sanitized = xml;

  // Close CDATA blocks that are missing their terminating "]]>"
  sanitized = sanitized.replace(/<!\[CDATA\[[\s\S]*?\]\](?!>)/g, (match) => `${match}>`);

  // CDATA content doesn't need escaping - protect any "&" inside it from the
  // blanket escape below, then restore it afterwards.
  sanitized = sanitized.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (match, inner) =>
    `<![CDATA[${inner.replace(/&/g, "[[AMP]]")}]]>`
  );

  // Escape bare "&" that isn't already part of a valid entity
  sanitized = sanitized.replace(/&(?!(amp|lt|gt|apos|quot|#[0-9]+);)/g, "&amp;");
  sanitized = sanitized.replace(/\[\[AMP\]\]/g, "&");

  // Normalize self-closing HTML tags that sometimes leak into <comments>
  sanitized = sanitized
    .replace(/<br\s*\/?>/gi, "<br/>")
    .replace(/<hr\s*\/?>/gi, "<hr/>")
    .replace(/<img([^>]*?)(?<!\/)>/gi, "<img$1/>");

  // Strip BOM/NUL
  sanitized = sanitized.replace(/^\uFEFF/, "").replace(/\u0000/g, "");

  // Normalize curly quotes/dashes and non-breaking spaces
  sanitized = sanitized
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ");

  return sanitized;
}

function contactName(contact) {
  const names = asArray(child(contact, "name"));
  const namedParts = new Map(
    names.map((entry) => [String(attribute(entry, "part") || "").toLowerCase(), text(entry)])
  );
  const combined = [namedParts.get("first"), namedParts.get("middle"), namedParts.get("last")]
    .filter(Boolean)
    .join(" ");
  return combined || firstText(names);
}

/**
 * Returns null for regular (non-ADF) email. A detected but unparseable ADF payload
 * throws AdfParseError even after sanitization is applied; callers should catch that
 * and fall back to the n8n pipeline rather than dropping the lead.
 */
export function parseAdfLeadEmail(content) {
  const rawXml = extractAdfBlock(content);
  if (!rawXml) return null;

  const xml = sanitizeAdfXml(rawXml);

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new AdfParseError(`Invalid ADF XML: ${validation.err?.msg || "validation failed"}`);
  }

  const parsed = parser.parse(xml);
  const adf = child(parsed, "adf");
  const prospect = asArray(child(adf, "prospect"))[0];
  if (!prospect) throw new AdfParseError("ADF XML does not contain a prospect");

  const customer = child(prospect, "customer");
  const contact = asArray(child(customer, "contact"))[0] || {};
  const vehicle = asArray(child(prospect, "vehicle"))[0] || {};
  const provider = child(prospect, "provider");
  const vendor = child(prospect, "vendor");
  const prospectId = child(prospect, "id");

  const name = contactName(contact);
  const email = firstText(child(contact, "email"));
  const phone = firstText(child(contact, "phone"));
  if (!email && !phone) {
    throw new AdfParseError("ADF prospect does not contain a customer email or phone");
  }

  return {
    xml,
    name,
    email,
    phone,
    source:
      firstText(child(provider, "name")) ||
      firstText(child(vendor, "vendorname")) ||
      attribute(prospectId, "source") ||
      "ADF/XML",
    externalLeadId: text(prospectId),
    requestDate: firstText(child(prospect, "requestdate")),
    comments: firstText(child(customer, "comments")) || firstText(child(prospect, "comments")),
    vehicle: {
      year: firstText(child(vehicle, "year")),
      make: firstText(child(vehicle, "make")),
      model: firstText(child(vehicle, "model")),
      vin: firstText(child(vehicle, "vin")),
      stock: firstText(child(vehicle, "stock")),
      trim: firstText(child(vehicle, "trim")),
      price: firstText(child(vehicle, "price")),
      interest: attribute(vehicle, "interest"),
      condition: attribute(vehicle, "status"),
    },
  };
}
