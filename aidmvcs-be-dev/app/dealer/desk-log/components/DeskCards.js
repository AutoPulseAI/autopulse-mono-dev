"use client";
// The Desk Log's headline cards: the picked day's number big, month to date small (Betsy's design).
const LOOK = {
  internet: ["fa-solid fa-globe", "#2563eb"],
  phone: ["fa-solid fa-phone-volume", "#7c3aed"],
  walk_in: ["fa-solid fa-person-walking", "#16a34a"],
  appts_set: ["fa-regular fa-calendar-plus", "#ea580c"],
  appts_showed: ["fa-regular fa-calendar-check", "#334155"],
  sold_pending: ["fa-solid fa-file-signature", "#15803d"],
  sold_delivered: ["fa-solid fa-car", "#dc2626"],
  action_required: ["fa-solid fa-triangle-exclamation", "#ca8a04"],
  closed_lost: ["fa-regular fa-circle-xmark", "#374151"],
};

export default function DeskCards({ cards, dayWord = "TODAY" }) {
  return (
    <div className="dl_cards">
      {cards.map((c) => {
        const [icon, color] = LOOK[c.key] || ["fa-solid fa-circle", "#2563eb"];
        return (
          <div key={c.key} className="dl_card" style={{ "--dl-accent": color }}>
            <div className="dl_card_title"><i className={icon} style={{ color }}></i>{c.label}</div>
            <div className="dl_card_nums">
              <div><div className="dl_card_today">{c.today}</div><small>{dayWord}</small></div>
              <div><div className="dl_card_mtd">{c.mtd}</div><small>MTD</small></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
