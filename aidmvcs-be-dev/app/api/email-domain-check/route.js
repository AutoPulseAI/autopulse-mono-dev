// GET /api/email-domain-check?dealer_id=[&domain=]  (19 Nov 2026, SOW reference B9 "Email Domain Validation Setup")
// The dealership's email domains - its website domain (Dealer Setup) and each Email / Lead account's address - each
// with its DNS checks (lib/emailDomainCheck.js). `domain` checks one more domain typed on the page. Read-only; the
// dealership's staff only.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import EmailAccount from '@models/EmailAccount';
import { requireDealerAccess } from '@lib/apiGuard';
import { checkDomain, domainOf } from '@lib/emailDomainCheck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX = 10;

export async function GET(req) {
  await dbConnect();
  const p = new URL(req.url).searchParams;
  const dealerId = String(p.get('dealer_id') || '');
  if (!mongoose.isValidObjectId(dealerId)) return Response.json({ error: 'dealer_id is required' }, { status: 400 });
  const g = await requireDealerAccess(req, dealerId);
  if (g.response) return g.response;
  const [dealer, accounts] = await Promise.all([
    User.findById(dealerId).select('dealer_account_information.domain_name dealer_account_information.store_website').lean(),
    EmailAccount.find({ dealer_id: dealerId }).select('email_address active account_name').lean(),
  ]);
  const used = new Map(); // domain -> where it is used
  const add = (d, where) => { if (d) used.set(d, [...(used.get(d) || []), where]); };
  add(domainOf(dealer?.dealer_account_information?.domain_name), 'Dealer Setup domain');
  add(domainOf(dealer?.dealer_account_information?.store_website), 'Store website');
  for (const a of accounts) add(domainOf(a.email_address), `Email account ${a.email_address}${a.active === false ? ' (inactive)' : ''}`);
  const typed = domainOf(p.get('domain'));
  if (p.get('domain') && !typed) return Response.json({ error: 'That is not a domain name' }, { status: 400 });
  if (typed) add(typed, 'Checked by hand');
  const domains = [...used.keys()].slice(0, MAX);
  const results = await Promise.all(domains.map(async (d) => ({ ...(await checkDomain(d)), used_for: used.get(d) })));
  return Response.json({ checked_at: new Date().toISOString(), domains: results });
}
