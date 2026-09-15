import mongoose from "mongoose";
import User from "../models/User.js";

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseBoundedInteger(value, fallback, minimum, maximum) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

export const CUSTOMER_SOURCE_VALUES = ["inbound", "dealervault", "both", "manual", "unknown"];

// Mongo-query mirror of hasDealerVaultOrigin/hasInboundOrigin/getOriginBadge
// in app/api/customers/[id]/360/assemble.js - keep these two in sync the same
// way customerResolver.js's own hasDealerVaultOrigin copy is kept in sync
// with assemble.js's. leadCustomerIds is the set of Customer _ids that have
// at least one linked Lead (Lead.distinct("customer_id", ...)), needed
// because "Inbound Lead" counts a customer with no inbound_lead flag but a
// linked Lead too (a rollout-gap fallback - see assemble.js's comments).
export function buildSourceQuery(source, leadCustomerIds) {
  const dealervaultOr = [
    { dealervault_upload: true },
    { "extra.dealervault.customer_numbers.0": { $exists: true } },
    { "extra.dealervault.customer_numbers": { $type: "string" } },
  ];
  const inboundOr = [
    { inbound_lead: true },
    { _id: { $in: leadCustomerIds } },
  ];

  switch (source) {
    case "inbound":
      return [{ $or: inboundOr }, { $nor: dealervaultOr }];
    case "dealervault":
      return [{ $or: dealervaultOr }, { $nor: inboundOr }];
    case "both":
      return [{ $or: dealervaultOr }, { $or: inboundOr }];
    case "manual":
      return [{ $nor: dealervaultOr }, { $nor: inboundOr }, { manual_entry: true }];
    case "unknown":
      return [{ $nor: dealervaultOr }, { $nor: inboundOr }, { manual_entry: { $ne: true } }];
    default:
      return [];
  }
}

async function getVendorScope(user, UserModel) {
  const visited = new Set();
  let current = user;

  while (current?.parent_id) {
    const currentId = String(current._id);
    if (visited.has(currentId)) return null;
    visited.add(currentId);

    const parent = await UserModel.findById(current.parent_id).select("_id type parent_id");
    if (!parent || parent.type !== "vendor") return null;
    current = parent;
  }

  return current?.type === "vendor" ? String(current._id) : null;
}

export async function isAuthorizedForDealer(user, dealerId, UserModel = User) {
  const requestedDealerId = String(dealerId);

  if (user.type === "admin") return true;

  if (user.type === "dealer") {
    let authorizedDealerId;
    if (!user.parent_id) {
      authorizedDealerId = String(user._id);
    } else {
      const parent = await UserModel.findById(user.parent_id).select("_id type");
      if (!parent || parent.type !== "dealer") return false;
      authorizedDealerId = String(parent._id);
    }
    return authorizedDealerId === requestedDealerId;
  }

  if (user.type === "vendor") {
    const vendorId = await getVendorScope(user, UserModel);
    if (!vendorId || !mongoose.isValidObjectId(requestedDealerId)) return false;

    return Boolean(await UserModel.findOne({
      _id: requestedDealerId,
      type: "dealer",
      vendor_id: vendorId,
    }).select("_id"));
  }

  return false;
}
