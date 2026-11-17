"use client";
// One form, opened from the Forms Library: the form's preview (every blank boxed and numbered) beside the list of its
// blanks, each one correctable (the user, 16 Nov 2026: "parse once per form template, save the field map, and reuse
// it"; review screen: edit the label, the part of the form, what fills it, leave it for the person, nudge its place,
// delete a wrong one). Saved corrections go on the form and are reused whenever the same form is uploaded again.
// Signatures, initials, checkboxes and co-buyer blanks are never filled automatically (the server enforces it).
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from "react-bootstrap";
import { formsGet, formsSend } from "./formsApi";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const CONTEXT_NAMES = { buyer: "Buyer", co_buyer: "Co-buyer", dealer: "Dealer", trade_in: "Trade-in",
  vehicle_being_bought: "Vehicle bought" };
const NEVER_AUTO = ["signature", "initials", "checkbox"];

export default function FormPanel({ form, dealerId, canManage, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [edits, setEdits] = useState({}); // id -> { label?, context?, source?, fill_policy?, x?, y?, w?, delete? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, res] = await Promise.all([
        formsGet(`/api/forms/templates/${form.id}?dealer_id=${dealerId}`),
        fetch(`/api/forms/templates/${form.id}/preview?dealer_id=${dealerId}`, { headers: auth() }),
      ]);
      if (!res.ok) throw new Error(`Could not load the preview (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
      setDetail(d);
    } catch (e) { setError(e.message); }
  }, [form.id, dealerId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const edit = (id, patch) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const value = (f, k) => (edits[f.id]?.[k] !== undefined ? edits[f.id][k] : f[k]);
  const changed = Object.keys(edits).length;

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const fields = Object.entries(edits).map(([id, c]) => ({ id, ...c }));
      await formsSend(`/api/forms/templates/${form.id}`, "PATCH", { dealer_id: dealerId, fields });
      setEdits({});
      setNotice(`${fields.length} blank(s) saved. The same form uploaded again gets these corrections.`);
      await load(); onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const t = detail?.template;
  const fields = detail?.fields || [];
  const sources = detail?.sources || [];
  return (
    <Modal show onHide={onClose} size="xl" fullscreen="lg-down" scrollable>
      <Modal.Header closeButton>
        <Modal.Title as="h6">{form.name}{t ? <span className="text-muted fw-normal"> · {t.auto_filled} of {t.blanks} blanks filled automatically</span> : null}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2">{notice}</Alert>}
        {detail?.reused_from && <Alert variant="info" className="py-2">This form was set up before: its blanks and corrections were reused, nothing was read again.</Alert>}
        {!detail ? <div className="text-center p-5"><Spinner animation="border" /></div> : (
          <Row className="g-3">
            <Col lg={6}>
              {pdfUrl && <iframe title="Form preview" src={pdfUrl} style={{ width: "100%", height: "75vh", border: "1px solid #dee2e6" }} />}
              <div className="text-muted mt-1">Each blank is boxed with its number: <span style={{ color: "#1a59d9" }}>blue</span> = filled
                from the customer&apos;s data, <span style={{ color: "#e6801a" }}>orange</span> = left for the person. The preview
                updates after Save.</div>
            </Col>
            <Col lg={6}>
              <div className="d-flex align-items-center mb-2 gap-2 flex-wrap">
                <strong className="me-auto">Blanks ({fields.length})</strong>
                {canManage && changed > 0 && <>
                  <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setEdits({})}>Discard</Button>
                  <Button size="sm" variant="custom" disabled={busy} onClick={save}>{busy ? <Spinner size="sm" /> : `Save ${changed} change(s)`}</Button>
                </>}
              </div>
              {!fields.length ? <Alert variant="light" className="border">No blanks on this form.</Alert> : (
                <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                  <Table size="sm" className="mb-0 align-middle">
                    <thead><tr><th>#</th><th>Blank</th><th>Filled with</th>{canManage && <th />}</tr></thead>
                    <tbody>
                      {fields.map((f) => {
                        const gone = edits[f.id]?.delete;
                        const never = NEVER_AUTO.includes(f.field_type) || value(f, "context") === "co_buyer";
                        const person = value(f, "fill_policy") === "person" || !value(f, "source");
                        return (
                          <tr key={f.id} style={gone ? { opacity: 0.4, textDecoration: "line-through" } : undefined}>
                            <td className="text-muted">{f.n}</td>
                            <td style={{ minWidth: 170 }}>
                              {canManage ? <Form.Control size="sm" value={value(f, "label") || ""} disabled={gone}
                                onChange={(e) => edit(f.id, { label: e.target.value })} aria-label={`Label of blank ${f.n}`} />
                                : (f.label || "(no label)")}
                              <div className="text-muted d-flex flex-wrap gap-1 align-items-center mt-1">
                                {t.pages > 1 && <span>p.{f.page}</span>}<span>{f.kind}</span><span>· {f.field_type}</span>
                                {f.confidence != null && f.confidence < 0.7 && !f.corrected && <Badge bg="warning" text="dark">check</Badge>}
                                {f.corrected && <Badge bg="light" text="dark">corrected</Badge>}
                              </div>
                              {canManage && (
                                <div className="d-flex gap-1 mt-1">
                                  <Form.Select size="sm" value={value(f, "context")} disabled={gone} aria-label="Part of the form"
                                    onChange={(e) => edit(f.id, { context: e.target.value })}>
                                    {(detail.contexts || []).map((c) => <option key={c} value={c}>{CONTEXT_NAMES[c] || c}</option>)}
                                  </Form.Select>
                                  {[["x", "Left"], ["y", "Up"], ["w", "Width"]].map(([k, l]) => (
                                    <Form.Control key={k} size="sm" type="number" step="1" style={{ maxWidth: 74 }} title={`${l} (points)`}
                                      aria-label={`${l} of blank ${f.n}`} disabled={gone} value={Math.round(value(f, k) ?? 0)}
                                      onChange={(e) => edit(f.id, { [k]: Number(e.target.value) })} />
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={{ minWidth: 170 }}>
                              {canManage && !never ? (
                                <>
                                  <Form.Select size="sm" value={value(f, "source") || ""} disabled={gone} aria-label="Filled with"
                                    onChange={(e) => edit(f.id, { source: e.target.value || null, fill_policy: e.target.value ? "automatic" : "person" })}>
                                    <option value="">Left for the person</option>
                                    {sources.map((x) => <option key={x.key} value={x.key}>{x.label}{x.sensitive ? " (managers)" : ""}</option>)}
                                  </Form.Select>
                                  {value(f, "source") && (
                                    <Form.Check type="switch" className="mt-1" id={`person-${f.id}`} label="Leave for the person"
                                      checked={value(f, "fill_policy") === "person"} disabled={gone}
                                      onChange={(e) => edit(f.id, { fill_policy: e.target.checked ? "person" : "automatic" })} />
                                  )}
                                </>
                              ) : person ? <span className="text-muted">left for the person{never ? " (never automatic)" : ""}</span>
                                : <Badge bg="primary" className="fw-normal text-wrap text-start">{f.fills_with}</Badge>}
                            </td>
                            {canManage && (
                              <td>
                                <Button size="sm" variant="link" className={`p-0 ${gone ? "" : "text-danger"}`}
                                  title={gone ? "Keep this blank" : "Delete this blank (not a real blank)"}
                                  onClick={() => (gone ? setEdits((e) => { const n = { ...e }; delete n[f.id]; return n; }) : edit(f.id, { delete: true }))}>
                                  <i className={`fa-solid ${gone ? "fa-rotate-left" : "fa-trash"}`} /></Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              )}
            </Col>
          </Row>
        )}
      </Modal.Body>
    </Modal>
  );
}
