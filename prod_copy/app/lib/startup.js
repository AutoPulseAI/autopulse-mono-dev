import reportCronService from './reportCronService.js';
import csvCronService from './csvCronService.js';

/**
 * Initialize services on application startup
 */
export async function initializeServices() {
  try {
    console.log('🚀 Initializing application services...');
    
    // Start the report cron service
    reportCronService.start();
    
    // Start the CSV processing cron service (with error handling)
    try {
      csvCronService.start();
    } catch (csvError) {
      console.warn('⚠️ CSV cron service could not be started (this may be normal during build):', csvError.message);
    }
    
    console.log('✅ Application services initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing application services:', error);
  }
}

/**
 * Cleanup services on application shutdown
 */
export async function cleanupServices() {
  try {
    console.log('🛑 Cleaning up application services...');
    
    // Stop the report cron service
    reportCronService.stop();
    
    // Stop the CSV processing cron service
    csvCronService.stop();
    
    console.log('✅ Application services cleaned up successfully');
  } catch (error) {
    console.error('❌ Error cleaning up application services:', error);
  }
}
