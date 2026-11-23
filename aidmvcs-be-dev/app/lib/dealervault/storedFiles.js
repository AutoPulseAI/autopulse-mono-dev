// Every DealerVault feed file in storage (S3 raw/, where the daily copy puts what DealerVault sends; 20 Nov 2026).
// Used by Admin > DMS feed: the stores list, "import the files not imported yet", and the delivery calendar
// (23 Nov 2026). Listed once and kept two minutes, so opening the page doesn't list the bucket again and again.
import AWS from 'aws-sdk';

export const FILE = /^(DVD\d+)_(\d{8})_(\d{4})_(PTINV|SL|SV|SV_APPT|OPENRO)\.txt$/;
export const IMPORTABLE = new Set(['PTINV', 'SL', 'SV', 'SV_APPT']); // the importer reads these four (OPENRO isn't imported)

let cached = null;
const TTL_MS = 2 * 60 * 1000;

function s3() {
  return new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1',
    credentials: new AWS.EC2MetadataCredentials({ httpOptions: { timeout: 5000 }, maxRetries: 3 }) });
}

/** [{ key, fileName, dv, type, day: 'YYYYMMDD', stamp: 'YYYYMMDDhhmm', at }] */
export async function storedFiles({ fresh = false } = {}) {
  if (!fresh && cached && cached.at > Date.now() - TTL_MS) return cached.files;
  const Bucket = process.env.DEALERVAULT_S3_BUCKET;
  if (!Bucket) throw new Error('DEALERVAULT_S3_BUCKET is not set');
  const out = [];
  let token;
  const client = s3();
  do {
    const page = await client.listObjectsV2({ Bucket, Prefix: 'raw/', ContinuationToken: token }).promise();
    for (const o of page.Contents || []) {
      const fileName = o.Key.slice(4);
      const m = FILE.exec(fileName);
      if (m) out.push({ key: o.Key, fileName, dv: m[1], type: m[4], day: m[2], stamp: `${m[2]}${m[3]}`, at: o.LastModified });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  cached = { at: Date.now(), files: out };
  return out;
}
