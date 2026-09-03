/**
 * Migration Script: Mark all existing messages as read
 * This should be run once to set all existing messages in the database as "read"
 * 
 * Run with: node scripts/mark-existing-messages-read.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local from project root
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// Define Email schema inline for migration
const emailSchema = new mongoose.Schema({
  sender: String,
  recipient: String,
  subject: String,
  message_id: String,
  parent_conversation: String,
  date: Date,
  body: mongoose.Schema.Types.Mixed,
  mail_content: String,
  dealer_id: String,
  headers: mongoose.Schema.Types.Mixed,
  timestamp: Date,
  is_appointment_notification: Boolean,
  appointment_notification_type: String,
  parent_message_id: String,
  communication_type: String,
  message_by: mongoose.Schema.Types.ObjectId,
  status: String,
  lead_id: mongoose.Schema.Types.ObjectId,
  is_note: Boolean,
  read: Boolean,
  read_by: mongoose.Schema.Types.ObjectId,
  read_at: Date
}, { strict: false });

async function migrateMessages() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected successfully!');

    const Email = mongoose.model('Email', emailSchema);

    // Count total messages with lead_id that don't have read field
    const totalCount = await Email.countDocuments({
      lead_id: { $exists: true, $ne: null },
      $or: [
        { read: { $exists: false } },
        { read: null }
      ]
    });

    console.log(`Found ${totalCount} messages with lead_id without read status`);

    if (totalCount === 0) {
      console.log('All messages with lead_id already have read status. Migration not needed.');
      await mongoose.connection.close();
      return;
    }

    console.log('Marking all existing messages with lead_id as read...');

    // Update only messages with lead_id to set read = true
    const result = await Email.updateMany(
      {
        lead_id: { $exists: true, $ne: null },
        $or: [
          { read: { $exists: false } },
          { read: null }
        ]
      },
      {
        $set: {
          read: true,
          read_at: new Date()
        }
      }
    );

    console.log(`✅ Migration completed!`);
    console.log(`   - Modified: ${result.modifiedCount} messages with lead_id`);
    console.log(`   - All existing messages with lead_id are now marked as read`);
    console.log(`   - Messages without lead_id were skipped (system messages)`);
    console.log(`   - New messages will default to unread (read: false)`);

    await mongoose.connection.close();
    console.log('Database connection closed.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateMessages();
