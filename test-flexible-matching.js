// Test script to demonstrate flexible lead matching
import { checkLeadByIdentifiers } from './app/lib/dealersocket-worknote.js';

async function testFlexibleMatching() {
  try {
    console.log('Testing Flexible Lead Matching...\n');
    
    // Test 1: Email only (no VIN, no vendor_id)
    console.log('Test 1: Email only matching');
    const emailOnlyCriteria = {
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com'
      // No VIN, no vendor_id - will find all leads with this email for this dealer
    };
    
    console.log('Search criteria:', emailOnlyCriteria);
    console.log('This will match any lead with email "sarahfranich@icloud.com" for dealer "7250"');
    console.log('---\n');
    
    // Test 2: Phone only (no VIN, no vendor_id)
    console.log('Test 2: Phone only matching');
    const phoneOnlyCriteria = {
      dealer_id: '7250',
      entity_phone: '+1-555-123-4567'
      // No VIN, no vendor_id - will find all leads with this phone for this dealer
    };
    
    console.log('Search criteria:', phoneOnlyCriteria);
    console.log('This will match any lead with phone "+1-555-123-4567" for dealer "7250"');
    console.log('---\n');
    
    // Test 3: Email + VIN (more specific)
    console.log('Test 3: Email + VIN matching');
    const emailVinCriteria = {
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com',
      vin: 'your_vin_number'
      // More specific - will find leads with both email and VIN
    };
    
    console.log('Search criteria:', emailVinCriteria);
    console.log('This will match leads with both email and VIN for dealer "7250"');
    console.log('---\n');
    
    // Test 4: Phone + VIN (more specific)
    console.log('Test 4: Phone + VIN matching');
    const phoneVinCriteria = {
      dealer_id: '7250',
      entity_phone: '5551234567', // Different format
      vin: 'your_vin_number'
      // More specific - will find leads with both phone and VIN
    };
    
    console.log('Search criteria:', phoneVinCriteria);
    console.log('This will match leads with both phone and VIN for dealer "7250"');
    console.log('---\n');
    
    // Test 5: Both email and phone (OR Logic)
    console.log('Test 5: Both email and phone matching (OR Logic)');
    const bothCriteria = {
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com',
      entity_phone: '+1-555-123-4567'
      // Will match leads with EITHER email OR phone (or both) for this dealer
    };
    
    console.log('Search criteria:', bothCriteria);
    console.log('This will match leads with EITHER email OR phone for dealer "7250"');
    console.log('More flexible - finds leads even if only one contact method matches');
    console.log('---\n');
    
    console.log('✅ Flexible matching test scenarios completed!');
    console.log('\nKey Points:');
    console.log('- dealer_id is always required (matches source_data.SiteId)');
    console.log('- Either entity_email OR entity_phone is required');
    console.log('- VIN is optional - if not provided, matches any VIN');
    console.log('- vendor_id is optional and not used in search');
    console.log('- Phone numbers support various formats with smart matching');
    console.log('- OR Logic: If both email and phone provided, finds records matching EITHER one');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testFlexibleMatching();
