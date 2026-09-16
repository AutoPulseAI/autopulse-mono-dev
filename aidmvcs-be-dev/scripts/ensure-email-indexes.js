#!/usr/bin/env node
// Explicit URI required. Never load application environment files or call syncIndexes().
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import Email, { EMAIL_CONVERSATION_INDEX } from '../app/models/Email.js';

function hasMatchingIndex(indexes, expected) {
  const expectedEntries = Object.entries(expected.key);
  return indexes.some((index) => {
    const actualEntries = Object.entries(index.key || {});
    return actualEntries.length === expectedEntries.length
      && actualEntries.every(([field, direction], position) => {
        const [expectedField, expectedDirection] = expectedEntries[position] || [];
        return field === expectedField && direction === expectedDirection;
      });
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

  if (hasMatchingIndex(indexes, EMAIL_CONVERSATION_INDEX)) {
    console.info(`${Email.collection.name}: conversation cursor index present`);
    return 0;
  }

  if (!apply) {
    console.info(`${Email.collection.name}: conversation cursor index missing`);
    return 1;
  }

  await collection.createIndex(
    EMAIL_CONVERSATION_INDEX.key,
    EMAIL_CONVERSATION_INDEX.options
  );
  console.info(`${Email.collection.name}: conversation cursor index created`);
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
