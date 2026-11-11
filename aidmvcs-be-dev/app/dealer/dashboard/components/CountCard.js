"use client";
// A Dashboard number. Its link opens in this tab (client, 11 Nov 2026), with a way back (../../components/backLink.js).
import Link from "next/link";
import { rememberBack } from "../../components/backLink";

export default function DashboardCard({iconClass, count, label, link, description}) {
    const CardContent = (
        <div className="w_card d_counts_card">
            <div className="d_counts_icon">
                <i className={iconClass}></i>
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
        <div className="col col-lg-3 col-md-6 col-6">
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
