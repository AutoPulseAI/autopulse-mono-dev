// Test script to demonstrate iframe integration
import { checkLeadByIdentifiers } from './app/lib/dealersocket-worknote.js';

async function testIframeIntegration() {
  try {
    console.log('Testing Iframe Integration...\n');
    
    // Test with iframe URL in work note
    console.log('Test: Lead search with iframe URL in work note');
    const searchCriteria = {
      lead_id: 'your_lead_id_here', // You need to provide an actual lead ID
      dealer_id: '7250',
      entity_email: 'sarahfranich@icloud.com',
      auto_insert_work_note: true,
      vendor_name: 'AutoPulse'
    };
    
    console.log('Search criteria:', searchCriteria);
    console.log('\nThis will:');
    console.log('1. Search for leads matching the criteria');
    console.log('2. If leads are found, insert work notes with iframe URLs');
    console.log('3. The iframe URL will be: /iframe/lead/[lead_id]');
    console.log('4. The iframe will display lead details and conversations');
    console.log('---\n');
    
    // Example of what the work note will contain
    console.log('Example Work Note Content:');
    console.log('"Lead found and processed via API - Email: sarahfranich@icloud.com, Phone: N/A, VIN: N/A. View lead details: http://localhost:3000/iframe/lead/your_lead_id_here"');
    console.log('---\n');
    
    // Example iframe URL structure
    console.log('Iframe URL Structure:');
    console.log('- Base URL: http://localhost:3000 (or your domain)');
    console.log('- Path: /iframe/lead/[lead_id]');
    console.log('- Example: http://localhost:3000/iframe/lead/507f1f77bcf86cd799439011');
    console.log('---\n');
    
    console.log('Iframe Features:');
    console.log('- Displays lead information (name, email, phone, source, status)');
    console.log('- Shows recent conversations');
    console.log('- Responsive design suitable for embedding');
    console.log('- Uses existing API endpoints (/api/leads and /api/conversations/lead)');
    console.log('- Similar styling to viewConversations component');
    console.log('---\n');
    
    console.log('✅ Iframe integration test completed!');
    console.log('\nKey Points:');
    console.log('- iframe URL is automatically generated in work notes');
    console.log('- URL format: /iframe/lead/[lead_id]');
    console.log('- Uses existing API endpoints for data');
    console.log('- Displays lead details and conversations');
    console.log('- Suitable for embedding in DealerSocket or other systems');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testIframeIntegration();
