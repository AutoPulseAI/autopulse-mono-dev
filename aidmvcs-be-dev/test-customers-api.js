import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  escapeRegex,
  isAuthorizedForDealer,
  parseBoundedInteger,
} from "./app/lib/customerListing.js";

function fakeUserModel(users, dealers = []) {
  const find = (items, predicate) => {
    const value = items.find(predicate) || null;
    return { select: async () => value };
  };

  return {
    findById: (id) => find(users, (user) => String(user._id) === String(id)),
    findOne: (query) => find(dealers, (dealer) =>
      String(dealer._id) === String(query._id) &&
      dealer.type === query.type &&
      String(dealer.vendor_id) === String(query.vendor_id)
    ),
  };
}

test("customer listing validates pagination and escapes name searches", () => {
  assert.equal(parseBoundedInteger(null, 1, 1, 100), 1);
  assert.equal(parseBoundedInteger("0", 1, 1, 100), null);
  assert.equal(parseBoundedInteger("101", 1, 1, 100), null);
  assert.equal(parseBoundedInteger("25", 1, 1, 100), 25);
  assert.equal(escapeRegex("A.*(B)") , "A\\.\\*\\(B\\)");
});

test("dealer authorization validates parent type before using parent id", async () => {
  const dealer = new mongoose.Types.ObjectId();
  const parentDealer = new mongoose.Types.ObjectId();
  const invalidParent = new mongoose.Types.ObjectId();
  const users = [
    { _id: dealer, type: "dealer", parent_id: parentDealer },
    { _id: parentDealer, type: "dealer", parent_id: null },
    { _id: invalidParent, type: "vendor", parent_id: null },
  ];
  const UserModel = fakeUserModel(users);

  assert.equal(await isAuthorizedForDealer(users[0], parentDealer, UserModel), true);
  assert.equal(await isAuthorizedForDealer(users[0], dealer, UserModel), false);
  assert.equal(await isAuthorizedForDealer({ ...users[0], parent_id: invalidParent }, parentDealer, UserModel), false);
});

test("vendor authorization includes validated vendor subaccounts", async () => {
  const vendor = new mongoose.Types.ObjectId();
  const subaccount = new mongoose.Types.ObjectId();
  const dealer = new mongoose.Types.ObjectId();
  const users = [
    { _id: vendor, type: "vendor", parent_id: null },
    { _id: subaccount, type: "vendor", parent_id: vendor },
  ];
  const UserModel = fakeUserModel(users, [{ _id: dealer, type: "dealer", vendor_id: vendor }]);

  assert.equal(await isAuthorizedForDealer(users[1], dealer, UserModel), true);
  assert.equal(await isAuthorizedForDealer(users[1], new mongoose.Types.ObjectId(), UserModel), false);
});
