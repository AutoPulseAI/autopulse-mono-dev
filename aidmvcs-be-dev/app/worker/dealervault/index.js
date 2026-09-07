import { setupPartsInventoryWorker } from './partsInventoryWorker.js';

export function setupDealerVaultWorkers(redis) {
  return [setupPartsInventoryWorker(redis)];
}
