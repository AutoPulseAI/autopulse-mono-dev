"use client";
// Forms Library (SOW v6 Deliverable K; the user, 16 Nov 2026 after the client meeting): the dealership uploads its own
// PDF forms; nothing to build or map by hand. Each form's blanks are found and matched to customer data on upload
// (lib/forms/detect.js). Staff export any customer into any form from the customer's profile ("Export to form").
// Here: upload, rename, switch on / off, upload a new version, delete, and see which blanks get filled.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { formsGet, formsSend, openPdf } from "./formsApi";

export default function FormsLibraryPage() {
  const { dealerParent, loadingParent } = useUser();
  const dealerId = dealerParent?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [upload, setUpload] = useState(null); // { name, file }
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [details, setDetails] = useState(null); // GET detail of one form

  const load = useCallback(async () => {
    if (!dealerId) return;
    try { setData(await formsGet(`/api/forms/templates?dealer_id=${dealerId}`)); setError(null); }
    catch (e) { setError(e.message); }
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, done) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (done) setNotice(done); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const doUpload = () => run(async () => {
    const fd = new FormData();
    fd.set("dealer_id", dealerId); fd.set("name", upload.name); fd.set("file", upload.file);
    const { template } = await formsSend("/api/forms/templates", "POST", fd);
    setUpload(null);
    setNotice(`"${template.name}" uploaded: ${template.blanks} blanks found, ${template.auto_filled} filled from the customer's data.`);
  });
  const newVersion = (t, file) => run(async () => {
    const fd = new FormData(); fd.set("dealer_id", dealerId); fd.set("file", file);
    await formsSend(`/api/forms/templates/${t.id}`, "POST", fd);
  }, `New version of "${t.name}" uploaded.`);
  const patch = (t, body, done) => run(() => formsSend(`/api/forms/templates/${t.id}`, "PATCH", { dealer_id: dealerId, ...body }), done);
  const remove = (t) => {
    if (!window.confirm(`Delete "${t.name}"? It will no longer be offered on customer profiles.`)) return;
    run(() => formsSend(`/api/forms/templates/${t.id}?dealer_id=${dealerId}`, "DELETE"), `"${t.name}" deleted.`);
  };
  const showDetails = (t) => run(async () => setDetails({ t, ...(await formsGet(`/api/forms/templates/${t.id}?dealer_id=${dealerId}`)) }));

  if (loadingParent || (!data && !error)) {
    return <div className="page_content d-flex justify-content-center p-5"><Spinner animation="border" /></div>;
  }
  const can = data?.can_manage;

  return (
    <div className="page_content">
      <div className="page_head d-flex align-items-center">
        <h3 className="page_title mb-0 me-auto">Forms Library</h3>
        {can && <Button variant="custom" size="sm" onClick={() => setUpload({ name: "", file: null })}>
          <i className="fa-solid fa-upload me-1" />Upload a form</Button>}
      </div>
      <div className="page_body">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2">{notice}</Alert>}
        <p className="small text-muted">
          Upload your dealership&apos;s PDF forms as they are. The customer&apos;s name, contact details, address, vehicle,
          trade-in, salesperson and the date are filled into the right blanks automatically. To use a form, open a
          customer and click <strong>Export to form</strong>.
        </p>
        {data && !data.templates.length ? (
          <Alert variant="light" className="border">No forms yet.{can ? " Click Upload a form." : ""}</Alert>
        ) : data && (
          <div className="w_card p-0">
            <Table responsive className="mb-0 small align-middle">
              <thead><tr><th>Form</th><th>Blanks filled automatically</th><th>Status</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {renaming?.id === t.id ? (
                        <div className="d-flex gap-1">
                          <Form.Control size="sm" value={renaming.name} maxLength={120} autoFocus
                            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                          <Button size="sm" variant="custom" disabled={busy || !renaming.name.trim()}
                            onClick={() => { patch(t, { name: renaming.name }, "Renamed."); setRenaming(null); }}>Save</Button>
                          <Button size="sm" variant="link" onClick={() => setRenaming(null)}>Cancel</Button>
                        </div>
                      ) : <span className="fw-semibold">{t.name}</span>}
                      <div className="text-muted">{t.filename || ""}{t.current_version > 1 ? ` · version ${t.current_version}` : ""}</div>
                    </td>
                    <td>{t.ready ? <>{t.auto_filled} of {t.blanks} <Button size="sm" variant="link" className="p-0 ms-1"
                      onClick={() => showDetails(t)}>see which</Button></>
                      : <span className="text-danger">Upload this form again</span>}</td>
                    <td>{t.active ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>}</td>
                    <td className="text-end text-nowrap">
                      <Button size="sm" variant="link" className="p-0 me-2"
                        onClick={() => run(() => openPdf(`/api/forms/templates/${t.id}/source?dealer_id=${dealerId}`))}>View</Button>
                      {can && <>
                        <Button size="sm" variant="link" className="p-0 me-2" onClick={() => setRenaming({ id: t.id, name: t.name })}>Rename</Button>
                        <Button size="sm" variant="link" className="p-0 me-2" disabled={busy}
                          onClick={() => patch(t, { active: !t.active })}>{t.active ? "Switch off" : "Switch on"}</Button>
                        <label className="btn btn-link btn-sm p-0 me-2 mb-0">New version
                          <input type="file" accept="application/pdf" hidden
                            onChange={(e) => { if (e.target.files?.[0]) newVersion(t, e.target.files[0]); e.target.value = ""; }} /></label>
                        <Button size="sm" variant="link" className="p-0 text-danger" onClick={() => remove(t)}>Delete</Button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      <Modal show={!!upload} onHide={() => setUpload(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">Upload a form</Modal.Title></Modal.Header>
        <Modal.Body>
          {upload && (
            <>
              <Form.Group className="mb-2"><Form.Label className="small mb-0">PDF (as you use it today, up to 15 MB)</Form.Label>
                <Form.Control size="sm" type="file" accept="application/pdf"
                  onChange={(e) => { const file = e.target.files?.[0] || null;
                    setUpload((u) => ({ file, name: u.name || (file?.name || "").replace(/\.pdf$/i, "") })); }} /></Form.Group>
              <Form.Group><Form.Label className="small mb-0">Name</Form.Label>
                <Form.Control size="sm" value={upload.name} maxLength={120} placeholder="e.g. Buyer's Order"
                  onChange={(e) => setUpload({ ...upload, name: e.target.value })} /></Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setUpload(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy || !upload?.file} onClick={doUpload}>
            {busy ? <Spinner size="sm" /> : "Upload"}</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={!!details} onHide={() => setDetails(null)} centered scrollable>
        <Modal.Header closeButton><Modal.Title as="h6">{details?.t.name}: what goes in each blank</Modal.Title></Modal.Header>
        <Modal.Body className="small">
          <Table size="sm" className="mb-0">
            <thead><tr><th>Blank on the form</th><th>Filled with</th></tr></thead>
            <tbody>
              {(details?.fields || []).map((f, i) => (
                <tr key={i}><td>{f.label || "(no label)"}{details.template.pages > 1 ? <small className="text-muted"> · p.{f.page}</small> : null}</td>
                  <td>{f.fills_with || <span className="text-muted">left blank (filled by hand)</span>}</td></tr>
              ))}
            </tbody>
          </Table>
        </Modal.Body>
      </Modal>
    </div>
  );
}
