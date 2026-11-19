// The lead's "..." menu (19 Nov 2026, SOW reference B5 - DealerSocket's opportunity menu), read when the menu opens:
//   GET /api/leads/[id]/opportunity
//   audit      every logged change on this lead, newest first (ActivityLog: status, owner, details, Desk Log, AI on /
//              off...), worded as the customer's timeline words them (360/activity.js staffEntry)
//   checklist  the Sold Pending delivery checklist of the lead's latest Desk Log visit that has one (lib/deskLog/rules),
//              ticked on the Desk Log's own route (PATCH /api/desk-log/[id] checklist_item)
//   campaigns  the dealership's campaigns this lead can still be added to (nothing sent yet) and whether it is in each
// The lead's dealership, its agency or a super admin only. Read-only.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import ActivityLog from '@models/ActivityLog';
import DeskLogEntry from '@models/DeskLogEntry';
import Campaign from '@models/Campaign';
import CampaignLead from '@models/CampaignLead';
import { requireDealerAccess } from '@lib/apiGuard';
import { deskLogAccess } from '@lib/deskLog/access';
import { staffEntry } from '../../../customers/[id]/360/activity';
import { campaignOpenForLeads } from '@lib/campaignMembers';

export const dynamic = 'force-dynamic';
const AUDIT_MAX = 300;

export async function GET(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const lead = mongoose.isValidObjectId(id) ? await Lead.findById(id).select('dealer_id').lean() : null;
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });
  const access = await requireDealerAccess(req, String(lead.dealer_id));
  if (access.response) return Response.json({ error: 'Lead not found' }, { status: 404 });
  const dealerId = String(lead.dealer_id);

  const [logs, visit, campaigns, memberOf] = await Promise.all([
    ActivityLog.find({ lead_id: lead._id }).sort({ at: -1 }).limit(AUDIT_MAX).lean(),
    // Only where the Desk Log is shown to this person (its feature level), as on the Desk Log itself.
    deskLogAccess(req, dealerId).then((desk) => (desk.response ? null
      : DeskLogEntry.findOne({ lead_id: lead._id, 'checklist.0': { $exists: true } }).sort({ checked_in_at: -1 })
        .select('checklist checked_in_at updatedAt').lean())),
    Campaign.find({ dealer_id: mongoose.isValidObjectId(dealerId) ? new mongoose.Types.ObjectId(dealerId) : dealerId,
      status: { $in: ['draft', 'scheduled', 'active'] } })
      .select('name message_type status scheduled_date stats.sent').sort({ createdAt: -1 }).limit(50).lean(),
    CampaignLead.distinct('campaign_id', { lead_id: lead._id }),
  ]);
  const inCampaign = new Set(memberOf.map(String));

  return Response.json({
    audit: logs.map((a) => ({ at: a.at, actor: a.actor_type, by: a.actor_name || null, text: staffEntry(a).text,
      undone: Boolean(a.undone_at) })),
    checklist: visit ? { entry_id: String(visit._id), visit_at: visit.checked_in_at, updated_at: visit.updatedAt,
      items: (visit.checklist || []).map((c, index) => ({ index, item: c.item, done: Boolean(c.done), at: c.at || null })) } : null,
    campaigns: campaigns.filter(campaignOpenForLeads).map((c) => ({ id: String(c._id), name: c.name, channel: c.message_type,
      status: c.status, scheduled_date: c.scheduled_date || null, member: inCampaign.has(String(c._id)) })),
  });
}
