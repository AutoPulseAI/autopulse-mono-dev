// The Call Tasks page (app/dealer/ai/call-tasks).
//   GET /api/dealer-ai/call-tasks?view=open|upcoming|done[&dealer_id=]
// open: calls staff should make now; upcoming: the 60-minute timers still
// waiting for a reply and the next Days 1-7 call task; done: completed, dismissed, cancelled or missed. Each row has
// the lead's stage and last AI touch (AI service) and name / vehicle (CRM lead).
// Stream T: "done" also carries `missed_by_agent` - missed call tasks in the last 30 days per assigned agent
// ({days, agents: [{agent_id, agent, missed}]}; assigned-only staff see their own row). The BDC report is next SOW.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import User from "@models/User";
import { missedCountRows } from "@lib/ai/aiCallTasks";
import {
  aiServiceError, assignedOnlyUserId, callAiService, jsonError, keepAssignedRows, leadSummaries, requireDealerSession,
} from "../_lib/dealerAi";

const MISSED_DAYS = 30;

async function missedByAgent(dealerId, onlyUserId) {
  const result = await callAiService("/v1/staff/call-tasks/missed-by-agent",
    { query: { dealer_id: dealerId, days: MISSED_DAYS } });
  if (!result.ok) return null; // the list still shows; the counts just don't
  const agents = result.body?.agents || [];
  const ids = agents.map((a) => a.assigned_to).filter((id) => mongoose.isValidObjectId(id));
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("name email").lean() : [];
  const names = Object.fromEntries(users.map((u) => [String(u._id), u.name || u.email]));
  return { days: MISSED_DAYS, agents: missedCountRows(agents, names, onlyUserId) };
}

const VIEWS = ["open", "upcoming", "done"];

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const view = url.searchParams.get("view") || "open";
  if (!VIEWS.includes(view)) return jsonError(`view must be one of ${VIEWS.join(", ")}`, 400);

  const result = await callAiService("/v1/staff/call-tasks", { query: { dealer_id: session.dealerId, view } });
  if (!result.ok) return aiServiceError(result);
  // Stream R: "View Assigned Leads" staff (without "Manage Leads") get only their own leads' tasks.
  const onlyUserId = await assignedOnlyUserId(session.user);
  const tasks = await keepAssignedRows(session.dealerId, onlyUserId, Array.isArray(result.body) ? result.body : []);
  const leads = await leadSummaries(session.dealerId, tasks.map((t) => t.lead_id));
  return NextResponse.json({
    view,
    ...(view === "done" ? { missed_by_agent: await missedByAgent(session.dealerId, onlyUserId) } : {}),
    tasks: tasks.map((task) => {
      const lead = leads[task.lead_id] || {};
      return {
        ...task,
        customer_name: task.customer_name || lead.name || null,
        phone: task.phone || lead.phone || null,
        vehicle: lead.vehicle || null,
        crm_status: lead.crm_status || null,
      };
    }),
  });
}
