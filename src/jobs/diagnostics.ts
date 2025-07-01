import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export const runDiagnostics = async () => {
  try {
    // Get all active pixels
    const pixelsResult = await query(
      'SELECT id, name, pixel_id, workspace_id, last_activity FROM pixels WHERE is_active = true'
    );

    const pixels = pixelsResult.rows;
    let diagnosticsCreated = 0;

    for (const pixel of pixels) {
      // Clear existing auto-generated diagnostics for this pixel
      await query(
        'DELETE FROM diagnostics WHERE pixel_id = $1 AND created_by IS NULL',
        [pixel.id]
      );

      const diagnostics = [];

      // Check 1: Recent events
      const recentEventsResult = await query(
        'SELECT COUNT(*) as count FROM events WHERE pixel_id = $1 AND created_at >= NOW() - INTERVAL \'1 hour\'',
        [pixel.id]
      );

      const recentEventsCount = parseInt(recentEventsResult.rows[0].count);

      if (recentEventsCount === 0 && pixel.last_activity) {
        const lastActivity = new Date(pixel.last_activity);
        const hoursSinceLastActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastActivity > 2) {
          diagnostics.push({
            id: uuidv4(),
            pixelId: pixel.id,
            severity: hoursSinceLastActivity > 24 ? 'error' : 'warning',
            category: 'performance',
            title: 'Pixel inativo',
            description: `Pixel não recebe eventos há ${Math.floor(hoursSinceLastActivity)} horas`,
            url: null,
            status: 'active'
          });
        }
      }

      // Check 2: Error rate
      const errorEventsResult = await query(
        `SELECT 
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE status = 'error') as error_events
         FROM events 
         WHERE pixel_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
        [pixel.id]
      );

      const eventStats = errorEventsResult.rows[0];
      const totalEvents = parseInt(eventStats.total_events);
      const errorEvents = parseInt(eventStats.error_events);

      if (totalEvents > 0 && errorEvents > 0) {
        const errorRate = (errorEvents / totalEvents) * 100;
        
        if (errorRate > 10) {
          diagnostics.push({
            id: uuidv4(),
            pixelId: pixel.id,
            severity: errorRate > 50 ? 'error' : 'warning',
            category: 'events',
            title: 'Alta taxa de erro',
            description: `${errorRate.toFixed(1)}% dos eventos estão falhando (${errorEvents}/${totalEvents})`,
            url: null,
            status: 'active'
          });
        }
      }

      // Check 3: Missing Purchase parameters
      const purchaseEventsResult = await query(
        `SELECT 
          COUNT(*) as total_purchases,
          COUNT(*) FILTER (WHERE parameters->>'value' IS NULL OR parameters->>'currency' IS NULL) as missing_params
         FROM events 
         WHERE pixel_id = $1 AND event_name = 'Purchase' AND created_at >= NOW() - INTERVAL '24 hours'`,
        [pixel.id]
      );

      const purchaseStats = purchaseEventsResult.rows[0];
      const totalPurchases = parseInt(purchaseStats.total_purchases);
      const missingParams = parseInt(purchaseStats.missing_params);

      if (totalPurchases > 0 && missingParams > 0) {
        const missingRate = (missingParams / totalPurchases) * 100;
        
        diagnostics.push({
          id: uuidv4(),
          pixelId: pixel.id,
          severity: missingRate > 50 ? 'error' : 'warning',
          category: 'events',
          title: 'Eventos Purchase incompletos',
          description: `${missingParams} de ${totalPurchases} eventos Purchase estão sem parâmetros obrigatórios`,
          url: null,
          status: 'active'
        });
      }

      // Insert diagnostics
      for (const diagnostic of diagnostics) {
        await query(
          `INSERT INTO diagnostics (id, pixel_id, severity, category, title, description, url, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          [
            diagnostic.id,
            diagnostic.pixelId,
            diagnostic.severity,
            diagnostic.category,
            diagnostic.title,
            diagnostic.description,
            diagnostic.url,
            diagnostic.status
          ]
        );
        diagnosticsCreated++;
      }
    }

    logger.info(`Diagnostics job completed: ${diagnosticsCreated} diagnostics created for ${pixels.length} pixels`);
  } catch (error) {
    logger.error('Error in diagnostics job:', error);
    throw error;
  }
};