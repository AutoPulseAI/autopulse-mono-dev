// Email domain validation (19 Nov 2026, SOW reference B9 "Email Domain Validation Setup"): for each domain a dealership
// sends or receives lead email on, are the DNS records that make its mail trusted in place? Read-only DNS lookups:
//   MX     the domain can receive mail (replies, lead emails)
//   SPF    a "v=spf1" record names who may send for it (more than one SPF record is itself an error)
//   DMARC  a "_dmarc" record with a policy (none / quarantine / reject)
//   SES    when the CRM sends through Amazon SES (USE_SES_SEND_RAW), whether SES has the domain verified and DKIM on -
//          best effort: an account without that permission just shows "not checked"
import { promises as dns } from 'node:dns';

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function domainOf(value) {
  const s = String(value || '').trim().toLowerCase();
  const d = (s.includes('@') ? s.split('@').pop() : s).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return DOMAIN.test(d) ? d : null;
}

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map((parts) => parts.join('')); }
  catch (e) { if (['ENODATA', 'ENOTFOUND'].includes(e.code)) return []; throw e; }
}

async function sesStatus(domain) {
  if (!['true', '1'].includes(String(process.env.USE_SES_SEND_RAW || '').toLowerCase())) return null;
  try {
    const { SESClient, GetIdentityVerificationAttributesCommand, GetIdentityDkimAttributesCommand } = await import('@aws-sdk/client-ses');
    const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const [v, k] = await Promise.all([
      ses.send(new GetIdentityVerificationAttributesCommand({ Identities: [domain] })),
      ses.send(new GetIdentityDkimAttributesCommand({ Identities: [domain] })),
    ]);
    return { verification: v.VerificationAttributes?.[domain]?.VerificationStatus || 'NotStarted',
      dkim: k.DkimAttributes?.[domain]?.DkimVerificationStatus || 'NotStarted' };
  } catch (e) {
    return { error: e?.name === 'AccessDeniedException' ? 'not allowed to check' : 'could not be checked' };
  }
}

/** One domain's checks: { domain, mx, spf, dmarc, ses, ok, problems[] }. */
export async function checkDomain(domain) {
  const out = { domain, mx: [], spf: null, dmarc: null, ses: null, problems: [] };
  try {
    out.mx = (await dns.resolveMx(domain).catch((e) => (['ENODATA', 'ENOTFOUND'].includes(e.code) ? [] : Promise.reject(e))))
      .sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter((x) => x && x !== '.');
    const spf = (await txt(domain)).filter((t) => /^v=spf1\b/i.test(t));
    out.spf = spf[0] || null;
    if (spf.length > 1) out.problems.push('More than one SPF record: mail servers may treat SPF as failed. Keep one.');
    const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => /^v=DMARC1\b/i.test(t)) || null;
    out.dmarc = dmarc ? { record: dmarc, policy: (dmarc.match(/\bp=(\w+)/i) || [])[1]?.toLowerCase() || null } : null;
  } catch (e) {
    out.problems.push(`DNS lookup failed (${e.code || 'error'}). Try again later.`);
    return { ...out, ok: false };
  }
  if (!out.mx.length) out.problems.push('No mail server (MX): this domain can\'t receive email (customer replies, lead emails).');
  if (!out.spf) out.problems.push('No SPF record: emails sent for this domain are more likely to land in spam.');
  if (!out.dmarc) out.problems.push('No DMARC record: add one (start with p=none) so receivers can check the domain\'s mail.');
  out.ses = await sesStatus(domain);
  if (out.ses?.verification && out.ses.verification !== 'Success') out.problems.push(`Amazon SES: domain not verified (${out.ses.verification}).`);
  if (out.ses?.dkim && out.ses.dkim !== 'Success') out.problems.push(`Amazon SES: DKIM not verified (${out.ses.dkim}).`);
  return { ...out, ok: out.problems.length === 0 };
}
