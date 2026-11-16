"use client";
// One form, opened from the Forms Library (the user, 16 Nov 2026: "all the extracted empty fields enlisted on the side
// panel ... we will be able to see if it has extracted right or wrong ... and there must be a retry"): the form's
// preview (every blank boxed and numbered, with what fills it) beside the list of every blank found. Retry finds the
// blanks again with the bigger AI model; Undo puts the earlier blanks back.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Modal, Row, Spinner, Table } from "react-bootstrap";
import { formsGet, formsSend } from "./formsApi";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export default function FormPanel({ form, dealerId, canManage, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
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

  const retry = async (undo) => {
    if (!undo && !window.confirm("Find this form's blanks again with the bigger AI model? It can take a minute or two. "
      + "Undo puts the current blanks back.")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const d = await formsSend(`/api/forms/templates/${form.id}/ai`, "POST", { dealer_id: dealerId, undo: Boolean(undo) });
      setNotice(undo ? "The earlier blanks are back." : `Found again: ${d.template.blanks} blanks, ${d.template.auto_filled} filled from the customer's data.`);
      await load(); onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const t = detail?.template;
  const fields = detail?.fields || [];
  return (
    <Modal show onHide={onClose} size="xl" fullscreen="lg-down" scrollable>
      <Modal.Header closeButton>
        <Modal.Title as="h6">{form.name}{t ? <span className="text-muted fw-normal"> · {t.auto_filled} of {t.blanks} blanks filled automatically</span> : null}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2">{notice}</Alert>}
        {!detail ? <div className="text-center p-5"><Spinner animation="border" /></div> : (
          <Row className="g-3">
            <Col lg={7}>
              {pdfUrl && <iframe title="Form preview" src={pdfUrl} style={{ width: "100%", height: "75vh", border: "1px solid #dee2e6" }} />}
              <div className="text-muted mt-1">Each blank is boxed with its number: <span style={{ color: "#1a59d9" }}>blue</span> = filled
                from the customer&apos;s data, <span style={{ color: "#e6801a" }}>orange</span> = left for the person.</div>
            </Col>
            <Col lg={5}>
              <div className="d-flex align-items-center mb-2 gap-2 flex-wrap">
                <strong className="me-auto">Blanks found ({fields.length})</strong>
                {canManage && t?.can_undo_ai && <Button size="sm" variant="outline-custom" disabled={busy} onClick={() => retry(true)}>Undo retry</Button>}
                {canManage && <Button size="sm" variant="custom" disabled={busy} onClick={() => retry(false)}>
                  {busy ? <><Spinner size="sm" /> Retrying...</> : "Retry"}</Button>}
              </div>
              {!fields.length ? <Alert variant="light" className="border">No blanks found. Click Retry.</Alert> : (
                <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                  <Table size="sm" className="mb-0 align-middle">
                    <thead><tr><th>#</th><th>Blank on the form</th><th>Filled with</th></tr></thead>
                    <tbody>
                      {fields.map((f) => (
                        <tr key={f.n}>
                          <td className="text-muted">{f.n}</td>
                          <td>{f.label || "(no label)"}<div className="text-muted">{t.pages > 1 ? `p.${f.page} · ` : ""}{f.kind}</div></td>
                          <td>{f.fills_with ? <Badge bg="primary" className="fw-normal text-wrap text-start">{f.fills_with}</Badge>
                            : <span className="text-muted">left blank</span>}</td>
                        </tr>
                      ))}
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
