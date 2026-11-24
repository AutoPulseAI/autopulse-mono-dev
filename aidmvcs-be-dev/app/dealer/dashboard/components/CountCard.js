"use client";
// A Dashboard number. Its link opens in this tab (client, 11 Nov 2026), with a way back (../../components/backLink.js).
// Laid out like the Desk Log's headline cards: the icon sits beside the heading it belongs to, then the number.
import Link from "next/link";
import { rememberBack } from "../../components/backLink";
import { iconClass as sharedIcon } from "../../components/AppIcon";
import { MEANING } from "../../components/meaningColors";

// meaning: a key of MEANING (meaningColors.js) - the card's edge, icon and number. soft: the card breaks another down.
export default function DashboardCard({ icon, iconClass, count, label, link, description, meaning = "neutral", soft = false,
  colClass = "col col-lg-3 col-md-6 col-6" }) {
  const card = (
    <div className={`w_card d_counts_card dash_card${soft ? " soft" : ""}${meaning === "neutral" ? " neutral" : ""}`}
      style={{ "--card": MEANING[meaning] || MEANING.neutral }}>
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
