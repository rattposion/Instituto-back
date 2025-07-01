import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class EventController {
  async getEvents(req: AuthRequest, res: Response) {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      pixelId, 
      eventName, 
      status,
      startDate,
      endDate,
      sortBy = 'timestamp', 
      sortOrder = 'desc' 
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);

    let query = Database.query(`
      SELECT *
      FROM events
      JOIN pixels ON pixels.id = events.pixel_id
      WHERE pixels.workspace_id = ${req.user!.workspaceId}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `);

    if (search) {
      query = query.or(`event_name.ilike.%${search}%,source.ilike.%${search}%`);
    }

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    if (eventName) {
      query = query.eq('event_name', eventName);
    }

    if (status === 'processed') {
      query = query.eq('processed', true);
    } else if (status === 'error') {
      query = query.not('error_message', 'is', null);
    } else if (status === 'pending') {
      query = query.eq('processed', false).is('error_message', null);
    }

    if (startDate) {
      query = query.gte('timestamp', startDate);
    }

    if (endDate) {
      query = query.lte('timestamp', endDate);
    }

    const { data: events, error, count } = await query;

    if (error) {
      logger.error('Error fetching events:', error);
      throw createError('Failed to fetch events', 500);
    }

    res.json({
      success: true,
      data: events,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getEventById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: event, error } = await Database.query(`
      SELECT *
      FROM events
      JOIN pixels ON pixels.id = events.pixel_id
      WHERE events.id = ${id} AND pixels.workspace_id = ${req.user!.workspaceId}
      LIMIT 1
    `);

    if (error || !event) {
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
    const { data: pixel, error: pixelError } = await Database.query(`
      SELECT id
      FROM pixels
      WHERE id = ${pixelId} AND workspace_id = ${req.user!.workspaceId}
      LIMIT 1
    `);

    if (pixelError || !pixel) {
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

    const { data: event, error } = await Database.query(`
      INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, ip_address, timestamp, processed)
      VALUES (${eventData.id}, ${eventData.pixel_id}, ${eventData.event_name}, ${eventData.event_type}, ${eventData.parameters}, ${eventData.source}, ${eventData.user_agent}, ${eventData.ip_address}, ${eventData.timestamp}, ${eventData.processed})
      RETURNING *
    `);

    if (error) {
      logger.error('Error creating event:', error);
      throw createError('Failed to create event', 500);
    }

    // Process event asynchronously
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
    const pixelIds = [...new Set(events.map(e => e.pixelId))];
    const { data: pixels, error: pixelError } = await Database.query(`
      SELECT id
      FROM pixels
      WHERE workspace_id = ${req.user!.workspaceId} AND id IN (${pixelIds.map(id => `'${id}'`).join(',')})
    `);

    if (pixelError || pixels.length !== pixelIds.length) {
      throw createError('One or more pixels not found', 404);
    }

    const eventData = events.map(event => ({
      id: uuidv4(),
      pixel_id: event.pixelId,
      event_name: event.eventName,
      event_type: event.eventType || 'standard',
      parameters: event.parameters || {},
      source: event.source || 'server',
      user_agent: event.userAgent,
      ip_address: event.ipAddress,
      timestamp: event.timestamp || new Date().toISOString(),
      processed: false
    }));

    const { data: createdEvents, error } = await Database.query(`
      INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, ip_address, timestamp, processed)
      VALUES ${eventData.map(e => `(${e.id}, ${e.pixel_id}, ${e.event_name}, ${e.event_type}, ${e.parameters}, ${e.source}, ${e.user_agent}, ${e.ip_address}, ${e.timestamp}, ${e.processed})`).join(',')}
      RETURNING *
    `);

    if (error) {
      logger.error('Error creating bulk events:', error);
      throw createError('Failed to create events', 500);
    }

    // Process events asynchronously
    createdEvents.forEach(event => this.processEventAsync(event));

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

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    let query = Database.query(`
      SELECT event_name, timestamp, processed, error_message, parameters,
      pixels.workspace_id
      FROM events
      JOIN pixels ON pixels.id = events.pixel_id
      WHERE pixels.workspace_id = ${req.user!.workspaceId}
      AND timestamp >= ${startDate.toISOString()} AND timestamp <= ${endDate.toISOString()}
    `);

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    const { data: events, error } = await query;

    if (error) {
      logger.error('Error fetching events analytics:', error);
      throw createError('Failed to fetch analytics', 500);
    }

    const analytics = this.processEventsAnalytics(events || []);

    res.json({
      success: true,
      data: analytics
    });
  }

  async reprocessFailedEvents(req: AuthRequest, res: Response) {
    const { pixelId, limit = 100 } = req.body;

    let query = Database.query(`
      SELECT *
      FROM events
      JOIN pixels ON pixels.id = events.pixel_id
      WHERE pixels.workspace_id = ${req.user!.workspaceId}
      AND error_message IS NOT NULL
      LIMIT ${limit}
    `);

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    const { data: failedEvents, error } = await query;

    if (error) {
      logger.error('Error fetching failed events:', error);
      throw createError('Failed to fetch failed events', 500);
    }

    // Reprocess events
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
      // Simulate event processing logic
      // In a real implementation, this would:
      // 1. Validate event data
      // 2. Send to Meta Pixel API
      // 3. Update conversion tracking
      // 4. Trigger any webhooks

      const processed = Math.random() > 0.1; // 90% success rate
      const updateData: any = {
        processed,
        updated_at: new Date().toISOString()
      };

      if (!processed) {
        updateData.error_message = 'Simulated processing error';
      } else {
        updateData.error_message = null;
        
        // Update pixel statistics
        await this.updatePixelStats(event.pixel_id, event);
      }

      await Database.query(`
        UPDATE events
        SET processed = ${updateData.processed},
            error_message = ${updateData.error_message},
            updated_at = ${updateData.updated_at}
        WHERE id = ${event.id}
      `);

    } catch (error) {
      await Database.query(`
        UPDATE events
        SET processed = false,
            error_message = ${error.message},
            updated_at = ${new Date().toISOString()}
        WHERE id = ${event.id}
      `);
      
      throw error;
    }
  }

  private async updatePixelStats(pixelId: string, event: any) {
    // Update pixel events count and revenue
    const { data: pixel } = await Database.query(`
      SELECT events_count, conversions_count, revenue
      FROM pixels
      WHERE id = ${pixelId}
      LIMIT 1
    `);

    if (pixel) {
      const updateData: any = {
        events_count: pixel.events_count + 1,
        last_activity: new Date().toISOString()
      };

      if (event.event_name === 'Purchase' && event.parameters?.value) {
        updateData.conversions_count = pixel.conversions_count + 1;
        updateData.revenue = pixel.revenue + parseFloat(event.parameters.value);
      }

      await Database.query(`
        UPDATE pixels
        SET events_count = ${updateData.events_count},
            conversions_count = ${updateData.conversions_count},
            revenue = ${updateData.revenue},
            last_activity = ${updateData.last_activity}
        WHERE id = ${pixelId}
      `);
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