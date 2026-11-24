"use client";
// Leads > Actions > Bulk history (SOW Deliverable B b5: bulk "audit trail"; the user's design of 24 Nov 2026): every
// bulk change - when, who, what, how many, result - with filters in the Leads filters' style, each change's leads
// (before -> after, why one failed) and Undo for reassignments. Data: /api/leads/bulk-history.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Col, Form, ListGroup, Modal, Offcanvas, Row, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import { formatTimestamp } from "../../../utils/dateUtils";
import { statusLabel } from "@lib/statusLabels";
import { ListPages, SkeletonRows } from "../components/BulkAssign";
import DateRangePickerComponent from "../../components/DateRangePicker";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const changeText = (r) => ({
  reassign: `Reassign → ${r.to_label || "Unassigned"}`,
  status: `Status → ${statusLabel(r.to_label) || r.to_label}`,
  department: `Department → ${r.to_label}`,
  lead_source: `Lead source → ${r.to_label || "None"}`,
  campaign: `Campaign → ${r.to_label || "None"}`,
  note: `Note: "${r.to_label || ""}"`,
  task: `Call task: "${r.to_label || ""}"`,
}[r.action] || r.action);
const EMPTY = { q: "", by: "", action: "", result: "", dateRange: { startDate: null, endDate: null } };

export default function BulkHistoryPage() {
  const router = useRouter();
  const { user, dealerParent } = useUser();
  const dealerId = (dealerParent || user)?.id;
  const timezone = (dealerParent || user)?.dealer_account_information?.time_zone || "America/New_York";
  const canAssign = useCan("Assign Leads");
  const [inputs, setInputs] = useState(EMPTY);
  const [applied, setApplied] = useState(inputs);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // { row, items, pagination }
  const [openPage, setOpenPage] = useState(1);
  const [confirmUndo, setConfirmUndo] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setLoading(true); setError(null);
    const q = new URLSearchParams({ dealer_id: dealerId, page: String(page), limit: "10" });
    if (applied.q) q.set("q", applied.q);
    // The app's own date range picker (dealer-local days), as on the Leads list.
    if (applied.dateRange?.startDate) q.set("from", applied.dateRange.startDate.toISOString());
    if (applied.dateRange?.endDate) q.set("to", applied.dateRange.endDate.toISOString());
    if (applied.by) q.set("by", applied.by);
    if (applied.action) q.set("action", applied.action);
    if (applied.result) q.set("result", applied.result);
    try {
      const res = await fetch(`/api/leads/bulk-history?${q}`, { headers: auth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || body.message || "Could not load the bulk history");
      setData(body);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [dealerId, page, applied]);
  useEffect(() => { load(); }, [load]);

  const openRow = useCallback(async (row, p = 1) => {
    setOpenPage(p);
    setOpen({ row, items: null, pagination: null }); // skeleton while it loads
    try {
      const res = await fetch(`/api/leads/bulk-history?dealer_id=${dealerId}&id=${row._id}&page=${p}&limit=25`, { headers: auth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not open this change");
      setOpen(body);
    } catch (e) { setError(e.message); }
  }, [dealerId]);

  const undo = async (row) => {
    setConfirmUndo(null);
    try {
      const res = await fetch(`/api/leads/bulk-history/${row._id}/undo`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not undo");
      setNotice({ variant: "success", text: `Undone: ${body.restored} back to their earlier owner${body.changed_since ? `, ${body.changed_since} changed since (left alone)` : ""}${body.failed ? `, ${body.failed} failed` : ""}.` });
      load();
    } catch (e) { setNotice({ variant: "danger", text: e.message }); }
  };

  const search = () => { setPage(1); setApplied(inputs); };
  const clear = () => { setInputs(EMPTY); setPage(1); setApplied(EMPTY); };
  const set = (key) => (e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }));
  const rows = data?.rows || [];

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="d-flex align-items-center">
          <Button variant="secondary" size="sm" className="me-2" onClick={() => router.push("/dealer/leads")} aria-label="Back to Leads">
            <i className="fa-solid fa-arrow-left"></i>
          </Button>
          <h3 className="page_title mb-0">Bulk history</h3>
        </div>
      </div>
      <div className="page_body">
        {notice && <Alert variant={notice.variant} dismissible onClose={() => setNotice(null)}>{notice.text}</Alert>}
        {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
        <div className="w_card">
          <Row className="search_filters gx-1 gy-1">
            <Col xl={3} md={6} xs={12}>
              <Form.Control size="sm" placeholder="Lead name, phone or email" value={inputs.q} onChange={set("q")}
                onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
            </Col>
            <Col xl={2} md={6} xs={6}>
              <DateRangePickerComponent dateRange={inputs.dateRange} timezone={timezone} className="w-100"
                onDateRangeChange={({ startDate, endDate }) => setInputs((prev) => ({ ...prev, dateRange: { startDate, endDate } }))} />
            </Col>
            <Col xl={2} md={4} xs={6}>
              <Form.Select size="sm" value={inputs.by} onChange={set("by")} aria-label="Done by">
                <option value="">Done by: anyone</option>
                {(data?.people || []).map((p) => <option key={p} value={p}>{p}</option>)}
              </Form.Select>
            </Col>
            <Col xl={2} md={4} xs={6}>
              <Form.Select size="sm" value={inputs.action} onChange={set("action")} aria-label="Change">
                <option value="">All changes</option>
                <option value="reassign">Reassign</option>
                <option value="status">Status</option>
                <option value="department">Department</option>
                <option value="lead_source">Lead source</option>
                <option value="campaign">Campaign</option>
                <option value="note">Note</option>
                <option value="task">Call task</option>
              </Form.Select>
            </Col>
            <Col xl={2} md={4} xs={6}>
              <Form.Select size="sm" value={inputs.result} onChange={set("result")} aria-label="Result">
                <option value="">All results</option>
                <option value="done">Done, nothing failed</option>
                <option value="failed">With failures</option>
                <option value="undone">Undone</option>
              </Form.Select>
            </Col>
            <Col xl="auto" md={4} xs={12}>
              <div className="d-flex gap-1">
                <Button variant="custom" size="sm" onClick={search}>Search</Button>
                <Button variant="secondary" size="sm" onClick={clear}>Clear</Button>
              </div>
            </Col>
          </Row>

          <div className="w_card_list mt-3">
            <ListGroup as="ul" variant="flush">
              <ListGroup.Item as="li" className="w_card_list_head border-bottom-0">
                <Row className="align-items-center w-100 g-0">
                  <Col xs={2}><p className="label"><small>When</small></p></Col>
                  <Col xs={2}><p className="label"><small>Who</small></p></Col>
                  <Col xs={3}><p className="label"><small>Change</small></p></Col>
                  <Col xs={1}><p className="label"><small>Leads</small></p></Col>
                  <Col xs={3}><p className="label"><small>Result</small></p></Col>
                  <Col xs={1}><p className="p_bold text-center"><small>Action</small></p></Col>
                </Row>
              </ListGroup.Item>
              {loading ? (
                <div className="py-3 px-2"><SkeletonRows rows={6} cols={5} /></div>
              ) : rows.length ? rows.map((r) => (
                <ListGroup.Item as="li" key={r._id} className="w_card_list_box d-flex align-items-center"
                  style={r.undone_at ? { borderLeftColor: "var(--secondary3)" } : undefined}>
                  <Row className={`align-items-center w-100 g-0${r.undone_at ? " text-muted" : ""}`}>
                    <Col xs={2}><p>{formatTimestamp(r.at, timezone)}</p></Col>
                    <Col xs={2}><p className="text-truncate">{r.by_name || "—"}</p></Col>
                    <Col xs={3}><p className="text-truncate">{changeText(r)}</p></Col>
                    <Col xs={1}><p>{r.leads.toLocaleString()}</p></Col>
                    <Col xs={3}>
                      <p className="text-truncate">
                        {r.undone_at ? `Undone ${formatTimestamp(r.undone_at, timezone)}${r.undone_by_name ? ` by ${r.undone_by_name}` : ""}` : (
                          <>
                            <span className="text-success">{r.updated} done</span>
                            {r.unchanged ? ` · ${r.unchanged} unchanged` : ""}
                            {r.failed ? <> · <span className="text-danger">{r.failed} failed</span></> : null}
                          </>
                        )}
                      </p>
                    </Col>
                    <Col xs={1}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button variant="custom" size="sm" title="See each lead" aria-label="See each lead" onClick={() => openRow(r)}>
                          <i className="fa-regular fa-eye"></i>
                        </Button>
                        {r.can_undo && canAssign && (
                          <Button variant="outline-custom" size="sm" title="Undo" aria-label="Undo" onClick={() => setConfirmUndo(r)}>
                            <i className="fa-solid fa-rotate-left"></i>
                          </Button>
                        )}
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              )) : (
                <div className="text-center py-4">No bulk changes found.</div>
              )}
            </ListGroup>
            <div className="d-md-flex justify-content-center mt-3">
              <ListPages current={page} total={data?.pagination?.totalPages || 1} onPage={setPage} />
            </div>
          </div>
        </div>
      </div>

      <Offcanvas show={Boolean(open)} onHide={() => setOpen(null)} placement="end" className="bulk_panel">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{open ? changeText(open.row) : ""}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {open && (
            <>
              <p className="text-muted small mb-2">
                {formatTimestamp(open.row.at, timezone)} · {open.row.by_name || "—"}
                {open.row.undone_at ? <> · <Badge bg="secondary">Undone</Badge></> : null}
              </p>
              {!open.items ? <SkeletonRows rows={8} /> : (
              <Table size="sm" className="small mb-2">
                <thead><tr><th>Lead</th><th>Before</th><th>Result</th></tr></thead>
                <tbody>
                  {open.items.map((i) => (
                    <tr key={String(i.lead_id)}>
                      <td>{i.name || "N/A"}</td>
                      <td>{open.row.action === "status" ? (statusLabel(i.from_label) || "No status") : (i.from_label || "—")}</td>
                      <td className={i.result === "failed" ? "text-danger" : i.result === "updated" ? "text-success" : "text-muted"}>
                        {i.result === "updated" ? "Changed" : i.result === "unchanged" ? "Already so" : `Failed: ${i.reason || ""}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              )}
              <ListPages current={openPage} total={open.pagination?.totalPages || 1} onPage={(p) => openRow(open.row, p)} size="sm" />
            </>
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <Modal show={Boolean(confirmUndo)} onHide={() => setConfirmUndo(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h5">Undo this reassignment?</Modal.Title></Modal.Header>
        <Modal.Body>
          {confirmUndo && `${confirmUndo.updated} leads go back to the owner each had before. A lead someone changed since is left alone.`}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setConfirmUndo(null)}>Cancel</Button>
          <Button variant="custom" size="sm" onClick={() => undo(confirmUndo)}>Undo</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
