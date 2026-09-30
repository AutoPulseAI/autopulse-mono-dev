import { motion } from "framer-motion";

import { formatDateTime, formatTime } from "../time";
import type { Replay, Speed } from "../trace/useReplay";
import type { TurnSummary } from "../types";
import { outcomeColor } from "./ui";

interface Props {
  turns: TurnSummary[];
  mode: "live" | "replay";
  replayTurnId: string | null;
  replay: Replay;
  onPickTurn: (turnId: string) => void;
  onLive: () => void;
}

const SPEEDS: Speed[] = [0.5, 1, 2];

export const TRIGGER_LABEL: Record<string, string> = {
  lead_created: "new lead",
  inbound_message: "reply",
  followup: "follow-up",
  inbound_held: "held",
  handoff_check: "staff check",
  resume_check: "morning check",
  resume_at_opening: "morning message",
  visit_followup_check: "visit follow-up check",
  visit_followup: "fresh visit offer",
  summary: "summary",
};

export function Timeline({ turns, mode, replayTurnId, replay, onPickTurn, onLive }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-t border-line bg-panel px-3 py-2">
      <button
        type="button"
        onClick={onLive}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
        style={{
          background: mode === "live" ? "var(--bad-soft)" : "var(--panel-2)",
          color: mode === "live" ? "var(--bad)" : "var(--muted)",
        }}
      >
        <motion.span
          className="h-2 w-2 rounded-full"
          style={{ background: mode === "live" ? "var(--bad)" : "var(--idle)" }}
          animate={mode === "live" ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
          transition={{ repeat: Infinity, duration: 1.4 }}
        />
        LIVE
      </button>

      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {turns.length === 0 && <span className="text-[11px] text-muted">No turns yet for this lead.</span>}
        {turns.map((t, i) => {
          const selected = mode === "replay" && replayTurnId === t.turn_id;
          return (
            <motion.button
              key={t.turn_id}
              type="button"
              layout
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={() => onPickTurn(t.turn_id)}
              title={`${t.trigger} · ${formatDateTime(t.created_at, true)} · ${t.ms ?? "?"} ms · click to replay`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]"
              style={{ borderColor: selected ? "var(--accent)" : "var(--border)", background: selected ? "var(--accent-soft)" : "var(--panel)" }}
            >
              <span className="font-semibold text-muted">#{i + 1}</span>
              <span>{TRIGGER_LABEL[t.trigger] ?? t.trigger}</span>
              <span className="text-[10px] tabular-nums text-muted">{formatTime(t.created_at)}</span>
              <span className="font-semibold" style={{ color: outcomeColor(t.outcome) }}>
                → {t.outcome ?? "…"}
              </span>
            </motion.button>
          );
        })}
      </div>

      {mode === "replay" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton label="Step back" onClick={replay.stepBack}>⏮</IconButton>
          {replay.playing ? (
            <IconButton label="Pause" onClick={replay.pause}>⏸</IconButton>
          ) : (
            <IconButton label="Play" onClick={replay.play}>▶</IconButton>
          )}
          <IconButton label="Step forward" onClick={replay.stepForward}>⏭</IconButton>
          <input
            type="range"
            min={0}
            max={replay.total}
            value={replay.index}
            onChange={(e) => replay.seek(Number(e.target.value))}
            className="w-28 accent-[var(--accent)]"
            aria-label="Replay position"
          />
          <span className="w-12 text-[10px] tabular-nums text-muted">
            {replay.index}/{replay.total}
          </span>
          <div className="flex overflow-hidden rounded-md border border-line">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => replay.setSpeed(s)}
                className="px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: replay.speed === s ? "var(--accent)" : "transparent", color: replay.speed === s ? "white" : "var(--muted)" }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md bg-panel-2 text-[11px] hover:bg-accent-soft"
    >
      {children}
    </button>
  );
}
