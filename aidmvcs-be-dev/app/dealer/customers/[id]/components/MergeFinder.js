"use client";
// The profile's Merge button (Bibi, 26 Nov 2026: "when you click on it it will pull up all potential matching
// customers and dealer will have to select which one they want to merge and what they want to keep"). Lists the
// customers with the same phone, email or full name (app/lib/duplicateCustomers.js mergeCandidates); the search box
// finds any other customer. "Merge…" opens the same merge review as Customers > Possible duplicates.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import MergeReview from "../../components/MergeReview";

export default function MergeFinder({ show, customerId, dealerId, onHide, onMerged }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pair, setPair] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (!show || !customerId || !dealerId) return;
    let live = true;
    setData(null); setError(null);
    const params = new URLSearchParams({ dealer_id: dealerId, customer_id: customerId, for: "merge" });
    if (search) params.set("q", search);
    fetch(`/api/customers/duplicates?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` } })
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || "Could not load the matches"); return b; })
      .then((b) => { if (live) setData(b); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [show, customerId, dealerId, search, reload]);

  const close = () => { setQ(""); setSearch(""); onHide?.(); };

  return (
    <>
      <Modal show={show && !pair} onHide={close} size="lg" centered>
        <Modal.Header closeButton><Modal.Title as="h5"><i className="fa-duotone fa-code-merge me-2" />Merge customer</Modal.Title></Modal.Header>
        <Modal.Body className="small">
          <p className="text-muted mb-2">Customers that may be the same person: the same phone, email or full name. Pick one to
            merge, then choose which customer and which details to keep. Nothing merges until you confirm, and it can be undone.</p>
          <Form.Control size="sm" className="mb-2" placeholder="Find another customer by name, phone or email" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Find a customer to merge" />
          {error && <Alert variant="danger" className="py-2">{error}</Alert>}
          {!data && !error && <div className="text-center py-3"><Spinner size="sm" /></div>}
          {data && data.matches.length === 0 && (
            <div className="text-muted py-2">{search ? "No customer found." : "No potential matches. Search above to find another customer."}</div>
          )}
          {data && data.matches.length > 0 && (
            <div className="table-responsive">
              <Table size="sm" hover className="align-middle mb-0">
                <thead><tr><th>Customer</th><th>Phones</th><th>Emails</th><th>Leads</th><th>Matches on</th><th /></tr></thead>
                <tbody>
                  {data.matches.map((m) => (
                    <tr key={m._id}>
                      <td>{m.name || "(no name)"}{m.dealership_history && <Badge bg="warning" text="dark" className="ms-1">Sales / service</Badge>}</td>
                      <td>{m.phones.join(", ") || "-"}</td>
                      <td className="text-break">{m.emails.join(", ") || "-"}</td>
                      <td>{m.leads}</td>
                      <td>{m.shared?.length ? m.shared.map((s) => <Badge key={s} bg="light" text="dark" className="me-1">{s}</Badge>) : <span className="text-muted">Search</span>}</td>
                      <td className="text-end"><Button size="sm" variant="custom" onClick={() => setPair([data.me, m])}>Merge…</Button></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Modal.Body>
      </Modal>
      <MergeReview customers={pair} keep={pair?.[0]?._id} dealerId={dealerId} onHide={() => setPair(null)}
        onDone={({ merged, keep_id: keepId } = {}) => {
          setPair(null);
          if (!merged) { setReload((n) => n + 1); return; } // "Not the same person": that one leaves the list
          close();
          // This customer merged into the other one: open the kept customer; otherwise reload this profile.
          if (keepId && String(keepId) !== String(customerId)) router.push(`/dealer/customers/${keepId}`);
          else onMerged?.();
        }} />
    </>
  );
}
