"use client";
// The reporting field dictionary (SOW 3 Deliverable A, G-001), from app/lib/reporting/fieldDictionary.js: one line per
// field the reports read (entity + field + where it comes from); a click opens source of truth, transformation, null
// handling, refresh, access and where it is used. Filter by entity, search, 15 per page, CSV for the client's sign-off.
import { useMemo, useState } from "react";
import { Button, Form, Pagination } from "react-bootstrap";
import { ENTITIES, fieldDictionaryCsv, listFields } from "@lib/reporting/fieldDictionary";

const PAGE = 15;

function Detail({ label, children }) {
  if (!children) return null;
  return (
    <div className="mb-1">
      <span className="text-muted">{label}: </span>{children}
    </div>
  );
}

function download() {
  const blob = new Blob([`﻿${fieldDictionaryCsv()}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "autopulse-reporting-field-dictionary.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function FieldDictionary() {
  const fields = useMemo(() => listFields(), []);
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const needle = q.trim().toLowerCase();
  const rows = fields.filter((f) => (!entity || f.entity === entity) && (!needle
    || [f.field, f.collection, f.source, f.usedBy, f.transform].some((v) => String(v || "").toLowerCase().includes(needle))));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const go = (p) => { setPage(p); setOpen(null); };

  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <Form.Select size="sm" className="w-auto" value={entity} aria-label="Entity"
          onChange={(e) => { setEntity(e.target.value); go(1); }}>
          <option value="">All records ({fields.length} fields)</option>
          {Object.entries(ENTITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Form.Select>
        <Form.Control size="sm" style={{ maxWidth: 240 }} placeholder="Search a field" value={q}
          onChange={(e) => { setQ(e.target.value); go(1); }} />
        <Button size="sm" variant="outline-secondary" className="ms-auto text-nowrap" onClick={download}>
          <i className="fa-solid fa-download me-1" />Download CSV
        </Button>
      </div>

      {!shown.length && <div className="text-muted small py-3">No fields match.</div>}
      <ul className="list-unstyled mb-0">
        {shown.map((f) => {
          const isOpen = open === f.id;
          return (
            <li key={f.id} className="border-bottom py-2">
              <button type="button" className="btn btn-link p-0 text-start text-decoration-none w-100 text-body"
                onClick={() => setOpen(isOpen ? null : f.id)} aria-expanded={isOpen}>
                <div className="d-flex align-items-start gap-2">
                  <i className={`fa-solid fa-chevron-${isOpen ? "down" : "right"} small mt-1 text-muted`} />
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <strong className="text-break">{f.field}</strong>
                      <small className="text-muted">{f.entityLabel}</small>
                    </div>
                    <small className="text-muted d-block text-break">{f.source}</small>
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="small ms-4 mt-2 text-break">
                  <Detail label="Stored in">{f.collection}</Detail>
                  <Detail label="Type">{f.type}</Detail>
                  <Detail label="Source of truth">{f.truth}</Detail>
                  <Detail label="Transformation">{f.transform}</Detail>
                  <Detail label="When empty">{f.nulls}</Detail>
                  <Detail label="Refresh">{f.refresh}</Detail>
                  <Detail label="Who sees it">{f.access}</Detail>
                  <Detail label="Used by">{f.usedBy}</Detail>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="d-flex flex-wrap align-items-center justify-content-between mt-3 gap-2">
          <small className="text-muted">{rows.length} fields · page {current} of {pages}</small>
          <Pagination size="sm" className="mb-0">
            <Pagination.Prev disabled={current === 1} onClick={() => go(current - 1)} />
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <Pagination.Item key={p} active={p === current} onClick={() => go(p)}>{p}</Pagination.Item>
            ))}
            <Pagination.Next disabled={current === pages} onClick={() => go(current + 1)} />
          </Pagination>
        </div>
      )}
    </>
  );
}
