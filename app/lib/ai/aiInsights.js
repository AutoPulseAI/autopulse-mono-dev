// Pure helpers for the AI Insights page (app/dealer/ai/insights) and the AI panel on a lead
// (agentic-upsell PLAN_4 stream L). No imports: the CRM's node tests load this file directly.

export const INSIGHTS_PERIODS = [7, 30, 90, 180, 365];
export const DEFAULT_INSIGHTS_DAYS = 30;

// The report period asked for, or the default when it isn't one of the offered ones.
export function insightsDays(value) {
  const n = Number(value);
  return INSIGHTS_PERIODS.includes(n) ? n : DEFAULT_INSIGHTS_DAYS;
}

// 0.3456 -> "35%", null (nothing settled yet) -> "—".
export function percent(rate) {
  if (rate === null || rate === undefined || Number.isNaN(Number(rate))) return "—";
  return `${Math.round(Number(rate) * 100)}%`;
}

// A row's rate against the overall one: "better" / "worse" (5 points or more apart) or "" (close, or too few).
export const MIN_ROW_SAMPLE = 10;
export function rateTone(rate, overall, sample) {
  if (rate === null || rate === undefined || overall === null || overall === undefined) return "";
  if ((sample ?? 0) < MIN_ROW_SAMPLE) return "";
  if (rate - overall >= 0.05) return "better";
  if (overall - rate >= 0.05) return "worse";
  return "";
}

const VEHICLE_TYPES = { new: "New", used: "Used" };

// "Used (came in as New)" / "New" / null, from the lead profile's vehicle_type record (or lead fields).
export function vehicleTypeText(info) {
  if (!info) return null;
  const current = VEHICLE_TYPES[info.vehicle_type] || info.vehicle_type;
  if (!current) return null;
  const original = VEHICLE_TYPES[info.original_vehicle_type] || info.original_vehicle_type;
  return original && original !== current ? `${current} (came in as ${original})` : current;
}
