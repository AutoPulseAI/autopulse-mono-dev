"use client";
// Forms & Documents Library (SOW v6 Deliverable K, gap G-064): the dealership's own PDFs - buyer's order, trade-in
// appraisal, test drive, credit application, We Owe, delivery checklist, privacy... Upload, name, categorize, switch
// on / off, replace with a new version, say who can use each one and when, and map what fills each field
// (components/TemplateEditor.js). Staff fill the forms from a customer's Documents tab.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { formsGet, formsSend } from "./formsApi";
import TemplateEditor from "./components/TemplateEditor";

export default function FormsLibraryPage() {
  const { dealerParent, loadingParent } = useUser();
  const dealerId = dealerParent?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [upload, setUpload] = useState(null); // { name, category, file }
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // template id

  const load = useCallback(async () => {
    if (!dealerId) return;
    try { setData(await formsGet(`/api/forms/templates?dealer_id=${dealerId}`)); setError(null); }
    catch (e) { setError(e.message); }
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("dealer_id", dealerId); fd.set("name", upload.name); fd.set("category", upload.category);
      fd.set("file", upload.file);
      const { template } = await formsSend("/api/forms/templates", "POST", fd);
      setUpload(null); await load(); setOpen(template.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (loadingParent || (!data && !error)) {
    return <div className="page_content d-flex justify-content-center p-5"><Spinner animation="border" /></div>;
  }

  return (
    <div className="page_content">
      <div className="page_head d-flex align-items-center">
        <h3 className="page_title mb-0 me-auto">Forms Library</h3>
        {data?.can_manage && (
          <Button variant="custom" size="sm" onClick={() => setUpload({ name: "", category: "Other", file: null })}>
            <i className="fa-solid fa-upload me-1" />Upload a form
          </Button>
        )}
      </div>
      <div className="page_body">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <p className="small text-muted">
          Your dealership&apos;s own PDF forms. AutoPulse fills them in from the customer, the lead, the vehicle and
          the trade-ins - it never makes up a value - and keeps every filled copy on the customer. The forms&apos;
          legal wording is yours. Fill a form from a customer&apos;s <strong>Documents</strong> tab.
        </p>
        {data && !data.templates.length ? (
          <Alert variant="light" className="border">No forms yet.{data.can_manage ? " Upload your first PDF." : ""}</Alert>
        ) : data && (
          <div className="w_card p-0">
            <Table hover responsive className="mb-0 small align-middle">
              <thead><tr><th>Form</th><th>Category</th><th>Type</th><th>Version</th><th>Fields mapped</th>
                <th>Who / when</th><th>Status</th></tr></thead>
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.id} role="button" onClick={() => setOpen(t.id)}>
                    <td className="fw-semibold">{t.name}</td>
                    <td>{t.category}</td>
                    <td>{t.fillable ? "Fillable PDF" : "Flat PDF"}</td>
                    <td>v{t.current_version}{t.versions > 1 ? ` (${t.versions} uploads)` : ""}</td>
                    <td>{t.mapped ? `${t.mapped}${t.required ? ` (${t.required} required)` : ""}` : <span className="text-danger">Not mapped yet</span>}</td>
                    <td className="text-muted">
                      {t.departments.length ? t.departments.join(", ") : "Sales & service"} ·{" "}
                      {t.role_ids.length ? `${t.role_ids.length} role(s)` : "all roles"} ·{" "}
                      {t.statuses.length ? `${t.statuses.length} status(es)` : "any status"}
                    </td>
                    <td>{t.active ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>}</td>
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
              <Form.Group className="mb-2"><Form.Label className="small mb-0">Name</Form.Label>
                <Form.Control size="sm" value={upload.name} maxLength={120} placeholder="e.g. Buyer's Order"
                  onChange={(e) => setUpload({ ...upload, name: e.target.value })} /></Form.Group>
              <Form.Group className="mb-2"><Form.Label className="small mb-0">Category</Form.Label>
                <Form.Select size="sm" value={upload.category} onChange={(e) => setUpload({ ...upload, category: e.target.value })}>
                  {(data?.categories || []).map((c) => <option key={c}>{c}</option>)}
                </Form.Select></Form.Group>
              <Form.Group><Form.Label className="small mb-0">PDF (fillable or not, up to 15 MB)</Form.Label>
                <Form.Control size="sm" type="file" accept="application/pdf"
                  onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} /></Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setUpload(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy || !upload?.name.trim() || !upload?.file} onClick={save}>
            {busy ? <Spinner size="sm" /> : "Upload"}
          </Button>
        </Modal.Footer>
      </Modal>

      {open && (
        <TemplateEditor dealerId={dealerId} id={open} canManage={data?.can_manage}
          categories={data?.categories || []} onHide={() => { setOpen(null); load(); }} />
      )}
    </div>
  );
}
