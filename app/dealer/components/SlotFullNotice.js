"use client";
// The full-slot answer in every staff booking screen (agentic-upsell MASTER_PLAN_4 stream R): the server's message,
// a one-click "Book {next available}" that re-submits, and the day's other open times when the server gave them.
// See app/lib/bookingConflict.js.
import { Alert, Button } from "react-bootstrap";
import { slotLabel } from "@lib/bookingConflict";

export default function SlotFullNotice({ conflict, onBook, busy = false }) {
  if (!conflict) return null;
  const next = conflict.nextAvailable;
  return (
    <Alert variant="warning" className="mt-3 mb-0" role="alert">
      <div className="mb-2">{conflict.message}</div>
      {next && (
        <Button size="sm" variant="custom" disabled={busy} onClick={() => onBook(next.date, next.time)}>
          Book {slotLabel(next.date, next.time)}
        </Button>
      )}
      {conflict.alternatives?.length > 0 && conflict.requestedDate && (
        <div className="mt-2 small">
          Other open times that day:{" "}
          {conflict.alternatives.map((time) => (
            <Button key={time} size="sm" variant="outline-secondary" className="me-1 mb-1" disabled={busy}
              onClick={() => onBook(conflict.requestedDate, time)}>
              {slotLabel(conflict.requestedDate, time).split(" at ")[1]}
            </Button>
          ))}
        </div>
      )}
    </Alert>
  );
}
