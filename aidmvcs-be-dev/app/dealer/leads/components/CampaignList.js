"use client";
// Campaigns / tracking codes for one dealer (13 Nov 2026 meeting 4.4: "admin only: add lead sources and tracking codes /
// campaigns per dealer"; SOW B campaign taxonomy). Shown in Lead sources > Edit list for the dealer account / super
// admin (/api/lead-sources campaign_* actions). A new lead whose sub-source or lead source is exactly a campaign's code
// gets that campaign (app/lib/leadCampaign.js); adding a code also tags the leads already carrying it.
import { useState } from "react";
import { Button, Form, Table } from "react-bootstrap";

const EMPTY = { name: "", code: "", lead_source: "" };

export default function CampaignList({ campaigns, busy, change }) {
  const [adding, setAdding] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // { id, name, code, lead_source }
  const field = (obj, set, k, placeholder, width) => (
    <Form.Control size="sm" style={{ maxWidth: width }} placeholder={placeholder} value={obj[k] || ""} maxLength={60}
      onChange={(e) => set({ ...obj, [k]: e.target.value })} />
  );
  return (
    <div className="mt-4">
      <h6 className="mb-1">Campaigns and tracking codes</h6>
      <p className="small text-muted mb-2">
        A new lead whose sub-source or lead source is exactly the tracking code is tagged with the campaign; reports
        can filter by it. Adding a code also tags the leads that already carry it.
      </p>
      <div className="d-flex flex-wrap gap-1 mb-2">
        {field(adding, setAdding, "name", "Campaign, e.g. Spring Sale", 170)}
        {field(adding, setAdding, "code", "Tracking code", 130)}
        {field(adding, setAdding, "lead_source", "Source (optional)", 130)}
        <Button size="sm" variant="custom" disabled={busy || !adding.name.trim() || !adding.code.trim()}
          onClick={async () => { if (await change({ action: "campaign_add", campaign: adding })) setAdding(EMPTY); }}>Add</Button>
      </div>
      {!campaigns.length ? <p className="small text-muted mb-0">No campaigns yet.</p> : (
        <Table size="sm" className="small mb-0">
          <thead><tr><th>Campaign</th><th>Code</th><th>Source</th><th className="text-end">Leads</th><th>On</th><th /></tr></thead>
          <tbody>
            {campaigns.map((c) => (editing?.id === c.id ? (
              <tr key={c.id}>
                <td>{field(editing, setEditing, "name", "Campaign")}</td>
                <td>{field(editing, setEditing, "code", "Code")}</td>
                <td>{field(editing, setEditing, "lead_source", "Source")}</td>
                <td className="text-end">{c.leads}</td><td />
                <td className="text-end text-nowrap">
                  <Button size="sm" variant="custom" disabled={busy || !editing.name.trim() || !editing.code.trim()}
                    onClick={async () => {
                      const { id, ...campaign } = editing;
                      if (await change({ action: "campaign_update", id, campaign },
                        editing.name.trim() !== c.name && c.leads ? `${c.leads} lead(s) will show under "${editing.name.trim()}".` : null)) setEditing(null);
                    }}>Save</Button>
                  <Button size="sm" variant="link" onClick={() => setEditing(null)}>Cancel</Button>
                </td>
              </tr>
            ) : (
              <tr key={c.id} className={c.active ? "" : "text-muted"}>
                <td>{c.name}</td><td><code>{c.code}</code></td><td>{c.lead_source || "-"}</td>
                <td className="text-end">{c.leads}</td>
                <td><Form.Check type="switch" checked={c.active} disabled={busy} aria-label={`${c.name} on`}
                  title={c.active ? "Tags new leads" : "Off: no longer tags new leads"}
                  onChange={(e) => change({ action: "campaign_update", id: c.id, campaign: { active: e.target.checked } })} /></td>
                <td className="text-end text-nowrap">
                  <Button size="sm" variant="link" onClick={() => setEditing({ id: c.id, name: c.name, code: c.code, lead_source: c.lead_source || "" })}>Edit</Button>
                  <Button size="sm" variant="link" className="text-danger" disabled={busy}
                    onClick={() => change({ action: "campaign_remove", id: c.id },
                      `Remove "${c.name}"? Its ${c.leads} lead(s) keep the campaign; new leads are no longer tagged.`)}>Remove</Button>
                </td>
              </tr>
            )))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
