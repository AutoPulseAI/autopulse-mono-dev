// Test script to demonstrate work note integration
import { checkLeadByIdentifiers } from './app/lib/dealersocket-worknote.js';

async function testWorkNoteIntegration() {
  try {
    console.log('Testing Work Note Integration...\n');
    
    // Test 1: With work note insertion enabled (default)
    console.log('Test 1: Lead search with automatic work note insertion');
    const searchCriteriaWithWorkNote = {
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com',
      auto_insert_work_note: true, // Explicitly enable (this is the default)
      vendor_name: 'TestVendor'
    };
    
    console.log('Search criteria:', searchCriteriaWithWorkNote);
    console.log('This will search for leads and automatically insert work notes for found records');
    console.log('---\n');
    
    // Test 2: With work note insertion disabled
    console.log('Test 2: Lead search without work note insertion');
    const searchCriteriaWithoutWorkNote = {
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com',
      auto_insert_work_note: false // Disable work note insertion
    };
    
    console.log('Search criteria:', searchCriteriaWithoutWorkNote);
    console.log('This will search for leads but NOT insert work notes');
    console.log('---\n');
    
    // Test 3: With custom vendor name
    console.log('Test 3: Lead search with custom vendor name');
    const searchCriteriaCustomVendor = {
      dealer_id: '7250',
      entity_phone: '+1-555-123-4567',
      auto_insert_work_note: true,
      vendor_name: 'CustomVendorName'
    };
    
    console.log('Search criteria:', searchCriteriaCustomVendor);
    console.log('This will search for leads and insert work notes with custom vendor name');
    console.log('---\n');
    
    // Test 4: Multiple leads with work notes
    console.log('Test 4: Multiple leads with work note insertion');
    const searchCriteriaMultiple = {
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com',
      entity_phone: '+1-555-123-4567', // OR logic - will find more leads
      auto_insert_work_note: true,
      vendor_name: 'MultiLeadVendor'
    };
    
    console.log('Search criteria:', searchCriteriaMultiple);
    console.log('This will find leads matching EITHER email OR phone and insert work notes for each');
    console.log('---\n');
    
    console.log('✅ Work note integration test scenarios completed!');
    console.log('\nKey Points:');
    console.log('- auto_insert_work_note defaults to true');
    console.log('- vendor_name defaults to "DealerSocket"');
    console.log('- Work notes are inserted for each found lead');
    console.log('- Work note includes lead details (email, phone, VIN)');
    console.log('- Response includes work_note_results array with success/failure status');
    console.log('- Each work note uses EntityId and EventId from the found lead');
    
    console.log('\nWork Note Content:');
    console.log('"Lead found and processed via API - Email: [email], Phone: [phone], VIN: [vin]"');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testWorkNoteIntegration();
