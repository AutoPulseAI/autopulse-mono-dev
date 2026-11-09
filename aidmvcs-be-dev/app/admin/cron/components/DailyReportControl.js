'use client';
// Daily performance email: per-dealer rollout switch, preview, resend and delivery log (/api/admin/daily-report).
// Super admin only (the API checks the admin sign-in cookie).
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Table } from 'react-bootstrap';

const API = '/api/admin/daily-report';
const MODE_HELP = {
  off: 'Off - nothing is sent',
  internal: 'Internal - only to our internal test addresses',
  live: "Live - to the dealer's report recipients",
};

export default function DailyReportControl() {
  const [dealers, setDealers] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const [date, setDate] = useState('');
  const [deliveries, setDeliveries] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadDealers = useCallback(async () => {
    try {
      const res = await fetch(`${API}?action=dealers`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || res.statusText);
      setDealers(data.dealers || []);
    } catch (e) {
      setMessage(`Error loading dealers: ${e.message}`);
    }
  }, []);

  const loadDeliveries = useCallback(async (dealerId) => {
    try {
      const qs = dealerId ? `&dealer_id=${encodeURIComponent(dealerId)}` : '';
      const res = await fetch(`${API}?action=deliveries&limit=50${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || res.statusText);
      setDeliveries(data.deliveries || []);
    } catch (e) {
      setMessage(`Error loading deliveries: ${e.message}`);
    }
  }, []);

  useEffect(() => { loadDealers(); loadDeliveries(''); }, [loadDealers, loadDeliveries]);

  const dealer = dealers.find((d) => d.dealer_id === selected) || null;
  useEffect(() => {
    if (dealer && !date) setDate(dealer.yesterday);
  }, [dealer, date]);

  const post = async (body) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || res.statusText);
      return data;
    } catch (e) {
      setMessage(`Error: ${e.message}`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (dealerId, mode) => {
    const d = dealers.find((x) => x.dealer_id === dealerId);
    if (mode === 'live' && !window.confirm(`Send the daily email to ${d?.name}'s recipients (${(d?.live_recipients || []).join(', ') || 'none'}) every day?`)) return;
    const data = await post({ action: 'set-mode', dealer_id: dealerId, mode });
    if (data) {
      setMessage(`${data.dealer.name}: ${MODE_HELP[data.dealer.mode]}`);
      await loadDealers();
    }
  };

  const resend = async () => {
    if (!dealer || !date) return;
    const to = dealer.mode === 'internal' ? dealer.internal_recipients : dealer.live_recipients;
    if (!window.confirm(`Resend ${date} for ${dealer.name} to ${to.join(', ') || 'nobody'}?`)) return;
    const data = await post({ action: 'resend', dealer_id: dealer.dealer_id, date });
    if (data) {
      const sent = data.results.filter((r) => r.status === 'sent').length;
      setMessage(`Resend ${data.request_id}: ${sent} of ${data.results.length} sent`);
      await loadDeliveries(dealer.dealer_id);
    }
  };

  const preview = () => {
    if (!dealer || !date) return;
    window.open(`${API}?action=preview&dealer_id=${encodeURIComponent(dealer.dealer_id)}&date=${encodeURIComponent(date)}`,
      '_blank', 'noopener');
  };

  const shown = dealers.filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()) || d.mode === filter);

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mt-4">
      <h4 className="text-lg font-semibold text-gray-900 mb-2">Daily performance email</h4>
      <p className="text-muted mb-3" style={{ fontSize: 14 }}>
        Sent by the background worker for yesterday (dealer time), at the dealer&apos;s Report Schedule daily time
        (09:00 if none). Every dealer starts Off. Internal sends only to DAILY_REPORT_INTERNAL_RECIPIENTS.
      </p>

      {message && (
        <div className={`mb-3 p-2 rounded-md ${message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      <Form.Control size="sm" className="mb-2" placeholder="Filter dealers (name, or off / internal / live)"
        value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 360 }} />

      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        <Table size="sm" bordered hover responsive>
          <thead>
            <tr><th>Dealer</th><th>Mode</th><th>Send time</th><th>Live recipients</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.dealer_id} className={d.dealer_id === selected ? 'table-active' : ''}>
                <td>{d.name}</td>
                <td>
                  <Form.Select size="sm" value={d.mode} disabled={busy}
                    onChange={(e) => setMode(d.dealer_id, e.target.value)}>
                    <option value="off">Off</option>
                    <option value="internal">Internal</option>
                    <option value="live">Live</option>
                  </Form.Select>
                </td>
                <td>{d.send_time} <span className="text-muted">({d.tz})</span></td>
                <td style={{ fontSize: 12 }}>{d.live_recipients.join(', ') || '-'}</td>
                <td>
                  <Button size="sm" variant="outline-primary"
                    onClick={() => { setSelected(d.dealer_id); setDate(d.yesterday); loadDeliveries(d.dealer_id); }}>
                    Select
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {dealer && (
        <div className="d-flex align-items-center flex-wrap gap-2 my-3">
          <strong>{dealer.name}</strong>
          <Form.Control type="date" size="sm" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} />
          <Button size="sm" variant="secondary" onClick={preview} disabled={!date}>Preview (sends nothing)</Button>
          <Button size="sm" variant="warning" onClick={resend} disabled={busy || !date || dealer.mode === 'off'}>
            Resend this day
          </Button>
          {dealer.mode === 'off' && <span className="text-muted" style={{ fontSize: 12 }}>Resend needs Internal or Live</span>}
        </div>
      )}

      <h6 className="mt-3">Delivery log {dealer ? `- ${dealer.name}` : '(all dealers)'}</h6>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <Table size="sm" bordered responsive style={{ fontSize: 12 }}>
          <thead>
            <tr><th>Day</th><th>Recipient</th><th>Mode</th><th>Status</th><th>Attempts</th><th>Sent</th><th>Resend</th><th>Error</th></tr>
          </thead>
          <tbody>
            {deliveries.length === 0 && <tr><td colSpan={8} className="text-muted">No deliveries yet</td></tr>}
            {deliveries.map((r) => (
              <tr key={r.id}>
                <td>{r.report_date}</td>
                <td>{r.recipient}</td>
                <td>{r.mode}</td>
                <td>{r.status}</td>
                <td>{r.attempts}</td>
                <td>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '-'}</td>
                <td>{r.resend_of ? 'yes' : ''}</td>
                <td>{r.last_error || ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
