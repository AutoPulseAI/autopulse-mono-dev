// Every time the Debug UI shows is in Pakistan time, where the testing team
// works. Display only: the service's rules run in each dealer's own timezone
// (architecture §15, decision 9), shown separately where it matters.

export const DISPLAY_TZ = "Asia/Karachi";
export const DISPLAY_TZ_LABEL = "PKT";

type Stamp = string | number | Date;

const toDate = (value: Stamp) => (value instanceof Date ? value : new Date(value));

export function formatDateTime(value: Stamp, withSeconds = false): string {
  return `${toDate(value).toLocaleString(undefined, {
    timeZone: DISPLAY_TZ,
    dateStyle: "medium",
    timeStyle: withSeconds ? "medium" : "short",
  })} ${DISPLAY_TZ_LABEL}`;
}

export function formatDate(value: Stamp): string {
  return toDate(value).toLocaleDateString(undefined, { timeZone: DISPLAY_TZ, dateStyle: "medium" });
}

export function formatTime(value: Stamp): string {
  return `${toDate(value).toLocaleTimeString(undefined, { timeZone: DISPLAY_TZ, timeStyle: "short" })} ${DISPLAY_TZ_LABEL}`;
}

// A dealer's own local time, for anything that follows business hours or the
// SMS contact window.
export function formatInZone(value: Stamp, timeZone: string): string {
  return toDate(value).toLocaleString(undefined, {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
