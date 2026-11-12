// PDF files of the Forms Library (templates and generated documents), in the CRM's own database (GridFS bucket
// "form_files"), never on a public URL: they are only served through the forms API, to the dealership's own staff.
import mongoose from 'mongoose';

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'form_files' });

export async function saveFile(buffer, { filename, dealerId, kind }) {
  const stream = bucket().openUploadStream(filename || 'form.pdf',
    { contentType: 'application/pdf', metadata: { dealer_id: String(dealerId), kind } });
  await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); stream.end(buffer); });
  return stream.id;
}

export async function readFile(id) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    bucket().openDownloadStream(new mongoose.Types.ObjectId(String(id)))
      .on('data', (c) => chunks.push(c)).on('end', resolve).on('error', reject);
  });
  return Buffer.concat(chunks);
}

export async function removeFile(id) {
  try { await bucket().delete(new mongoose.Types.ObjectId(String(id))); } catch { /* already gone */ }
}
