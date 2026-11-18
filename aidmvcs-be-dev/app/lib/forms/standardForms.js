// Standard forms a dealership can add to its Forms Library in one click (13 Nov 2026 meeting, 7.4: "supply standard
// editable form templates - Buyer's Order, Credit Application, We Owe, Guest/Up Sheet, Referral Form, Media Release").
// Each is made here as a plain fillable PDF (pdf-lib): every blank is a named fillable field whose tooltip is its
// label, so it is read like any uploaded form (lib/forms/detect.js) - customer, vehicle, trade-in, staff and dealer
// blanks fill themselves; signatures, SSN, birth date, bank, income, prices and co-buyer blanks stay for the person.
// These are generic layouts, not legal advice: the dealership checks the wording with its own counsel before use.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// A row is a list of [label, width share]; a string is a section heading; { note } is a paragraph.
const PEOPLE = [['First Name', 1], ['Last Name', 1]];
const CONTACT = [['Phone', 1], ['Email', 1.4]];
const ADDRESS = [['Street Address', 2], ['City', 1], ['State', 0.5], ['ZIP', 0.7]];
const VEHICLE = [['Year', 0.6], ['Make', 1], ['Model', 1], ['VIN', 1.6]];
const TRADE = [['Trade-in Year', 0.6], ['Trade-in Make', 1], ['Trade-in Model', 1], ['Trade-in VIN', 1.6]];

export const STANDARD_FORMS = Object.freeze({
  buyers_order: { name: "Buyer's Order", category: 'Sales', rows: [
    'Buyer', PEOPLE, CONTACT, ADDRESS, 'Co-Buyer', [['Co-Buyer Name', 2], ['Co-Buyer Phone', 1]],
    'Vehicle Purchased', VEHICLE, [['Stock Number', 1], ['Mileage', 1], ['Color', 1]],
    'Trade-in', TRADE, [['Trade-in Mileage', 1], ['Lienholder', 1.5], ['Payoff', 1]],
    'Price', [['Vehicle Price', 1], ['Trade Allowance', 1], ['Fees', 1]], [['Taxes', 1], ['Down Payment', 1], ['Total Due', 1]],
    'Dealership', [['Dealer Name', 2], ['Salesperson', 1]], [['Date', 1], ['Sales Manager', 1]],
    [['Buyer Signature', 2], ['Co-Buyer Signature', 2]],
  ] },
  credit_application: { name: 'Credit Application', category: 'Finance', rows: [
    'Applicant', PEOPLE, [['Date of Birth', 1], ['Social Security Number', 1]], CONTACT, ADDRESS,
    [['Years at Address', 1], ['Rent or Own', 1], ['Monthly Housing Payment', 1]],
    'Employment', [['Employer', 2], ['Occupation', 1]], [['Years Employed', 1], ['Monthly Income', 1], ['Employer Phone', 1]],
    'Co-Applicant', [['Co-Applicant Name', 2], ['Co-Applicant Date of Birth', 1]], [['Co-Applicant Social Security Number', 1], ['Co-Applicant Monthly Income', 1]],
    'Vehicle', VEHICLE,
    { note: 'I authorize the dealership and its lenders to obtain my credit report and verify the information above.' },
    [['Applicant Signature', 2], ['Date', 1]], [['Co-Applicant Signature', 2], ['Date Signed', 1]],
  ] },
  we_owe: { name: 'We Owe', category: 'Sales', rows: [
    'Customer', [['Customer Name', 2], ['Phone', 1]], 'Vehicle', VEHICLE, [['Stock Number', 1]],
    'The dealership owes the customer', [['Item 1', 3]], [['Item 2', 3]], [['Item 3', 3]], [['Item 4', 3]],
    'The customer owes the dealership', [['Customer Item 1', 3]], [['Customer Item 2', 3]],
    [['Salesperson', 1], ['Sales Manager', 1], ['Date', 1]], [['Customer Signature', 2], ['Manager Signature', 2]],
  ] },
  guest_sheet: { name: 'Guest / Up Sheet', category: 'Sales', rows: [
    'Guest', PEOPLE, CONTACT, ADDRESS, 'Interested In', VEHICLE, [['Stock Number', 1], ['New or Used', 1]],
    'Trade-in', TRADE, [['Trade-in Mileage', 1]],
    'Visit', [['Salesperson', 1], ['Date', 1], ['Lead Source', 1]], [['Notes', 3]],
  ] },
  referral: { name: 'Referral Form', category: 'Marketing', rows: [
    'Referred By', [['Customer Name', 2], ['Phone', 1]], [['Email', 2]],
    'Person Referred', [['Referral Name', 2], ['Referral Phone', 1]], [['Referral Email', 2]],
    [['Salesperson', 1], ['Date', 1]], [['Customer Signature', 2]],
  ] },
  media_release: { name: 'Media Release', category: 'Marketing', rows: [
    { note: 'I give the dealership permission to use photographs, video and my name taken at the dealership in its '
      + 'advertising and social media, without payment.' },
    'Customer', [['Print Name', 2], ['Phone', 1]], [['Email', 2]], ADDRESS, 'Vehicle', VEHICLE,
    [['Dealer Name', 2], ['Date', 1]], [['Customer Signature', 2]],
  ] },
});

// What fills each blank, set here rather than guessed from the label (these forms are ours). Any label not listed is
// left for the person - signatures, SSN, birth date, income, prices, co-buyer, notes.
const FILLS = Object.freeze({
  'First Name': 'customer.first_name', 'Last Name': 'customer.last_name', 'Customer Name': 'customer.full_name',
  'Print Name': 'customer.full_name', Phone: 'customer.phone', Email: 'customer.email',
  'Street Address': 'customer.address_line', City: 'customer.city', State: 'customer.state', ZIP: 'customer.zip',
  Year: 'vehicle.year', Make: 'vehicle.make', Model: 'vehicle.model', VIN: 'vehicle.vin', 'Stock Number': 'vehicle.stock_number',
  'Trade-in Year': 'trade.year', 'Trade-in Make': 'trade.make', 'Trade-in Model': 'trade.model', 'Trade-in VIN': 'trade.vin',
  'Trade-in Mileage': 'trade.miles', Lienholder: 'trade.lienholder', Payoff: 'trade.payoff',
  'Dealer Name': 'dealer.name', Salesperson: 'staff.salesperson', 'Sales Manager': 'staff.sales_manager', Date: 'date.today',
});
const fieldName = (label, n) => `${label.replace(/[^A-Za-z0-9]+/g, '_')}${n > 1 ? `_${n}` : ''}`;

/**
 * What fills each blank of a standard form, by its fillable field's name: { [pdf_field]: sourceKey | null }.
 */
export function standardFormSources(key) {
  const spec = STANDARD_FORMS[key];
  const out = {}; const used = new Map();
  for (const row of spec?.rows || []) {
    if (!Array.isArray(row)) continue;
    for (const [label] of row) { const n = (used.get(label) || 0) + 1; used.set(label, n); out[fieldName(label, n)] = FILLS[label] || null; }
  }
  return out;
}

/** The PDF of a standard form (Buffer). */
export async function standardFormPdf(key) {
  const spec = STANDARD_FORMS[key];
  if (!spec) throw Object.assign(new Error('Unknown standard form'), { status: 404 });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const W = 612; const H = 792; const M = 46; const GAP = 10;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const used = new Map();
  const need = (h) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; } };
  page.drawText(spec.name.toUpperCase(), { x: M, y: y - 16, size: 16, font: bold, color: rgb(0.1, 0.2, 0.4) });
  y -= 34;
  for (const row of spec.rows) {
    if (typeof row === 'string') {
      need(26);
      page.drawText(row, { x: M, y: y - 14, size: 10.5, font: bold, color: rgb(0.12, 0.37, 0.66) });
      y -= 26;
      continue;
    }
    if (row.note) {
      const words = row.note.split(' '); let line = ''; const lines = [];
      for (const w of words) { if (font.widthOfTextAtSize(`${line} ${w}`, 9) > W - 2 * M) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w; }
      lines.push(line); need(lines.length * 12 + 8);
      for (const l of lines) { page.drawText(l, { x: M, y: y - 10, size: 9, font }); y -= 12; }
      y -= 8;
      continue;
    }
    need(34);
    const total = row.reduce((a, [, share]) => a + share, 0);
    let x = M;
    for (const [label, share] of row) {
      const w = ((W - 2 * M - GAP * (row.length - 1)) * share) / total;
      page.drawText(label, { x, y: y - 9, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
      const n = (used.get(label) || 0) + 1; used.set(label, n);
      const field = form.createTextField(fieldName(label, n));
      field.addToPage(page, { x, y: y - 28, width: w, height: 16, borderColor: rgb(0.6, 0.65, 0.72), borderWidth: 0.6,
        backgroundColor: rgb(0.97, 0.98, 1), font });
      field.setFontSize(9);
      // The tooltip is the label: lib/forms/detect.js reads it to know what goes in the blank.
      field.acroField.dict.set(doc.context.obj('TU'), doc.context.obj(label));
      x += w + GAP;
    }
    y -= 36;
  }
  return Buffer.from(await doc.save());
}
