import type { Ping } from "../types";

// Which models the AI service is running, so a tester always knows what they're
// testing: the offline stand-in is rules, not AI (MASTER_PLAN_2 Phase 9).
export function ModelsBanner({ ping }: { ping: Ping }) {
  const name = (model: string) => model.replace(/^openai:/, "");
  const title = ping.offline
    ? "Offline model: deterministic rules standing in for the AI, so the pipeline runs without a key. Replies show the flow, not real AI quality. The #retry / #fallback / #reject test tags work."
    : `Real models. Extract: ${ping.models.extract}. Compose: ${ping.models.compose}.`;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        background: ping.offline ? "var(--warn-soft)" : "var(--ai-soft)",
        color: ping.offline ? "var(--warn)" : "var(--ai)",
      }}
      title={title}
    >
      {ping.offline ? "Offline model (rules, not AI)" : `AI: ${name(ping.models.extract)} / ${name(ping.models.compose)}`}
    </span>
  );
}
