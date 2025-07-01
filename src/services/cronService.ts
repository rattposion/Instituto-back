import cron from 'node-cron';
import { Database } from '../config/database';
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
    const { data: pixels, error } = await Database.query('SELECT * FROM pixels WHERE status = $1', ['active']);

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
  const { data: recentEvents, error } = await Database.query('SELECT id FROM events WHERE pixel_id = $1 AND timestamp >= $2 AND timestamp < $3 LIMIT 1', [pixel.id, oneHourAgo.toISOString(), now.toISOString()]);

  if (error) {
    logger.error(`Error checking events for pixel ${pixel.id}:`, error);
    return;
  }

  // Create diagnostic if no recent events
  if (!recentEvents || recentEvents.length === 0) {
    await Database.query('INSERT INTO diagnostics (pixel_id, severity, category, title, description, status, last_checked) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (pixel_id, title) DO UPDATE SET severity = $2, category = $3, title = $4, description = $5, status = $6, last_checked = $7', [pixel.id, 'warning', 'performance', 'Low event volume', 'No events received in the last hour', 'active', now.toISOString()]);

    // Update pixel status
    await Database.query('UPDATE pixels SET status = $1 WHERE id = $2', ['inactive', pixel.id]);
  } else {
    // Resolve diagnostic if exists
    await Database.query('UPDATE diagnostics SET status = $1 WHERE pixel_id = $2 AND title = $3', ['resolved', pixel.id, 'Low event volume']);
  }
}

async function cleanupOldEvents() {
  try {
    const retentionDays = 90; // Keep events for 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const { error } = await Database.query('DELETE FROM events WHERE timestamp < $1', [cutoffDate.toISOString()]);

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
    const { data: pixels, error } = await Database.query('SELECT id FROM pixels');

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
  const { data: events, error } = await Database.query('SELECT event_name, parameters FROM events WHERE pixel_id = $1 AND timestamp >= $2 AND timestamp < $3', [pixelId, last24Hours.toISOString(), new Date().toISOString()]);

  if (error) {
    logger.error(`Error fetching events for pixel ${pixelId}:`, error);
    return;
  }

  let conversions = 0;
  let revenue = 0;

  events.forEach((event: any) => {
    if (event.event_name === 'Purchase' && event.parameters?.value) {
      conversions++;
      revenue += parseFloat(event.parameters.value);
    }
  });

  // Update pixel statistics
  await Database.query('UPDATE pixels SET events_count = $1, conversions_count = $2, revenue = $3, last_activity = $4 WHERE id = $5', [events.length, conversions, revenue, events.length > 0 ? new Date().toISOString() : null, pixelId]);
}

async function processFailedEvents() {
  try {
    // Get failed events from last hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const { data: failedEvents, error } = await Database.query('SELECT * FROM events WHERE error_message IS NOT NULL AND created_at >= $1 AND created_at < $2 LIMIT 100', [oneHourAgo.toISOString(), new Date().toISOString()]);

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
          await Database.query('UPDATE events SET processed = $1, error_message = $2, updated_at = $3 WHERE id = $4', [true, null, new Date().toISOString(), event.id]);
          
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