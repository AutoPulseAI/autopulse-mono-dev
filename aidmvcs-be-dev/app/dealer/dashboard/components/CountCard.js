"use client";
// A Dashboard number. Its link opens in this tab (client, 11 Nov 2026), with a way back (../../components/backLink.js).
import Link from "next/link";
import { rememberBack } from "../../components/backLink";
import { iconClass as sharedIcon, iconColor } from "../../components/AppIcon";

// tone (13 Nov 2026 meeting, Betsy): orange = Customer Replied, light_orange = its breakdown, red = Dealer Action
// Required, green = the appointment row. colClass: the card's column width (default four to a row on large screens).
export default function DashboardCard({icon, iconClass, count, label, link, description, tone, colClass = "col col-lg-3 col-md-6 col-6"}) {
    const CardContent = (
        <div className={`w_card d_counts_card${tone ? ` tone_${tone}` : ""}`}>
            {/* icon: from the shared list (AppIcon.js). A toned row keeps its tone's colour. */}
            <div className="d_counts_icon" style={icon && !tone ? { backgroundColor: iconColor(icon) } : undefined}>
                <i className={icon ? sharedIcon(icon) : iconClass}></i>
            </div>
            <div className="d_counts_info">
                <h3>{count}</h3>
                <p>{label}</p>

                {description && (
                    <small
                        className="text-muted d-block mt-1"
                    >
                        {description}
                    </small>
                )}
            </div>
        </div>
    );

    return (
        <div className={colClass}>
            {link ? (
                <Link href={link} className="d-block" onClick={() => rememberBack(link)}>
                    {CardContent}
                </Link>
            ) : (
                CardContent
            )}
        </div>
    );
}
