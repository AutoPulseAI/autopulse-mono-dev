"use client";
// The dealership's Do-Not-Contact list (19 Nov 2026, SOW reference B8 "Manage Do-Not-Call List"; SOW L, G-071):
// phones and emails this dealership must not contact. Everyone can see it; the dealer account and managers ("Manage
// Account Information") add and remove. Removing keeps the entry's history. /api/do-not-contact.
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Form, InputGroup, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { formatTimestamp } from "../../utils/dateUtils";

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export default function DoNotContactPage() {
  const { dealerParent, user } = useUser();
  const dealerId = dealerParent?.id || user?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: "phone", value: "", reason: "" });
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!dealerId) return;
    const res = await fetch(`/api/do-not-contact?dealer_id=${dealerId}`, { headers: auth() });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { setData(body); setError(""); } else setError(body.error || "Could not load the list");
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const send = async (method, payload) => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/do-not-contact", { method, headers: auth(), body: JSON.stringify({ dealer_id: dealerId, ...payload }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Not saved");
      await load();
      return true;
    } catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (await send("POST", form)) setForm({ ...form, value: "", reason: "" });
  };
  const download = async () => {
    const res = await fetch(`/api/do-not-contact?dealer_id=${dealerId}&export=csv`, { headers: auth() });
    if (!res.ok) { setError("Could not download the list"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = "do-not-contact.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const rows = (data?.entries || []).filter((r) => !q.trim() || `${r.value} ${r.reason || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="page_content">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h2 className="fs-4 mb-0 me-auto">Do-Not-Contact list</h2>
        <Button size="sm" variant="outline-custom" onClick={download} disabled={!data?.entries?.length}>
          <i className="fa-regular fa-download me-1" />Download CSV</Button>
      </div>
      <div className="w_card">
        <p className="small text-muted">
          Phones and emails this dealership must not contact: a phone covers calls and texts, an email covers email. Customers
          who reply STOP are handled automatically and don&apos;t need to be added here.
        </p>
        {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
        {data?.can_edit && (
          <Form onSubmit={add} className="mb-3">
            <InputGroup size="sm">
              <Form.Select style={{ maxWidth: 110 }} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Phone or email">
                <option value="phone">Phone</option><option value="email">Email</option>
              </Form.Select>
              <Form.Control placeholder={form.kind === "phone" ? "10-digit phone" : "email@example.com"} value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} aria-label="Phone or email to add" />
              <Form.Control placeholder="Reason (optional)" value={form.reason} maxLength={200}
                onChange={(e) => setForm({ ...form, reason: e.target.value })} aria-label="Reason" />
              <Button type="submit" variant="custom" disabled={busy || !form.value.trim()}>{busy ? <Spinner size="sm" /> : "Add"}</Button>
            </InputGroup>
          </Form>
        )}
        <Form.Control size="sm" className="mb-2" style={{ maxWidth: 260 }} placeholder="Search the list" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Search the list" />
        {!data ? <div className="text-center py-3"><Spinner size="sm" /></div> : (
          <div className="table-responsive">
            <Table size="sm" className="small mb-0">
              <thead><tr><th>Phone / email</th><th>Covers</th><th>Reason</th><th>Added by</th><th>Added</th>{data.can_edit && <th />}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-break">{r.value}</td>
                    <td>{r.channel === "email" ? "Email" : "Calls and texts"}</td>
                    <td>{r.reason || "-"}</td>
                    <td>{r.added_by_name || (r.source === "import" ? "Import" : "-")}</td>
                    <td className="text-nowrap">{formatTimestamp(r.added_at)}</td>
                    {data.can_edit && <td className="text-end">
                      <Button size="sm" variant="link" className="p-0 text-danger" disabled={busy}
                        onClick={() => window.confirm(`Remove ${r.value} from the list?`) && send("DELETE", { id: r.id })}>Remove</Button></td>}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="text-center text-muted py-3">{q ? "Nothing matches." : "The list is empty."}</td></tr>}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
