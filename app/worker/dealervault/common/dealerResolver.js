import User from '../../../models/User.js';
import { permanentError } from './logger.js';

export async function resolveDealer(dvDealerId, UserModel = User) {
  const dealers = await UserModel.find({ type: 'dealer', dv_dealer_id: dvDealerId })
    .select('_id').limit(2).lean();
  if (!dealers.length) throw permanentError('DEALER_NOT_FOUND');
  if (dealers.length !== 1) throw permanentError('DEALER_AMBIGUOUS');
  return String(dealers[0]._id);
}
