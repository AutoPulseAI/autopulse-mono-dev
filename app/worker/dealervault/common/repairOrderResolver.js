import RepairOrder from '../../../models/RepairOrder.js';

export async function resolveRepairOrders(entries, context, Model = RepairOrder) {
  const numbers = [...new Set(entries.map(entry => entry.document.ro_number).filter(Boolean))];
  const orders = numbers.length ? await Model.find({ dealer_id: context.dealer_id, ro_number: { $in: numbers } })
    .select('_id ro_number').lean() : [];
  const byNumber = new Map();
  for (const order of orders) {
    const matches = byNumber.get(order.ro_number) || [];
    matches.push(order);
    byNumber.set(order.ro_number, matches);
  }
  for (const entry of entries) {
    // An absent source field leaves an existing relationship update untouched.
    if (!Object.hasOwn(entry.document, 'RO Number')) continue;
    const matches = byNumber.get(entry.document.ro_number) || [];
    entry.document.repair_order_id = matches.length === 1 ? matches[0]._id : null;
    if (entry.document.ro_number && matches.length !== 1) {
      entry.warnings.push(matches.length ? 'SV_APPT_RO_AMBIGUOUS' : 'SV_APPT_RO_UNRESOLVED');
    }
  }
}
