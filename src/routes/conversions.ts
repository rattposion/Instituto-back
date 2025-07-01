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
const createConversionSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  pixelId: Joi.string().uuid().required(),
  eventName: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).optional(),
  rules: Joi.array().items(Joi.object({
    type: Joi.string().valid('url', 'event', 'parameter').required(),
    operator: Joi.string().valid('equals', 'contains', 'starts_with', 'ends_with', 'greater_than', 'less_than').required(),
    value: Joi.string().required(),
    parameter: Joi.string().optional()
  })).optional()
});

const updateConversionSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).optional(),
  isActive: Joi.boolean().optional(),
  rules: Joi.array().items(Joi.object({
    type: Joi.string().valid('url', 'event', 'parameter').required(),
    operator: Joi.string().valid('equals', 'contains', 'starts_with', 'ends_with', 'greater_than', 'less_than').required(),
    value: Joi.string().required(),
    parameter: Joi.string().optional()
  })).optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).optional(),
  pixelId: Joi.string().uuid().optional()
});

const paramsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Get all conversions for workspace
router.get('/', authenticateToken, validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { page = 1, limit = 20, search, pixelId } = req.query as any;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE p.workspace_id = $1';
    const queryParams: any[] = [req.user!.workspaceId];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (c.name ILIKE $${paramCount} OR c.event_name ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (pixelId) {
      whereClause += ` AND c.pixel_id = $${paramCount}`;
      queryParams.push(pixelId);
      paramCount++;
    }

    // Get conversions with analytics
    const conversionsResult = await query(
      `SELECT 
        c.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id,
        COALESCE(stats.total_conversions, 0) as total_conversions,
        COALESCE(stats.total_value, 0) as total_value,
        COALESCE(stats.conversion_rate, 0) as conversion_rate
      FROM conversions c
      JOIN pixels p ON c.pixel_id = p.id
      LEFT JOIN (
        SELECT 
          c.id as conversion_id,
          COUNT(e.id) as total_conversions,
          COALESCE(SUM((e.parameters->>'value')::numeric), 0) as total_value,
          CASE 
            WHEN total_events.count > 0 THEN (COUNT(e.id)::float / total_events.count * 100)
            ELSE 0 
          END as conversion_rate
        FROM conversions c
        LEFT JOIN events e ON c.pixel_id = e.pixel_id AND c.event_name = e.event_name
        LEFT JOIN (
          SELECT pixel_id, COUNT(*) as count
          FROM events
          GROUP BY pixel_id
        ) total_events ON c.pixel_id = total_events.pixel_id
        GROUP BY c.id, total_events.count
      ) stats ON c.id = stats.conversion_id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total 
       FROM conversions c
       JOIN pixels p ON c.pixel_id = p.id
       ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        conversions: conversionsResult.rows,
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

// Get single conversion
router.get('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const conversionResult = await query(
      `SELECT 
        c.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM conversions c
      JOIN pixels p ON c.pixel_id = p.id
      WHERE c.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (conversionResult.rows.length === 0) {
      throw createError('Conversion not found', 404);
    }

    // Get conversion analytics
    const analyticsResult = await query(
      `SELECT 
        COUNT(e.id) as total_conversions,
        COALESCE(SUM((e.parameters->>'value')::numeric), 0) as total_value,
        COALESCE(AVG((e.parameters->>'value')::numeric), 0) as average_value,
        COUNT(e.id) FILTER (WHERE DATE(e.created_at) = CURRENT_DATE) as conversions_today,
        COALESCE(SUM(CASE WHEN DATE(e.created_at) = CURRENT_DATE THEN (e.parameters->>'value')::numeric END), 0) as value_today
      FROM events e
      WHERE e.pixel_id = $1 AND e.event_name = $2`,
      [conversionResult.rows[0].pixel_id, conversionResult.rows[0].event_name]
    );

    // Get conversion timeline (last 30 days)
    const timelineResult = await query(
      `SELECT 
        DATE(e.created_at) as date,
        COUNT(e.id) as conversions,
        COALESCE(SUM((e.parameters->>'value')::numeric), 0) as value
      FROM events e
      WHERE e.pixel_id = $1 AND e.event_name = $2 AND e.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(e.created_at)
      ORDER BY date`,
      [conversionResult.rows[0].pixel_id, conversionResult.rows[0].event_name]
    );

    res.json({
      success: true,
      data: {
        ...conversionResult.rows[0],
        analytics: analyticsResult.rows[0],
        timeline: timelineResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create conversion
router.post('/', authenticateToken, requireRole(['admin', 'manager']), validate(createConversionSchema), async (req: AuthRequest, res, next) => {
  try {
    const { name, pixelId, eventName, description, rules } = req.body;

    // Check if pixel exists and belongs to workspace
    const pixelResult = await query(
      'SELECT id, name FROM pixels WHERE id = $1 AND workspace_id = $2',
      [pixelId, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    // Check if conversion with same name already exists for this pixel
    const existingConversion = await query(
      'SELECT id FROM conversions WHERE name = $1 AND pixel_id = $2',
      [name, pixelId]
    );

    if (existingConversion.rows.length > 0) {
      throw createError('Conversion with this name already exists for this pixel', 400);
    }

    const id = uuidv4();
    await query(
      `INSERT INTO conversions (id, name, pixel_id, event_name, description, rules, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [id, name, pixelId, eventName, description, rules || [], req.user!.id]
    );

    // Get created conversion
    const createdConversion = await query(
      `SELECT 
        c.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM conversions c
      JOIN pixels p ON c.pixel_id = p.id
      WHERE c.id = $1`,
      [id]
    );

    res.status(201).json({
      success: true,
      data: createdConversion.rows[0]
    });

    logger.info(`Conversion created: ${name} for pixel ${pixelId} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Update conversion
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), validateParams(paramsSchema), validate(updateConversionSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, isActive, rules } = req.body;

    // Check if conversion exists and belongs to workspace
    const existingConversion = await query(
      `SELECT c.id FROM conversions c
       JOIN pixels p ON c.pixel_id = p.id
       WHERE c.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (existingConversion.rows.length === 0) {
      throw createError('Conversion not found', 404);
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(isActive);
    }

    if (rules) {
      updates.push(`rules = $${paramCount++}`);
      values.push(rules);
    }

    if (updates.length === 0) {
      throw createError('No fields to update', 400);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    await query(
      `UPDATE conversions SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated conversion
    const updatedConversion = await query(
      `SELECT 
        c.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM conversions c
      JOIN pixels p ON c.pixel_id = p.id
      WHERE c.id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: updatedConversion.rows[0]
    });

    logger.info(`Conversion updated: ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Delete conversion
router.delete('/:id', authenticateToken, requireRole(['admin']), validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if conversion exists and belongs to workspace
    const existingConversion = await query(
      `SELECT c.id, c.name FROM conversions c
       JOIN pixels p ON c.pixel_id = p.id
       WHERE c.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (existingConversion.rows.length === 0) {
      throw createError('Conversion not found', 404);
    }

    await query('DELETE FROM conversions WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Conversion deleted successfully'
    });

    logger.info(`Conversion deleted: ${existingConversion.rows[0].name} (${id}) by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

export default router;