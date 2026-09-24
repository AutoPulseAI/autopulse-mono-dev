/**
 * Shared request-authorization helper for routes that must accept EITHER a
 * human dealer/agency/admin session (Bearer JWT, same convention as
 * localStorage("dealertoken") sent by e.g. app/dealer/customers/[id]/page.js)
 * OR a trusted internal service call (see internalServiceAuth.js).
 *
 * Several existing routes (app/api/customers/[id]/360/route.js and others)
 * already duplicate a local loadAuthenticatedUser() — this file is NOT a
 * retrofit of those; it's used by the internal-service-aware routes this
 * change introduces/touches, so as not to alter the auth behavior of routes
 * outside this feature's scope.
 */

import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "@models/User";
import { verifyInternalServiceToken } from "./internalServiceAuth";

/**
 * @param {Request} req
 * @returns {Promise<import("mongoose").Document|null>}
 */
export async function loadAuthenticatedUser(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !/^Bearer\s+\S+$/.test(authHeader)) return null;

  const token = authHeader.replace(/^Bearer\s+/, "");
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded?.userId || !mongoose.isValidObjectId(decoded.userId)) return null;

  return User.findById(decoded.userId).select("_id type parent_id vendor_id");
}

/**
 * @param {Request} req
 * @returns {Promise<{mode: "internal_service"} | {mode: "user", currentUser: object} | null>}
 *   null means unauthenticated — caller should respond 401.
 */
export async function resolveRequestAuthorization(req) {
  // Internal-service check first: it's the cheaper, more specific check
  // (single hash comparison, no DB round-trip), and a request carrying a
  // valid service token is never also expected to carry a human JWT.
  if (verifyInternalServiceToken(req)) {
    return { mode: "internal_service" };
  }

  const currentUser = await loadAuthenticatedUser(req);
  if (!currentUser) return null;

  return { mode: "user", currentUser };
}
