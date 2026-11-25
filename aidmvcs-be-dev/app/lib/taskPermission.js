// "Dismiss Tasks" (Bibi / the user, 25 Nov 2026): who may close a task without doing it - an AI call task nobody will
// make, or a reminder that is no longer needed. Role based, like every other permission (Admin > Employee Roles):
//   super admin and the dealership account itself  always
//   Rooftop Admin / Sales Manager and any role that can manage and assign leads   given it when it first appears
//   every other role                                                              only when an admin ticks it
// The server refuses a dismiss (and its undo) from anyone else; the screens hide the button for them.
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import { hasPermission } from './staffPermission.js';

export const DISMISS_TASKS = 'Dismiss Tasks';
const GROUP = 'Task Management';
const GIVEN_BY_NAME = ['Rooftop Admin', 'Sales Manager'];

let ready = false;
/** Creates the permission once (all dealers). The first time, the roles that manage leads get it, so managers keep
 *  the dismiss they had before it was a permission. Safe to call on every request. */
export async function ensureDismissPermission() {
  if (ready) return;
  const res = await Permission.findOneAndUpdate(
    { permission_name: DISMISS_TASKS, entity: 'dealer' },
    { $setOnInsert: { permission_name: DISMISS_TASKS, entity: 'dealer', group: GROUP } },
    { upsert: true, new: true, includeResultMetadata: true });
  const created = res?.lastErrorObject?.upserted;
  const permId = res?.value?._id;
  if (created && permId) {
    const managing = await Permission.find({ entity: 'dealer', permission_name: { $in: ['Manage Leads', 'Assign Leads'] } })
      .select('_id permission_name').lean();
    const manageId = managing.find((p) => p.permission_name === 'Manage Leads')?._id;
    const assignId = managing.find((p) => p.permission_name === 'Assign Leads')?._id;
    const byPerms = manageId && assignId ? [{ permissions: { $all: [manageId, assignId] } }] : [];
    await Role.updateMany({ entity: 'dealer', $or: [{ name: { $in: GIVEN_BY_NAME } }, ...byPerms] },
      { $addToSet: { permissions: permId } });
  }
  ready = true;
}

/** May this signed-in user dismiss tasks? Super admin and the dealership account always may. */
export async function canDismissTasks(user) {
  return hasPermission(user, DISMISS_TASKS);
}
