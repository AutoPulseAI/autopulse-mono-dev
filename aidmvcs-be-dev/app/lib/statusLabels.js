// The lead statuses as the client's workflow PDFs name them (client, 9 Oct 2026: "status names must be the same as
// in the PDF"). Display only: the stored values stay as they are, so every route, worker and AI rule that reads a
// status keeps working. Omnichannel PDF §1, SOLD PENDING / SOLD - DELIVERED PDFs.
export const STATUS_LABELS = Object.freeze({
  'Lead': 'New Lead',
  'Lead Not Contacted': 'No Contact Made',
  'Contacted - No Next Action': 'Contact Made - No Next Action',
  // Client, 12 Oct 2026 (Betsy): "Contact Made - Follow Up Assigned" when the customer asked for follow-up on
  // another day; and "Opt-Out" - the legal TCPA process, different from Closed Lost.
  'Contacted - Specific Follow-up': 'Contact Made - Follow Up Assigned',
  'Appointment Booked': 'Appointment Set',
  'No Show': 'Appointment No Show',
  'Visited': 'Sales Visit',
  'Sold Delivered': 'Sold - Delivered',
  'Closed - Lost': 'Closed Lost',
  'DND': 'Opt-Out',
  // Client, 12 Oct 2026 (Betsy): "change Manager Review to Dealership Action Required". A plain "Contacted" isn't
  // a workflow status (it's no longer offered when setting a status); as a Leads filter it means the customer
  // actually talked to us (app/lib/contactedLeads.js).
  'Managerial Review': 'Dealership Action Required',
  'Contacted': 'Customer Replied',
});

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}
