/**
 * True if the user still has paid time through package_expiry (e.g. cancel at period end).
 * Does not require current_subscription — cancelled subs can remain valid until expiry.
 */
export function isPackageExpiryValid(packageExpiry) {
  if (packageExpiry == null || packageExpiry === "") return false;
  const d = new Date(packageExpiry);
  if (Number.isNaN(d.getTime())) return false;
  return d >= new Date();
}
