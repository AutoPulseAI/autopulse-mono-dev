import moment from "moment-timezone";

// Dashboard date ranges (DashboardDatePicker.js). Pure, so they can be checked without a browser.
// [start, end] as dealer-timezone moments (start of day), or null for all time.
export function presetRange(key, tz, n = 30) {
  const today = moment.tz(tz).startOf("day");
  const days = Math.max(1, parseInt(n, 10) || 1);
  switch (key) {
    case "today": return [today, today];
    case "yesterday": return [today.clone().subtract(1, "day"), today.clone().subtract(1, "day")];
    case "this_week": return [today.clone().startOf("week"), today];
    case "last_7": return [today.clone().subtract(6, "days"), today];
    case "last_week": {
      const start = today.clone().startOf("week").subtract(1, "week");
      return [start, start.clone().add(6, "days")];
    }
    case "last_14": return [today.clone().subtract(13, "days"), today];
    case "this_month": return [today.clone().startOf("month"), today];
    case "last_30": return [today.clone().subtract(29, "days"), today];
    case "last_month": {
      const start = today.clone().subtract(1, "month").startOf("month");
      return [start, start.clone().endOf("month").startOf("day")];
    }
    case "days_to_today": return [today.clone().subtract(days - 1, "days"), today];
    case "days_to_yesterday": {
      const end = today.clone().subtract(1, "day");
      return [end.clone().subtract(days - 1, "days"), end];
    }
    case "all_time": return null;
    default: return [today, today];
  }
}

// The period just before [start, end], the same number of days.
export function previousPeriod(startUtc, endUtc, tz) {
  if (!startUtc || !endUtc) return null;
  const start = moment.utc(startUtc).tz(tz).startOf("day");
  const end = moment.utc(endUtc).tz(tz).startOf("day");
  const days = end.diff(start, "days") + 1;
  const prevEnd = start.clone().subtract(1, "day");
  const prevStart = prevEnd.clone().subtract(days - 1, "days");
  return { startDate: prevStart.startOf("day").utc().toDate(), endDate: prevEnd.endOf("day").utc().toDate() };
}

