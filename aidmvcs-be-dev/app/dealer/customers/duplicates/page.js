"use client";
// Possible duplicate customers (SOW Deliverable B b3, gap G-008): customers that share a phone number or an email.
// A manager opens them and, when they are two different people (a couple, a parent and child), marks them
// "Not the same person" so they aren't flagged again. Nothing is merged automatically.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import { formatTimestamp } from "../../../utils/dateUtils";

export default function DuplicateCustomersPage() {
  const { user, dealerParent } = useUser();
  const dealerId = (dealerParent || user)?.id;
  const canReview = useCan("Manage Leads");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setError(null);
    try {
      const res = await fetch(`/api/customers/duplicates?dealer_id=${dealerId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load the list");
      setData(body);
    } catch (e) { setError(e.message); }
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const notSame = async (ids) => {
    setBusy(ids.join(":")); setError(null);
    try {
      const res = await fetch("/api/customers/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ dealer_id: dealerId, customer_ids: ids, decision: "not_duplicate" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save");
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="page_content">
      <div className="page_head d-flex align-items-center gap-2">
        <Link href="/dealer/customers" className="btn btn-sm btn-outline-custom">
          <i className="fa-regular fa-arrow-left me-1" />Back
        </Link>
        <h3 className="page_title mb-0">Possible duplicate customers</h3>
      </div>
      <div className="page_body">
        <div className="w_card">
          <p className="small text-muted">
            Customers that share a phone number or an email address. Open them to check; if they are different
            people, mark them so they aren&apos;t shown again. Nothing is merged automatically.
          </p>
          {!canReview && <Alert variant="warning" className="small">Only managers can review duplicates.</Alert>}
          {error && <Alert variant="danger" className="small">{error}</Alert>}
          {!data && !error && <div className="text-center py-4"><Spinner size="sm" /></div>}
          {data && data.total === 0 && <div className="text-muted small">No possible duplicates.</div>}
          {data && data.total > data.groups.length && (
            <div className="small text-muted mb-2">Showing the {data.groups.length} most recent of {data.total} groups.</div>
          )}
          {data?.groups.map((g) => (
            <div key={g.customers.map((c) => c._id).join("-")} className="border rounded p-2 mb-3">
              <Table size="sm" className="small mb-2">
                <thead><tr><th>Customer</th><th>Phones</th><th>Emails</th><th>Leads</th><th>Created</th></tr></thead>
                <tbody>
                  {g.customers.map((c) => (
                    <tr key={c._id}>
                      <td><Link href={`/dealer/customers/${c._id}`}>{c.name || "(no name)"}</Link></td>
                      <td>{c.phones.join(", ") || "-"}</td>
                      <td>{c.emails.join(", ") || "-"}</td>
                      <td>{c.leads}</td>
                      <td>{c.created_at ? formatTimestamp(c.created_at) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {g.pairs.map((p) => {
                const [a, b] = p.customer_ids.map((id) => g.customers.find((c) => c._id === id)?.name || id);
                const key = p.customer_ids.join(":");
                return (
                  <div key={key} className="d-flex flex-wrap align-items-center gap-2 small mb-1">
                    <span><strong>{a}</strong> and <strong>{b}</strong> share</span>
                    {p.shared.map((s) => <Badge key={s} bg="light" text="dark">{s}</Badge>)}
                    {canReview && (
                      <Button size="sm" variant="outline-custom" disabled={busy === key}
                        onClick={() => notSame(p.customer_ids)}>
                        {busy === key ? <Spinner size="sm" /> : "Not the same person"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
