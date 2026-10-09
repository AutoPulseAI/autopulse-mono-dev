// The lead statuses as the client's workflow PDFs name them (client, 9 Oct 2026: "status names must be the same as
// in the PDF"). Display only: the stored values stay as they are, so every route, worker and AI rule that reads a
// status keeps working. Omnichannel PDF §1, SOLD PENDING / SOLD - DELIVERED PDFs.
export const STATUS_LABELS = Object.freeze({
  'Lead': 'New Lead',
  'Lead Not Contacted': 'No Contact Made',
  'Contacted - No Next Action': 'Contact Made - No Next Action',
  'Contacted - Specific Follow-up': 'Contact Made - Specific Follow-Up',
  'Appointment Booked': 'Appointment Set',
  'No Show': 'Appointment No Show',
  'Visited': 'Sales Visit',
  'Sold Delivered': 'Sold - Delivered',
  'Closed - Lost': 'Closed Lost',
  'DND': 'Opted Out / Suppressed',
});

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}
