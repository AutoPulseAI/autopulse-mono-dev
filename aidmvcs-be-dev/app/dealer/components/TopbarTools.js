"use client";
// The top bar's quick tools, on every dealer page (19 Nov 2026, SOW reference B4 - DealerSocket's header): the store
// you are in (and, for an AutoPulse admin or agency inside a store through "login as", a menu to go to another store),
// a bell with what needs a person now, and Help. Each opens the page where the work
// is done - the Leads list, AI Alerts, Call Tasks - in the same tab. Numbers come from /api/topbar, re-read every minute
// while the tab is open.
import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dropdown, Form, Spinner } from "react-bootstrap";
import { useCan } from "../../hooks/PermissionsContext";
import useLiveRefresh from "../../hooks/useLiveRefresh";
import { ALERTS_CHANGED_EVENT, aiFetch, alertKind, fromNow, leadHref } from "../ai/components/aiShared";

const REFRESH_MS = 60_000;

const IconToggle = forwardRef(function IconToggle({ children, onClick, className, ...rest }, ref) {
  return (
    <button type="button" ref={ref} className={`tb_icon ${className || ""}`}
      onClick={(e) => { e.preventDefault(); onClick?.(e); }} {...rest}>
      {children}
    </button>
  );
});

const Count = ({ n }) => (n > 0 ? <span className="tb_badge">{n > 99 ? "99+" : n}</span> : null);

function StoreMenu({ storeName }) {
  const [stores, setStores] = useState(null);
  const [needle, setNeedle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    aiFetch("/api/login-as/switch").then((d) => setStores(d.stores || [])).catch(() => setStores([]));
  }, []);

  const shown = useMemo(() => {
    const n = needle.trim().toLowerCase();
    return (stores || []).filter((s) => !n || `${s.name} ${s.city || ""}`.toLowerCase().includes(n)).slice(0, 50);
  }, [stores, needle]);

  const go = async (id) => {
    setBusy(true);
    setError("");
    try {
      const data = await aiFetch("/api/login-as/switch", { method: "POST", body: JSON.stringify({ dealerId: id }) });
      localStorage.setItem("dealertoken", data.token);
      window.location.assign("/dealer/dashboard"); // a fresh page: every screen reloads for the new store
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const label = <><i className="fa-regular fa-store" /><span className="tb_store_name">{storeName}</span></>;
  if (!stores?.length) return <span className="tb_store d-none d-md-inline-flex" title="The store you are in">{label}</span>;
  return (
    <Dropdown align="end" autoClose="outside" className="d-none d-md-block">
      <Dropdown.Toggle as={IconToggle} className="tb_store" title="Switch store" aria-label="Switch store">
        {label}<i className="fa-regular fa-chevron-down tb_caret" />
      </Dropdown.Toggle>
      <Dropdown.Menu className="tb_menu">
        <div className="px-3 pb-2">
          <Form.Control size="sm" placeholder="Find a store" value={needle} autoFocus
            onChange={(e) => setNeedle(e.target.value)} />
          {error && <div className="text-danger small mt-1">{error}</div>}
        </div>
        {busy ? <div className="text-center py-2"><Spinner size="sm" /></div> : shown.map((s) => (
          <Dropdown.Item key={s.id} onClick={() => go(s.id)} active={s.name === storeName}>
            {s.name}{s.city && <small className="text-muted ms-1">{s.city}</small>}
          </Dropdown.Item>
        ))}
        {!busy && !shown.length && <div className="px-3 small text-muted">No store matches</div>}
      </Dropdown.Menu>
    </Dropdown>
  );
}

function Section({ title, icon, count, more, children, empty }) {
  return (
    <div className="tb_section">
      <div className="tb_section_head">
        <i className={icon} />{title}{count ? <span className="tb_section_count">{count}</span> : null}
        {more && <Link href={more} className="ms-auto small">See all</Link>}
      </div>
      {children}
      {!count && <div className="tb_empty">{empty}</div>}
    </div>
  );
}

// One notification: click opens the lead and clears it; x clears it without leaving the page.
function Row({ href, title, text, at, whose, onClear }) {
  return (
    <div className="tb_row_wrap">
      <Dropdown.Item as={Link} href={href} className="tb_row" onClick={onClear}>
        <span className="tb_row_title">{title || "Unknown customer"}</span>
        {text && <span className="tb_row_text">{text}</span>}
        {whose && <span className="tb_row_whose"><i className="fa-regular fa-user me-1" />{whose}</span>}
        {at && <span className="tb_row_at">{fromNow(at)}</span>}
      </Dropdown.Item>
      <button type="button" className="tb_row_clear" title="Clear" aria-label={`Clear ${title || "notification"}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear(); }}>
        <i className="fa-regular fa-xmark" />
      </button>
    </div>
  );
}

export default function TopbarTools({ storeName }) {
  const canManageLeads = useCan("Manage Leads");
  const canViewAssigned = useCan("View Assigned Leads");
  const canViewAll = useCan("View All Leads (Read Only)");
  const canSupport = useCan("Manage Support Ticket");
  const canSeeLeads = canManageLeads || canViewAssigned || canViewAll;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canSeeLeads) return;
    try {
      setData(await aiFetch("/api/topbar"));
    } catch {
      // the icons stay without numbers until the next read
    }
  }, [canSeeLeads]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    window.addEventListener(ALERTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(ALERTS_CHANGED_EVENT, load);
  }, [load]);
  useLiveRefresh(load, { everyMs: REFRESH_MS });

  // Clearing only hides it from this user's bell; the alert or task stays on its page until the work is done.
  const sendClear = useCallback(async (body) => {
    const res = await fetch("/api/topbar/clear", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      body: JSON.stringify(body) });
    if (!res.ok) throw new Error("not cleared");
  }, []);
  const clearOne = useCallback((key) => {
    const drop = (part) => {
      if (!part?.items?.some((i) => i.key === key)) return part;
      return { ...part, items: part.items.filter((i) => i.key !== key), count: Math.max(0, (part.count || 0) - 1) };
    };
    setData((d) => d && { ...d, alerts: drop(d.alerts), calls: drop(d.calls), taken: drop(d.taken), new_leads: drop(d.new_leads) });
    sendClear({ keys: [key] }).catch(() => null).finally(load);
  }, [load, sendClear]);
  const clearAll = useCallback(() => {
    const keys = data?.clear_keys || [];
    const empty = (part) => part && { ...part, items: [], count: 0 };
    setData((d) => d && { ...d, alerts: empty(d.alerts), calls: empty(d.calls), taken: empty(d.taken), new_leads: empty(d.new_leads) });
    sendClear({ all: true, keys }).catch(() => null).finally(load);
  }, [data, load, sendClear]);


  const alerts = data?.alerts;
  const calls = data?.calls;
  const fresh = data?.new_leads;
  const taken = data?.taken;
  const bellCount = (alerts?.count || 0) + (calls?.count || 0) + (fresh?.count || 0) + (taken?.count || 0);

  return (
    <div className="tb_tools">
      <StoreMenu storeName={storeName} />
      {canSeeLeads && (
        <>
          {/* Opens to the right, under the bell: it used to open left, under the side menu (21 Nov 2026). */}
          <Dropdown align="start" onToggle={(open) => { if (open) load(); }}>
            <Dropdown.Toggle as={IconToggle} title="Notifications" aria-label="Notifications">
              <i className="fa-regular fa-bell" /><Count n={bellCount} />
            </Dropdown.Toggle>
            <Dropdown.Menu className="tb_menu tb_bell">
              {loading && !data && <div className="text-center py-2"><Spinner size="sm" /></div>}
              {data && (alerts?.count > 0 || calls?.count > 0 || taken?.count > 0 || fresh?.count > 0) && (
                <div className="tb_bell_head">
                  <strong>Notifications</strong>
                  <button type="button" className="btn btn-link btn-sm p-0 ms-auto" onClick={clearAll}>Clear all</button>
                </div>
              )}
              {data?.ai_unavailable && (
                <div className="tb_empty text-warning">AI alerts and call tasks can&apos;t be loaded right now.</div>
              )}
              {alerts && (
                <Section title="Needs a person" icon="fa-regular fa-triangle-exclamation" count={alerts.count}
                  more="/dealer/ai/actions?tab=dar" empty="Nothing waiting">
                  {alerts.items.map((a) => (
                    <Row key={a.key} href={leadHref(a.lead_id)} title={a.name} text={a.text || alertKind(a.kind).label} at={a.at} whose={a.whose} onClear={() => clearOne(a.key)} />
                  ))}
                </Section>
              )}
              {calls && (
                <Section title="Calls to make" icon="fa-regular fa-phone-volume" count={calls.count}
                  more="/dealer/ai/actions?tab=tasks" empty="No calls due">
                  {calls.items.map((t) => (
                    <Row key={t.key} href={leadHref(t.lead_id)} title={t.name} text={t.reason} at={t.due_at} whose={t.whose} onClear={() => clearOne(t.key)} />
                  ))}
                </Section>
              )}
              {taken?.count > 0 && (
                <Section title="Taken over from you" icon="fa-regular fa-user-shield" count={taken.count} empty="">
                  {taken.items.map((t) => (
                    <Row key={t.key} href={leadHref(t.lead_id)} title={t.name} onClear={() => clearOne(t.key)}
                      text={`${t.by || "A manager"} took it over${t.why ? `: ${t.why}` : ""}`} at={t.at} />
                  ))}
                </Section>
              )}
              {fresh && (
                <Section title={fresh.mine ? "New leads for you (24 h)" : "New leads to assign (24 h)"} icon="fa-regular fa-user-plus"
                  count={fresh.count} more={`/dealer/leads?assignment=${fresh.mine ? "my" : "unassigned"}`} empty="No new leads">
                  {fresh.items.map((l) => (
                    <Row key={l.key} href={leadHref(l.lead_id)} title={l.name} onClear={() => clearOne(l.key)}
                      text={l.why === "reassigned" ? `Reassigned to you${l.by ? ` by ${l.by}` : ""}` : "New lead"} at={l.at} />
                  ))}
                </Section>
              )}
            </Dropdown.Menu>
          </Dropdown>
        </>
      )}
      {canSupport && (
        <Link href="/dealer/support" className="tb_icon" title="Help Center (support tickets)" aria-label="Help Center">
          <i className="fa-regular fa-circle-question" />
        </Link>
      )}
    </div>
  );
}
