// Desk Log values shared by the screen and the server (no server imports here).

// Stage display order from the APPRAISAL spec. Not forced to be linear: any stage can be picked at any time, and the
// stage is optional (APPRAISAL only when there is a trade).
export const STAGES = Object.freeze(['QUALIFY', 'TEST DRIVE', 'APPRAISAL', 'PROPOSAL', 'T.O.', 'VERBAL AGREEMENT']);

export const OUTCOMES = Object.freeze(['SOLD PENDING', 'SOLD DELIVERED', 'UNSOLD']);

// SOW 9C unsold dispositions, with the labels the Desk Log design shows.
export const UNSOLD_REASONS = Object.freeze({
  NEGATIVE_EQUITY: 'Negative Equity',
  DND: 'DND',
  PRICE_PAYMENT: 'Price/Payment',
  CREDIT: 'Credit',
  HOT: 'Hot',
  FUTURE_FOLLOW_UP: 'Future Follow-Up',
  CAR_FINDER: 'Car Finder',
});

export const DEPARTMENTS = Object.freeze(['sales', 'service']);

// Stalled: open and in the same stage (or without one) for this long. Shown on the manager view.
export const STALLED_MINUTES = 60;
