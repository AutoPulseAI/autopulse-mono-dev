import type { CallTask, ConversationItem, Dealer, Followup, Lead, ManagerOutcome, Metrics, Ping, Pipeline, RolloutCheck, Scenario, ScenarioRun, ShadowView, SlotsView, StaffStatusName, TurnDoc, TurnSummary, Verdict } from "./types";

// Everything goes through Vite's /api proxy to the AI service's /dev/* routes.
const BASE = "/api/dev";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  ping: () => request<Ping>("/ping"),
  pipeline: () => request<Pipeline>("/pipeline"),
  dealers: () => request<Dealer[]>("/dealers"),
  leads: (dealerId: string) => request<Lead[]>(`/leads?${q({ dealer_id: dealerId })}`),
  conversation: (dealerId: string, leadId: string) =>
    request<ConversationItem[]>(`/leads/${leadId}/conversation?${q({ dealer_id: dealerId })}`),
  slots: (dealerId: string, leadId: string) =>
    request<SlotsView>(`/leads/${leadId}/slots?${q({ dealer_id: dealerId })}`),
  turns: (dealerId: string, leadId: string) =>
    request<TurnSummary[]>(`/turns?${q({ dealer_id: dealerId, lead_id: leadId })}`),
  turn: (dealerId: string, turnId: string) => request<TurnDoc>(`/turns/${turnId}?${q({ dealer_id: dealerId })}`),
  newLead: (body: { dealer_id: string; lead_type: string; channel: string; name: string; comments: string;
    same_contact_as?: string }) =>
    post<{ lead_id: string; customer_id: string; event: string }>("/simulate/lead", body),
  reply: (body: { dealer_id: string; lead_id: string; channel: string; text: string }) =>
    post<{ event: string }>("/simulate/reply", body),
  leadAction: (dealerId: string, leadId: string, action: "pause" | "resume") =>
    post<{ event: string }>(`/leads/${leadId}/${action}`, { dealer_id: dealerId, reason: "Paused from Debug UI" }),
  // Plays staff on the platform's status screen (C3/C5): the lead-paused event the platform would send.
  staffStatus: (dealerId: string, leadId: string, status: StaffStatusName,
    extra?: { booking_at?: string; manager_outcome?: ManagerOutcome }) =>
    post<{ event: string }>(`/leads/${leadId}/staff/status`, { dealer_id: dealerId, status, ...extra }),
  // Plays a provider delivery callback for one sent message; `hard` = the address can never receive (C6).
  messageStatus: (dealerId: string, messageId: string, status: "bounced" | "undelivered" | "delivered", hard: boolean) =>
    post<Record<string, unknown>>(`/messages/${messageId}/status?${q({ dealer_id: dealerId })}`, { status, hard }),
  callTasks: (dealerId: string) => request<CallTask[]>(`/call-tasks?${q({ dealer_id: dealerId })}`),
  resolveCallTask: (dealerId: string, taskId: string, action: "complete" | "dismiss", outcome?: string) =>
    post<CallTask>(`/call-tasks/${taskId}/${action}`, { dealer_id: dealerId, outcome: outcome ?? null }),
  clock: () => request<{ now: string; offset_s: number }>("/clock"),
  advanceClock: (seconds: number) => post<{ now: string; offset_s: number }>("/clock/advance", { seconds }),
  resetClock: () => post<{ now: string; offset_s: number }>("/clock/reset", {}),
  followups: (dealerId: string) => request<Followup[]>(`/followups?${q({ dealer_id: dealerId })}`),
  failSms: (dealerId: string, followupId: string) =>
    post<{ status: string }>(`/followups/${followupId}/fail-sms?${q({ dealer_id: dealerId })}`, {}),
  metrics: (dealerId: string, days: number) => request<Metrics>(`/metrics?${q({ dealer_id: dealerId, days: String(days) })}`),
  rolloutCheck: (dealerId: string, days: number) =>
    request<RolloutCheck>(`/rollout-check?${q({ dealer_id: dealerId, days: String(days) })}`),
  shadow: (dealerId: string, days: number) => request<ShadowView>(`/shadow?${q({ dealer_id: dealerId, days: String(days) })}`),
  reviewShadow: (dealerId: string, turnId: string, verdict: Verdict, note?: string) =>
    post<{ status: string }>("/shadow/review", { dealer_id: dealerId, turn_id: turnId, verdict, note: note ?? null }),
  markSold: (dealerId: string, vin: string) =>
    post<{ status: string; vin: string }>(`/stock/${vin}/mark-sold?${q({ dealer_id: dealerId })}`, {}),
  scenarios: () => request<Scenario[]>("/scenarios"),
  runScenarios: (ids?: string[]) => post<ScenarioRun[]>("/scenarios/run", { ids: ids ?? null }),
  streamUrl: (dealerId: string) => `${BASE}/stream?${q({ dealer_id: dealerId })}`,
};
