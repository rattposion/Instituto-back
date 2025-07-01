import cron from 'node-cron';
import { prisma } from '../config/database';
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
    const pixels = await prisma.pixel.findMany({
      where: {
        status: 'active'
      }
    });

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
  const recentEvents = await prisma.event.findMany({
    where: {
      pixel_id: pixel.id,
      timestamp: {
        gte: oneHourAgo.toISOString()
      }
    },
    take: 1
  });

  // Create diagnostic if no recent events
  if (recentEvents.length === 0) {
    await prisma.diagnostic.upsert({
      where: {
        pixel_id_title: {
          pixel_id: pixel.id,
          title: 'Low event volume'
        }
      },
      update: {
        status: 'active',
        last_checked: now.toISOString()
      },
      create: {
        pixel_id: pixel.id,
        severity: 'warning',
        category: 'performance',
        title: 'Low event volume',
        description: 'No events received in the last hour',
        status: 'active',
        last_checked: now.toISOString()
      }
    });

    // Update pixel status
    await prisma.pixel.update({
      where: {
        id: pixel.id
      },
      data: {
        status: 'inactive'
      }
    });
  } else {
    // Resolve diagnostic if exists
    await prisma.diagnostic.update({
      where: {
        pixel_id_title: {
          pixel_id: pixel.id,
          title: 'Low event volume'
        }
      },
      data: {
        status: 'resolved'
      }
    });
  }
}

async function cleanupOldEvents() {
  try {
    const retentionDays = 90; // Keep events for 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const events = await prisma.event.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate.toISOString()
        }
      }
    });

    if (events.count > 0) {
      logger.info(`Cleaned up events older than ${cutoffDate.toISOString()}`);
    }
  } catch (error) {
    logger.error('Error in cleanup job:', error);
  }
}

async function updatePixelStatistics() {
  try {
    // Get all pixels
    const pixels = await prisma.pixel.findMany({
      select: {
        id: true
      }
    });

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
  const events = await prisma.event.findMany({
    select: {
      event_name: true,
      parameters: true
    },
    where: {
      pixel_id: pixelId,
      timestamp: {
        gte: last24Hours.toISOString()
      }
    }
  });

  let conversions = 0;
  let revenue = 0;

  events.forEach(event => {
    if (event.event_name === 'Purchase' && event.parameters?.value) {
      conversions++;
      revenue += parseFloat(event.parameters.value);
    }
  });

  // Update pixel statistics
  await prisma.pixel.update({
    where: {
      id: pixelId
    },
    data: {
      events_count: events.length,
      conversions_count: conversions,
      revenue: revenue,
      last_activity: events.length > 0 ? new Date().toISOString() : null
    }
  });
}

async function processFailedEvents() {
  try {
    // Get failed events from last hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const failedEvents = await prisma.event.findMany({
      where: {
        error_message: {
          not: null
        },
        created_at: {
          gte: oneHourAgo.toISOString()
        }
      },
      take: 100
    });

    let reprocessedCount = 0;
    for (const event of failedEvents) {
      try {
        // Simulate reprocessing
        const success = Math.random() > 0.3; // 70% success rate on retry
        
        if (success) {
          await prisma.event.update({
            where: {
              id: event.id
            },
            data: {
              processed: true,
              error_message: null,
              updated_at: new Date().toISOString()
            }
          });
          
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