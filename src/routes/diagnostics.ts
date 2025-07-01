import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validateQuery, validateParams } from '../middleware/validation';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).optional(),
  pixelId: Joi.string().uuid().optional(),
  severity: Joi.string().valid('info', 'warning', 'error', 'success').optional(),
  category: Joi.string().valid('implementation', 'events', 'performance', 'connection').optional(),
  status: Joi.string().valid('active', 'resolved').optional()
});

const paramsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Get all diagnostics for workspace
router.get('/', authenticateToken, validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { page = 1, limit = 20, search, pixelId, severity, category, status } = req.query as any;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE p.workspace_id = $1';
    const queryParams: any[] = [req.user!.workspaceId];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (d.title ILIKE $${paramCount} OR d.description ILIKE $${paramCount} OR p.name ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (pixelId) {
      whereClause += ` AND d.pixel_id = $${paramCount}`;
      queryParams.push(pixelId);
      paramCount++;
    }

    if (severity) {
      whereClause += ` AND d.severity = $${paramCount}`;
      queryParams.push(severity);
      paramCount++;
    }

    if (category) {
      whereClause += ` AND d.category = $${paramCount}`;
      queryParams.push(category);
      paramCount++;
    }

    if (status) {
      whereClause += ` AND d.status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }

    // Get diagnostics with pixel info
    const diagnosticsResult = await query(
      `SELECT 
        d.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM diagnostics d
      JOIN pixels p ON d.pixel_id = p.id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total 
       FROM diagnostics d
       JOIN pixels p ON d.pixel_id = p.id
       ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        diagnostics: diagnosticsResult.rows,
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

// Get single diagnostic
router.get('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const diagnosticResult = await query(
      `SELECT 
        d.*,
        p.name as pixel_name,
        p.pixel_id as pixel_external_id
      FROM diagnostics d
      JOIN pixels p ON d.pixel_id = p.id
      WHERE d.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (diagnosticResult.rows.length === 0) {
      throw createError('Diagnostic not found', 404);
    }

    res.json({
      success: true,
      data: diagnosticResult.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Run diagnostics for a pixel
router.post('/run/:pixelId', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { pixelId } = req.params;

    // Check if pixel exists and belongs to workspace
    const pixelResult = await query(
      'SELECT id, name, pixel_id, status, last_activity FROM pixels WHERE id = $1 AND workspace_id = $2',
      [pixelId, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    const pixel = pixelResult.rows[0];
    const diagnostics = [];

    // Clear existing diagnostics for this pixel
    await query('DELETE FROM diagnostics WHERE pixel_id = $1', [pixelId]);

    // Diagnostic 1: Check if pixel is receiving events
    const recentEventsResult = await query(
      'SELECT COUNT(*) as count FROM events WHERE pixel_id = $1 AND created_at >= NOW() - INTERVAL \'24 hours\'',
      [pixelId]
    );

    const recentEventsCount = parseInt(recentEventsResult.rows[0].count);

    if (recentEventsCount === 0) {
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: 'error',
        category: 'implementation',
        title: 'Pixel não está recebendo eventos',
        description: 'O pixel não recebeu nenhum evento nas últimas 24 horas. Verifique se o código está implementado corretamente.',
        url: null,
        status: 'active'
      });
    } else if (recentEventsCount < 10) {
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: 'warning',
        category: 'performance',
        title: 'Baixo volume de eventos',
        description: `O pixel recebeu apenas ${recentEventsCount} eventos nas últimas 24 horas, o que pode indicar problemas de implementação.`,
        url: null,
        status: 'active'
      });
    } else {
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: 'success',
        category: 'implementation',
        title: 'Pixel funcionando corretamente',
        description: `O pixel está recebendo eventos normalmente (${recentEventsCount} eventos nas últimas 24 horas).`,
        url: null,
        status: 'resolved'
      });
    }

    // Diagnostic 2: Check for failed events
    const failedEventsResult = await query(
      'SELECT COUNT(*) as count FROM events WHERE pixel_id = $1 AND status = $2 AND created_at >= NOW() - INTERVAL \'24 hours\'',
      [pixelId, 'error']
    );

    const failedEventsCount = parseInt(failedEventsResult.rows[0].count);

    if (failedEventsCount > 0) {
      const errorRate = (failedEventsCount / recentEventsCount * 100).toFixed(2);
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: failedEventsCount > recentEventsCount * 0.1 ? 'error' : 'warning',
        category: 'events',
        title: 'Eventos com falha detectados',
        description: `${failedEventsCount} eventos falharam nas últimas 24 horas (${errorRate}% de taxa de erro).`,
        url: null,
        status: 'active'
      });
    }

    // Diagnostic 3: Check for missing Purchase events parameters
    const purchaseEventsResult = await query(
      `SELECT COUNT(*) as total, 
       COUNT(*) FILTER (WHERE parameters->>'value' IS NULL OR parameters->>'currency' IS NULL) as missing_params
       FROM events 
       WHERE pixel_id = $1 AND event_name = 'Purchase' AND created_at >= NOW() - INTERVAL '7 days'`,
      [pixelId]
    );

    const purchaseEvents = purchaseEventsResult.rows[0];
    if (parseInt(purchaseEvents.total) > 0 && parseInt(purchaseEvents.missing_params) > 0) {
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: 'warning',
        category: 'events',
        title: 'Eventos Purchase sem parâmetros obrigatórios',
        description: `${purchaseEvents.missing_params} de ${purchaseEvents.total} eventos Purchase estão sem os parâmetros 'value' ou 'currency'.`,
        url: null,
        status: 'active'
      });
    }

    // Diagnostic 4: Check pixel status
    if (pixel.status === 'inactive') {
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: 'error',
        category: 'connection',
        title: 'Pixel inativo',
        description: 'O pixel está marcado como inativo. Verifique a configuração e ative-o se necessário.',
        url: null,
        status: 'active'
      });
    } else if (pixel.status === 'error') {
      diagnostics.push({
        id: uuidv4(),
        pixelId,
        severity: 'error',
        category: 'connection',
        title: 'Pixel com erro',
        description: 'O pixel está com status de erro. Verifique os logs e a configuração.',
        url: null,
        status: 'active'
      });
    }

    // Diagnostic 5: Check last activity
    if (pixel.last_activity) {
      const lastActivity = new Date(pixel.last_activity);
      const hoursSinceLastActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastActivity > 24) {
        diagnostics.push({
          id: uuidv4(),
          pixelId,
          severity: 'warning',
          category: 'performance',
          title: 'Pixel inativo há mais de 24 horas',
          description: `A última atividade do pixel foi há ${Math.floor(hoursSinceLastActivity)} horas.`,
          url: null,
          status: 'active'
        });
      }
    }

    // Insert diagnostics into database
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
    }

    // Get summary
    const summaryResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE severity = 'error') as errors,
        COUNT(*) FILTER (WHERE severity = 'warning') as warnings,
        COUNT(*) FILTER (WHERE severity = 'info') as info,
        COUNT(*) FILTER (WHERE severity = 'success') as success
       FROM diagnostics 
       WHERE pixel_id = $1`,
      [pixelId]
    );

    res.json({
      success: true,
      data: {
        summary: summaryResult.rows[0],
        diagnostics: diagnostics.length,
        message: `Diagnóstico executado com sucesso. ${diagnostics.length} itens verificados.`
      }
    });

    logger.info(`Diagnostics run for pixel: ${pixel.name} (${pixelId}) by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Mark diagnostic as resolved
router.put('/:id/resolve', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if diagnostic exists and belongs to workspace
    const diagnosticResult = await query(
      `SELECT d.id FROM diagnostics d
       JOIN pixels p ON d.pixel_id = p.id
       WHERE d.id = $1 AND p.workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (diagnosticResult.rows.length === 0) {
      throw createError('Diagnostic not found', 404);
    }

    await query(
      'UPDATE diagnostics SET status = $1, updated_at = NOW() WHERE id = $2',
      ['resolved', id]
    );

    res.json({
      success: true,
      message: 'Diagnostic marked as resolved'
    });

    logger.info(`Diagnostic resolved: ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Get diagnostics summary
router.get('/summary/stats', authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    // Get overall diagnostics stats
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE d.severity = 'error' AND d.status = 'active') as active_errors,
        COUNT(*) FILTER (WHERE d.severity = 'warning' AND d.status = 'active') as active_warnings,
        COUNT(*) FILTER (WHERE d.severity = 'info' AND d.status = 'active') as active_info,
        COUNT(*) FILTER (WHERE d.status = 'resolved') as resolved,
        COUNT(DISTINCT d.pixel_id) as affected_pixels
      FROM diagnostics d
      JOIN pixels p ON d.pixel_id = p.id
      WHERE p.workspace_id = $1`,
      [req.user!.workspaceId]
    );

    // Get diagnostics by category
    const categoryStatsResult = await query(
      `SELECT 
        d.category,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE d.status = 'active') as active
      FROM diagnostics d
      JOIN pixels p ON d.pixel_id = p.id
      WHERE p.workspace_id = $1
      GROUP BY d.category
      ORDER BY count DESC`,
      [req.user!.workspaceId]
    );

    // Get recent diagnostics
    const recentDiagnosticsResult = await query(
      `SELECT 
        d.id,
        d.severity,
        d.title,
        d.created_at,
        p.name as pixel_name
      FROM diagnostics d
      JOIN pixels p ON d.pixel_id = p.id
      WHERE p.workspace_id = $1 AND d.status = 'active'
      ORDER BY d.created_at DESC
      LIMIT 10`,
      [req.user!.workspaceId]
    );

    res.json({
      success: true,
      data: {
        summary: statsResult.rows[0],
        byCategory: categoryStatsResult.rows,
        recent: recentDiagnosticsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;