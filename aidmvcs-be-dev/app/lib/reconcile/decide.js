// The reconciliation decision for one incoming field value (SOW Appendix B 7: every attempted reconciliation resolves
// to ACCEPT / RETAIN / APPEND / REVIEW / REJECT, with a reason). Pure: no database. 23 Nov 2026.
// Returns null when there is nothing to record (a blank incoming value, or the same value already current).
import { SOURCE_NAMES, rank } from './policy.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'no date');
const blank = (v) => v == null || (typeof v === 'string' && !v.trim());

/**
 * Undated profile data (name): the incoming source may replace the value on file only when it ranks the same or
 * higher than the source of that value.
 * @param {object} policyField  policy.name
 * @param {{value, source}|null} existing
 * @param {{value, source}} incoming
 * @param {{disputed?: Set<string>}} marks  values the customer disputed (lower case)
 */
export function decideUndated(policyField, existing, incoming, marks = {}) {
  if (blank(incoming?.value)) return null;
  const v = String(incoming.value).trim();
  if (marks.disputed?.has(v.toLowerCase())) return { decision: 'RETAIN', reason: 'the customer disputed this value' };
  if (!existing || blank(existing.value)) return { decision: 'ACCEPT', reason: 'nothing on file' };
  if (String(existing.value).trim().toLowerCase() === v.toLowerCase()) return null;
  return rank(policyField, incoming.source) <= rank(policyField, existing.source)
    ? { decision: 'ACCEPT', reason: `${SOURCE_NAMES[incoming.source]} ranks the same or above ${SOURCE_NAMES[existing.source] || 'the value on file'}` }
    : { decision: 'RETAIN', reason: `${SOURCE_NAMES[existing.source] || 'The value on file'} ranks above ${SOURCE_NAMES[incoming.source]}` };
}

/**
 * A phone or email the DMS sends for a customer already on file (undated; Appendix B 2B: may populate missing data,
 * must not overwrite). `onFile` = the profile's values of that kind; `removed` = values staff removed.
 */
export function decideDmsContact(policyField, kind, value, { onFile = [], removed = new Set(), disputed = new Set() } = {}) {
  if (blank(value)) return null;
  const key = String(value).toLowerCase();
  if (onFile.includes(key)) return null;
  if (removed.has(key)) return { decision: 'RETAIN', reason: `staff removed this ${kind} from the profile` };
  if (disputed.has(key)) return { decision: 'RETAIN', reason: `the customer disputed this ${kind}` };
  if (policyField.dms_contacts === 'fill_missing' && !onFile.length) {
    return { decision: 'ACCEPT', reason: `the profile had no ${kind}` };
  }
  return { decision: 'APPEND', reason: `kept as history: a DMS ${kind} doesn't change the profile's contacts (source precedence)` };
}

/** A mileage value as a whole number, or null. */
export function parseMiles(value) {
  if (value == null) return null;
  const s = String(value).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}

/**
 * An event-dated mileage reading (Appendix B 2A / 4): the newest valid reading by its event date (RO / sale date)
 * is current; an older one arriving later is history; an impossible change is reviewed, not applied.
 * @param {object} policyField  policy.mileage
 * @param {{miles: number|null, at: Date|null, raw?: any}} incoming
 * @param {{miles: number, at: Date}|null} current  the current (latest accepted) reading
 * @param {{disputed?: Set<number>}} marks
 */
export function decideMileage(policyField, incoming, current, marks = {}) {
  const { miles, at } = incoming;
  if (incoming.raw == null || String(incoming.raw).trim() === '') return null;
  if (miles == null || miles <= 0 || miles > 2000000) return { decision: 'REJECT', reason: `"${incoming.raw}" is not a mileage` };
  if (!at) return { decision: 'REVIEW', reason: 'the reading has no event date' };
  if (marks.disputed?.has(miles)) return { decision: 'RETAIN', reason: 'the customer disputed this mileage' };
  if (!current) return { decision: 'ACCEPT', reason: 'first reading on file' };
  const t = new Date(at).getTime();
  const ct = new Date(current.at).getTime();
  if (t === ct && miles === current.miles) return null;
  if (t < ct) {
    return miles > current.miles
      ? { decision: 'REVIEW', reason: `an older reading (${day(at)}) shows more miles (${fmt(miles)}) than the current ${fmt(current.miles)} of ${day(current.at)}` }
      : { decision: 'APPEND', reason: `older than the current reading of ${day(current.at)}: kept as history` };
  }
  const drop = current.miles - miles;
  if (drop > policyField.review_drop_miles) {
    return { decision: 'REVIEW', reason: `${fmt(drop)} miles lower than the reading of ${day(current.at)} (${fmt(current.miles)})` };
  }
  if (drop > 0) return { decision: 'RETAIN', reason: `${fmt(drop)} miles below the reading of ${day(current.at)}: kept the higher reading` };
  const years = Math.max((t - ct) / (365.25 * 86400000), 1 / 12);
  if ((miles - current.miles) / years > policyField.review_jump_miles_per_year) {
    return { decision: 'REVIEW', reason: `${fmt(miles - current.miles)} miles more than ${day(current.at)} - more than ${fmt(policyField.review_jump_miles_per_year)} a year` };
  }
  return { decision: 'ACCEPT', reason: `newest reading (${day(at)})` };
}
