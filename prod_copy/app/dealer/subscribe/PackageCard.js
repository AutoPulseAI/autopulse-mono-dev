// app/agency/subscribe/PackageCard.jsx
"use client";
import { Button } from 'react-bootstrap';

export default function PackageCard({ pkg, selected, onSelect, billingCycle }) {
  const getBillingTerm = (duration) => {
    return duration <= 31 ? 'month' : 'year';
  };

  const getPricePerMonth = (price, duration) => {
    if (duration <= 31) return price;
    return (price / 12).toFixed(2);
  };

  return (
    <div 
      className={`pricing_tabs_card ${selected ? 'border-primary' : ''}`} 
      onClick={onSelect}
    >
      <h3>{pkg.name}</h3>
      {pkg.description && (
        <p>{pkg.description}</p>
      )}
      <h4>
        <span>${pkg.price}</span>
        <sub>/{getBillingTerm(pkg.duration)}</sub>
      </h4>
      {billingCycle === 'yearly' && (
        <p className="text-muted small">
          ${getPricePerMonth(pkg.price, pkg.duration)} per month
        </p>
      )}
      <Button variant="custom" type="button">
        Get {pkg.name} Plan
      </Button>
      <hr />

      {pkg.features?.length > 0 && (
        <ul>
          {pkg.features.map((feature, index) => (
            <li key={index}>{feature}</li>
          ))}
        </ul>
      )}
    </div>
  );
}