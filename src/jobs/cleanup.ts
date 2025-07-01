import { query } from '../config/database';
import { logger } from '../utils/logger';

export const cleanupOldEvents = async () => {
  try {
    // Get retention settings (default 90 days)
    const retentionDays = parseInt(process.env.EVENT_RETENTION_DAYS || '90');

    // Delete old events
    const deleteEventsResult = await query(
      'DELETE FROM events WHERE created_at < NOW() - INTERVAL $1 DAY',
      [retentionDays]
    );

    // Delete old diagnostics (keep for 30 days)
    const deleteDiagnosticsResult = await query(
      'DELETE FROM diagnostics WHERE created_at < NOW() - INTERVAL \'30 days\' AND status = \'resolved\''
    );

    // Update pixel statuses based on recent activity
    await query(
      `UPDATE pixels 
       SET status = 'inactive', updated_at = NOW()
       WHERE status = 'active' 
       AND (last_activity IS NULL OR last_activity < NOW() - INTERVAL '7 days')`
    );

    const eventsDeleted = deleteEventsResult.rowCount || 0;
    const diagnosticsDeleted = deleteDiagnosticsResult.rowCount || 0;

    logger.info(`Cleanup job completed: ${eventsDeleted} events deleted, ${diagnosticsDeleted} diagnostics deleted`);
  } catch (error) {
    logger.error('Error in cleanup job:', error);
    throw error;
  }
};