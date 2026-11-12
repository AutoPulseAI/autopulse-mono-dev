// Desk Log rules (SOW v6 Deliverable C and 9C Deliverable J; Dealer Intelligence "Desklog Sales Process - APPRAISAL").
// Pure functions: the routes in app/api/desk-log use them, and test-desk-log.js tests them without a database.
import mongoose from 'mongoose';

import { DEPARTMENTS, OUTCOMES, STAGES, STALLED_MINUTES, UNSOLD_REASONS } from './constants.js';

export { DEPARTMENTS, OUTCOMES, STAGES, STALLED_MINUTES, UNSOLD_REASONS };

const REASON_VALUES = Object.values(UNSOLD_REASONS);
const PEOPLE = Object.freeze(['salesperson_id', 'sales_manager_id', 'bdc_agent_id']);
const VEHICLE_FIELDS = Object.freeze(['year', 'make', 'model', 'trim', 'vin']);

/**
 * The lead status change an outcome makes, through the existing status route (so its follow-ups, booking updates and
 * AI notice run as they do from the Leads page). SOLD / UNSOLD are a visit's manager outcome (status "Visited").
 * UNSOLD with DND is the existing "DND" status (shown as "Opt-Out"): the SOW says DND blocks outbound solicitation
 * at once, so it must not start the unsold follow-ups.
 */
export function leadStatusForOutcome(outcome, unsoldReason) {
  if (outcome === 'SOLD PENDING') return { status: 'Visited', manager_outcome: 'Sold Pending' };
  if (outcome === 'SOLD DELIVERED') return { status: 'Visited', manager_outcome: 'Sold Delivered' };
  if (outcome === 'UNSOLD' && unsoldReason === UNSOLD_REASONS.DND) return { status: 'DND' };
  if (outcome === 'UNSOLD') return { status: 'Visited', manager_outcome: 'Unsold' };
  return null;
}

const blank = (v) => v === undefined;
const clean = (v) => (v == null ? null : String(v).trim() || null);

function idOrNull(value) {
  if (value == null || value === '') return { ok: true, value: null };
  return mongoose.isValidObjectId(String(value))
    ? { ok: true, value: new mongoose.Types.ObjectId(String(value)) } : { ok: false };
}

function vehicleFrom(input) {
  if (!input || typeof input !== 'object') return { error: 'must be an object' };
  const out = {};
  for (const k of VEHICLE_FIELDS) {
    if (blank(input[k])) continue;
    if (k === 'year') {
      if (input.year === null || input.year === '') { out.year = null; continue; }
      const y = Number(input.year);
      if (!Number.isInteger(y) || y < 1900 || y > 2100) return { error: 'year must be a whole year' };
      out.year = y;
    } else {
      out[k] = clean(input[k]);
      if (out[k] && out[k].length > 80) return { error: `${k} is too long` };
    }
  }
  return { value: out };
}

const same = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * What a Desk Log edit changes. `entry` is the saved entry (or {} for a new one), `body` what the screen sent.
 * Returns { errors } or { set, history, note, outcomeChanged } - history lines are { field, from, to } (the route
 * adds who and when). An unchanged field adds nothing.
 */
export function planChanges(entry, body, { now = new Date() } = {}) {
  const errors = [];
  const set = {};
  const history = [];
  const change = (field, value) => {
    if (same(entry[field], value)) return;
    set[field] = value;
    history.push({ field, from: entry[field] ?? null, to: value ?? null });
  };

  if (!blank(body.stage)) {
    const stage = clean(body.stage);
    if (stage && !STAGES.includes(stage)) errors.push(`stage must be one of ${STAGES.join(', ')}`);
    else if (!same(entry.stage, stage)) {
      change('stage', stage);
      set.stage_at = stage ? now : null;
    }
  }

  for (const field of PEOPLE) {
    if (blank(body[field])) continue;
    const id = idOrNull(body[field]);
    if (!id.ok) errors.push(`${field} is not a staff id`);
    else change(field, id.value);
  }

  if (!blank(body.stock_number)) {
    const stock = clean(body.stock_number);
    if (stock && stock.length > 40) errors.push('stock_number is too long');
    else change('stock_number', stock);
  }

  if (!blank(body.department)) {
    if (!DEPARTMENTS.includes(body.department)) errors.push(`department must be ${DEPARTMENTS.join(' or ')}`);
    else change('department', body.department);
  }

  for (const field of ['vehicle', 'trade']) {
    if (blank(body[field])) continue;
    const v = vehicleFrom(body[field]);
    if (v.error) { errors.push(`${field}: ${v.error}`); continue; }
    for (const [k, value] of Object.entries(v.value)) {
      const before = entry[field]?.[k] ?? null;
      if (same(before, value)) continue;
      set[`${field}.${k}`] = value;
      history.push({ field: `${field}.${k}`, from: before, to: value });
    }
  }

  let nextStep = entry.next_step_at ?? null;
  if (!blank(body.next_step_at)) {
    if (body.next_step_at === null || body.next_step_at === '') nextStep = null;
    else {
      const d = new Date(body.next_step_at);
      if (Number.isNaN(d.getTime())) errors.push('next_step_at is not a date');
      else nextStep = d;
    }
    if (!errors.length && (nextStep?.getTime?.() ?? null) !== (entry.next_step_at ? new Date(entry.next_step_at)
      .getTime() : null)) {
      set.next_step_at = nextStep;
      history.push({ field: 'next_step_at', from: entry.next_step_at ?? null, to: nextStep });
    }
  }

  let outcomeChanged = false;
  if (!blank(body.outcome) || !blank(body.unsold_reason)) {
    const outcome = blank(body.outcome) ? entry.outcome ?? null : clean(body.outcome);
    let reason = blank(body.unsold_reason) ? entry.unsold_reason ?? null : clean(body.unsold_reason);
    if (outcome !== 'UNSOLD') reason = null;
    if (outcome && !OUTCOMES.includes(outcome)) errors.push(`outcome must be one of ${OUTCOMES.join(', ')}`);
    else if (outcome === 'UNSOLD' && !reason) errors.push('Pick the unsold reason');
    else if (reason && !REASON_VALUES.includes(reason)) errors.push(`unsold_reason must be one of ${REASON_VALUES
      .join(', ')}`);
    else if (!outcome && entry.outcome) errors.push('An outcome can be changed, not removed');
    else if (!same(entry.outcome, outcome) || !same(entry.unsold_reason, reason)) {
      change('outcome', outcome);
      change('unsold_reason', reason);
      set.outcome_at = now;
      outcomeChanged = true;
    }
  }

  // Future Follow-Up always has its date: when it is picked, and later too (the date can be moved, not removed).
  const reasonAfter = 'unsold_reason' in set ? set.unsold_reason : entry.unsold_reason;
  if (!errors.length && reasonAfter === UNSOLD_REASONS.FUTURE_FOLLOW_UP && !nextStep) {
    errors.push('Future Follow-Up needs the follow-up date and time');
  }

  let note = null;
  if (!blank(body.note) && clean(body.note)) {
    note = clean(body.note);
    if (note.length > 2000) errors.push('note is too long (2000 characters)');
  }

  return errors.length ? { errors } : { set, history, note, outcomeChanged };
}

/** Minutes since the entry's current stage started (or its check-in), for "stalled" on the manager view. */
export function minutesInStage(entry, now = new Date()) {
  const since = entry?.stage_at || entry?.checked_in_at;
  return since ? Math.max(0, Math.round((now.getTime() - new Date(since).getTime()) / 60000)) : null;
}

// A visit still being worked: no outcome yet.
export const isOpen = (entry) => !entry?.outcome;
