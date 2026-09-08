const customerSourceFields = [
  'Customer Number', 'Email 1', 'Email 2', 'Email 3',
  'Home Phone', 'Cell Phone', 'Work Phone',
];

// Resolvers intentionally return null plus a warning for absent identities.
// Partial source rows use omission semantics, so remove both together before
// persistence to preserve existing links without recording false warnings.
export function preserveAbsentCustomerVehicleRelationships(entries) {
  for (const entry of entries) {
    const { document } = entry;
    if (document.customer_id === null
        && !customerSourceFields.some(field => Object.hasOwn(document, field))) {
      delete document.customer_id;
      entry.warnings = entry.warnings.filter(code => code !== 'CUSTOMER_UNRESOLVED');
    }
    if (document.vehicle_id === null && !Object.hasOwn(document, 'VIN')) {
      delete document.vehicle_id;
      entry.warnings = entry.warnings.filter(code => code !== 'VIN_MISSING');
    }
  }
}
