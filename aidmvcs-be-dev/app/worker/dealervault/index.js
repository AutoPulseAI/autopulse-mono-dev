import { setupPartsInventoryWorker } from './partsInventoryWorker.js';
import { setupSalesWorker } from './salesWorker.js';
import { setupServiceWorker } from './serviceWorker.js';
import { setupServiceAppointmentWorker } from './serviceAppointmentWorker.js';

export function setupDealerVaultWorkers(redis) {
  return [setupPartsInventoryWorker(redis), setupSalesWorker(redis), setupServiceWorker(redis), setupServiceAppointmentWorker(redis)];
}
