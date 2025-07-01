import cron from 'node-cron';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';

export function startCronJobs() {
  // Run diagnostics every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Running pixel diagnostics...');
    await runPixelDiagnostics();
  });

  // Clean up old events daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('Cleaning up old events...');
    await cleanupOldEvents();
  });

  // Update pixel statistics hourly
  cron.schedule('0 * * * *', async () => {
    logger.info('Updating pixel statistics...');
    await updatePixelStatistics();
  });

  // Process failed events every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    logger.info('Processing failed events...');
    await processFailedEvents();
  });

  logger.info('Cron jobs started');
}

async function runPixelDiagnostics() {
  try {
    // Get all active pixels
    const { data: pixels, error } = await supabase
      .from('pixels')
      .select('*')
      .eq('status', 'active');

    if (error) {
      logger.error('Error fetching pixels for diagnostics:', error);
      return;
    }

    for (const pixel of pixels) {
      await checkPixelHealth(pixel);
    }
  } catch (error) {
    logger.error('Error running pixel diagnostics:', error);
  }
}

async function checkPixelHealth(pixel: any) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Check for recent events
  const { data: recentEvents, error } = await supabase
    .from('events')
    .select('id')
    .eq('pixel_id', pixel.id)
    .gte('timestamp', oneHourAgo.toISOString())
    .limit(1);

  if (error) {
    logger.error(`Error checking events for pixel ${pixel.id}:`, error);
    return;
  }

  // Create diagnostic if no recent events
  if (!recentEvents || recentEvents.length === 0) {
    await supabase
      .from('diagnostics')
      .upsert({
        pixel_id: pixel.id,
        severity: 'warning',
        category: 'performance',
        title: 'Low event volume',
        description: 'No events received in the last hour',
        status: 'active',
        last_checked: now.toISOString()
      }, {
        onConflict: 'pixel_id,title'
      });

    // Update pixel status
    await supabase
      .from('pixels')
      .update({ status: 'inactive' })
      .eq('id', pixel.id);
  } else {
    // Resolve diagnostic if exists
    await supabase
      .from('diagnostics')
      .update({ status: 'resolved' })
      .eq('pixel_id', pixel.id)
      .eq('title', 'Low event volume');
  }
}

async function cleanupOldEvents() {
  try {
    const retentionDays = 90; // Keep events for 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const { error } = await supabase
      .from('events')
      .delete()
      .lt('timestamp', cutoffDate.toISOString());

    if (error) {
      logger.error('Error cleaning up old events:', error);
    } else {
      logger.info(`Cleaned up events older than ${cutoffDate.toISOString()}`);
    }
  } catch (error) {
    logger.error('Error in cleanup job:', error);
  }
}

async function updatePixelStatistics() {
  try {
    // Get all pixels
    const { data: pixels, error } = await supabase
      .from('pixels')
      .select('id');

    if (error) {
      logger.error('Error fetching pixels for stats update:', error);
      return;
    }

    for (const pixel of pixels) {
      await updatePixelStats(pixel.id);
    }
  } catch (error) {
    logger.error('Error updating pixel statistics:', error);
  }
}

async function updatePixelStats(pixelId: string) {
  const last24Hours = new Date();
  last24Hours.setDate(last24Hours.getDate() - 1);

  // Get events count and revenue for last 24 hours
  const { data: events, error } = await supabase
    .from('events')
    .select('event_name, parameters')
    .eq('pixel_id', pixelId)
    .gte('timestamp', last24Hours.toISOString());

  if (error) {
    logger.error(`Error fetching events for pixel ${pixelId}:`, error);
    return;
  }

  let conversions = 0;
  let revenue = 0;

  events.forEach(event => {
    if (event.event_name === 'Purchase' && event.parameters?.value) {
      conversions++;
      revenue += parseFloat(event.parameters.value);
    }
  });

  // Update pixel statistics
  await supabase
    .from('pixels')
    .update({
      events_count: events.length,
      conversions_count: conversions,
      revenue: revenue,
      last_activity: events.length > 0 ? new Date().toISOString() : null
    })
    .eq('id', pixelId);
}

async function processFailedEvents() {
  try {
    // Get failed events from last hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const { data: failedEvents, error } = await supabase
      .from('events')
      .select('*')
      .not('error_message', 'is', null)
      .gte('created_at', oneHourAgo.toISOString())
      .limit(100);

    if (error) {
      logger.error('Error fetching failed events:', error);
      return;
    }

    let reprocessedCount = 0;
    for (const event of failedEvents) {
      try {
        // Simulate reprocessing
        const success = Math.random() > 0.3; // 70% success rate on retry
        
        if (success) {
          await supabase
            .from('events')
            .update({
              processed: true,
              error_message: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', event.id);
          
          reprocessedCount++;
        }
      } catch (error) {
        logger.error(`Failed to reprocess event ${event.id}:`, error);
      }
    }

    if (reprocessedCount > 0) {
      logger.info(`Reprocessed ${reprocessedCount} failed events`);
    }
  } catch (error) {
    logger.error('Error processing failed events:', error);
  }
}