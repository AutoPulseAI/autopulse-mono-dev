import { NextResponse } from 'next/server';
import { 
  clearAllQueues, 
  clearQueue, 
  getQueueStatus, 
  pauseAllQueues, 
  resumeAllQueues 
} from '@lib/queue';

export async function GET() {
  try {
    console.log('📊 Getting Redis queue status...');
    
    const status = await getQueueStatus();
    
    console.log('📊 Redis queue status retrieved:', status);
    
    return NextResponse.json({
      success: true,
      message: 'Redis queue status retrieved successfully',
      data: status
    });
    
  } catch (error) {
    console.error('❌ Error getting Redis queue status:', error);
    
    return NextResponse.json({
      success: false,
      message: 'Error getting Redis queue status',
      error: error.message
    }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { action, queueName } = await req.json();
    
    console.log(`🔄 Redis queue action requested: ${action}`, { queueName });
    
    let result;
    
    switch (action.toLowerCase()) {
      case 'clear-all':
        console.log('🧹 Clearing all Redis queues...');
        result = await clearAllQueues();
        break;
        
      case 'clear-queue':
        if (!queueName) {
          throw new Error('Queue name is required for clear-queue action');
        }
        console.log(`🧹 Clearing specific queue: ${queueName}`);
        result = await clearQueue(queueName);
        break;
        
      case 'pause-all':
        console.log('⏸️ Pausing all Redis queues...');
        result = await pauseAllQueues();
        break;
        
      case 'resume-all':
        console.log('▶️ Resuming all Redis queues...');
        result = await resumeAllQueues();
        break;
        
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: clear-all, clear-queue, pause-all, resume-all`);
    }
    
    console.log(`✅ Redis queue action ${action} completed successfully:`, result);
    
    return NextResponse.json({
      success: true,
      message: `Redis queue action '${action}' completed successfully`,
      data: result
    });
    
  } catch (error) {
    console.error('❌ Error executing Redis queue action:', error);
    
    return NextResponse.json({
      success: false,
      message: 'Error executing Redis queue action',
      error: error.message
    }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    console.log('🧹 Clearing all Redis queues via DELETE request...');
    
    const result = await clearAllQueues();
    
    console.log('✅ All Redis queues cleared successfully:', result);
    
    return NextResponse.json({
      success: true,
      message: 'All Redis queues cleared successfully',
      data: result
    });
    
  } catch (error) {
    console.error('❌ Error clearing Redis queues:', error);
    
    return NextResponse.json({
      success: false,
      message: 'Error clearing Redis queues',
      error: error.message
    }, { status: 500 });
  }
}
