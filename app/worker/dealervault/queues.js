export const PARTS_QUEUE = 'dealervault-parts-inventory';
export const SALES_QUEUE = 'dealervault-sales';
export const SERVICE_QUEUE = 'dealervault-service';
export const SERVICE_APPOINTMENTS_QUEUE = 'dealervault-service-appointments';

export function defaultJobOptions() {
  return {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100, removeOnFail: false,
  };
}
