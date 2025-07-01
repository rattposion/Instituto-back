import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class EventController {
  async getEvents(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, pixelId, eventName, status, startDate, endDate, sortBy = 'timestamp', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let baseQuery = 'SELECT events.*, pixels.workspace_id FROM events JOIN pixels ON pixels.id = events.pixel_id WHERE pixels.workspace_id = $1';
    let params: any[] = [req.user!.workspaceId];
    let countQuery = 'SELECT COUNT(*) FROM events JOIN pixels ON pixels.id = events.pixel_id WHERE pixels.workspace_id = $1';
    let countParams: any[] = [req.user!.workspaceId];
    if (search) {
      baseQuery += ` AND (event_name ILIKE $${params.length + 1} OR source ILIKE $${params.length + 1})`;
      countQuery += ` AND (event_name ILIKE $${countParams.length + 1} OR source ILIKE $${countParams.length + 1})`;
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }
    if (pixelId) {
      baseQuery += ` AND pixel_id = $${params.length + 1}`;
      countQuery += ` AND pixel_id = $${countParams.length + 1}`;
      params.push(pixelId);
      countParams.push(pixelId);
    }
    if (eventName) {
      baseQuery += ` AND event_name = $${params.length + 1}`;
      countQuery += ` AND event_name = $${countParams.length + 1}`;
      params.push(eventName);
      countParams.push(eventName);
    }
    if (status === 'processed') {
      baseQuery += ` AND processed = $${params.length + 1}`;
      countQuery += ` AND processed = $${countParams.length + 1}`;
      params.push(true);
      countParams.push(true);
    } else if (status === 'error') {
      baseQuery += ' AND error_message IS NOT NULL';
      countQuery += ' AND error_message IS NOT NULL';
    } else if (status === 'pending') {
      baseQuery += ' AND processed = false AND error_message IS NULL';
      countQuery += ' AND processed = false AND error_message IS NULL';
    }
    if (startDate) {
      baseQuery += ` AND timestamp >= $${params.length + 1}`;
      countQuery += ` AND timestamp >= $${countParams.length + 1}`;
      params.push(startDate);
      countParams.push(startDate);
    }
    if (endDate) {
      baseQuery += ` AND timestamp <= $${params.length + 1}`;
      countQuery += ` AND timestamp <= $${countParams.length + 1}`;
      params.push(endDate);
      countParams.push(endDate);
    }
    baseQuery += ` ORDER BY ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const eventsResult = await Database.query(baseQuery, params);
    const countResult = await Database.query(countQuery, countParams);
    const events = eventsResult.rows;
    const count = parseInt(countResult.rows[0].count, 10);
    res.json({
      success: true,
      data: events,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / Number(limit))
      }
    });
  }

  async getEventById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const result = await Database.query(
      'SELECT events.*, pixels.workspace_id FROM events JOIN pixels ON pixels.id = events.pixel_id WHERE events.id = $1 AND pixels.workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    const event = result.rows[0];
    if (!event) {
      throw createError('Event not found', 404);
    }
    res.json({
      success: true,
      data: event
    });
  }

  async createEvent(req: AuthRequest, res: Response) {
    const { pixelId, eventName, eventType, parameters, source, userAgent, ipAddress } = req.body;
    // Verify pixel belongs to workspace
    const pixelResult = await Database.query(
      'SELECT id FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [pixelId, req.user!.workspaceId]
    );
    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }
    const eventData = {
      id: uuidv4(),
      pixel_id: pixelId,
      event_name: eventName,
      event_type: eventType || 'standard',
      parameters: parameters || {},
      source: source || 'web',
      user_agent: userAgent || req.get('User-Agent'),
      ip_address: ipAddress || req.ip,
      timestamp: new Date().toISOString(),
      processed: false
    };
    const insertResult = await Database.query(
      'INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, ip_address, timestamp, processed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [eventData.id, eventData.pixel_id, eventData.event_name, eventData.event_type, eventData.parameters, eventData.source, eventData.user_agent, eventData.ip_address, eventData.timestamp, eventData.processed]
    );
    const event = insertResult.rows[0];
    this.processEventAsync(event);
    res.status(201).json({
      success: true,
      data: event
    });
  }

  async bulkCreateEvents(req: AuthRequest, res: Response) {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      throw createError('Events array is required', 400);
    }
    if (events.length > 100) {
      throw createError('Maximum 100 events per batch', 400);
    }
    // Verify all pixels belong to workspace
    const pixelIds = [...new Set(events.map((e: any) => e.pixelId))];
    const pixelsResult = await Database.query(
      `SELECT id FROM pixels WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [req.user!.workspaceId, pixelIds]
    );
    if (pixelsResult.rows.length !== pixelIds.length) {
      throw createError('One or more pixels not found', 404);
    }
    const eventData = events.map((event: any) => ([
      uuidv4(),
      event.pixelId,
      event.eventName,
      event.eventType || 'standard',
      event.parameters || {},
      event.source || 'server',
      event.userAgent,
      event.ipAddress,
      event.timestamp || new Date().toISOString(),
      false
    ]));
    const valuesSql = eventData.map((_, i) => `($${i * 10 + 1}, $${i * 10 + 2}, $${i * 10 + 3}, $${i * 10 + 4}, $${i * 10 + 5}, $${i * 10 + 6}, $${i * 10 + 7}, $${i * 10 + 8}, $${i * 10 + 9}, $${i * 10 + 10})`).join(', ');
    const flatValues = eventData.flat();
    const insertResult = await Database.query(
      `INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, ip_address, timestamp, processed) VALUES ${valuesSql} RETURNING *`,
      flatValues
    );
    const createdEvents = insertResult.rows;
    createdEvents.forEach((event: any) => this.processEventAsync(event));
    res.status(201).json({
      success: true,
      data: {
        created: createdEvents.length,
        events: createdEvents
      }
    });
  }

  async getEventsAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d', pixelId } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    switch (timeframe) {
      case '1h': startDate.setHours(startDate.getHours() - 1); break;
      case '24h': startDate.setDate(startDate.getDate() - 1); break;
      case '7d': startDate.setDate(startDate.getDate() - 7); break;
      case '30d': startDate.setDate(startDate.getDate() - 30); break;
      default: startDate.setDate(startDate.getDate() - 7);
    }
    let analyticsQuery = 'SELECT event_name, timestamp, processed, error_message, parameters, pixels.workspace_id FROM events JOIN pixels ON pixels.id = events.pixel_id WHERE pixels.workspace_id = $1 AND timestamp >= $2 AND timestamp <= $3';
    let analyticsParams: any[] = [req.user!.workspaceId, startDate.toISOString(), endDate.toISOString()];
    if (pixelId) {
      analyticsQuery += ' AND pixel_id = $4';
      analyticsParams.push(pixelId);
    }
    const analyticsResult = await Database.query(analyticsQuery, analyticsParams);
    const analytics = this.processEventsAnalytics(analyticsResult.rows || []);
    res.json({
      success: true,
      data: analytics
    });
  }

  async reprocessFailedEvents(req: AuthRequest, res: Response) {
    const { pixelId, limit = 100 } = req.body;
    let baseQuery = 'SELECT * FROM events JOIN pixels ON pixels.id = events.pixel_id WHERE pixels.workspace_id = $1 AND error_message IS NOT NULL';
    let params: any[] = [req.user!.workspaceId];
    if (pixelId) {
      baseQuery += ' AND pixel_id = $2';
      params.push(pixelId);
    }
    baseQuery += ' LIMIT $' + (params.length + 1);
    params.push(limit);
    const failedEventsResult = await Database.query(baseQuery, params);
    const failedEvents = failedEventsResult.rows;
    let reprocessedCount = 0;
    for (const event of failedEvents) {
      try {
        await this.processEvent(event);
        reprocessedCount++;
      } catch (error) {
        logger.error(`Failed to reprocess event ${event.id}:`, error);
      }
    }
    res.json({
      success: true,
      data: {
        totalFailed: failedEvents.length,
        reprocessed: reprocessedCount
      }
    });
  }

  private async processEventAsync(event: any) {
    try {
      await this.processEvent(event);
    } catch (error) {
      logger.error(`Failed to process event ${event.id}:`, error);
    }
  }

  private async processEvent(event: any) {
    try {
      const processed = Math.random() > 0.1;
      const updateData: any = {
        processed,
        updated_at: new Date().toISOString()
      };
      if (!processed) {
        updateData.error_message = 'Simulated processing error';
      } else {
        updateData.error_message = null;
        await this.updatePixelStats(event.pixel_id, event);
      }
      await Database.query(
        'UPDATE events SET processed = $1, error_message = $2, updated_at = $3 WHERE id = $4',
        [updateData.processed, updateData.error_message, updateData.updated_at, event.id]
      );
    } catch (error: any) {
      await Database.query(
        'UPDATE events SET processed = false, error_message = $1, updated_at = $2 WHERE id = $3',
        [error.message, new Date().toISOString(), event.id]
      );
      throw error;
    }
  }

  private async updatePixelStats(pixelId: string, event: any) {
    const pixelResult = await Database.query(
      'SELECT events_count, conversions_count, revenue FROM pixels WHERE id = $1 LIMIT 1',
      [pixelId]
    );
    const pixel = pixelResult.rows[0];
    if (pixel) {
      const updateData: any = {
        events_count: pixel.events_count + 1,
        last_activity: new Date().toISOString()
      };
      if (event.event_name === 'Purchase' && event.parameters?.value) {
        updateData.conversions_count = pixel.conversions_count + 1;
        updateData.revenue = pixel.revenue + parseFloat(event.parameters.value);
      }
      await Database.query(
        'UPDATE pixels SET events_count = $1, conversions_count = $2, revenue = $3, last_activity = $4 WHERE id = $5',
        [updateData.events_count, updateData.conversions_count, updateData.revenue, updateData.last_activity, pixelId]
      );
    }
  }

  private processEventsAnalytics(events: any[]) {
    const eventsByDay: { [key: string]: number } = {};
    const eventsByType: { [key: string]: number } = {};
    const errorsByDay: { [key: string]: number } = {};
    let totalProcessed = 0;
    let totalErrors = 0;
    let totalRevenue = 0;
    events.forEach(event => {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      eventsByDay[day] = (eventsByDay[day] || 0) + 1;
      eventsByType[event.event_name] = (eventsByType[event.event_name] || 0) + 1;
      if (event.processed) {
        totalProcessed++;
      }
      if (event.error_message) {
        totalErrors++;
        errorsByDay[day] = (errorsByDay[day] || 0) + 1;
      }
      if (event.event_name === 'Purchase' && event.parameters?.value) {
        totalRevenue += parseFloat(event.parameters.value);
      }
    });
    return {
      totalEvents: events.length,
      totalProcessed,
      totalErrors,
      successRate: events.length > 0 ? (totalProcessed / events.length) * 100 : 0,
      totalRevenue,
      eventsByDay,
      eventsByType,
      errorsByDay,
      topEvents: Object.entries(eventsByType)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))
    };
  }
}