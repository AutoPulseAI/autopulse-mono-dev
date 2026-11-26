"use client";
// The customer's appointments in one table (SOW D2; approved 24 Nov 2026): sales and service bookings from the CRM and
// service appointments from the DMS. Filter by department or status; click a DMS appointment to open it.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Form, Table } from "react-bootstrap";
import moment from "moment-timezone";
import AppIcon, { IconLabel } from "../../../components/AppIcon";

const vehicleLabel = (r) => [r.Year, r.Make, r.Model].filter(Boolean).join(" ") || r.vin || "Unknown vehicle";
const VARIANT = { Shown: "success", Completed: "success", Confirmed: "primary", Scheduled: "primary", Upcoming: "warning", "No show": "danger", Cancelled: "secondary", Past: "secondary" };

export default function AppointmentsTab({ appointments = [], bookings = [] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const now = Date.now();
    return [
      ...bookings.map((b) => ({ key: `b-${b._id}`, at: b.at, time: b.time, department: b.type === "service" ? "Service" : "Sales", work: b.vehicle || "No vehicle",
        status: b.status, by: b.set_by, owner: b.owner })),
      ...appointments.map((a) => ({ key: `s-${a._id}`, id: a._id, at: a.computed_date, time: a.computed_date ? moment(a.computed_date).format("h:mm A") : "", department: "Service", work: vehicleLabel(a),
        status: a.computed_date && new Date(a.computed_date).getTime() > now ? "Upcoming" : "Past", by: "DMS", owner: a["Service Advisor Name"] || null })),
    ].sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
  }, [appointments, bookings]);
  const options = [...new Set(rows.flatMap((r) => [r.department, r.status]))];
  const shown = rows.filter((r) => !filter || r.department === filter || r.status === filter);
  return (
    <div className="w_card">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <h3 className="w_card_title mb-0 me-auto">Appointments</h3>
        <Form.Select size="sm" className="w-auto" aria-label="Filter appointments" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All appointments</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Form.Select>
      </div>
      {shown.length === 0 ? <div className="text-center py-4 text-muted">No appointments found for this customer.</div> : (
        <div className="table-responsive act_table">
          <Table hover size="sm" className="mb-0 align-middle">
            <thead><tr><th><IconLabel name="date">Date</IconLabel></th><th><IconLabel name="time">Time</IconLabel></th><th><IconLabel name="department">Department</IconLabel></th><th><IconLabel name="vehicle">Vehicle / work</IconLabel></th><th><IconLabel name="status">Status</IconLabel></th><th><IconLabel name="staff">Set by</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.key} style={r.id ? { cursor: "pointer" } : undefined} onClick={r.id ? () => router.push(`/dealer/service-appointments/${r.id}`) : undefined}>
                <td className="text-nowrap">{r.at ? moment(r.at).format("ddd, MMM D, YYYY") : "Date unknown"}</td><td className="text-nowrap">{r.time || "-"}</td>
                <td><span className="ap_label"><AppIcon name="department" />{r.department}</span></td><td>{r.work}</td>
                <td><Badge bg={VARIANT[r.status] || "secondary"} text={r.status === "Upcoming" ? "dark" : undefined}>{r.status}</Badge></td>
                <td>{r.by}</td><td>{r.owner || <span className="text-muted">Unassigned</span>}</td>
              </tr>))}</tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
