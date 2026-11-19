// One customer added to a campaign from their lead's "..." menu (19 Nov 2026, SOW reference B5: "Add Customer to
// Campaign"). Pure; the routes use it. The same rule as editing a campaign's list (api/campaigns/[id] PUT): a campaign
// can take leads until it starts sending - draft, scheduled, or active with nothing sent yet. The send check (consent,
// hours, opt-outs) still runs on every message when the campaign sends, as for any campaign lead.
export const OPEN_STATUSES = Object.freeze(['draft', 'scheduled', 'active']);

export function campaignOpenForLeads(campaign) {
  if (!campaign || !OPEN_STATUSES.includes(campaign.status)) return false;
  return campaign.status !== 'active' || !(campaign.stats?.sent > 0);
}

/** Why this lead can't be added to this campaign, or null. */
export function cannotAdd(campaign, lead) {
  if (!campaignOpenForLeads(campaign)) return 'This campaign has started sending or is finished; leads can no longer be added';
  if (campaign.message_type === 'sms' && !String(lead?.phone || '').trim()) return 'This is a text campaign and the lead has no phone number';
  if (campaign.message_type === 'email' && !String(lead?.email || '').trim()) return 'This is an email campaign and the lead has no email';
  return null;
}
