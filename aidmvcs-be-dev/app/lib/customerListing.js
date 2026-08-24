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
