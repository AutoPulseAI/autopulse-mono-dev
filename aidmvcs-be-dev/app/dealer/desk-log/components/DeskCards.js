"use client";
// The Desk Log's headline cards: the picked day's number big, month to date small (Betsy's design). Each number opens
// its leads on the Leads page in this tab (with Export CSV there), with a way back to the Desk Log.
import { rememberBack } from "../../components/backLink";

function Num({ link, className, children }) {
  if (!link) return <div className={className}>{children}</div>;
  return (
    <a href={link} className={`${className} dl_card_link`} title="Open these leads"
      onClick={() => rememberBack(link, "/dealer/desk-log", "Desk Log")}>{children}</a>
  );
}
const ICON = {
  internet: "fa-solid fa-globe", phone: "fa-solid fa-phone-volume", walk_in: "fa-solid fa-person-walking",
  appts_set: "fa-regular fa-calendar-plus", appts_showed: "fa-regular fa-calendar-check",
  sold_pending: "fa-solid fa-file-signature", sold_delivered: "fa-solid fa-car",
  action_required: "fa-solid fa-triangle-exclamation", closed_lost: "fa-regular fa-circle-xmark",
};

export default function DeskCards({ cards, dayWord = "TODAY" }) {
  return (
    <div className="dl_cards">
      {cards.map((c) => {
        const icon = ICON[c.key] || "fa-solid fa-circle";
        return (
          <div key={c.key} className="dl_card">
            <div className="dl_card_title"><i className={icon}></i>{c.label}</div>
            <div className="dl_card_nums">
              <div><Num link={c.today_link} className="dl_card_today">{c.today}</Num><small>{dayWord}</small></div>
              <div><Num link={c.mtd_link} className="dl_card_mtd">{c.mtd}</Num><small>MTD</small></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
