/** Canonical form for User.email: trim + lowercase (RFC 5321 local-part case sensitivity is rarely relied on). */
export function normalizeUserEmail(email) {
  if (email == null || typeof email !== "string") return email;
  return email.trim().toLowerCase();
}
