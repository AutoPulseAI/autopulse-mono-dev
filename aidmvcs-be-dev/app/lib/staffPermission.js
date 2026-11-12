// Does this signed-in user hold a role permission (server side, the same names the screens check with useCan)?
// The dealer account itself (no parent) and AutoPulse super admins hold every permission, as on the screens
// (app/api/auth/me gives staff their role's permission_name list).
import User from '../models/User.js';

export async function hasPermission(user, name) {
  if (!user) return false;
  if (user.type === 'admin') return true;
  if (user.type === 'dealer' && !user.parent_id) return true;
  const full = await User.findById(user._id).select('role')
    .populate({ path: 'role', populate: { path: 'permissions' } }).lean();
  return (full?.role?.permissions || []).some((p) => p?.permission_name === name);
}
