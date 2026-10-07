// The Days 1-7 call tasks setting and the missed call task counts (agentic-upsell PLAN_4 stream T).
//
// ai_daily_call_tasks ("on" | "off", unset = on) lives on dealer_account_information and is read by the AI service
// (integrations/dealer_profile.py): on, the AI opens a morning (opening-noon) and an afternoon (noon-closing)
// call task per working day for Days 1-7 of a lead's Short-Term follow-up, besides the 60-minute task after each
// touch; off, only the 60-minute one. A call task not completed by the end of its window (or of the agent's day)
// is marked missed; missedCountRows() turns the AI's per-agent counts into rows for the Call Tasks page.
// No framework imports: the CRM's node tests import it directly.

export const DAILY_CALL_TASK_VALUES = ['on', 'off'];

export function dailyCallTasksView(dealer) {
  const raw = String(dealer?.dealer_account_information?.ai_daily_call_tasks || 'on').trim().toLowerCase();
  return raw === 'off' ? 'off' : 'on';
}

// { set } for a PUT body's ai_daily_call_tasks, or { error }.
export function dailyCallTasksUpdate(value) {
  if (!DAILY_CALL_TASK_VALUES.includes(value)) {
    return { error: 'ai_daily_call_tasks must be "on" or "off"' };
  }
  return { set: { 'dealer_account_information.ai_daily_call_tasks': value } };
}

// [{assigned_to, missed}] from the AI service + {userId: name} -> [{agent_id, agent, missed}], biggest first.
// `onlyUserId`: assigned-only staff see their own row only.
export function missedCountRows(agents, names = {}, onlyUserId = null) {
  return (Array.isArray(agents) ? agents : [])
    .filter((row) => row && Number(row.missed) > 0)
    .filter((row) => !onlyUserId || String(row.assigned_to) === String(onlyUserId))
    .map((row) => ({
      agent_id: row.assigned_to || null,
      agent: row.assigned_to ? (names[String(row.assigned_to)] || 'Unknown user') : 'Not assigned',
      missed: Number(row.missed),
    }))
    .sort((a, b) => b.missed - a.missed);
}
