"use client";
// "Get value" on a trade-in (Betsy, 19 Nov 2026): Vehicle Databases' trade-in / private party / dealer retail values
// by condition, for dealers whose super admin chose "AutoPulse value" (AI Settings > Trade-in values). Hidden for a
// dealer that uses its own link. Shows the values; it doesn't change the trade-in (staff type the offer themselves).
import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { aiFetch, formatDateTime } from "../../../ai/components/aiShared";
import { formatCurrency } from "../../../../utils/formatCurrency";

const CONDITIONS = ["Outstanding", "Clean", "Average", "Rough"];
let sourceCache = null; // one read per page: the dealer's switch

export default function TradeValueButton({ tradeIn, dealerId }) {
  const [source, setSource] = useState(sourceCache);
  const [show, setShow] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [trim, setTrim] = useState(0);

  useEffect(() => {
    if (sourceCache || !dealerId) return;
    aiFetch(`/api/dealer-ai/trade-value?dealer_id=${dealerId}`)
      .then((d) => { sourceCache = d.source; setSource(d.source); })
      .catch(() => setSource("dealer_link"));
  }, [dealerId]);

  if (source !== "autopulse") return null;

  const open = async () => {
    setShow(true); setBusy(true); setError(""); setData(null); setTrim(0);
    try {
      setData(await aiFetch("/api/dealer-ai/trade-value", { method: "POST",
        body: JSON.stringify({ trade_in_id: tradeIn._id, dealer_id: dealerId }) }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const values = data?.values;
  const row = values?.trims?.[trim];
  return (
    <>
      <Button variant="outline-custom" size="sm" onClick={open} title="Trade-in value from Vehicle Databases">
        <i className="fa-regular fa-sack-dollar me-1" />Get value
      </Button>
      <Modal show={show} onHide={() => setShow(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">Trade-in value: {[tradeIn.year, tradeIn.make, tradeIn.model].filter(Boolean).join(" ") || tradeIn.vin}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {busy && <div className="text-center py-3"><Spinner size="sm" /> Getting the value...</div>}
          {error && <Alert variant="warning" className="small">{error}</Alert>}
          {data?.status === "no_record" && <Alert variant="light" className="small">Vehicle Databases has no value for this vehicle.</Alert>}
          {values && (
            <>
              <p className="small text-muted mb-2">
                {[values.year, values.make, values.model].filter(Boolean).join(" ")} · {Number(data.mileage_used).toLocaleString()} miles · {data.state}
                {data.fetched_at && <> · as of {formatDateTime(data.fetched_at)}</>}
              </p>
              {values.trims.length > 1 && (
                <Form.Select size="sm" className="mb-2" value={trim} onChange={(e) => setTrim(Number(e.target.value))} aria-label="Trim">
                  {values.trims.map((t, i) => <option key={i} value={i}>{t.trim || `Trim ${i + 1}`}</option>)}
                </Form.Select>
              )}
              {row && (
                <Table size="sm" className="small mb-2">
                  <thead><tr><th>Condition</th><th>Trade-in</th><th>Private party</th><th>Dealer retail</th></tr></thead>
                  <tbody>
                    {CONDITIONS.filter((c) => row.by_condition?.[c]).map((c) => (
                      <tr key={c}><td>{c}{tradeIn.condition && tradeIn.condition.toLowerCase() === c.toLowerCase() ? " (this car)" : ""}</td>
                        {["trade_in", "private_party", "dealer_retail"].map((k) => (
                          <td key={k}>{row.by_condition[c][k] != null ? formatCurrency(row.by_condition[c][k]) : "-"}</td>
                        ))}</tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <p className="small text-muted mb-0">An estimate from Vehicle Databases; the final value comes from the dealership&apos;s inspection.</p>
            </>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
