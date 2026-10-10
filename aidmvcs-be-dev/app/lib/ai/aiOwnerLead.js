// An owner lead for a DealerVault customer who has no lead in the CRM (client, 9 Oct 2026: "we will need to create
// their leads"). The AI's owner messages (birthday, anniversary, lease end, ...) live in a lead's conversation, so
// the customer needs one. It is created as "Sold Delivered" with source "DealerVault": an owner, never a new sales
// lead, so no sales follow-up, n8n reply or reminder starts for it. Creating it gives no permission to text: the
// AI's Compliance Engine still decides every message (TCPA spec §5).
// Imports are relative-free (deps injected) so it can be unit tested.

export const OWNER_LEAD_SOURCE = 'DealerVault';
export const OWNER_LEAD_STATUS = 'Sold Delivered';

export function validateOwnerLeadPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { errors: ['body must be an object'] };
  if (!body.dealer_id || typeof body.dealer_id !== 'string') errors.push('dealer_id is required');
  if (!body.customer_id || !/^[a-f0-9]{24}$/i.test(String(body.customer_id))) errors.push('customer_id is required');
  return { errors };
}

function primary(list) {
  const rows = Array.isArray(list) ? list : [];
  return (rows.find((r) => r?.is_primary) || rows[0])?.value || null;
}

export async function ensureOwnerLead({ dealer_id, customer_id, deal_number = null }, { Lead, Customer }) {
  const customer = await Customer.findOne({ _id: customer_id, dealer_id }).lean();
  if (!customer) return { found: false };
  const existing = await Lead.findOne({ dealer_id, customer_id }).sort({ _id: -1 }).lean();
  if (existing) return { found: true, created: false, lead_id: String(existing._id) };
  const lead = await Lead.create({
    dealer_id, customer_id, name: customer.name || null,
    email: primary(customer.emails), phone: primary(customer.phones),
    source: OWNER_LEAD_SOURCE, fe_lead_status: OWNER_LEAD_STATUS,
    data: { owner_lead: true, created_by: 'ai_owner_lifecycle', deal_number },
  });
  return { found: true, created: true, lead_id: String(lead._id) };
}
