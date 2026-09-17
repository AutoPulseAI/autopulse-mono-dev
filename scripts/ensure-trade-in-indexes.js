#!/usr/bin/env node
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import TradeIn, { TRADE_SOURCE_INDEX } from '../app/models/TradeIn.js';
import { matchesUniqueIndex } from '../app/worker/dealervault/common/indexProtection.js';

export async function ensureTradeIndexes(connection, apply = false) {
  const collection = connection.collection(TradeIn.collection.name);
  let indexes;
  try { indexes = await collection.listIndexes().toArray(); }
  catch (error) { if (error.code !== 26) throw error; indexes = []; }
  if (indexes.some(index => matchesUniqueIndex(index, TRADE_SOURCE_INDEX))) return 0;
  if (!apply) { console.info('Trade source index missing or incompatible'); return 1; }
  await collection.createIndex(TRADE_SOURCE_INDEX.key, TRADE_SOURCE_INDEX.options);
  console.info('Trade source index created');
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.TRADE_INDEX_MONGO_URI || args.some(arg => arg !== '--apply')) {
    console.error('Set TRADE_INDEX_MONGO_URI; usage: node scripts/ensure-trade-in-indexes.js [--apply]');
    process.exitCode = 1;
    return;
  }
  // No automatic production .env loading, index drops, or syncIndexes().
  const connection = mongoose.createConnection(process.env.TRADE_INDEX_MONGO_URI, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000,
  });
  try {
    await connection.asPromise();
    process.exitCode = await ensureTradeIndexes(connection, args.includes('--apply'));
  } catch {
    console.error('TRADE_INDEX_FAILED');
    process.exitCode = 1;
  } finally { await connection.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
