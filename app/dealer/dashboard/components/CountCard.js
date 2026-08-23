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
                <a
                    href={link}
                    className="d-block"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {CardContent}
                </a>
            ) : (
                CardContent
            )}
        </div>
    );
}
