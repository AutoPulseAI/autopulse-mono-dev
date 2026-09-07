export const PARTS_QUEUE = 'dealervault-parts-inventory';

export function defaultJobOptions() {
  return {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100, removeOnFail: false,
  };
}
