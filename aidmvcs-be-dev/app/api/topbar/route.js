// The dealer portal's top bar (19 Nov 2026, SOW reference B4 - DealerSocket's header: mail, chat and notification
// icons on every page). One read for the whole bar, re-read every minute while the tab is open:
//   GET /api/topbar[?dealer_id=]
//   unread.email / unread.sms  leads with a customer email / text nobody has opened yet - the same count as the Leads
//                              page's "Unread" filter (app/api/leads/route.js), per channel
//   alerts                     AI alerts that need a person (the AI Alerts page / the sidebar's count), newest first
//   calls                      call tasks to make now (Call Tasks > Open)
//   new_leads                  the last 24 hours: new leads (dealer / managers), or leads given to me (assigned-only
//                              staff: created for me or reassigned to me)
// Staff who see only their own leads get only their own leads in every number, as on the pages the icons open. An
// AI service that can't be reached leaves its two parts empty (`ai_unavailable`); the rest still shows. Read-only.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Email from "@models/Email";
import Lead from "@models/Lead";
import ActivityLog from "@models/ActivityLog";
import NotificationClear from "@models/NotificationClear";
import User from "@models/User";
import { loadResponsibilityScope, newLeadFilter, responsibilityFor } from "@lib/responsibility";
import {
  callAiService, leadSummaries, requireDealerSession,
} from "../dealer-ai/_lib/dealerAi";

export const dynamic = "force-dynamic";

const LIST = 5; // rows per part in the bell's dropdown
const NEW_LEADS_HOURS = 24;

async function unreadLeads(dealerId, channel, onlyUserId) {
  const ids = await Email.distinct("lead_id", {
    dealer_id: dealerId, lead_id: { $exists: true, $ne: null }, status: { $in: ["received", "incoming"] },
    communication_type: channel, read: { $ne: true },
  });
  if (!ids.length) return 0;
  return Lead.countDocuments({ _id: { $in: ids }, dealer_id: dealerId, ...(onlyUserId ? { assigned_to: onlyUserId } : {}) });
}

async function aiPart(path, query, pick) {
  const result = await callAiService(path, { query });
  if (!result.ok) return null;
  return pick(result.body) || [];
}

// Only the rows this person is responsible for (app/lib/responsibility.js), each with why and whose it is.
async function keepResponsible(rows, dealerId, scope) {
  if (!rows?.length) return rows ? [] : null;
  const ids = [...new Set(rows.map((r) => r.lead_id).filter((id) => mongoose.isValidObjectId(id)))];
  const leads = await Lead.find({ _id: { $in: ids }, dealer_id: dealerId }).select("assigned_to department").lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const out = [];
  for (const row of rows) {
    const lead = byId.get(String(row.lead_id));
    const why = responsibilityFor(scope, row, lead);
    if (why) out.push({ ...row, responsibility: why, owner_id: lead?.assigned_to ? String(lead.assigned_to) : null });
  }
  return out;
}

// What this user cleared from the bell (app/models/NotificationClear.js).
async function clearedFor(userId, dealerId) {
  const rows = await NotificationClear.find({ user_id: userId, dealer_id: dealerId }).select("key at").lean().catch(() => []);
  return { keys: new Set(rows.map((r) => r.key)), allAt: rows.find((r) => r.key === "all")?.at || null };
}
const later = (a, b) => (b && b > a ? b : a);

async function newLeads(dealerId, scope, cleared) {
  const since = later(new Date(Date.now() - NEW_LEADS_HOURS * 3_600_000), cleared.allAt);
  const mine = newLeadFilter(scope);
  const hidden = [...cleared.keys].filter((k) => k.startsWith("new:")).map((k) => k.slice(4)).filter((id) => mongoose.isValidObjectId(id));
  const match = { dealer_id: dealerId, createdAt: { $gte: since }, ...mine, ...(hidden.length ? { _id: { $nin: hidden } } : {}) };
  const created = await Lead.find(match).sort({ createdAt: -1 }).limit(50).select("name createdAt").lean();
  const rows = created.map((l) => ({ key: `new:${l._id}`, lead_id: String(l._id), name: l.name || null, at: l.createdAt, why: "new" }));
  {
    const moved = await ActivityLog.find({ dealer_id: dealerId, action: "lead_reassigned", to_id: scope.userId,
      at: { $gte: since }, undone_at: { $exists: false } }).sort({ at: -1 }).limit(50).select("_id lead_id at actor_name").lean();
    const seen = new Set(rows.map((r) => r.lead_id));
    const names = await leadSummaries(dealerId, moved.map((m) => String(m.lead_id)));
    for (const m of moved) {
      const id = String(m.lead_id);
      if (seen.has(id) || !names[id] || cleared.keys.has(`moved:${m._id}`)) continue;
      seen.add(id);
      rows.push({ key: `moved:${m._id}`, lead_id: id, name: names[id].name, at: m.at, why: "reassigned", by: m.actor_name || null });
    }
  }
  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  const movedCount = rows.filter((r) => r.why === "reassigned").length;
  const total = (await Lead.countDocuments(match)) + movedCount;
  return { count: total, items: rows.slice(0, LIST), mine: scope.role === "staff" };
}

// A manager override that took one of my leads (last 7 days, not undone) - the old owner hears about it in the bell.
async function takenFromMe(dealerId, userId, cleared) {
  if (!userId) return { count: 0, items: [] };
  const since = later(new Date(Date.now() - 7 * 24 * 3_600_000), cleared.allAt);
  const rows = await ActivityLog.find({ dealer_id: dealerId, action: "lead_reassigned", from_id: userId,
    detail: /^override:/, at: { $gte: since }, undone_at: { $exists: false } }).sort({ at: -1 }).limit(20)
    .select("_id lead_id at actor_name detail").lean();
  const names = await leadSummaries(dealerId, rows.map((r) => String(r.lead_id)));
  const items = rows.filter((r) => names[String(r.lead_id)] && !cleared.keys.has(`taken:${r._id}`)).map((r) => ({ key: `taken:${r._id}`, lead_id: String(r.lead_id),
    name: names[String(r.lead_id)].name, at: r.at, by: r.actor_name || null, why: String(r.detail).slice(9).trim() }));
  return { count: items.length, items: items.slice(0, LIST) };
}

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const { dealerId, user } = session;

  const scope = await loadResponsibilityScope(user, dealerId);
  const onlyUserId = scope.role === "staff" ? scope.userId : null; // unread counts: staff see their own leads only
  const cleared = await clearedFor(user._id, dealerId);
  const [email, sms, allAlerts, allCalls, fresh] = await Promise.all([
    unreadLeads(dealerId, "email", onlyUserId),
    unreadLeads(dealerId, "sms", onlyUserId),
    aiPart("/v1/staff/notices", { dealer_id: dealerId, include_handled: "false" },
      (body) => (body?.notices || []).filter((n) => !n.handled)),
    aiPart("/v1/staff/call-tasks", { dealer_id: dealerId, view: "open" },
      (body) => (Array.isArray(body) ? body : [])),
    newLeads(dealerId, scope, cleared),
  ]);
  const taken = await takenFromMe(dealerId, user?._id, cleared).catch(() => ({ count: 0, items: [] }));
  // Cleared from this user's bell only: the alert / task itself stays open on its page.
  const [myAlerts, myCalls] = await Promise.all([keepResponsible(allAlerts, dealerId, scope), keepResponsible(allCalls, dealerId, scope)]);
  const alerts = myAlerts && myAlerts.filter((a) => !cleared.keys.has(`alert:${a.id}`));
  const calls = myCalls && myCalls.filter((t) => !cleared.keys.has(`call:${t.id}`));
  const ownerIds = [...new Set([...(alerts || []).slice(0, LIST), ...(calls || []).slice(0, LIST)]
    .filter((r) => r.responsibility === "team").map((r) => r.owner_id))];
  const owners = new Map((ownerIds.length ? await User.find({ _id: { $in: ownerIds } }).select("name").lean() : [])
    .map((u) => [String(u._id), u.name]));
  const whose = (r) => (r.responsibility === "mine" ? null : r.responsibility === "unowned" ? "No owner" : owners.get(r.owner_id) || "Staff");

  const firstRows = [...(alerts || []).slice(0, LIST), ...(calls || []).slice(0, LIST)];
  const names = await leadSummaries(dealerId, firstRows.map((r) => r.lead_id));
  const nameOf = (row) => row.customer_name || names[row.lead_id]?.name || null;

  return NextResponse.json({
    unread: { email, sms },
    alerts: alerts && {
      // Leads that need a person, once each - the count the sidebar shows (app/api/dealer-ai/alerts).
      count: new Set(alerts.map((a) => a.lead_id)).size,
      items: alerts.slice(0, LIST).map((a) => ({ key: `alert:${a.id}`, id: a.id, lead_id: a.lead_id, kind: a.kind, text: a.text || null,
        at: a.at || null, name: nameOf(a), whose: whose(a) })),
    },
    calls: calls && {
      count: calls.length,
      items: calls.slice(0, LIST).map((t) => ({ key: `call:${t.id}`, id: t.id, lead_id: t.lead_id, reason: t.reason || null,
        due_at: t.due_at || t.due_by || null, name: nameOf(t), whose: whose(t) })),
    },
    new_leads: fresh,
    role: scope.role,
    taken,
    clear_keys: [...(alerts || []).map((a) => `alert:${a.id}`), ...(calls || []).map((t) => `call:${t.id}`)].slice(0, 1000),
    ai_unavailable: !alerts || !calls,
  });
}
