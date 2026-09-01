/**
 * Migration Script: Backfill Customer rows for orphaned Leads
 * Finds every Lead with no linked Customer (customer_id null/missing) and
 * runs it through the same resolution/creation logic the app already uses
 * for new leads (app/lib/customerResolver.js), so orphaned leads end up
 * matched to an existing Customer or get a new one created for them.
 *
 * Every Lead this run touches (linked or still unresolved) is stamped with
 * a `migration_batch` id (e.g. `migration_20260829_213045`), one per run,
 * so they can be found again later. Any Customer this run actually *creates*
 * (as opposed to matching an existing one) gets the same stamp.
 *
 * Run with: node scripts/backfill-customers-for-orphaned-leads.js [--dealerId=<id>] [--dryRun]
 */

import dbConnect from "../app/lib/mongodb.js";
import mongoose from "mongoose";
import Lead from "../app/models/Lead.js";
import Customer from "../app/models/Customer.js";
import { linkCustomerToLead } from "../app/lib/customerResolver.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);

const dealerId = args.dealerId || null;
const dryRun = Boolean(args.dryRun);

function formatMigrationBatchName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `migration_${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

async function migrate() {
  const migrationBatch = formatMigrationBatchName();
  console.log(`Migration batch: ${migrationBatch}`);

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
    let customersCreated = 0;
    let stillUnresolved = 0;

    for (const lead of orphanedLeads) {
      // Set before linkCustomerToLead() so that when it links a customer_id
      // it saves this in the same write, instead of needing a second one.
      lead.migration_batch = migrationBatch;

      const resolution = await linkCustomerToLead(lead, { source: lead.source });

      if (lead.customer_id) {
        linked++;

        if (resolution?.created) {
          customersCreated++;
          try {
            await Customer.updateOne(
              { _id: resolution.customerId },
              { $set: { migration_batch: migrationBatch } }
            );
          } catch (stampError) {
            console.error(`  - Failed to stamp migration_batch on Customer ${resolution.customerId}:`, stampError);
          }
        }
      } else {
        stillUnresolved++;
        // linkCustomerToLead() only saves the Lead when it successfully
        // links a customer_id, so persist the migration_batch stamp
        // ourselves here - unresolved leads should still be traceable back
        // to the run that examined them.
        try {
          await lead.save();
        } catch (saveError) {
          console.error(`  - Failed to stamp migration_batch on Lead ${lead._id}:`, saveError);
        }
        console.warn(`  - Lead ${lead._id} still unresolved (no usable email/phone, or an email/phone identity conflict).`);
      }
    }

    console.log(`✅ Migration completed! (batch: ${migrationBatch})`);
    console.log(`   - Linked: ${linked}`);
    console.log(`   - New customers created: ${customersCreated}`);
    console.log(`   - Still unresolved: ${stillUnresolved}`);

    await mongoose.connection.close();
    console.log("Database connection closed.");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate();
