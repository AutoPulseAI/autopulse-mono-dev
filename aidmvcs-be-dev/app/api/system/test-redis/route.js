import { NextResponse } from 'next/server';
import { getQueueStatus } from '@lib/queue';
import { requireSuperAdmin } from "@lib/apiGuard";

export async function GET(request) {
  // Security fix (Nov 2026): debug/maintenance route, super admin only (it had no sign-in check).
  const guard = await requireSuperAdmin(request);
  if (guard.response) return guard.response;
  try {
    console.log('🧪 Testing Redis queue management...');
    
    // Test getting queue status
    const status = await getQueueStatus();
    
    console.log('✅ Queue status test successful:', status);
    
    return NextResponse.json({
      success: true,
      message: 'Redis queue management test successful',
      data: {
        status,
        timestamp: new Date().toISOString(),
        test: 'queue-management'
      }
    });
    
  } catch (error) {
    console.error('❌ Redis queue management test failed:', error);
    
    return NextResponse.json({
      success: false,
      message: 'Redis queue management test failed',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}
