// POST /api/roles/standard - adds the SOW's standard roles (app/lib/standardRoles.js: Rooftop Admin, Executive, Sales
// Manager, BDC / Sales, Service, Read-only) to the signed-in dealership's Employee Roles. A role whose name is already
// there is left as it is. The "View All Leads (Read Only)" permission is created the first time it is needed.
// Who: the dealer account, or staff with "Manage Employee's  Role". -> { created: [names], skipped: [names] }
import dbConnect from '@lib/mongodb';
import Role from '@models/Role';
import Permission from '@models/Permission';
import { requireUser } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { READ_ONLY, STANDARD_ROLES } from '@lib/standardRoles';
import { ensureDismissPermission } from '@lib/taskPermission';

export const runtime = 'nodejs';

export async function POST(req) {
  await dbConnect();
  const signedIn = await requireUser(req);
  if (signedIn.response) return signedIn.response;
  const user = signedIn.user;
  if (user.type !== 'dealer') return Response.json({ message: 'Only a dealership can add these roles' }, { status: 403 });
  if (!(await hasPermission(user, "Manage Employee's  Role"))) {
    return Response.json({ message: 'You do not have permission to manage roles' }, { status: 403 });
  }
  const dealerId = user.parent_id || user._id;
  if (!(await Permission.findOne({ permission_name: READ_ONLY, entity: 'dealer' }).lean())) {
    await Permission.create({ permission_name: READ_ONLY, entity: 'dealer', group: 'Leads Management' });
  }
  await ensureDismissPermission();
  const perms = await Permission.find({ entity: 'dealer' }).select('permission_name').lean();
  const idOf = new Map(perms.map((p) => [p.permission_name, p._id]));
  const created = []; const skipped = [];
  for (const r of STANDARD_ROLES) {
    if (await Role.findOne({ name: r.name, entity: 'dealer', entity_id: dealerId }).lean()) { skipped.push(r.name); continue; }
    await Role.create({ name: r.name, entity: 'dealer', entity_id: dealerId,
      permissions: r.permissions.map((n) => idOf.get(n)).filter(Boolean) });
    created.push(r.name);
  }
  return Response.json({ created, skipped });
}
