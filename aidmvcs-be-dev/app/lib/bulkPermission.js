// "Bulk Reassign Leads" (Betsy, 25 Nov 2026: "reassigning ... should be a certain level ... bulk reassign leads gotta go
// under the admin"): who may reassign several leads at once (Leads > Actions > Reassign). Reassigning one lead still
// needs only "Assign Leads". Role based, like every permission (Admin > Employee Roles):
//   super admin and the dealership account itself   always
//   Rooftop Admin / Sales Manager roles             given it when it first appears
//   every other role                                only when an admin ticks it
// The server refuses a bulk reassign from anyone else; the Leads page hides Reassign for them.
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import { hasPermission } from './staffPermission.js';

export const BULK_REASSIGN = 'Bulk Reassign Leads';
const GIVEN_BY_NAME = ['Rooftop Admin', 'Sales Manager'];

let ready = false;
/** Creates the permission once (all dealers); the first time, Rooftop Admin and Sales Manager roles get it. */
export async function ensureBulkReassignPermission() {
  if (ready) return;
  const res = await Permission.findOneAndUpdate(
    { permission_name: BULK_REASSIGN, entity: 'dealer' },
    { $setOnInsert: { permission_name: BULK_REASSIGN, entity: 'dealer', group: 'Leads Management' } },
    { upsert: true, new: true, includeResultMetadata: true });
  const permId = res?.value?._id;
  if (res?.lastErrorObject?.upserted && permId) {
    await Role.updateMany({ entity: 'dealer', name: { $in: GIVEN_BY_NAME } }, { $addToSet: { permissions: permId } });
  }
  ready = true;
}

/** May this user reassign `count` leads in one go? One lead = "Assign Leads"; more = "Bulk Reassign Leads" too. */
export async function canReassign(user, count) {
  if (!(await hasPermission(user, 'Assign Leads'))) return false;
  return count <= 1 || hasPermission(user, BULK_REASSIGN);
}
