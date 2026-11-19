"use client";
// Lead source maintenance (19 Nov 2026, SOW reference B9; gap G-009): the dealership's own list of lead sources, the
// same window as Leads > Add lead > Lead Source > "Edit list" (LeadSourcePicker), on its own page.
import LeadSourcePicker from "../leads/components/LeadSourcePicker";
import { useUser } from "../context/UserContext";

export default function LeadSourcesPage() {
  const { dealerParent, user } = useUser();
  const dealerId = dealerParent?.id || user?.id;
  return (
    <div className="page_content">
      <h2 className="fs-4 mb-3">Lead source maintenance</h2>
      <div className="w_card">
        <p className="small text-muted">
          The sources staff pick on a lead they enter by hand. Renaming one renames it on the dealership&apos;s leads too, so
          reports don&apos;t split it; removing one only stops it being offered. Internet leads keep the source their
          provider sends.
        </p>
        {dealerId && <LeadSourcePicker dealerId={dealerId} editOnly />}
      </div>
    </div>
  );
}
