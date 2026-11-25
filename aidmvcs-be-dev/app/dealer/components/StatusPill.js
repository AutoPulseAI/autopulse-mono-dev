"use client";
// A lead's status as a pill: the colour says the family, the icon says the exact status, the words are the client's
// own (lib/statusLabels.js, unchanged). Blue = new, orange = a conversation, green = moving to a sale (deepest = sold),
// red = a person is needed, grey = finished. Click opens the status list, so a small arrow says so (no pencil).
const LOOK = {
  "lead":                          { cls: "sp_new",    icon: "fa-user-plus",           strip: "#0272b4" },
  "lead not contacted":            { cls: "sp_nocon",  icon: "fa-comment-slash",       strip: "#0272b4" },
  "contacted":                     { cls: "sp_reply",  icon: "fa-comments",            strip: "#f7931e" },
  "contacted - no next action":    { cls: "sp_reply",  icon: "fa-comments",            strip: "#f7931e" },
  "contacted - specific follow-up": { cls: "sp_reply", icon: "fa-comments",            strip: "#f7931e" },
  "appointment booked":            { cls: "sp_appt",   icon: "fa-calendar-check",      strip: "#2fb344" },
  "visited":                       { cls: "sp_show",   icon: "fa-person-walking",      strip: "#2fb344" },
  "no show":                       { cls: "sp_noshow", icon: "fa-calendar-xmark",      strip: "#b4383c" },
  "managerial review":             { cls: "sp_action", icon: "fa-triangle-exclamation", strip: "#b4383c" },
  "sold pending":                  { cls: "sp_sp",     icon: "fa-file-signature",      strip: "#2fb344" },
  "sold":                          { cls: "sp_sd",     icon: "fa-handshake",           strip: "#12602a" },
  "sold delivered":                { cls: "sp_sd",     icon: "fa-handshake",           strip: "#12602a" },
  "unsold":                        { cls: "sp_closed", icon: "fa-rotate-left",         strip: "#6c757d" },
  "closed - lost":                 { cls: "sp_closed", icon: "fa-circle-xmark",        strip: "#6c757d" },
  "closed - no longer owns":       { cls: "sp_closed", icon: "fa-circle-xmark",        strip: "#6c757d" },
  "dnd":                           { cls: "sp_closed", icon: "fa-ban",                 strip: "#6c757d" },
  "opted out":                     { cls: "sp_closed", icon: "fa-ban",                 strip: "#6c757d" },
};
const OTHER = { cls: "sp_closed", icon: "fa-circle-half-stroke", strip: "#6c757d" };

// label: what the lead shows ("Appointment Showed" is display only, lib/statusLabels.js leadStatusLabel).
export function statusLook(status, label) {
  if (label === "Appointment Showed") return LOOK.visited;
  return LOOK[String(status || "").trim().toLowerCase()] || OTHER;
}

export default function StatusPill({ status, label, onClick, title = "Change status" }) {
  const look = statusLook(status, label);
  return (
    <button type="button" className={`sp ${look.cls}`} onClick={onClick} title={title}>
      <i className={`fa-regular ${look.icon}`} aria-hidden="true" /><span>{label}</span>
      {onClick && <i className="fa-regular fa-chevron-down sp_car" aria-hidden="true" />}
    </button>
  );
}
