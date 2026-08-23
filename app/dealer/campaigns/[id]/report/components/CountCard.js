// export default function DashboardCard({iconClass, count, label, link, description}) {
//     return (
//         <div className="w_card d_counts_card">
//             <div className="d_counts_icon">
//                 <i className={iconClass}></i>
//             </div>
//             <div className="d_counts_info">
//                 <h3>{count}</h3>
//                 <p>{label}</p>

//                 {description && (
//                     <small
//                         className="text-muted d-block mt-1"
//                     >
//                         {description}
//                     </small>
//                 )}
//             </div>
//         </div>
//     );
// }

export default function DashboardCard({iconClass, count, label, description, progressValue, progressTotal, showProgress = false}) {
  const percentage =
    showProgress && progressTotal
      ? Math.min((progressValue / progressTotal) * 100, 100)
      : 0;

  return (
    <div className="w_card d_counts_card border">
      <div className="d_counts_icon">
        <i className={iconClass}></i>
      </div>

      <div className="d_counts_info w-100">
        <h3>{count}</h3>
        <p>{label}</p>

        {/* Linear Progress Bar */}
        {showProgress && (
          <div className="mt-2">
            <div className="linear-progress">
              <div
                className="linear-progress-fill"
                style={{ width: `${percentage}%` }}
              />
            </div>
            {/* <small className="text-muted">
              {description}
            </small> */}
          </div>
        )}

        {/* Description */}
        {description && (
          <small className="text-muted d-block mt-1">
            {description}
          </small>
        )}
      </div>
    </div>
  );
}
