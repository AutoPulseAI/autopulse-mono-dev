// Parse once per form (the user, 16 Nov 2026): an upload whose fingerprint matches a form already in any dealership's
// library (the same file, or the same text on the same page sizes with the same fillable fields) takes that form's
// staff-corrected blanks instead of the blanks read now. This dealership's own forms first, then the most recently
// corrected. Only corrected versions of forms still in a library are reused (17 Nov 2026: a deleted form's uncorrected
// blanks - read by older, buggier code - came back on re-upload; reading is local and free, corrections are not).
import FormTemplate from '../../models/FormTemplate.js';

const same = (v, fp) => v.fingerprint && (v.fingerprint.sha256 === fp.sha256 || (fp.text_hash
  && v.fingerprint.text_hash === fp.text_hash && v.fingerprint.page_sizes === fp.page_sizes
  && (v.fingerprint.field_names || null) === (fp.field_names || null)));

/** @returns {Promise<null | { fields, reused_from: { template_id, version, dealer_id } }>} */
export async function savedFieldsFor(fp, dealerId) {
  if (!fp?.sha256) return null;
  const or = [{ 'versions.fingerprint.sha256': fp.sha256 }];
  if (fp.text_hash) or.push({ 'versions.fingerprint.text_hash': fp.text_hash });
  const found = await FormTemplate.find({ $or: or, deleted_at: null }).select('dealer_id versions').lean();
  const hits = found.flatMap((t) => (t.versions || []).filter((v) => same(v, fp) && v.fields?.length && v.corrected_at)
    .map((v) => ({ t, v })));
  if (!hits.length) return null;
  hits.sort((a, b) => (String(b.t.dealer_id) === String(dealerId)) - (String(a.t.dealer_id) === String(dealerId))
    || new Date(b.v.corrected_at || 0) - new Date(a.v.corrected_at || 0) || new Date(b.v.created_at || 0) - new Date(a.v.created_at || 0));
  const { t, v } = hits[0];
  return { fields: v.fields, reused_from: { template_id: t._id, version: v.version, dealer_id: String(t.dealer_id) } };
}

// A scan read before (by our reader or, once, by the AI): the same file (sha256) takes its blanks again, corrected or
// not - reading a scan is slow, and the AI read costs money, so it is never repeated (the user, 18 Nov 2026).
export async function savedScanFieldsFor(fp) {
  if (!fp?.sha256) return null;
  const found = await FormTemplate.find({ 'versions.fingerprint.sha256': fp.sha256, deleted_at: null }).select('dealer_id versions').lean();
  const hits = found.flatMap((t) => (t.versions || []).filter((v) => v.fingerprint?.sha256 === fp.sha256 && v.fields?.length)
    .map((v) => ({ t, v })));
  if (!hits.length) return null;
  hits.sort((a, b) => new Date(b.v.corrected_at || 0) - new Date(a.v.corrected_at || 0) || new Date(b.v.created_at || 0) - new Date(a.v.created_at || 0));
  const { t, v } = hits[0];
  return { fields: v.fields, reused_from: { template_id: t._id, version: v.version, dealer_id: String(t.dealer_id) } };
}
