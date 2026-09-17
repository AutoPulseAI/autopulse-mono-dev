import mongoose from 'mongoose';
import { Worker, UnrecoverableError } from 'bullmq';
import dbConnect from '../lib/mongodb.js';
import RawAdfPayload from '../models/RawAdfPayload.js';
import Email from '../models/Email.js';
import Lead from '../models/Lead.js';
import Customer from '../models/Customer.js';
import TradeIn, { TRADE_SOURCE_INDEX } from '../models/TradeIn.js';
import { detectTradeCandidates, sanitizeTradeCandidate, hasTradeIdentity } from '../lib/adfTradeCandidates.js';
import { extractTrade, validateTradeExtraction, TradeExtractionError } from '../lib/adfTradeExtraction.js';
import { TRADE_QUEUE, logTradeEvent } from '../lib/adfTradeEnrichment.js';
import { requireUniqueIndex } from './dealervault/common/indexProtection.js';

export function createAdfTradeProcessor({
  connect = dbConnect, Raw = RawAdfPayload, Emails = Email, Leads = Lead, Customers = Customer,
  Trades = TradeIn, extract = extractTrade, checkIndex = requireUniqueIndex, log = logTradeEvent,
} = {}) {
  return async function processTrade(job) {
    const context = {};
    let stage = 'extraction';
    try {
      const data = job.data;
      if (!data || !mongoose.isValidObjectId(data.raw_adf_payload_id)
        || typeof data.dealer_id !== 'string' || !data.dealer_id
        || typeof data.source_message_id !== 'string' || !data.source_message_id
        || !/^[a-f0-9]{64}$/.test(data.source_candidate_key || '')) throw new UnrecoverableError('INVALID_JOB');
      context.raw_adf_payload_id = data.raw_adf_payload_id;
      await connect();
      const source = { dealer_id: data.dealer_id, raw_adf_payload_id: data.raw_adf_payload_id,
        source_candidate_key: data.source_candidate_key };
      await checkIndex(Trades, TRADE_SOURCE_INDEX);
      if (await Trades.findOne(source).select('_id').lean()) { log('duplicate_skipped', context); return; }
      const raw = await Raw.findOne({ _id: data.raw_adf_payload_id, dealer_id: data.dealer_id,
        message_id: data.source_message_id }).lean();
      if (!raw) throw new UnrecoverableError('SOURCE_NOT_FOUND');
      let candidates;
      try { candidates = detectTradeCandidates(raw.raw_xml); } catch { throw new UnrecoverableError('INVALID_ADF'); }
      const candidate = candidates.find(item => item.key === data.source_candidate_key);
      if (!candidate) throw new UnrecoverableError('CANDIDATE_NOT_FOUND');
      const safeInput = sanitizeTradeCandidate(candidate);
      log('content_sanitized', context);
      if (!hasTradeIdentity(safeInput)) { log('extraction_skipped', context, 'INSUFFICIENT_IDENTITY'); return; }
      let trade;
      if (data.extraction) trade = validateTradeExtraction(data.extraction, safeInput);
      else {
        log('extraction_started', context);
        trade = validateTradeExtraction(await extract(safeInput), safeInput);
        log('extraction_succeeded', context);
        // Keep only sanitized validated facts for retries; don't repay OpenAI while
        // waiting for customer resolution or retrying a failed DB insert.
        await job.updateData({ ...data, extraction: trade });
      }
      stage = 'creation';
      const linkedEmails = await Emails.find({ dealer_id: data.dealer_id, message_id: data.source_message_id,
        lead_id: { $ne: null } }).select('lead_id').lean();
      const ids = [...new Set(linkedEmails.map(email => String(email.lead_id)))];
      // The fallback ingestion path also records sourcemail on the Lead. It may
      // not have updated the inbound Email yet. Never select an arbitrary match.
      const leads = await Leads.find({ dealer_id: data.dealer_id,
        ...(ids.length ? { _id: { $in: ids } } : { sourcemail: data.source_message_id }) })
        .select('_id customer_id dealer_id').limit(2).lean();
      if (leads.length !== 1 || !leads[0].customer_id) {
        log('waiting_for_customer', context, 'CUSTOMER_UNRESOLVED');
        throw new Error('CUSTOMER_UNRESOLVED');
      }
      const lead = leads[0];
      context.lead_id = lead._id;
      context.customer_id = lead.customer_id;
      const customer = await Customers.findOne({ _id: lead.customer_id, dealer_id: data.dealer_id,
        merged_into: null }).select('_id').lean();
      if (!customer) throw new Error('CUSTOMER_UNRESOLVED');
      const document = { ...trade, ...source, source_message_id: data.source_message_id,
        lead_id: lead._id, customer_id: customer._id, status: 'open', createdAt: new Date(), updatedAt: new Date() };
      await new Trades(document).validate();
      // Recheck persisted ownership after validation, immediately before insert.
      const stillLinked = await Leads.findOne({ _id: lead._id, dealer_id: data.dealer_id,
        customer_id: customer._id }).select('_id').lean();
      if (!stillLinked) throw new Error('CUSTOMER_UNRESOLVED');
      let result;
      try {
        result = await Trades.updateOne(source, { $setOnInsert: document }, {
          upsert: true, runValidators: true, timestamps: false,
        });
      } catch (error) {
        if (error?.code === 11000 && await Trades.findOne(source).select('_id').lean()) {
          log('duplicate_skipped', context); return;
        }
        throw error;
      }
      log(result.upsertedCount ? 'created' : 'duplicate_skipped', context);
    } catch (error) {
      const allowed = ['INVALID_JOB', 'SOURCE_NOT_FOUND', 'INVALID_ADF', 'CANDIDATE_NOT_FOUND', 'CUSTOMER_UNRESOLVED', 'INDEX_REQUIRED'];
      const code = error instanceof TradeExtractionError ? error.code
        : allowed.includes(error.message) ? error.message : 'TRADE_PROCESSING_FAILED';
      log(stage === 'creation' ? 'creation_failed' : 'extraction_failed', context, code);
      if (error instanceof UnrecoverableError || ['INVALID_EXTRACTION', 'UNSUPPORTED_FACT', 'INSUFFICIENT_IDENTITY'].includes(code)) {
        throw new UnrecoverableError(code);
      }
      throw new Error(code);
    }
  };
}

export function setupAdfTradeWorker(connection) {
  if (process.env.ADF_TRADE_ENRICHMENT_ENABLED !== 'true') return null;
  try {
    const worker = new Worker(TRADE_QUEUE, createAdfTradeProcessor(), { connection, concurrency: 2 });
    worker.on('error', () => logTradeEvent('worker_failed', {}, 'WORKER_ERROR'));
    worker.on('failed', job => logTradeEvent('job_failed', job?.data, 'RETRY_OR_REVIEW_REQUIRED'));
    return worker;
  } catch {
    logTradeEvent('worker_failed', {}, 'WORKER_START_FAILED');
    return null;
  }
}
