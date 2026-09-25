// Admin-only: what the AI knows about a lead (status and reason, every slot
// with its state and source, missing details, pending follow-up). Proxies the
// AI service's GET /v1/leads/{id}/profile with the shared secret.
//   GET /api/admin/ai/leads/<leadId>/profile

import { NextResponse } from 'next/server';
import { loadLeadForAdmin } from '@lib/ai/aiAdminLead';

const TIMEOUT_MS = 5_000;

export async function GET(request, { params }) {
  const loaded = await loadLeadForAdmin(request, params);
  if (loaded.error) return loaded.error;

  const base = (process.env.UPSELL_AGENT_API_URL || 'http://localhost:8100').replace(/\/$/, '');
  const url = `${base}/v1/leads/${loaded.leadId}/profile?dealer_id=${encodeURIComponent(loaded.dealerId)}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.UPSELL_SERVICE_SHARED_SECRET}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) {
      return NextResponse.json({ error: 'The AI has no profile for this lead yet' }, { status: 404 });
    }
    if (!response.ok) {
      return NextResponse.json({ error: 'AI service error', status: response.status }, { status: 502 });
    }
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ error: 'AI service unreachable', detail: error?.message }, { status: 502 });
  }
}
