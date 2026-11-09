"use client";
// The records behind one number (GET /api/reports/kpis?kpi=&rows=1 with the page's filters), and its CSV - the same
// call with format=csv, so the list, the CSV and the card show the same total.
import { useEffect, useState } from "react";
import { Alert, Button, Modal, Spinner, Table } from "react-bootstrap";
import { downloadCsv, reportsGet } from "../reportsApi";

const PAGE = 100;

export default function DrillDown({ target, params, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const [part, setPart] = useState("numerator");
  const [exporting, setExporting] = useState(false);

  const query = target ? { ...params, kpi: target.kpi.id, rows: 1, ...(target.by ? { by: target.by,
    group: target.group } : {}), ...(part === "denominator" ? { part } : {}) } : null;

  useEffect(() => { setPart("numerator"); }, [target]);
  useEffect(() => {
    if (!target) return;
    setData(null);
    setError(null);
    setShown(PAGE);
    reportsGet(query).then(setData).catch((e) => setError(e.message));
  }, [target, part]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;
  const { kpi } = target;
  const exportCsv = async () => {
    setExporting(true);
    try {
      const { rows, ...rest } = query; // eslint-disable-line no-unused-vars
      await downloadCsv(rest, `${kpi.id}_${params.start_date}_${params.end_date}.csv`);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal show onHide={onClose} size="xl" scrollable>
      <Modal.Header closeButton>
        <Modal.Title as="h5">
          {kpi.label}{target.by ? ` – ${target.group}` : ""}
          {data && <small className="text-muted ms-2">{data.count} record{data.count === 1 ? "" : "s"}</small>}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-secondary-light mb-2"><small>{kpi.definition?.numerator}</small></p>
        {kpi.kind === "rate" && !target.by && (
          <div className="mb-2">
            <Button size="sm" variant={part === "numerator" ? "dark" : "outline-dark"} className="me-2"
              onClick={() => setPart("numerator")}>Counted ({kpi.numerator?.count ?? 0})</Button>
            <Button size="sm" variant={part === "denominator" ? "dark" : "outline-dark"}
              onClick={() => setPart("denominator")}>Out of ({kpi.denominator?.count ?? 0})</Button>
          </div>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {!data && !error && <div className="text-center py-4"><Spinner animation="border" variant="dark" /></div>}
        {data && (data.rows.length ? (
          <div className="table-responsive">
            <Table size="sm" striped className="align-middle mb-0">
              <thead><tr>{data.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {data.rows.slice(0, shown).map((r) => (
                  <tr key={r.id}>
                    {data.columns.map((c) => (
                      <td key={c.key}>
                        {String(r[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            {data.rows.length > shown && (
              <Button size="sm" variant="link" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({data.rows.length - shown} left)
              </Button>
            )}
          </div>
        ) : <p className="text-muted mb-0">No records.</p>)}
      </Modal.Body>
      <Modal.Footer>
        <small className="text-muted me-auto">
          Same filters as the page{data?.ignored_filters?.length ? `; not filtered by ${data.ignored_filters.join(", ")}`
            : ""}.
        </small>
        <Button size="sm" variant="outline-dark" disabled={!data || exporting} onClick={exportCsv}>
          <i className="fa-regular fa-download me-1"></i>{exporting ? "Exporting…" : "Download CSV"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
