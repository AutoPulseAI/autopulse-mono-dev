"use client";
// Forms Library (SOW v6 Deliverable K; the user, 16 Nov 2026 after the client meeting): the dealership uploads its own
// PDF forms (or a JPG / PNG of a paper form); nothing to build or map by hand. Each form's blanks are found and matched
// to customer data on upload (lib/forms/read.js; a scan's blanks by the AI, then the form waits, switched off, for a
// check of its Preview). Staff export any customer into any form from the customer's profile ("Export to form").
// Here: upload, rename, switch on / off, upload a new version, delete, see which blanks get filled, Preview where they
// go, and "Find blanks with AI" (with Undo) for a form whose blanks were missed.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { formsGet, formsSend, openPdf } from "./formsApi";

const ACCEPT = "application/pdf,image/jpeg,image/png";
const AI_NOTE = " The AI found its blanks, so it is switched off: click Preview to check where each value goes, then Switch on.";

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
    setNotice(`"${template.name}" uploaded: ${template.blanks} blanks found, ${template.auto_filled} filled from the customer's data.`
      + (template.found_by_ai ? AI_NOTE : ""));
  });
  const newVersion = (t, file) => run(async () => {
    const fd = new FormData(); fd.set("dealer_id", dealerId); fd.set("file", file);
    const d = await formsSend(`/api/forms/templates/${t.id}`, "POST", fd);
    setNotice(`New version of "${t.name}" uploaded.${d.template?.found_by_ai ? AI_NOTE : ""}`);
  });
  const findWithAi = (t, undo) => {
    if (!undo && !window.confirm(`Let the AI find the blanks of "${t.name}"? Use this when blanks were missed. The form is `
      + "switched off until you check its Preview; Undo puts the current blanks back.")) return;
    run(async () => {
      const d = await formsSend(`/api/forms/templates/${t.id}/ai`, "POST", { dealer_id: dealerId, undo: Boolean(undo) });
      setNotice(undo ? `"${t.name}": the earlier blanks are back.`
        : `"${t.name}": the AI found ${d.template.blanks} blanks, ${d.template.auto_filled} filled from the customer's data.${AI_NOTE}`);
    });
  };
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
          Upload your dealership&apos;s forms as they are: a PDF, or a scan / photo of a paper form. The customer&apos;s
          name, contact details, address, vehicle, trade-in, salesperson and the date are filled into the right blanks
          automatically. <strong>Preview</strong> shows where each one goes. To use a form, open a customer and click
          {" "}<strong>Export to form</strong>.
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
                      onClick={() => showDetails(t)}>see which</Button>
                      {t.found_by_ai && <div><Badge bg="info" text="dark">Found by AI</Badge> <span className="text-muted">check Preview</span></div>}</>
                      : <span className="text-danger">Upload this form again</span>}</td>
                    <td>{t.active ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>}</td>
                    <td className="text-end text-nowrap">
                      <Button size="sm" variant="link" className="p-0 me-2"
                        onClick={() => run(() => openPdf(`/api/forms/templates/${t.id}/source?dealer_id=${dealerId}`))}>View</Button>
                      {t.ready && <Button size="sm" variant="link" className="p-0 me-2"
                        onClick={() => run(() => openPdf(`/api/forms/templates/${t.id}/preview?dealer_id=${dealerId}`))}>Preview</Button>}
                      {can && <>
                        <Button size="sm" variant="link" className="p-0 me-2" onClick={() => setRenaming({ id: t.id, name: t.name })}>Rename</Button>
                        <Button size="sm" variant="link" className="p-0 me-2" disabled={busy}
                          onClick={() => patch(t, { active: !t.active })}>{t.active ? "Switch off" : "Switch on"}</Button>
                        <label className="btn btn-link btn-sm p-0 me-2 mb-0">New version
                          <input type="file" accept={ACCEPT} hidden
                            onChange={(e) => { if (e.target.files?.[0]) newVersion(t, e.target.files[0]); e.target.value = ""; }} /></label>
                        <Button size="sm" variant="link" className="p-0 me-2" disabled={busy} onClick={() => findWithAi(t)}>Find blanks with AI</Button>
                        {t.can_undo_ai && <Button size="sm" variant="link" className="p-0 me-2" disabled={busy}
                          onClick={() => findWithAi(t, true)}>Undo AI</Button>}
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
              <Form.Group className="mb-2"><Form.Label className="small mb-0">The form as you use it today: PDF, or a JPG / PNG
                scan or photo (up to 15 MB)</Form.Label>
                <Form.Control size="sm" type="file" accept={ACCEPT}
                  onChange={(e) => { const file = e.target.files?.[0] || null;
                    setUpload((u) => ({ file, name: u.name || (file?.name || "").replace(/\.(pdf|jpe?g|png)$/i, "") })); }} /></Form.Group>
              <Form.Text>A scan or photo is read by the AI; check its Preview before switching it on.</Form.Text>
              <Form.Group><Form.Label className="small mb-0">Name</Form.Label>
                <Form.Control size="sm" value={upload.name} maxLength={120} placeholder="e.g. Buyer's Order"
                  onChange={(e) => setUpload({ ...upload, name: e.target.value })} /></Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setUpload(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy || !upload?.file} onClick={doUpload}>
            {busy ? <><Spinner size="sm" /> Reading the form...</> : "Upload"}</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={!!details} onHide={() => setDetails(null)} centered scrollable>
        <Modal.Header closeButton><Modal.Title as="h6">{details?.t.name}: what goes in each blank</Modal.Title></Modal.Header>
        <Modal.Body className="small">
          <Table size="sm" className="mb-0">
            <thead><tr><th>Blank on the form</th><th>Filled with</th></tr></thead>
            <tbody>
              {(details?.fields || []).map((f, i) => (
                <tr key={i}><td>{f.label || "(no label)"}{details.template.pages > 1 ? <small className="text-muted"> · p.{f.page}</small> : null}
                  {f.found_by_ai ? <small className="text-muted"> · AI</small> : null}</td>
                  <td>{f.fills_with || <span className="text-muted">left blank (filled by hand)</span>}</td></tr>
              ))}
            </tbody>
          </Table>
        </Modal.Body>
      </Modal>
    </div>
  );
}
