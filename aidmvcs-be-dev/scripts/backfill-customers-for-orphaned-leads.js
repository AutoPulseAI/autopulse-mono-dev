/**
 * Migration Script: Backfill Customer rows for orphaned Leads
 * Finds every Lead with no linked Customer (customer_id null/missing) and
 * runs it through the same resolution/creation logic the app already uses
 * for new leads (app/lib/customerResolver.js), so orphaned leads end up
 * matched to an existing Customer or get a new one created for them.
 *
 * Run with: node scripts/backfill-customers-for-orphaned-leads.js [--dealerId=<id>] [--dryRun]
 */

import dbConnect from "../app/lib/mongodb.js";
import mongoose from "mongoose";
import Lead from "../app/models/Lead.js";
import { linkCustomerToLead } from "../app/lib/customerResolver.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);

const dealerId = args.dealerId || null;
const dryRun = Boolean(args.dryRun);

async function migrate() {
  try {
    console.log("Connecting to MongoDB...");
    await dbConnect();
    console.log("Connected successfully!");

    const filter = {
      $or: [{ customer_id: null }, { customer_id: { $exists: false } }],
    };
    if (dealerId) filter.dealer_id = dealerId;

    const orphanedLeads = await Lead.find(filter);
    console.log(`Found ${orphanedLeads.length} orphaned lead(s)${dealerId ? ` for dealer_id=${dealerId}` : ""}.`);

    if (orphanedLeads.length === 0 || dryRun) {
      if (dryRun) console.log("Dry run - no changes made.");
      await mongoose.connection.close();
      return;
    }

    let linked = 0;
    let stillUnresolved = 0;

    for (const lead of orphanedLeads) {
      await linkCustomerToLead(lead, { source: lead.source });
      if (lead.customer_id) {
        linked++;
      } else {
        stillUnresolved++;
        console.warn(`  - Lead ${lead._id} still unresolved (no usable email/phone, or an email/phone identity conflict).`);
      }
    }

    console.log(`✅ Migration completed!`);
    console.log(`   - Linked: ${linked}`);
    console.log(`   - Still unresolved: ${stillUnresolved}`);

    await mongoose.connection.close();
    console.log("Database connection closed.");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate();
