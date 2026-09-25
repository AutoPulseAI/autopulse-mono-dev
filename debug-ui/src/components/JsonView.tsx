import { useState } from "react";

/** Compact, collapsible JSON with light colouring. */
export function JsonView({ value, collapsedAt = 2 }: { value: unknown; collapsedAt?: number }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-lg bg-panel-2 p-2 font-mono text-[11px] leading-relaxed">
      <Node value={value} depth={0} collapsedAt={collapsedAt} />
    </div>
  );
}

function Node({ value, depth, collapsedAt, name }: { value: unknown; depth: number; collapsedAt: number; name?: string }) {
  const [open, setOpen] = useState(depth < collapsedAt);
  const label = name !== undefined ? <span className="text-muted">{name}: </span> : null;

  if (value === null || value === undefined) return <div>{label}<span className="text-muted">null</span></div>;
  if (typeof value === "string") return <div className="break-words">{label}<span className="text-ok">"{value}"</span></div>;
  if (typeof value === "number") return <div>{label}<span className="text-accent">{value}</span></div>;
  if (typeof value === "boolean") return <div>{label}<span className="text-ai">{String(value)}</span></div>;

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  const [openBr, closeBr] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return <div>{label}{openBr}{closeBr}</div>;

  return (
    <div>
      <button type="button" className="text-left hover:text-accent" onClick={() => setOpen((o) => !o)}>
        <span className="inline-block w-3 text-muted">{open ? "▾" : "▸"}</span>
        {label}
        {openBr}
        {!open && <span className="text-muted"> {entries.length} … {closeBr}</span>}
      </button>
      {open && (
        <>
          <div className="ml-3 border-l border-line pl-2">
            {entries.map(([k, v]) => (
              <Node key={k} name={k} value={v} depth={depth + 1} collapsedAt={collapsedAt} />
            ))}
          </div>
          <div>{closeBr}</div>
        </>
      )}
    </div>
  );
}
