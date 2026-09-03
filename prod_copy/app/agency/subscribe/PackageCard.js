// app/agency/subscribe/PackageCard.jsx
"use client";
import { Button } from 'react-bootstrap';

export default function PackageCard({ pkg, selected, onSelect, currentPackageId }) {
  const isCurrentPlan = pkg._id === currentPackageId;

  const getPriceDisplay = () => {
    if (pkg.pricing_model === "per_dealer") {
      return (
        <>
          <span>${pkg.base_fee} base</span>
          <br />
          <small>+ ${pkg.price_per_dealer} per dealer</small>
        </>
      );
    }
    return <span>${pkg.price}</span>;
  };

  return (
    <div
      className={`pricing_tabs_card ${selected ? 'border-primary' : ''} ${isCurrentPlan ? 'current-plan' : ''}`}
      onClick={onSelect}
    >
      {isCurrentPlan && (
        <div className="current-plan-badge">Current Plan</div>
      )}

      <h3>{pkg.name}</h3>
      {pkg.description && (
        <p>{pkg.description}</p>
      )}

      <h4>
        {getPriceDisplay()}
        <sub>/{pkg.billing_interval === "month" ? 'month' : 'year'}</sub>
      </h4>

      <Button variant="custom" type="button" disabled={isCurrentPlan}>
        {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
      </Button>

      <hr />

      {pkg.features?.length > 0 && (
        <ul>
          {pkg.features.map((feature, index) => (
            <li key={index}>{feature}</li>
          ))}
        </ul>
      )}

      {pkg.max_dealers > 0 && (
        <div className="text-center text-muted">
          <hr />
          <small>Includes up to <strong>{pkg.max_dealers}</strong> dealer accounts</small>
        </div>
      )}

      <style jsx>{`
        .pricing_tabs_card {
          position: relative;
        }
        .current-plan {
          border: 2px solid #4BB543;
        }
        .current-plan-badge {
          position: absolute;
          top: 10px;
          right: 10px;
          background: #4BB543;
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}