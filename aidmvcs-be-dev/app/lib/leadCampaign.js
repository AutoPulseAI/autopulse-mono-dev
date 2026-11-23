// Which of the dealer's campaigns a lead came from (13 Nov 2026 meeting 4.4; SOW B campaign taxonomy). The admin keeps
// campaigns with a tracking code per dealer (app/models/LeadSourceList.js `campaigns`, Admin screen: Leads > Lead
// Source > Edit list > Campaigns). A lead belongs to an active campaign when its sub-source or its lead source is
// exactly the campaign's code (any case, spaces ignored at the ends). Nothing else is guessed: no code, no campaign.
import LeadSourceList from '../models/LeadSourceList.js';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// The campaign name for a lead, or null. `campaigns` can be passed (tests, bulk) to skip the lookup.
export function matchCampaign(campaigns, lead) {
  const values = new Set([lead?.sub_source, lead?.lead_source].map(norm).filter(Boolean));
  if (!values.size) return null;
  const hit = (campaigns || []).find((c) => c?.active !== false && norm(c.code) && values.has(norm(c.code)));
  return hit ? hit.name : null;
}

export async function campaignForLead(dealerId, lead) {
  const doc = await LeadSourceList.findOne({ dealer_id: String(dealerId) }, { campaigns: 1 }).lean();
  return matchCampaign(doc?.campaigns, lead);
}
