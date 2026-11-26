"use client";
// "Possible match" on the customer profile (Betsy, 25 Nov 2026: tethered, not merged - "it's going to show you that
// this appears to be linked. Do you want to link it?"). Lists the customers that share this one's phone or email;
// a manager links them from Customers > Possible duplicates (merge review, undo, who merged). Nothing links by itself.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import { useCan } from "../../../../hooks/PermissionsContext";

export default function PossibleMatch({ customerId, dealerId }) {
  const canReview = useCan("Manage Leads");
  const [matches, setMatches] = useState([]);
  useEffect(() => {
    if (!canReview || !customerId || !dealerId) return;
    let live = true;
    fetch(`/api/customers/duplicates?dealer_id=${dealerId}&customer_id=${customerId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    }).then((r) => (r.ok ? r.json() : { matches: [] })).then((b) => { if (live) setMatches(b.matches || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [canReview, customerId, dealerId]);
  if (!matches.length) return null;
  return (
    <Alert variant="warning" className="small py-2 d-flex flex-wrap align-items-center gap-2" data-testid="possible-match">
      <i className="fa-duotone fa-link" />
      <span>
        <strong>Possible match:</strong>{" "}
        {matches.map((m, i) => (
          <span key={m._id}>
            {i ? ", " : ""}
            <Link href={`/dealer/customers/${m._id}`}>{m.name || "(no name)"}</Link>
            {m.dealership_history ? " (sales / service customer)" : ""}
          </span>
        ))}
        {" "}shares this customer&apos;s phone or email. Not linked until a manager confirms it is the same person
        (check their ID).
      </span>
      <Link href="/dealer/customers/duplicates" className="btn btn-sm btn-outline-custom ms-auto">Review match</Link>
    </Alert>
  );
}
