// The customer's details from the dealership's DMS sales file (DealerVault SL rows, app/models/Deal.js), for the
// customer profile (17 Nov 2026, BB's DealerSocket / VinSolutions screenshots: birthday, co-buyer, end of lease, Do Not
// Call / Email / Mail). Read-only: nothing here is typed by staff, and nothing is guessed - a field the DMS left
// empty is left out. Pure (no database), so the 360 route and tests can call it.
//
//   person      from the newest deal on which this customer is the buyer (or the co-buyer: their own columns)
//   co_buyer    the other person on that deal, if any
//   finance     one entry per financed / leased deal, newest first: type, term, APR, payment, bank, first payment,
//               and the date the last payment falls due (first payment + term - 1 months)
//   lease_end   the latest lease's end, for the yellow bar at the top of the profile
const s = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const yes = (v) => /^(y|yes|true|1|x)$/i.test(s(v));

export function parseDmsDate(value) {
  const t = s(value);
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const d = m ? new Date(Date.UTC(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[1]) - 1, Number(m[2])))
    : new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const num = (v) => {
  const n = Number(s(v).replace(/[$,%]/g, ''));
  return s(v) && Number.isFinite(n) ? n : null;
};

function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** One person's block of an SL row. prefix '' = buyer, 'Co-Buyer ' = co-buyer. */
function personFrom(deal, prefix) {
  const f = (name) => s(deal[`${prefix}${name}`]);
  // The co-buyer's block columns are spelled "Co Buyer Block ..." in the file.
  const block = (name) => s(deal[prefix ? `Co Buyer Block ${name}` : `Block ${name}`]);
  const out = {
    first_name: f('First Name'), middle_name: f('Middle Name'), last_name: f('Last Name'), suffix: f('Suffix'),
    full_name: f('Full Name'), salutation: f('Salutation'),
    birth_date: parseDmsDate(f('Birth Date')),
    business: /^b/i.test(f('Individual/Business Flag')) ? true : /^i/i.test(f('Individual/Business Flag')) ? false : null,
    language: f('Language'), county: f('County'),
    address: [f('Address Line 1'), f('Address Line 2'), f('City'), f('State'), f('Zip')].filter(Boolean).join(', '),
    phones: [['Cell', f('Cell Phone')], ['Home', f('Home Phone')],
      ['Work', f('Work Phone') && `${f('Work Phone')}${f('Work Extension') ? ` x${f('Work Extension')}` : ''}`]]
      .filter(([, v]) => v).map(([label, value]) => ({ label, value })),
    emails: [f('Email 1'), f('Email 2'), f('Email 3')].filter(Boolean),
    // What the dealership marked in the DMS. Shown as it is; it does not change who the AI messages.
    do_not: { call: yes(block('Phone')), email: yes(block('Email')), mail: yes(block('Mail')), opt_out: yes(f('Opt Out')) },
    customer_number: f('Customer Number'),
  };
  return out.first_name || out.last_name || out.full_name ? out : null;
}

const vehicleOf = (d) => [s(d.Year), s(d.Make), s(d.Model)].filter(Boolean).join(' ') || s(d.VIN) || 'Vehicle';
const dealDate = (d) => parseDmsDate(d['Contract Date']) || parseDmsDate(d['Delivery Date']) || parseDmsDate(d['Entry Date']);

/**
 * @param {object[]} deals         Deal docs of this customer (any order)
 * @param {string[]} customerNumbers  this customer's DMS customer numbers (Customer.extra.dealervault.customer_numbers)
 */
export function dmsProfile(deals = [], customerNumbers = []) {
  const mine = new Set((Array.isArray(customerNumbers) ? customerNumbers : [customerNumbers]).map(s).filter(Boolean));
  const sorted = [...deals].sort((a, b) => (dealDate(b)?.getTime() || 0) - (dealDate(a)?.getTime() || 0));
  let person = null;
  let coBuyer = null;
  let asOf = null;
  for (const d of sorted) {
    const isCo = mine.size && mine.has(s(d['Co-Buyer Customer Number'])) && !mine.has(s(d['Customer Number']));
    const me = personFrom(d, isCo ? 'Co-Buyer ' : '');
    if (!me) continue;
    person = me;
    coBuyer = personFrom(d, isCo ? '' : 'Co-Buyer ');
    asOf = { deal_number: s(d['Deal Number']) || s(d.deal_number), date: dealDate(d) };
    break;
  }
  const finance = sorted.map((d) => {
    const term = num(d.Term);
    const first = parseDmsDate(d['First Pay Date']);
    const type = s(d['Deal Type']);
    if (!term && !first && !num(d['Monthly Payment'])) return null; // a cash deal: nothing to show
    const lease = /lease/i.test(type) || /^l$/i.test(type);
    return {
      deal_number: s(d['Deal Number']) || s(d.deal_number), vehicle: vehicleOf(d), vin: s(d.VIN) || null,
      deal_type: type || null, sale_type: s(d['Sale Type']) || null, lease,
      term_months: term, apr: num(d.APR), monthly_payment: num(d['Monthly Payment']),
      amount_financed: num(d['Amount Financed']), residual: num(d['Residual Amount']),
      balloon: num(d['Balloon Amount']), bank: s(d['Bank Name']) || null, first_payment: first,
      contract_date: dealDate(d),
      ends_at: first && term ? addMonths(first, term - 1) : null,
    };
  }).filter(Boolean);
  const leaseEnd = finance.find((f) => f.lease && f.ends_at) || null;
  return {
    person, co_buyer: coBuyer, as_of: asOf, finance,
    lease_end: leaseEnd ? { date: leaseEnd.ends_at, vehicle: leaseEnd.vehicle, deal_number: leaseEnd.deal_number } : null,
  };
}
