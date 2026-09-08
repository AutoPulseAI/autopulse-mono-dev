#!/usr/bin/env node
// Explicit URI required. Never load production .env files or call syncIndexes().
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import User from '../app/models/User.js';
import Batch from '../app/models/DealerVaultImportBatch.js';
import Part from '../app/models/PartInventory.js';
import Customer, { CUSTOMER_MAPPING_INDEX } from '../app/models/Customer.js';
import Deal, { DEAL_NATURAL_KEY_INDEX } from '../app/models/Deal.js';
import RepairOrder, { REPAIR_ORDER_NATURAL_KEY_INDEX } from '../app/models/RepairOrder.js';
import ServiceAppointment, { SERVICE_APPOINTMENT_NATURAL_KEY_INDEX } from '../app/models/ServiceAppointment.js';
import { matchesUniqueIndex } from '../app/worker/dealervault/common/indexProtection.js';

export const requiredIndexes = [
  { collection: ServiceAppointment.collection.name, ...SERVICE_APPOINTMENT_NATURAL_KEY_INDEX },
  { collection: RepairOrder.collection.name, ...REPAIR_ORDER_NATURAL_KEY_INDEX },
  { collection: Customer.collection.name, ...CUSTOMER_MAPPING_INDEX },
  { collection: Deal.collection.name, ...DEAL_NATURAL_KEY_INDEX },
  { collection: User.collection.name, key: { dv_dealer_id: 1 }, options: {
    unique: true, partialFilterExpression: { type: 'dealer', dv_dealer_id: { $type: 'string' } },
  } },
  { collection: Batch.collection.name,
    key: { dealer_id: 1, fileName: 1, fileType: 1, batchId: 1 }, options: { unique: true } },
  { collection: Part.collection.name,
    key: { dealer_id: 1, part_number: 1 }, options: { unique: true } },
];

export async function ensureIndexes(connection, apply = false) {
  let missing = 0;
  for (const spec of requiredIndexes) {
    const collection = connection.collection(spec.collection);
    let indexes;
    try { indexes = await collection.listIndexes().toArray(); }
    catch (error) { if (error.code !== 26) throw error; indexes = []; }
    const match = indexes.some(index => matchesUniqueIndex(index, spec));
    if (match) console.info(`${spec.collection}: required index present`);
    else if (apply) {
      await collection.createIndex(spec.key, spec.options);
      console.info(`${spec.collection}: required index created`);
    } else {
      missing += 1;
      console.info(`${spec.collection}: required index missing or incompatible`);
    }
  }
  return missing;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || !process.env.DEALERVAULT_INDEX_MONGO_URI) {
    console.error('Set DEALERVAULT_INDEX_MONGO_URI; usage: node scripts/ensure-dealervault-indexes.js [--apply]');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(process.env.DEALERVAULT_INDEX_MONGO_URI, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000,
  });
  try {
    await connection.asPromise();
    const missing = await ensureIndexes(connection, args.includes('--apply'));
    if (missing) process.exitCode = 1;
  } catch {
    console.error('INDEX_CHECK_FAILED: verify connectivity, permissions and conflicting indexes/data');
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
