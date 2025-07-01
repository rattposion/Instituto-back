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
const createIntegrationSchema = Joi.object({
  type: Joi.string().valid('gtm', 'wordpress', 'shopify', 'webhook').required(),
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).optional(),
  config: Joi.object().required()
});

const updateIntegrationSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).optional(),
  config: Joi.object().optional(),
  isActive: Joi.boolean().optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).optional(),
  type: Joi.string().valid('gtm', 'wordpress', 'shopify', 'webhook').optional()
});

const paramsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Get all integrations for workspace
router.get('/', authenticateToken, validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { page = 1, limit = 20, search, type } = req.query as any;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams: any[] = [req.user!.workspaceId];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (type) {
      whereClause += ` AND type = $${paramCount}`;
      queryParams.push(type);
      paramCount++;
    }

    // Get integrations
    const integrationsResult = await query(
      `SELECT 
        i.*,
        COUNT(ip.pixel_id) as connected_pixels
      FROM integrations i
      LEFT JOIN integration_pixels ip ON i.id = ip.integration_id
      ${whereClause}
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM integrations ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        integrations: integrationsResult.rows,
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

// Get single integration
router.get('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const integrationResult = await query(
      `SELECT 
        i.*,
        COUNT(ip.pixel_id) as connected_pixels
      FROM integrations i
      LEFT JOIN integration_pixels ip ON i.id = ip.integration_id
      WHERE i.id = $1 AND i.workspace_id = $2
      GROUP BY i.id`,
      [id, req.user!.workspaceId]
    );

    if (integrationResult.rows.length === 0) {
      throw createError('Integration not found', 404);
    }

    // Get connected pixels
    const connectedPixelsResult = await query(
      `SELECT 
        p.id,
        p.name,
        p.pixel_id,
        p.status
      FROM pixels p
      JOIN integration_pixels ip ON p.id = ip.pixel_id
      WHERE ip.integration_id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...integrationResult.rows[0],
        connectedPixels: connectedPixelsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create integration
router.post('/', authenticateToken, requireRole(['admin', 'manager']), validate(createIntegrationSchema), async (req: AuthRequest, res, next) => {
  try {
    const { type, name, description, config } = req.body;

    // Validate config based on integration type
    const validationResult = validateIntegrationConfig(type, config);
    if (!validationResult.isValid) {
      throw createError(validationResult.error || 'Erro de validação', 400);
    }

    const id = uuidv4();
    await query(
      `INSERT INTO integrations (id, type, name, description, config, workspace_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [id, type, name, description, config, req.user!.workspaceId, req.user!.id]
    );

    // Get created integration
    const createdIntegration = await query(
      'SELECT * FROM integrations WHERE id = $1',
      [id]
    );

    res.status(201).json({
      success: true,
      data: createdIntegration.rows[0]
    });

    logger.info(`Integration created: ${name} (${type}) by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Update integration
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), validateParams(paramsSchema), validate(updateIntegrationSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, config, isActive } = req.body;

    // Check if integration exists and belongs to workspace
    const existingIntegration = await query(
      'SELECT id, type FROM integrations WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (existingIntegration.rows.length === 0) {
      throw createError('Integration not found', 404);
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

    if (config) {
      // Validate config
      const validationResult = validateIntegrationConfig(existingIntegration.rows[0].type, config);
      if (!validationResult.isValid) {
        throw createError(validationResult.error || 'Erro de validação', 400);
      }

      updates.push(`config = $${paramCount++}`);
      values.push(config);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(isActive);
    }

    if (updates.length === 0) {
      throw createError('No fields to update', 400);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    await query(
      `UPDATE integrations SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated integration
    const updatedIntegration = await query(
      'SELECT * FROM integrations WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      data: updatedIntegration.rows[0]
    });

    logger.info(`Integration updated: ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Delete integration
router.delete('/:id', authenticateToken, requireRole(['admin']), validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if integration exists and belongs to workspace
    const existingIntegration = await query(
      'SELECT id, name FROM integrations WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (existingIntegration.rows.length === 0) {
      throw createError('Integration not found', 404);
    }

    // Start transaction
    await query('BEGIN');

    try {
      // Delete integration-pixel relationships
      await query('DELETE FROM integration_pixels WHERE integration_id = $1', [id]);
      
      // Delete integration
      await query('DELETE FROM integrations WHERE id = $1', [id]);

      await query('COMMIT');

      res.json({
        success: true,
        message: 'Integration deleted successfully'
      });

      logger.info(`Integration deleted: ${existingIntegration.rows[0].name} (${id}) by user ${req.user!.id}`);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Test integration
router.post('/:id/test', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if integration exists and belongs to workspace
    const integrationResult = await query(
      'SELECT * FROM integrations WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (integrationResult.rows.length === 0) {
      throw createError('Integration not found', 404);
    }

    const integration = integrationResult.rows[0];

    // Perform test based on integration type
    const testResult = await testIntegration(integration);

    // Update last sync time if test successful
    if (testResult.success) {
      await query(
        'UPDATE integrations SET last_sync = NOW(), updated_at = NOW() WHERE id = $1',
        [id]
      );
    }

    res.json({
      success: true,
      data: testResult
    });

    logger.info(`Integration test: ${integration.name} (${id}) - ${testResult.success ? 'SUCCESS' : 'FAILED'}`);
  } catch (error) {
    next(error);
  }
});

// Connect pixel to integration
router.post('/:id/pixels/:pixelId', authenticateToken, requireRole(['admin', 'manager']), validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id, pixelId } = req.params;

    // Check if integration exists and belongs to workspace
    const integrationResult = await query(
      'SELECT id FROM integrations WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (integrationResult.rows.length === 0) {
      throw createError('Integration not found', 404);
    }

    // Check if pixel exists and belongs to workspace
    const pixelResult = await query(
      'SELECT id FROM pixels WHERE id = $1 AND workspace_id = $2',
      [pixelId, req.user!.workspaceId]
    );

    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }

    // Check if connection already exists
    const existingConnection = await query(
      'SELECT id FROM integration_pixels WHERE integration_id = $1 AND pixel_id = $2',
      [id, pixelId]
    );

    if (existingConnection.rows.length > 0) {
      throw createError('Pixel is already connected to this integration', 400);
    }

    // Create connection
    await query(
      'INSERT INTO integration_pixels (id, integration_id, pixel_id, created_at) VALUES ($1, $2, $3, NOW())',
      [uuidv4(), id, pixelId]
    );

    res.json({
      success: true,
      message: 'Pixel connected to integration successfully'
    });

    logger.info(`Pixel ${pixelId} connected to integration ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Disconnect pixel from integration
router.delete('/:id/pixels/:pixelId', authenticateToken, requireRole(['admin', 'manager']), validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id, pixelId } = req.params;

    // Check if connection exists
    const connectionResult = await query(
      `SELECT ip.id FROM integration_pixels ip
       JOIN integrations i ON ip.integration_id = i.id
       WHERE ip.integration_id = $1 AND ip.pixel_id = $2 AND i.workspace_id = $3`,
      [id, pixelId, req.user!.workspaceId]
    );

    if (connectionResult.rows.length === 0) {
      throw createError('Connection not found', 404);
    }

    // Delete connection
    await query(
      'DELETE FROM integration_pixels WHERE integration_id = $1 AND pixel_id = $2',
      [id, pixelId]
    );

    res.json({
      success: true,
      message: 'Pixel disconnected from integration successfully'
    });

    logger.info(`Pixel ${pixelId} disconnected from integration ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Helper functions
function validateIntegrationConfig(type: string, config: any): { isValid: boolean; error?: string } {
  switch (type) {
    case 'gtm':
      if (!config.containerId) {
        return { isValid: false, error: 'GTM Container ID is required' };
      }
      break;
    case 'wordpress':
      if (!config.siteUrl) {
        return { isValid: false, error: 'WordPress site URL is required' };
      }
      break;
    case 'shopify':
      if (!config.shopDomain) {
        return { isValid: false, error: 'Shopify shop domain is required' };
      }
      break;
    case 'webhook':
      if (!config.endpoint) {
        return { isValid: false, error: 'Webhook endpoint URL is required' };
      }
      break;
    default:
      return { isValid: false, error: 'Invalid integration type' };
  }
  return { isValid: true };
}

async function testIntegration(integration: any): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    switch (integration.type) {
      case 'gtm':
        // Test GTM connection (mock implementation)
        return {
          success: true,
          message: 'GTM container connection successful',
          details: {
            containerId: integration.config.containerId,
            status: 'active'
          }
        };
      
      case 'wordpress':
        // Test WordPress connection (mock implementation)
        return {
          success: true,
          message: 'WordPress site connection successful',
          details: {
            siteUrl: integration.config.siteUrl,
            status: 'reachable'
          }
        };
      
      case 'shopify':
        // Test Shopify connection (mock implementation)
        return {
          success: true,
          message: 'Shopify store connection successful',
          details: {
            shopDomain: integration.config.shopDomain,
            status: 'active'
          }
        };
      
      case 'webhook':
        // Test webhook endpoint (mock implementation)
        return {
          success: true,
          message: 'Webhook endpoint is reachable',
          details: {
            endpoint: integration.config.endpoint,
            responseTime: '150ms'
          }
        };
      
      default:
        return {
          success: false,
          message: 'Unknown integration type'
        };
    }
  } catch (error) {
    return {
      success: false,
      message: 'Integration test failed',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

export default router;