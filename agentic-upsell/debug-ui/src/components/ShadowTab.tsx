import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import { formatDateTime, formatTime } from "../time";
import type { ShadowPair, ShadowView, Verdict } from "../types";

interface Props {
  dealerId: string;
  onError: (m: string) => void;
}

const VERDICTS: { id: Verdict; label: string; color: string }[] = [
  { id: "better", label: "AI better", color: "var(--ok)" },
  { id: "same", label: "Same", color: "var(--accent)" },
  { id: "worse", label: "AI worse", color: "var(--warn)" },
  { id: "unsafe", label: "Unsafe", color: "var(--bad)" },
];

function Bubble({ who, text, tone, meta }: { who: string; text: string; tone: string; meta?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-line p-2" style={{ background: tone }}>
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {who}
        {meta && <span className="font-normal normal-case">{meta}</span>}
      </div>
      <div className="whitespace-pre-wrap text-[12px]">{text}</div>
    </div>
  );
}

function Pair({ pair, onReview }: { pair: ShadowPair; onReview: (v: Verdict) => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <span>{formatDateTime(pair.at)}</span>
        <span className="rounded bg-panel-2 px-1.5">{pair.trigger === "lead_created" ? "new lead" : "reply"}</span>
        <span className="rounded bg-panel-2 px-1.5">{pair.channel}</span>
        <span className="truncate">lead …{pair.lead_id.slice(-6)}</span>
      </div>
      <div className="mb-2 text-[12px]">
        <span className="font-semibold">Customer: </span>
        {pair.customer.length ? pair.customer.join(" / ") : <span className="text-muted">(no text)</span>}
      </div>
      <div className="flex flex-col gap-2 lg:flex-row">
        <Bubble
          who="AI draft (not sent)"
          text={pair.ai.text}
          tone="var(--ai-soft)"
          meta={`${pair.ai.outcome ?? ""}${pair.ai.used_fallback ? " · template" : ""}${pair.ai.guard_passed ? "" : " · guard failed"}`}
        />
        {pair.actual ? (
          <Bubble
            who={pair.actual.by === "staff" ? "Staff sent" : "n8n sent"}
            text={pair.actual.text}
            tone="var(--panel-2)"
            meta={formatTime(pair.actual.at)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line p-2 text-[12px] text-muted">
            Nothing sent by the platform (yet)
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted">Review:</span>
        {VERDICTS.map((v) => {
          const chosen = pair.review?.verdict === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onReview(v.id)}
              className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
              style={{ borderColor: v.color, background: chosen ? v.color : "transparent", color: chosen ? "white" : v.color }}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

export function ShadowTab({ dealerId, onError }: Props) {
  const [view, setView] = useState<ShadowView | null>(null);
  const [days, setDays] = useState(7);

  const load = async () => {
    try {
      setView(await api.shadow(dealerId, days));
    } catch (e) {
      onError(String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId, days]);

  const review = async (pair: ShadowPair, verdict: Verdict) => {
    try {
      await api.reviewShadow(dealerId, pair.turn_id, verdict);
      await load();
    } catch (e) {
      onError(String(e));
    }
  };

  const s = view?.summary;
  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="text-[13px] font-semibold">Shadow comparison</div>
          <div className="text-[11px] text-muted">
            What the AI would have sent vs what the customer actually got. Use on a DEV copy of a shadow dealer
            (make ai-copy-dealer), never on production.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className="rounded-md px-2.5 py-1 text-[12px] font-semibold"
              style={{ background: d === days ? "var(--accent)" : "var(--panel-2)", color: d === days ? "white" : "var(--muted)" }}
            >
              {d === 1 ? "24h" : `${d} days`}
            </button>
          ))}
          <button type="button" onClick={() => void load()} className="rounded-md bg-panel-2 px-2.5 py-1 text-[12px] font-semibold text-muted">
            Refresh
          </button>
        </div>
      </div>

      {s && (
        <div className="flex flex-wrap gap-2 text-[12px]">
          <span className="rounded-md bg-panel-2 px-2 py-1">{s.drafts} AI drafts</span>
          <span className="rounded-md bg-panel-2 px-2 py-1">{s.with_actual_reply} with a platform reply to compare</span>
          <span className="rounded-md bg-panel-2 px-2 py-1">{s.reviewed} reviewed</span>
          {VERDICTS.map((v) => (
            <span key={v.id} className="rounded-md px-2 py-1 font-semibold" style={{ color: v.color, background: "var(--panel-2)" }}>
              {v.label}: {s.verdicts[v.id] ?? 0}
            </span>
          ))}
        </div>
      )}

      {view && view.pairs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line p-8 text-center text-[12px] text-muted">
          No shadow drafts for this dealer in this window. Pick the shadow dealer (Hillside Cars) or copy one with
          make ai-copy-dealer ... REPLAY=1.
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {view?.pairs.map((pair) => <Pair key={pair.turn_id} pair={pair} onReview={(v) => void review(pair, v)} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
