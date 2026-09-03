// app/api/leads/import/route.js
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";

import User from '@models/User';
import EmailAccount from '@models/EmailAccount';
import { sendSubscriptionExpiryNotification } from '@lib/emailservice';
import { isPackageExpiryValid } from '@lib/isPackageExpiryValid';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Readable } from 'stream';
import csv from 'csv-parser';

// POST: Import multiple leads from CSV file
export async function POST(request) {
    try {
        // Connect to MongoDB
        await dbConnect();
        
        const formData = await request.formData();
        const file = formData.get('file');
        const dealerId = formData.get('dealer_id');

        if (!file) {
            return NextResponse.json(
                { error: "No file uploaded" },
                { status: 400 }
            );
        }

        if (!dealerId) {
            return NextResponse.json(
                { error: "Dealer ID is required" },
                { status: 400 }
            );
        }

        // Convert file to readable stream
        const buffer = await file.arrayBuffer();
        const stream = Readable.from(Buffer.from(buffer));

        // Create Redis connection
        const redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
        });

        // Create queue for processing
        const leadQueue = new Queue('leadProcessingQueue', { connection: redis });
        let processedCount = 0;
        let skippedCount = 0;

        // Get dealer info
        const dealer = await User.findById(dealerId);
        if (!dealer) {
            return NextResponse.json(
                { error: "Dealer not found" },
                { status: 404 }
            );
        }

        const dealerEmailAccount = await EmailAccount.findOne({ dealer_id: dealer._id });

        // Check subscription validity
        let subscriptionValid = false;
        if (dealer.vendor_id) {
            const agency = await User.findById(dealer.vendor_id);
            subscriptionValid = Boolean(agency && isPackageExpiryValid(agency.package_expiry));
        } else {
            subscriptionValid = isPackageExpiryValid(dealer.package_expiry);
        }

        if (!subscriptionValid) {
            await sendSubscriptionExpiryNotification({
                account: dealer.vendor_id ? await User.findById(dealer.vendor_id) : dealer,
                dealer: dealer.vendor_id ? dealer : null
            });
            return NextResponse.json(
                { error: "Dealer subscription is expired or invalid" },
                { status: 402 }
            );
        }

        // Process CSV stream
        const processCSV = () => new Promise((resolve, reject) => {
            stream
                .pipe(csv())
                .on('data', async (row) => {
                    try {
                        // Pause the stream while we process this row
                        stream.pause();

                        // Validate required fields
                        if (!row.name || (!row.email && !row.phone)) {
                            skippedCount++;
                            stream.resume();
                            return;
                        }
                        
                        const followupPref = row.followup_preference === 'sms' && row.phone ? 'sms' : 
                        row.followup_preference === 'email' && row.email ? 'email' : 
                        row.phone ? 'sms' : 'email';
                        
                       
                        const sender = followupPref === 'sms' 
                            ? dealer.dealer_account_information?.sms_conversion_phone 
                            : dealerEmailAccount?.email_address;

                        const recipient = followupPref === 'sms' ? formatPhoneForTwilio(row.phone) : row.email;

                        const leadData = {
                            name: row.name,
                            email: row.email,
                            phone: formatPhoneForTwilio(row.phone),
                            followup_preference: followupPref,
                            vehicle_make: row.make || row.vehicle_make,
                            vehicle_model: row.model || row.vehicle_model,
                            vehicle_year: row.year || row.vehicle_year,
                            vin: row.vin,
                            comments: row.comments || row.comment,
                            dealer_id: dealerId,
                            source: row.source || 'csv_import',
                            status: 'New'
                        };

                        const jobData = {
                            currentSMS: {
                                message_id: null,
                                parent_conversation: null,
                                sender,
                                recipient,
                                name: row.name,
                                email: row.email,
                                phone: formatPhoneForTwilio(row.phone),
                                subject: null,
                                date: new Date(),
                                mail_content: row.comments || row.comment,
                                vehicle_make: row.make || row.vehicle_make,
                                vehicle_model: row.model || row.vehicle_model,
                                vehicle_year: row.year || row.vehicle_year,
                                vin: row.vin,
                                followup_preference: followupPref,
                                dealer_id: dealerId,
                                communication_type: followupPref,
                            }
                        };

                        // Add job to queue
                        await leadQueue.add('processLead', {
                            leadData,
                            action: 'create',
                            dealer,
                            jobData
                        }, {
                            attempts: 3,
                            backoff: {
                                type: 'exponential',
                                delay: 5000
                            }
                        });

                        processedCount++;
                        stream.resume();
                    } catch (error) {
                        console.error('Error processing CSV row:', error);
                        skippedCount++;
                        stream.resume();
                    }
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });

        await processCSV();

        return NextResponse.json(
            { 
                message: "CSV import processing started",
                stats: {
                    processed: processedCount,
                    skipped: skippedCount
                }
            },
            { status: 202 }
        );

    } catch (error) {
        console.error('Error importing leads:', error);
        return NextResponse.json(
            { error: error.message || "Failed to process CSV file" },
            { status: 500 }
        );
    }
}

function formatPhoneForTwilio(phone) {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');

  // If the number starts with a country code (e.g., 91 for India), keep it
  if (cleaned.length > 10 && cleaned.startsWith('1')) {
    return `+${cleaned}`; // US numbers with country code
  } else if (cleaned.length > 10 && !cleaned.startsWith('1')) {
    return `+${cleaned}`; // Other countries (e.g., India: +919876543210)
  } else if (cleaned.length === 10) {
    return `+1${cleaned}`; // Default to US (+1) if 10 digits
  } else {
    throw phone;
  }
}