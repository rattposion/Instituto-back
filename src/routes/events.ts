import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validation';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const createEventSchema = Joi.object({
  pixelId: Joi.string().uuid().required(),
  eventName: Joi.string().min(1).max(100).required(),
  eventType: Joi.string().valid('standard', 'custom').default('standard'),
  parameters: Joi.object().default({}),
  source: Joi.string().valid('web', 'server', 'mobile').default('web'),
  userAgent: Joi.string().max(500).optional(),
  ipAddress: Joi.string().ip().optional()
});

const bulkCreateEventsSchema = Joi.object({
  events: Joi.array().items(createEventSchema).min(1).max(100).required()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).optional(),
  pixelId: Joi.string().uuid().optional(),
  eventName: Joi.string().max(100).optional(),
  status: Joi.string().valid('success', 'error', 'pending').optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional()
});

const paramsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Get all events for workspace
router.get('/', authenticateToken, validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { page = 1, limit = 20, search, pixelId, eventName, status, startDate, endDate } = req.query as any;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE p.workspace_id = $1';
    const queryParams: any[] = [req.user!.workspaceId];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (e.event_name ILIKE $${paramCount} OR p.name ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (pixelId) {
      whereClause += ` AND e.pixel_id = $${paramCount}`;
      queryParams.push(pixelId);
      paramCount++;
    }

    if (eventName) {
      whereClause += ` AND e.event_name = $${paramCount}`;
      queryParams.push(eventName);
      paramCount++;
    }

    if (status) {
      whereClause += ` AND e.status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }

    if (startDate) {
      whereClause += ` AND e.created_at >= $${paramCount}`;
      queryParams.push(startDate);
      paramCount++;
    }

    if (endDate) {
      whereClause += ` AND e.created_at <= $${paramCount}`;
      queryParams.push(endDate);
      paramCount++;
    }

    // Get events with pixel info
    const eventsResult = await query(
      `SELECT 
        e.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total 
       FROM events e
       JOIN pixels p ON e.pixel_id = p.id
       ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        events: eventsResult.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get single event
router.get('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const eventResult = await query(
      `SELECT 
        e.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE e.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (eventResult.rows.length === 0) {
      throw createError('Event not found', 404);
    }

    res.json({
      success: true,
      data: eventResult.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Create event
router.post('/', authenticateToken, validate(createEventSchema), async (req: AuthRequest, res, next) => {
  try {
    const { pixelId, eventName, eventType, parameters, source, userAgent, ipAddress } = req.body;

    // Check if pixel exists and belongs to workspace
    const pixelResult = await query(
      'SELECT id, name FROM pixels WHERE id = $1 AND workspace_id = $2',
      [pixelId, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    const id = uuidv4();
    await query(
      `INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [id, pixelId, eventName, eventType, parameters, source, userAgent, ipAddress]
    );

    // Update pixel last activity
    await query(
      'UPDATE pixels SET last_activity = NOW(), status = $1 WHERE id = $2',
      ['active', pixelId]
    );

    // Get created event
    const createdEvent = await query(
      `SELECT 
        e.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE e.id = $1`,
      [id]
    );

    res.status(201).json({
      success: true,
      data: createdEvent.rows[0]
    });

    logger.info(`Event created: ${eventName} for pixel ${pixelId}`);
  } catch (error) {
    next(error);
  }
});

// Create events in bulk
router.post('/bulk', authenticateToken, validate(bulkCreateEventsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { events } = req.body;

    // Validate all pixel IDs belong to workspace
    const pixelIds = [...new Set(events.map((e: any) => e.pixelId))];
    const pixelsResult = await query(
      `SELECT id FROM pixels WHERE id = ANY($1) AND workspace_id = $2`,
      [pixelIds, req.user!.workspaceId]
    );

    if (pixelsResult.rows.length !== pixelIds.length) {
      throw createError('One or more pixels not found', 404);
    }

    // Start transaction
    await query('BEGIN');

    try {
      const createdEvents = [];

      for (const event of events) {
        const { pixelId, eventName, eventType = 'standard', parameters = {}, source = 'web', userAgent, ipAddress } = event;
        
        const id = uuidv4();
        await query(
          `INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [id, pixelId, eventName, eventType, parameters, source, userAgent, ipAddress]
        );

        createdEvents.push({ id, pixelId, eventName });
      }

      // Update pixel last activities
      await query(
        'UPDATE pixels SET last_activity = NOW(), status = $1 WHERE id = ANY($2)',
        ['active', pixelIds]
      );

      await query('COMMIT');

      res.status(201).json({
        success: true,
        data: {
          created: createdEvents.length,
          events: createdEvents
        }
      });

      logger.info(`Bulk events created: ${createdEvents.length} events`);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Get events analytics summary
router.get('/analytics/summary', authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    const { timeframe = '7d', pixelId } = req.query;

    // Calculate date range based on timeframe
    let dateFilter = '';
    switch (timeframe) {
      case '1h':
        dateFilter = "AND e.created_at >= NOW() - INTERVAL '1 hour'";
        break;
      case '24h':
        dateFilter = "AND e.created_at >= NOW() - INTERVAL '24 hours'";
        break;
      case '7d':
        dateFilter = "AND e.created_at >= NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        dateFilter = "AND e.created_at >= NOW() - INTERVAL '30 days'";
        break;
      default:
        dateFilter = "AND e.created_at >= NOW() - INTERVAL '7 days'";
    }

    let pixelFilter = '';
    const queryParams = [req.user!.workspaceId];
    if (pixelId) {
      pixelFilter = 'AND e.pixel_id = $2';
      queryParams.push(pixelId);
    }

    // Get summary statistics
    const summaryResult = await query(
      `SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE e.status = 'success') as successful_events,
        COUNT(*) FILTER (WHERE e.status = 'error') as failed_events,
        COUNT(*) FILTER (WHERE DATE(e.created_at) = CURRENT_DATE) as events_today,
        COUNT(DISTINCT e.pixel_id) as active_pixels,
        COUNT(DISTINCT e.event_name) as unique_events
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter} ${pixelFilter}`,
      queryParams
    );

    // Get events by day
    const timelineResult = await query(
      `SELECT 
        DATE(e.created_at) as date,
        COUNT(*) as events,
        COUNT(*) FILTER (WHERE e.status = 'error') as errors
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter} ${pixelFilter}
      GROUP BY DATE(e.created_at)
      ORDER BY date`,
      queryParams
    );

    // Get top events
    const topEventsResult = await query(
      `SELECT 
        e.event_name,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER()), 2) as percentage
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter} ${pixelFilter}
      GROUP BY e.event_name
      ORDER BY count DESC
      LIMIT 10`,
      queryParams
    );

    // Get events by source
    const sourceResult = await query(
      `SELECT 
        e.source,
        COUNT(*) as count
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter} ${pixelFilter}
      GROUP BY e.source
      ORDER BY count DESC`,
      queryParams
    );

    res.json({
      success: true,
      data: {
        summary: summaryResult.rows[0],
        timeline: timelineResult.rows,
        topEvents: topEventsResult.rows,
        bySource: sourceResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;