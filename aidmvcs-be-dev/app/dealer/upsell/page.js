'use client';

import { useState } from 'react';
import { Container, Alert } from 'react-bootstrap';
import { useUser } from "../context/UserContext";

/**
 * Placeholder page for the agentic upsell review screen.
 *
 * Intentionally not linked from Sidebar.js yet — add that link once this page
 * has real content, so it doesn't appear as a dead/empty nav item in
 * production before the feature exists. See ../../../agentic-upsell/README.md
 * and INTEGRATION.md for what this is building toward: a screen where staff
 * review AI-generated upsell recommendations (grounded, with their reasoning
 * and source data visible) before they're approved and sent to a customer.
 *
 * TODO:
 *   - fetch recommendations via POST /api/upsell/recommend for a selected
 *     customer/lead (dealerParent.id from useUser(), matching the pattern in
 *     ../report-schedule/page.js)
 *   - render each GroundedUpsellItem with its reasoning and grounding_tool_calls
 *     visible (this is the whole point — staff should be able to see WHY,
 *     not just WHAT, before approving)
 *   - approve/edit/reject actions posting to POST /api/upsell/feedback
 */
export default function UpsellPage() {
  const { dealerParent } = useUser();
  const [notice] = useState(
    'Agentic upsell review — not yet implemented. See agentic-upsell/README.md.'
  );

  return (
    <Container className="py-4">
      <h4>Upsell Recommendations</h4>
      <Alert variant="info">{notice}</Alert>
    </Container>
  );
}
