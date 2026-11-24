// POST /api/leads/bulk-export  Export on the bulk bar: the chosen leads as the same CSV as Leads > Export CSV.
//   body { dealer_id, lead_ids (at most 2,000) } -> text/csv
// Runs the list's own CSV export (GET /api/leads?format=csv) limited to those leads, so the columns are the same.
import mongoose from 'mongoose';
import { GET as listLeads } from '../route.js';

export const runtime = 'nodejs';
const MAX = 2000;

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'The request body must be JSON' }, { status: 400 }); }
  const ids = [...new Set((Array.isArray(body?.lead_ids) ? body.lead_ids : []).map(String))].filter((v) => mongoose.isValidObjectId(v));
  if (!ids.length) return Response.json({ error: 'Pick at least one lead' }, { status: 400 });
  if (ids.length > MAX) return Response.json({ error: `At most ${MAX} leads` }, { status: 400 });
  const url = new URL('/api/leads', req.url);
  url.searchParams.set('format', 'csv');
  url.searchParams.set('dealer_id', String(body.dealer_id || ''));
  url.searchParams.set('lead_ids', ids.join(','));
  const headers = new Headers();
  for (const h of ['authorization', 'cookie']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  return listLeads(new Request(url, { method: 'GET', headers }));
}
