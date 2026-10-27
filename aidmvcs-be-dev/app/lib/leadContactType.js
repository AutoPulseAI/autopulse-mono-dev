// How a lead came in (Betsy, 27 Oct 2026 meeting: "where it says source it should have internet or phone or showroom
// visit ... type should be internet, phone or walk-in" - a manual lead and an internet lead looked the same). Staff set
// it on a lead they add; a lead from a portal or the website is Internet. A manual lead nobody typed is "Not set".
export const CONTACT_TYPES = { internet: 'Internet', phone: 'Phone-up', walk_in: 'Walk-in' };

// The manual Add Lead form saves the follow-up choice as the source; every other source is a portal or the website.
const MANUAL_SOURCES = new Set(['email', 'sms', 'manual', '']);

export function leadContactType(lead) {
  if (lead?.contact_type && CONTACT_TYPES[lead.contact_type]) return lead.contact_type;
  return MANUAL_SOURCES.has(String(lead?.source ?? '').trim().toLowerCase()) ? null : 'internet';
}

export function contactTypeLabel(lead) {
  const type = leadContactType(lead);
  return type ? CONTACT_TYPES[type] : 'Not set';
}

export function validContactType(value) {
  return Object.prototype.hasOwnProperty.call(CONTACT_TYPES, value) ? value : null;
}
