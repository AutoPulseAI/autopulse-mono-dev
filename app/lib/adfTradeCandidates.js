import { createHash } from 'node:crypto';
import { parseAdfTree } from './adfLeadParser.js';

export const TRADE_FIELDS = ['vin', 'year', 'make', 'model', 'trim', 'miles', 'exterior_color', 'interior_color', 'condition', 'notes'];
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const keyOf = (value) => value.replace(/^@_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const marker = /\b(?:trade(?:[- ]?in)?|trade vehicle|vehicle to trade|current vehicle)\b/i;
const negative = /\b(?:no|not|without|don't|do not)\s+(?:a\s+|have\s+(?:a\s+)?)?trade(?:[- ]?in)?\b/i;
const restricted = /ssn|socialsecurity|government|passport|license|account|bank|credit|debit|payment|finance|financing|payoff|price|value|valuation|offer|acv|gross|profit|income|salary|balance|equity|loan|lien|customer|contact|address|email|phone|name/i;
const aliases = {
  vin: 'vin', vehicleidentificationnumber: 'vin', year: 'year', modelyear: 'year',
  make: 'make', manufacturer: 'make', model: 'model', trim: 'trim',
  miles: 'miles', mileage: 'miles', odometer: 'miles', exteriorcolor: 'exterior_color',
  color: 'exterior_color', interiorcolor: 'interior_color', condition: 'condition',
};
function fieldOf(key) {
  const normalized = keyOf(key);
  return aliases[normalized] || aliases[normalized.replace(/^(?:tradein|tradevehicle|trade|currentvehicle|vehicle)/, '')];
}
function scalar(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object') return scalar(value['#text']);
  return '';
}

// This output is INTERNAL ONLY. Queue jobs carry references/keys, never this tree.
export function detectTradeCandidates(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) return [];
  // No DTD/entity expansion is needed for trade enrichment.
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) return [];
  const result = parseAdfTree(content);
  if (!result) return [];
  const candidates = [];
  let visited = 0;
  const add = (path, fields, comments) => {
    candidates.push({ key: createHash('sha256').update(JSON.stringify(path)).digest('hex'), fields, comments });
  };
  function walk(value, path = [], context = false, depth = 0) {
    if (++visited > 10000 || depth > 40 || candidates.length >= 20) return;
    if (Array.isArray(value)) return value.forEach((entry, i) => walk(entry, [...path, i], context, depth + 1));
    const lastKey = keyOf(String(path.filter(p => typeof p === 'string').at(-1) || ''));
    const tradeNode = /^(?:trade|tradein|tradevehicle|vehicletrade|vehicletotrade|currentvehicle)s?$/.test(lastKey);
    if (!value || typeof value !== 'object') {
      const text = scalar(value);
      if (text && text.length <= 4096 && (context || tradeNode || marker.test(text)) && !negative.test(text)) add(path, {}, [text]);
      return;
    }
    const entries = Object.entries(value);
    const attrTrade = entries.some(([key, val]) => key.startsWith('@_')
      && ['interest', 'type', 'purpose', 'role'].includes(keyOf(key))
      && /^(?:trade|tradein|tradevehicle|vehicletotrade|currentvehicle|current)$/.test(keyOf(scalar(val))));
    const prefixed = entries.some(([key]) => /^(?:tradein|trade|currentvehicle)/.test(keyOf(key)) && fieldOf(key));
    const active = context || tradeNode || attrTrade || prefixed;
    const fields = {};
    const comments = [];
    for (const [key, val] of entries) {
      const field = fieldOf(key);
      if (active && field && (!prefixed || context || tradeNode || attrTrade || /^(trade|currentvehicle)/.test(keyOf(key)))) {
        fields[field] = scalar(val);
        if (field === 'miles' && val && typeof val === 'object') {
          fields.mileageUnits = scalar(val['@_units'] || val['@_unit']);
        }
      }
      if (/^(comments?|description|notes?)$/.test(keyOf(key))) comments.push(scalar(val));
    }
    if (active && (fields.vin || fields.make || fields.model || fields.year)) {
      add(path, fields, comments);
      return;
    }
    for (const [key, val] of entries) {
      if (key.startsWith('@_')) continue;
      // Never explore financial/identity subtrees, but allow customer wrappers
      // so customer/comments containing trade descriptions remain discoverable.
      if (restricted.test(keyOf(key)) && !['customer', 'contact'].includes(keyOf(key))) continue;
      walk(val, [...path, key], active, depth + 1);
    }
  }
  walk(result.parsed);
  return candidates;
}

const makes = 'Alfa Romeo|Aston Martin|Land Rover|Mercedes-Benz|Mercedes Benz|Rolls-Royce|Acura|Audi|Bentley|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Ferrari|Fiat|Ford|Genesis|GMC|Honda|Hyundai|Infiniti|Jaguar|Jeep|Kia|Lamborghini|Lexus|Lincoln|Lucid|Maserati|Mazda|McLaren|MINI|Mitsubishi|Nissan|Polestar|Pontiac|Porsche|Ram|Rivian|Saab|Saturn|Scion|Subaru|Suzuki|Tesla|Toyota|Volkswagen|Volvo';
const makePattern = new RegExp(`^(?:${makes})$`, 'i');
const identityPattern = new RegExp(`\\b((?:19|20)\\d{2})\\s+(${makes})\\s+([a-z][a-z0-9-]*|[a-z0-9-]*[a-z][a-z0-9-]*|\\d{1,4})(?:\\s+(Series|Class|Sport|Hybrid|Prime|Cross|Cruiser|Rover|Model [3SXY]))?\\b`, 'ig');
const unsafe = /(?:\b(?:ssn|social|security|passport|license|account|routing|bank|card|credit|debit|payoff|price|value|valuation|offer|acv|gross|profit|payment|finance|financing|loan|lien|balance|equity|income|salary|dollars?|usd|eur|owed|owe|worth|paid|cost|phone|email|address|customer|call|contact)\b|[$€£@]|https?:|\d{5,})/i;
const notePatterns = [
  /\b(?:minor|major|no) (?:scratches|dents|damage|rust)\b/gi,
  /\b(?:new|worn|good) tires\b/gi,
  /\b(?:runs well|does not run|not running|engine damage|transmission damage|single owner|one owner|two owners|non[- ]smoker|smoke[- ]free|garage[- ]kept)\b/gi,
];
const conditionPattern = /\b(?:excellent|good|fair|poor|like new) condition\b/i;
const labelledVin = /\bVIN\s*[:#-]?\s*([A-HJ-NPR-Z0-9]{17})\b/gi;
const colors = /^(?:black|white|silver|gray|grey|red|blue|green|brown|beige|tan|gold|orange|yellow|purple|burgundy)(?: (?:metallic|pearl))?$/i;

function numberValue(value, min, max) {
  const str = scalar(value);
  if (!/^\d+(?:,\d{3})*$/.test(str)) return null;
  const number = Number(str.replaceAll(',', ''));
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
function label(value) {
  const str = scalar(value);
  return str.length <= 40 && /^[a-z0-9-]+(?: [a-z0-9-]+){0,2}$/i.test(str)
    && !unsafe.test(str) && !/(?:\d[ -]*){5,}/.test(str) ? str : null;
}

// Do not forward prose after regex redaction. Reconstruct a tiny vehicle-only
// payload from typed fields and recognized vehicle phrases. Unknown prose is
// deliberately discarded, including personal names and unlabeled identifiers.
export function sanitizeTradeCandidate(candidate) {
  const fields = candidate.fields || {};
  const result = Object.fromEntries(TRADE_FIELDS.map(field => [field, null]));
  result.vin = VIN_PATTERN.test(scalar(fields.vin)) ? scalar(fields.vin).toUpperCase() : null;
  result.year = numberValue(fields.year, 1900, new Date().getFullYear() + 2);
  result.make = makePattern.test(scalar(fields.make)) ? scalar(fields.make) : null;
  result.model = label(fields.model);
  result.trim = label(fields.trim);
  if (!fields.mileageUnits || /^(mi|miles?)$/i.test(fields.mileageUnits)) {
    result.miles = numberValue(fields.miles, 0, 2000000);
  }
  for (const field of ['exterior_color', 'interior_color']) {
    result[field] = colors.test(scalar(fields[field])) ? scalar(fields[field]) : null;
  }
  const condition = scalar(fields.condition);
  if (/^(excellent|good|fair|poor|like new|new|used)$/i.test(condition)) result.condition = condition;

  const allIdentities = (candidate.comments || []).flatMap(comment =>
    typeof comment === 'string' && comment.length <= 4096 ? [...comment.matchAll(identityPattern)] : []);
  // Do not combine the identity of one vehicle with the mileage/notes of another.
  const identities = new Set(allIdentities.map(match => match[0].toLowerCase()));
  if (identities.size > 1) return result;
  for (const comment of candidate.comments || []) {
    if (!comment || comment.length > 4096) continue;
    // A clause containing restricted content is dropped whole, not repaired.
    const clauses = comment.split(/[;\n.!?]|,(?!\d)/).filter(part => !unsafe.test(part
      .replace(/\b\d[\d,]*\s*(?:miles?|mi)\b/gi, '').replace(labelledVin, '')));
    for (const clause of clauses) {
      const identities = [...clause.matchAll(identityPattern)];
      // Ambiguous multi-vehicle prose is omitted instead of mixing vehicles.
      if (identities.length > 1) continue;
      const found = identities[0];
      if (found) {
        const model = label([found[3], found[4]].filter(Boolean).join(' '));
        if ((result.year && result.year !== Number(found[1]))
          || (result.make && result.make.toLowerCase() !== found[2].toLowerCase())
          || (result.model && result.model.toLowerCase() !== model?.toLowerCase())) continue;
        result.year ??= numberValue(found[1], 1900, new Date().getFullYear() + 2);
        result.make ??= found[2];
        result.model ??= model;
      }
      const vins = [...clause.matchAll(labelledVin)];
      if (vins.length === 1) result.vin ??= vins[0][1].toUpperCase();
      const mileage = clause.match(/\b(\d[\d,]*)\s*(?:miles?|mi)\b/i);
      if (mileage) result.miles ??= numberValue(mileage[1], 0, 2000000);
      const explicitCondition = clause.match(conditionPattern);
      if (explicitCondition) result.condition ??= explicitCondition[0].replace(/ condition$/i, '');
      const notes = notePatterns.flatMap(pattern => [...clause.matchAll(pattern)].map(match => match[0]));
      if (notes.length) result.notes = [...new Set([...(result.notes?.split('; ') || []), ...notes])].join('; ');
    }
  }
  return result;
}

export function hasTradeIdentity(trade) {
  return Boolean(trade.vin || (trade.year && trade.make && trade.model));
}
