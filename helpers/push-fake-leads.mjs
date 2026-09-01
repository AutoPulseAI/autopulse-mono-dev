#!/usr/bin/env node
/**
 * Inserts fake Lead documents directly into MongoDB, bypassing the app/API
 * layer entirely. Because that layer is what normally creates/links a
 * Customer for a new lead (aidmvcs-be-dev/app/lib/customerResolver.js),
 * every lead inserted here comes out with customer_id: null -- orphaned by
 * construction. Pair with
 * aidmvcs-be-dev/scripts/backfill-customers-for-orphaned-leads.js to test
 * that migration.
 *
 * Usage:
 *   node helpers/push-fake-leads.mjs --dealerId=<dealerObjectId> [--count=10] [--source=email]
 */

import { connectDb, disconnectDb, mongoose } from "../aidmvcs-be-dev/scripts/seed/connect.js";
import Lead from "../aidmvcs-be-dev/app/models/Lead.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);

const dealerId = args.dealerId;
const count = parseInt(args.count, 10) || 10;
const source = args.source || "email";

if (!dealerId) {
  console.error("Usage: node helpers/push-fake-leads.mjs --dealerId=<id> [--count=10] [--source=email]");
  process.exit(1);
}

const FIRST_NAMES = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
const EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"];

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomDigits(length) {
  let digits = "";
  for (let i = 0; i < length; i++) digits += Math.floor(Math.random() * 10);
  return digits;
}

function buildFakeLead(index) {
  const firstName = randomItem(FIRST_NAMES);
  const lastName = randomItem(LAST_NAMES);
  const uniqueSuffix = `${Date.now()}${index}`;
  return {
    name: `${firstName} ${lastName}`,
    email: `${firstName}.${lastName}.${uniqueSuffix}@${randomItem(EMAIL_DOMAINS)}`.toLowerCase(),
    phone: `+1${randomDigits(10)}`,
    source,
    dealer_id: dealerId,
  };
}

async function main() {
  await connectDb();

  const fakeLeads = Array.from({ length: count }, (_, i) => buildFakeLead(i));
  const inserted = await Lead.insertMany(fakeLeads);

  console.log(`Inserted ${inserted.length} fake lead(s) for dealer_id=${dealerId}`);
  inserted.forEach((lead) => console.log(`  - ${lead._id}  ${lead.name}  ${lead.email}`));

  await disconnectDb();
}

main().catch(async (error) => {
  console.error("Failed to insert fake leads:", error);
  await mongoose.disconnect();
  process.exit(1);
});
