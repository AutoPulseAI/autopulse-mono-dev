// Who may see the reports: a super admin, signed in directly or inside a dealer account through "login as" (the
// token carries impersonated_by, app/api/login-as). Same rule as app/lib/apiAuth.js loadSettingsEditor, for the
// user requireDealerAccess returned. Used by GET /api/reports/kpis and /api/reports/source-performance.
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../../models/User.js';

export async function isSuperAdmin(req, user) {
  if (user?.type === 'admin') return true;
  const header = req.headers.get('authorization') || '';
  const tokens = [];
  if (/^Bearer\s+\S+$/.test(header)) tokens.push(header.replace(/^Bearer\s+/, ''));
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (['dealertoken', 'admintoken', 'vendortoken'].includes(name)) tokens.push(decodeURIComponent(rest.join('=')));
  }
  for (const token of tokens) {
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { continue; }
    if (String(decoded?.userId) !== String(user?._id)) continue;
    if (!decoded.impersonated_by || !mongoose.isValidObjectId(decoded.impersonated_by)) continue;
    const by = await User.findById(decoded.impersonated_by).select('_id type').lean();
    if (by?.type === 'admin') return true;
  }
  return false;
}
