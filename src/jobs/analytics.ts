import { query } from '../config/database';
import { logger } from '../utils/logger';

export const generateAnalytics = async () => {
  try {
    // Update pixel statistics
    await query(`
      UPDATE pixels 
      SET 
        events_count = COALESCE(event_stats.count, 0),
        conversions_count = COALESCE(conversion_stats.count, 0),
        revenue = COALESCE(revenue_stats.total, 0),
        updated_at = NOW()
      FROM (
        SELECT 
          pixel_id,
          COUNT(*) as count
        FROM events 
        GROUP BY pixel_id
      ) event_stats
      LEFT JOIN (
        SELECT 
          pixel_id,
          COUNT(*) as count
        FROM events 
        WHERE event_name = 'Purchase'
        GROUP BY pixel_id
      ) conversion_stats ON event_stats.pixel_id = conversion_stats.pixel_id
      LEFT JOIN (
        SELECT 
          pixel_id,
          SUM((parameters->>'value')::numeric) as total
        FROM events 
        WHERE event_name = 'Purchase' AND parameters->>'value' IS NOT NULL
        GROUP BY pixel_id
      ) revenue_stats ON event_stats.pixel_id = revenue_stats.pixel_id
      WHERE pixels.id = event_stats.pixel_id
    `);

    // Clean up old temporary data
    await query(
      'DELETE FROM events WHERE event_name = \'TestEvent\' AND created_at < NOW() - INTERVAL \'1 hour\''
    );

    logger.info('Analytics generation completed');
  } catch (error) {
    logger.error('Error in analytics job:', error);
    throw error;
  }
};