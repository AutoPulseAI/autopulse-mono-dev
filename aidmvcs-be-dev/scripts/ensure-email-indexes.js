#!/usr/bin/env node
// Explicit URI required. Never load application environment files or call syncIndexes().
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import Email, { EMAIL_AI_IDEMPOTENCY_INDEX, EMAIL_CONVERSATION_INDEX, EMAIL_SMS_PAIR_INDEX } from '../app/models/Email.js';

const EMAIL_INDEXES = [EMAIL_CONVERSATION_INDEX, EMAIL_SMS_PAIR_INDEX, EMAIL_AI_IDEMPOTENCY_INDEX];

function hasMatchingIndex(indexes, expected) {
  const expectedEntries = Object.entries(expected.key);
  return indexes.some((index) => {
    const actualEntries = Object.entries(index.key || {});
    const keyMatches = actualEntries.length === expectedEntries.length
      && actualEntries.every(([field, direction], position) => {
        const [expectedField, expectedDirection] = expectedEntries[position] || [];
        return field === expectedField && direction === expectedDirection;
      });
    return keyMatches
      && JSON.stringify(index.partialFilterExpression || null)
        === JSON.stringify(expected.options.partialFilterExpression || null);
  });
}

export async function ensureEmailIndexes(connection, apply = false) {
  const collection = connection.collection(Email.collection.name);
  let indexes;
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    if (error.code !== 26) throw error;
    indexes = [];
  }

  const missing = EMAIL_INDEXES.filter(expected => !hasMatchingIndex(indexes, expected));
  if (!missing.length) {
    console.info(`${Email.collection.name}: required indexes present`);
    return 0;
  }

  if (!apply) {
    console.info(`${Email.collection.name}: required indexes missing: ${missing.map(index => index.options.name).join(', ')}`);
    return 1;
  }

  for (const index of missing) {
    await collection.createIndex(index.key, index.options);
    console.info(`${Email.collection.name}: ${index.options.name} index created`);
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const uri = process.env.EMAIL_INDEX_MONGO_URI;
  if (args.some((arg) => arg !== '--apply') || !uri) {
    console.error('Set EMAIL_INDEX_MONGO_URI; usage: node scripts/ensure-email-indexes.js [--apply]');
    process.exitCode = 1;
    return;
  }

  const connection = mongoose.createConnection(uri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await connection.asPromise();
    process.exitCode = await ensureEmailIndexes(connection, args.includes('--apply'));
  } catch {
    console.error('EMAIL_INDEX_CHECK_FAILED: verify connectivity, permissions, and conflicting indexes');
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
