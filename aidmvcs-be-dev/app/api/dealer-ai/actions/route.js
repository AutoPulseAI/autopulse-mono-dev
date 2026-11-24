// The Actions page (app/dealer/ai/actions).
//   GET ?tab=stuck | reminders | board | lead&lead_id=   POST { lead_ids }  source, department, status, owner of each lead
// Every answer is limited to what this person is responsible for (app/lib/responsibility.js). Nothing here writes.
import { NextResponse } from "next/server";
import { loadResponsibilityScope } from "@lib/responsibility";
import { leadCardFacts, leadRowFacts, reminderRows, stuckLeads, teamBoard } from "@lib/actionQueues";
import { jsonError, requireDealerSession } from "../_lib/dealerAi";

const me = (scope) => ({ id: scope.userId, role: scope.role, departments: scope.departments, team: [...scope.team] });

export async function GET(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const tab = url.searchParams.get("tab");
  try {
    if (tab === "lead") {
      const facts = await leadCardFacts(session.dealerId, url.searchParams.get("lead_id"));
      return facts ? NextResponse.json(facts) : jsonError("Lead not found", 404);
    }
    const scope = await loadResponsibilityScope(session.user, session.dealerId);
    if (tab === "stuck") return NextResponse.json({ me: me(scope), ...(await stuckLeads(session.dealerId, scope)) });
    if (tab === "reminders") return NextResponse.json({ me: me(scope), rows: await reminderRows(session.dealerId, scope) });
    if (tab === "board") return NextResponse.json({ me: me(scope), rows: await teamBoard(session.dealerId, scope) });
    return jsonError("tab must be stuck, reminders, board or lead", 400);
  } catch (error) {
    console.error("[actions] could not load", { tab, error: error?.message });
    return jsonError("Could not load this list. Try again.", 500);
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return jsonError("Body must be JSON", 400); }
  const session = await requireDealerSession(req, body?.dealer_id);
  if (session.error) return session.error;
  const ids = Array.isArray(body?.lead_ids) ? body.lead_ids : [];
  return NextResponse.json({ facts: await leadRowFacts(session.dealerId, ids) });
}
