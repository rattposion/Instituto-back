import cron from 'node-cron';
import { logger } from '../utils/logger';
import { runDiagnostics } from './diagnostics';
import { cleanupOldEvents } from './cleanup';
import { generateAnalytics } from './analytics';

export const startCronJobs = () => {
  // Run diagnostics every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      logger.info('Running scheduled diagnostics...');
      await runDiagnostics();
      logger.info('Scheduled diagnostics completed');
    } catch (error) {
      logger.error('Error running scheduled diagnostics:', error);
    }
  });

  // Clean up old events daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Running cleanup job...');
      await cleanupOldEvents();
      logger.info('Cleanup job completed');
    } catch (error) {
      logger.error('Error running cleanup job:', error);
    }
  });

  // Generate analytics every hour
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Generating analytics...');
      await generateAnalytics();
      logger.info('Analytics generation completed');
    } catch (error) {
      logger.error('Error generating analytics:', error);
    }
  });

  logger.info('Cron jobs started successfully');
};