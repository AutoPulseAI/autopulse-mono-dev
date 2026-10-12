import User from '@models/User';

// Who made a change, for the version history.
export async function studioUser(decoded) {
  const user = decoded?.userId ? await User.findById(decoded.userId).select('name email').lean() : null;
  return { id: decoded?.userId ? String(decoded.userId) : null, name: user?.name || user?.email || 'Super admin' };
}
