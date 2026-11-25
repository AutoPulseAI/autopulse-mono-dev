"use client";
// A Dashboard number. Its link opens in this tab (client, 11 Nov 2026), with a way back (../../components/backLink.js).
// Laid out like the Desk Log's headline cards: the icon sits beside the heading it belongs to, then the number.
import Link from "next/link";
import { rememberBack } from "../../components/backLink";
import { iconClass as sharedIcon } from "../../components/AppIcon";

// meaning: which colour the card has always had - lead blue, date slate, reply orange, sent indigo, action red, appt green.
// soft: the card breaks another one down (a lighter orange under Customer Replied).
const TONES = { lead: "#0272b4", date: "#5f7890", reply: "#f7931e", sent: "#4f46e5", action: "#e5383b", appt: "#2fb344" };
export default function DashboardCard({ icon, iconClass, count, label, link, description, meaning = "date", soft = false,
  colClass = "col col-lg-3 col-md-6 col-6" }) {
  const card = (
    <div className={`w_card d_counts_card dash_card${soft ? " soft" : ""}`}
      style={{ "--card": soft && meaning === "reply" ? "#ffb45c" : TONES[meaning] || TONES.date }}>
      <p className="dash_card_title"><i className={icon ? sharedIcon(icon) : iconClass} aria-hidden="true"></i><span>{label}</span></p>
      <h3 className="dash_card_count">{count}</h3>
      {description && <small className="dash_card_text">{description}</small>}
    </div>
  );
  return (
    <div className={colClass}>
      {link ? <Link href={link} className="d-block" onClick={() => rememberBack(link)}>{card}</Link> : card}
    </div>
  );
}
