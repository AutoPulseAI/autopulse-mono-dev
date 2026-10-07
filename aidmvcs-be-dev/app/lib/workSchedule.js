// Staff work schedules (client, 7 Oct 2026: "each user should also have a schedule, so we don't assign them any
// task on their off day"). Stored on the staff User as `work_schedule`, in the dealer hours' format
// ({ monday: { active, start: "9:00 AM", end: "6:00 PM" }, ... }); null / unset = works the dealership's opening
// hours. The AI service reads it before giving out a call task (agentic-upsell agent/staff_schedule.py).

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const CLOCK = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/;

function minutesOf(clock) {
  const [, h, m, ap] = CLOCK.exec(clock);
  return ((Number(h) % 12) + (ap === "PM" ? 12 : 0)) * 60 + Number(m);
}

// { value, error }: the schedule to save (null = follow the dealership's hours), or why it can't be saved.
export function parseWorkSchedule(input) {
  if (input === null) return { value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "work_schedule must be null or an object of weekdays" };
  }
  const value = {};
  for (const day of WEEKDAYS) {
    const d = input[day] || {};
    if (!d.active) {
      value[day] = { active: false, start: "", end: "" };
      continue;
    }
    const start = String(d.start || "").trim();
    const end = String(d.end || "").trim();
    if (!CLOCK.test(start) || !CLOCK.test(end)) return { error: `${day}: times must look like 9:00 AM` };
    if (minutesOf(end) <= minutesOf(start)) return { error: `${day}: the shift must end after it starts` };
    value[day] = { active: true, start, end };
  }
  if (!WEEKDAYS.some((day) => value[day].active)) return { error: "Pick at least one working day" };
  return { value };
}

// The time pickers use "09:00"; the record uses "9:00 AM".
export function toPicker(clock) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(clock || "").trim());
  if (!m) return "";
  const hour = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

export function fromPicker(value) {
  const [h, m] = String(value || "").split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
