// Test script for the checkLeadByIdentifiers function
import { checkLeadByIdentifiers } from './app/lib/dealersocket-worknote.js';

async function testLeadCheck() {
  try {
    console.log('Testing lead check function...\n');
    
    // Test with the sample data from your request
    const searchCriteria = {
      dealer_id: '7250', // SiteId from the sample data
      entity_email: 'sarahfranich@icloud.com', // Email from the sample data
      vin: 'your_vin_number' // Optional - can be omitted
    };
    
    // Alternative test with phone number (uncomment to test phone matching)
    // const searchCriteria = {
    //   dealer_id: '7250',
    //   entity_phone: '+1-555-123-4567', // This will match various phone formats
    //   vin: 'your_vin_number' // Optional
    // };
    
    // Test without VIN (uncomment to test flexible matching)
    // const searchCriteria = {
    //   dealer_id: '7250',
    //   entity_email: 'sarahfranich@icloud.com'
    //   // No VIN required - will match any lead with this email for this dealer
    // };
    
    console.log('Search criteria:', searchCriteria);
    console.log('\nSearching for leads...\n');
    
    const result = await checkLeadByIdentifiers(searchCriteria);
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.success && result.found) {
      console.log(`\n✅ Found ${result.count} matching lead(s)!`);
      result.data.forEach((lead, index) => {
        console.log(`\nLead ${index + 1}:`);
        console.log(`  Entity ID: ${lead.entity_id}`);
        console.log(`  Event ID: ${lead.event_id}`);
        console.log(`  Name: ${lead.first_name} ${lead.last_name}`);
        console.log(`  Email: ${lead.email}`);
        console.log(`  Phone: ${lead.work_phone || lead.mobile_phone || lead.other_phone}`);
        console.log(`  VIN: ${lead.vin}`);
        console.log(`  Make/Model/Year: ${lead.make} ${lead.model} ${lead.year}`);
        console.log(`  Status: ${lead.event_status_desc}`);
        console.log(`  Assigned to: ${lead.assigned_to_name}`);
      });
    } else if (result.success && !result.found) {
      console.log('\n❌ No matching leads found.');
    } else {
      console.log('\n❌ Error occurred:', result.message);
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testLeadCheck();
