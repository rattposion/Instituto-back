import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validation';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const createPixelSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  pixelId: Joi.string().min(10).max(20).required(),
  metaAccount: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).optional(),
  settings: Joi.object().optional()
});

const updatePixelSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  metaAccount: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).optional(),
  settings: Joi.object().optional(),
  isActive: Joi.boolean().optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).optional(),
  status: Joi.string().valid('active', 'inactive', 'error').optional()
});

const paramsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Get all pixels for workspace
router.get('/', authenticateToken, validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query as any;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE p.workspace_id = $1';
    const queryParams: any[] = [req.user!.workspaceId];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramCount} OR p.pixel_id ILIKE $${paramCount} OR p.meta_account ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (status) {
      whereClause += ` AND p.status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }

    // Get pixels with analytics
    const pixelsResult = await query(
      `SELECT 
        p.*,
        COALESCE(e.events_today, 0) as events_today,
        COALESCE(e.events_total, 0) as events_total,
        COALESCE(c.conversions_today, 0) as conversions_today,
        COALESCE(c.conversions_total, 0) as conversions_total,
        COALESCE(c.revenue_today, 0) as revenue_today,
        COALESCE(c.revenue_total, 0) as revenue_total
      FROM pixels p
      LEFT JOIN (
        SELECT 
          pixel_id,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as events_today,
          COUNT(*) as events_total
        FROM events 
        GROUP BY pixel_id
      ) e ON p.id = e.pixel_id
      LEFT JOIN (
        SELECT 
          pixel_id,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE AND event_name = 'Purchase') as conversions_today,
          COUNT(*) FILTER (WHERE event_name = 'Purchase') as conversions_total,
          COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE AND event_name = 'Purchase' THEN (parameters->>'value')::numeric END), 0) as revenue_today,
          COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN (parameters->>'value')::numeric END), 0) as revenue_total
        FROM events 
        WHERE parameters->>'value' IS NOT NULL
        GROUP BY pixel_id
      ) c ON p.id = c.pixel_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM pixels p ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        pixels: pixelsResult.rows,
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

// Get single pixel
router.get('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const pixelResult = await query(
      `SELECT 
        p.*,
        COALESCE(e.events_today, 0) as events_today,
        COALESCE(e.events_total, 0) as events_total,
        COALESCE(c.conversions_today, 0) as conversions_today,
        COALESCE(c.conversions_total, 0) as conversions_total,
        COALESCE(c.revenue_today, 0) as revenue_today,
        COALESCE(c.revenue_total, 0) as revenue_total
      FROM pixels p
      LEFT JOIN (
        SELECT 
          pixel_id,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as events_today,
          COUNT(*) as events_total
        FROM events 
        WHERE pixel_id = $1
        GROUP BY pixel_id
      ) e ON p.id = e.pixel_id
      LEFT JOIN (
        SELECT 
          pixel_id,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE AND event_name = 'Purchase') as conversions_today,
          COUNT(*) FILTER (WHERE event_name = 'Purchase') as conversions_total,
          COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE AND event_name = 'Purchase' THEN (parameters->>'value')::numeric END), 0) as revenue_today,
          COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN (parameters->>'value')::numeric END), 0) as revenue_total
        FROM events 
        WHERE pixel_id = $1 AND parameters->>'value' IS NOT NULL
        GROUP BY pixel_id
      ) c ON p.id = c.pixel_id
      WHERE p.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    res.json({
      success: true,
      data: pixelResult.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Create pixel
router.post('/', authenticateToken, requireRole(['admin', 'manager']), validate(createPixelSchema), async (req: AuthRequest, res, next) => {
  try {
    const { name, pixelId, metaAccount, description, settings } = req.body;

    // Check if pixel ID already exists in workspace
    const existingPixel = await query(
      'SELECT id FROM pixels WHERE pixel_id = $1 AND workspace_id = $2',
      [pixelId, req.user!.workspaceId]
    );

    if (existingPixel.rows.length > 0) {
      throw createError('Pixel ID already exists in this workspace', 400);
    }

    const id = uuidv4();
    await query(
      `INSERT INTO pixels (id, name, pixel_id, meta_account, description, settings, workspace_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [id, name, pixelId, metaAccount, description, settings || {}, req.user!.workspaceId, req.user!.id]
    );

    // Get created pixel
    const createdPixel = await query('SELECT * FROM pixels WHERE id = $1', [id]);

    res.status(201).json({
      success: true,
      data: createdPixel.rows[0]
    });

    logger.info(`Pixel created: ${name} (${pixelId}) by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Update pixel
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), validateParams(paramsSchema), validate(updatePixelSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { name, metaAccount, description, settings, isActive } = req.body;

    // Check if pixel exists and belongs to workspace
    const existingPixel = await query(
      'SELECT id FROM pixels WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (existingPixel.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (metaAccount) {
      updates.push(`meta_account = $${paramCount++}`);
      values.push(metaAccount);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (settings) {
      updates.push(`settings = $${paramCount++}`);
      values.push(settings);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(isActive);
      updates.push(`status = $${paramCount++}`);
      values.push(isActive ? 'active' : 'inactive');
    }

    if (updates.length === 0) {
      throw createError('No fields to update', 400);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    await query(
      `UPDATE pixels SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated pixel
    const updatedPixel = await query('SELECT * FROM pixels WHERE id = $1', [id]);

    res.json({
      success: true,
      data: updatedPixel.rows[0]
    });

    logger.info(`Pixel updated: ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Delete pixel
router.delete('/:id', authenticateToken, requireRole(['admin']), validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if pixel exists and belongs to workspace
    const existingPixel = await query(
      'SELECT id, name FROM pixels WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (existingPixel.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    // Start transaction to delete pixel and related data
    await query('BEGIN');

    try {
      // Delete related events
      await query('DELETE FROM events WHERE pixel_id = $1', [id]);
      
      // Delete related conversions
      await query('DELETE FROM conversions WHERE pixel_id = $1', [id]);
      
      // Delete related diagnostics
      await query('DELETE FROM diagnostics WHERE pixel_id = $1', [id]);
      
      // Delete pixel
      await query('DELETE FROM pixels WHERE id = $1', [id]);

      await query('COMMIT');

      res.json({
        success: true,
        message: 'Pixel deleted successfully'
      });

      logger.info(`Pixel deleted: ${existingPixel.rows[0].name} (${id}) by user ${req.user!.id}`);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Get pixel analytics
router.get('/:id/analytics', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;

    // Check if pixel exists and belongs to workspace
    const pixelResult = await query(
      'SELECT id, name FROM pixels WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    // Calculate date range based on timeframe
    let dateFilter = '';
    switch (timeframe) {
      case '1h':
        dateFilter = "AND created_at >= NOW() - INTERVAL '1 hour'";
        break;
      case '24h':
        dateFilter = "AND created_at >= NOW() - INTERVAL '24 hours'";
        break;
      case '7d':
        dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        dateFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
        break;
      default:
        dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
    }

    // Get events analytics
    const eventsAnalytics = await query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as events,
        COUNT(DISTINCT CASE WHEN event_name = 'Purchase' THEN id END) as conversions,
        COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN (parameters->>'value')::numeric END), 0) as revenue
      FROM events 
      WHERE pixel_id = $1 ${dateFilter}
      GROUP BY DATE(created_at)
      ORDER BY date`,
      [id]
    );

    // Get top events
    const topEvents = await query(
      `SELECT 
        event_name,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER()), 2) as percentage
      FROM events 
      WHERE pixel_id = $1 ${dateFilter}
      GROUP BY event_name
      ORDER BY count DESC
      LIMIT 10`,
      [id]
    );

    // Get summary stats
    const summary = await query(
      `SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT CASE WHEN event_name = 'Purchase' THEN id END) as total_conversions,
        COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN (parameters->>'value')::numeric END), 0) as total_revenue,
        COUNT(DISTINCT DATE(created_at)) as active_days
      FROM events 
      WHERE pixel_id = $1 ${dateFilter}`,
      [id]
    );

    res.json({
      success: true,
      data: {
        summary: summary.rows[0],
        timeline: eventsAnalytics.rows,
        topEvents: topEvents.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Test pixel connection
router.post('/:id/test', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if pixel exists and belongs to workspace
    const pixelResult = await query(
      'SELECT id, name, pixel_id FROM pixels WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    const pixel = pixelResult.rows[0];

    // Create a test event
    const testEventId = uuidv4();
    await query(
      `INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        testEventId,
        id,
        'TestEvent',
        'custom',
        { test: true, timestamp: new Date().toISOString() },
        'test',
        'Meta Pixel Admin Test'
      ]
    );

    // Update pixel status to active if test successful
    await query(
      'UPDATE pixels SET status = $1, last_activity = NOW(), updated_at = NOW() WHERE id = $2',
      ['active', id]
    );

    res.json({
      success: true,
      message: 'Pixel test successful',
      data: {
        testEventId,
        pixelId: pixel.pixel_id,
        timestamp: new Date().toISOString()
      }
    });

    logger.info(`Pixel test successful: ${pixel.name} (${id}) by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

export default router;