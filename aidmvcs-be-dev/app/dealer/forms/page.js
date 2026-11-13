"use client";
// Forms Library (SOW v6 Deliverable K, gap G-064; the user, 13 Nov 2026): the dealership's forms as on-screen forms -
// buyer's order, trade-in appraisal, test drive, credit application, We Owe, delivery checklist, privacy... A new form
// is read from the dealer's PDF (or started blank) and opens in the form builder ([id]/page.js) to check and edit.
// Staff fill the forms from a customer's Documents tab.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { formsGet, formsSend } from "./formsApi";

export default function FormsLibraryPage() {
  const { dealerParent, loadingParent } = useUser();
  const router = useRouter();
  const dealerId = dealerParent?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [upload, setUpload] = useState(null); // { name, category, file }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!dealerId) return;
    try { setData(await formsGet(`/api/forms/templates?dealer_id=${dealerId}`)); setError(null); }
    catch (e) { setError(e.message); }
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}" from the Forms Library? Staff won't be able to start it any more. Forms `
      + "already filled for customers are kept as they are.")) return;
    setError(null);
    try { await formsSend(`/api/forms/templates/${t.id}?dealer_id=${dealerId}`, "DELETE"); await load(); }
    catch (e) { setError(e.message); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("dealer_id", dealerId); fd.set("name", upload.name); fd.set("category", upload.category);
      if (upload.file) fd.set("file", upload.file); else fd.set("blank", "true");
      const { template } = await formsSend("/api/forms/templates", "POST", fd);
      router.push(`/dealer/forms/${template.id}`);
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
            <i className="fa-solid fa-plus me-1" />New form
          </Button>
        )}
      </div>
      <div className="page_body">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <p className="small text-muted">
          Your dealership&apos;s forms. Build one from scratch with titles, text, blanks, fields, checkboxes and
          choices - or upload the PDF you use today and the AI turns it into an editable first draft for you to check.
          Staff fill forms from a customer&apos;s <strong>Documents</strong> tab: what the CRM knows is already in, they
          complete the rest, and it downloads or prints as a PDF. The legal wording is yours.
        </p>
        {data && !data.templates.length ? (
          <Alert variant="light" className="border">No forms yet.{data.can_manage ? " Click New form." : ""}</Alert>
        ) : data && (
          <div className="w_card p-0">
            <Table hover responsive className="mb-0 small align-middle">
              <thead><tr><th>Form</th><th>Category</th><th>Fields</th><th>Version</th>
                <th>Who / when</th><th>Status</th>{data.can_manage && <th aria-label="Delete" />}</tr></thead>
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.id} role="button" onClick={() => router.push(`/dealer/forms/${t.id}`)}>
                    <td className="fw-semibold">{t.name}</td>
                    <td>{t.category}</td>
                    <td>{t.ready ? t.fields : <span className="text-danger">Old upload - open and read the PDF again</span>}</td>
                    <td>v{t.current_version}</td>
                    <td className="text-muted">
                      {t.departments.length ? t.departments.join(", ") : "Sales & service"} ·{" "}
                      {t.role_ids.length ? `${t.role_ids.length} role(s)` : "all roles"} ·{" "}
                      {t.statuses.length ? `${t.statuses.length} status(es)` : "any status"}
                    </td>
                    <td>{t.active ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>}</td>
                    {data.can_manage && (
                      <td className="text-end">
                        <Button size="sm" variant="link" className="text-danger p-0" title="Delete form" aria-label="Delete form"
                          onClick={(e) => { e.stopPropagation(); remove(t); }}><i className="fa-regular fa-trash-can" /></Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      <Modal show={!!upload} onHide={() => setUpload(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">New form</Modal.Title></Modal.Header>
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
              <Form.Group><Form.Label className="small mb-0">Your PDF of the form (up to 15 MB) - the AI drafts it for you. Leave empty to build it from scratch</Form.Label>
                <Form.Control size="sm" type="file" accept="application/pdf"
                  onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} /></Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setUpload(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy || !upload?.name.trim()} onClick={save}>
            {busy ? <><Spinner size="sm" /> {upload?.file ? "Reading the PDF (up to a minute)..." : ""}</> : upload?.file ? "Draft it from the PDF" : "Start building"}
          </Button>
        </Modal.Footer>
      </Modal>

    </div>
  );
}
