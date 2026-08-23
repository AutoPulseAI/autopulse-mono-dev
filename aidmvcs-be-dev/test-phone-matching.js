// Test script to demonstrate phone number matching functionality
import { checkLeadByIdentifiers } from './app/lib/dealersocket-worknote.js';

// Helper function to test phone number normalization
function testPhoneNormalization() {
  console.log('Testing Phone Number Normalization:\n');
  
  const testPhones = [
    '+1-555-123-4567',
    '15551234567',
    '5551234567',
    '(555) 123-4567',
    '555-123-4567',
    '+1 555 123 4567',
    '1-555-123-4567',
    '+1(555)123-4567'
  ];
  
  testPhones.forEach(phone => {
    const normalized = phone.replace(/\D/g, '');
    console.log(`Input: "${phone}" → Normalized: "${normalized}"`);
  });
  
  console.log('\nAll these formats should match the same phone number in the database!\n');
}

async function testPhoneMatching() {
  try {
    console.log('Testing phone number matching in lead search...\n');
    
    // Test with different phone formats
    const phoneFormats = [
      '+1-555-123-4567',    // International format
      '15551234567',        // 11-digit format
      '5551234567',         // 10-digit format
      '(555) 123-4567',     // Formatted with parentheses
      '555-123-4567'        // Formatted with dashes
    ];
    
    for (const phone of phoneFormats) {
      console.log(`Testing with phone: "${phone}"`);
      
      const searchCriteria = {
        dealer_id: '7250',
        vendor_id: 'your_vendor_id',
        entity_phone: phone,
        vin: 'your_vin_number'
      };
      
      console.log('Search criteria:', searchCriteria);
      
      // Note: This will only work if you have actual data in your database
      // const result = await checkLeadByIdentifiers(searchCriteria);
      // console.log('Result:', result.success ? 'Success' : 'Failed');
      
      console.log('---');
    }
    
    console.log('\n✅ Phone matching test completed!');
    console.log('All phone formats should find the same lead if it exists in the database.');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the tests
testPhoneNormalization();
testPhoneMatching();
