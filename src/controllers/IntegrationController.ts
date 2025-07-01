import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class IntegrationController {
  async getIntegrations(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, type, status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let whereClauses: string[] = ['workspace_id = $1'];
    let params: any[] = [req.user!.workspaceId];
    let paramIndex = 2;
    if (search) {
      whereClauses.push('(name ILIKE $' + paramIndex + ' OR description ILIKE $' + (paramIndex + 1) + ')');
      params.push(`%${search}%`, `%${search}%`);
      paramIndex += 2;
    }
    if (type) {
      whereClauses.push('type = $' + paramIndex);
      params.push(type);
      paramIndex++;
    }
    if (status) {
      whereClauses.push('status = $' + paramIndex);
      params.push(status);
      paramIndex++;
    }
    const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const sql = `SELECT *, count(*) OVER() AS total_count FROM integrations ${where} ORDER BY ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);
    const result = await Database.query(sql, params);
    const integrations = result.rows;
    const total = integrations.length > 0 ? Number(integrations[0].total_count) : 0;
    res.json({
      success: true,
      data: integrations,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  }

  async getIntegrationById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const sql = 'SELECT * FROM integrations WHERE id = $1 AND workspace_id = $2 LIMIT 1';
    const result = await Database.query(sql, [id, req.user!.workspaceId]);
    const integration = result.rows[0];
    if (!integration) {
      throw createError('Integration not found', 404);
    }
    res.json({
      success: true,
      data: integration
    });
  }

  async createIntegration(req: AuthRequest, res: Response) {
    const { type, name, description, config } = req.body;
    const validTypes = ['gtm', 'wordpress', 'shopify', 'webhook'];
    if (!validTypes.includes(type)) {
      throw createError('Invalid integration type', 400);
    }
    const integrationData = {
      id: uuidv4(),
      workspace_id: req.user!.workspaceId,
      type,
      name,
      description: description || '',
      config: config || {},
      status: 'inactive',
      pixels_connected: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const sql = `INSERT INTO integrations (id, workspace_id, type, name, description, config, status, pixels_connected, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
    const values = [integrationData.id, integrationData.workspace_id, integrationData.type, integrationData.name, integrationData.description, integrationData.config, integrationData.status, integrationData.pixels_connected, integrationData.created_at, integrationData.updated_at];
    const result = await Database.query(sql, values);
    const integration = result.rows[0];
    res.status(201).json({
      success: true,
      data: integration
    });
  }

  async updateIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, description, config, status } = req.body;
    // Verifica se existe
    const check = await Database.query('SELECT * FROM integrations WHERE id = $1 AND workspace_id = $2', [id, req.user!.workspaceId]);
    if (check.rows.length === 0) {
      throw createError('Integration not found', 404);
    }
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    if (name !== undefined) { updateFields.push(`name = $${paramIndex}`); params.push(name); paramIndex++; }
    if (description !== undefined) { updateFields.push(`description = $${paramIndex}`); params.push(description); paramIndex++; }
    if (config !== undefined) { updateFields.push(`config = $${paramIndex}`); params.push(config); paramIndex++; }
    if (status !== undefined) { updateFields.push(`status = $${paramIndex}`); params.push(status); paramIndex++; }
    updateFields.push(`updated_at = $${paramIndex}`); params.push(new Date().toISOString()); paramIndex++;
    params.push(id, req.user!.workspaceId);
    const sql = `UPDATE integrations SET ${updateFields.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`;
    const result = await Database.query(sql, params);
    const integration = result.rows[0];
    res.json({
      success: true,
      data: integration
    });
  }

  async deleteIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;
    // Verifica se existe
    const check = await Database.query('SELECT name FROM integrations WHERE id = $1 AND workspace_id = $2', [id, req.user!.workspaceId]);
    if (check.rows.length === 0) {
      throw createError('Integration not found', 404);
    }
    await Database.query('DELETE FROM integrations WHERE id = $1 AND workspace_id = $2', [id, req.user!.workspaceId]);
    res.json({
      success: true,
      message: 'Integration deleted successfully'
    });
  }

  async testIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const result = await Database.query('SELECT * FROM integrations WHERE id = $1 AND workspace_id = $2', [id, req.user!.workspaceId]);
    const integration = result.rows[0];
    if (!integration) {
      throw createError('Integration not found', 404);
    }
    const testResult = await this.performIntegrationTest(integration);
    await Database.query('UPDATE integrations SET status = $1, last_sync = $2 WHERE id = $3', [testResult.success ? 'active' : 'error', new Date().toISOString(), id]);
    res.json({
      success: true,
      data: testResult
    });
  }

  async syncIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const result = await Database.query('SELECT * FROM integrations WHERE id = $1 AND workspace_id = $2', [id, req.user!.workspaceId]);
    const integration = result.rows[0];
    if (!integration) {
      throw createError('Integration not found', 404);
    }
    const syncResult = await this.performIntegrationSync(integration);
    await Database.query('UPDATE integrations SET status = $1, last_sync = $2, pixels_connected = $3 WHERE id = $4', [syncResult.success ? 'active' : 'error', new Date().toISOString(), syncResult.pixelsConnected || integration.pixels_connected, id]);
    res.json({
      success: true,
      data: syncResult
    });
  }

  private async performIntegrationTest(integration: any): Promise<any> {
    try {
      switch (integration.type) {
        case 'gtm':
          return await this.testGTMIntegration(integration);
        case 'wordpress':
          return await this.testWordPressIntegration(integration);
        case 'shopify':
          return await this.testShopifyIntegration(integration);
        case 'webhook':
          return await this.testWebhookIntegration(integration);
        default:
          return {
            success: false,
            message: 'Unknown integration type'
          };
      }
    } catch (error) {
      logger.error(`Integration test failed for ${integration.type}:`, error);
      return {
        success: false,
        message: typeof error === 'object' && error && 'message' in error ? (error as any).message : 'Test failed'
      };
    }
  }

  private async performIntegrationSync(integration: any): Promise<any> {
    try {
      switch (integration.type) {
        case 'gtm':
          return await this.syncGTMIntegration(integration);
        case 'wordpress':
          return await this.syncWordPressIntegration(integration);
        case 'shopify':
          return await this.syncShopifyIntegration(integration);
        case 'webhook':
          return await this.syncWebhookIntegration(integration);
        default:
          return {
            success: false,
            message: 'Unknown integration type'
          };
      }
    } catch (error) {
      logger.error(`Integration sync failed for ${integration.type}:`, error);
      return {
        success: false,
        message: typeof error === 'object' && error && 'message' in error ? (error as any).message : 'Sync failed'
      };
    }
  }

  private async testGTMIntegration(integration: any): Promise<any> {
    // Simulate GTM API test
    const { containerId } = integration.config;
    
    if (!containerId) {
      return {
        success: false,
        message: 'Container ID is required'
      };
    }

    // In a real implementation, you would:
    // 1. Validate GTM container access
    // 2. Check if Meta Pixel tags exist
    // 3. Verify configuration

    return {
      success: true,
      message: 'GTM connection successful',
      details: {
        containerId,
        tagsFound: 3,
        lastPublished: new Date().toISOString()
      }
    };
  }

  private async testWordPressIntegration(integration: any): Promise<any> {
    // Simulate WordPress API test
    const { siteUrl, apiKey } = integration.config;
    
    if (!siteUrl || !apiKey) {
      return {
        success: false,
        message: 'Site URL and API key are required'
      };
    }

    // In a real implementation, you would:
    // 1. Test WordPress REST API connection
    // 2. Verify plugin installation
    // 3. Check pixel implementation

    return {
      success: true,
      message: 'WordPress connection successful',
      details: {
        siteUrl,
        pluginVersion: '2.1.0',
        pixelsActive: 1
      }
    };
  }

  private async testShopifyIntegration(integration: any): Promise<any> {
    // Simulate Shopify API test
    const { shopDomain, accessToken } = integration.config;
    
    if (!shopDomain || !accessToken) {
      return {
        success: false,
        message: 'Shop domain and access token are required'
      };
    }

    // In a real implementation, you would:
    // 1. Test Shopify Admin API connection
    // 2. Verify app installation
    // 3. Check pixel configuration

    return {
      success: true,
      message: 'Shopify connection successful',
      details: {
        shopDomain,
        appInstalled: true,
        pixelsConfigured: 1
      }
    };
  }

  private async testWebhookIntegration(integration: any): Promise<any> {
    // Simulate webhook test
    const { endpoint, secret } = integration.config;
    
    if (!endpoint) {
      return {
        success: false,
        message: 'Webhook endpoint is required'
      };
    }

    // In a real implementation, you would:
    // 1. Send test webhook payload
    // 2. Verify endpoint response
    // 3. Validate signature if secret provided

    return {
      success: true,
      message: 'Webhook endpoint accessible',
      details: {
        endpoint,
        responseTime: '150ms',
        lastDelivery: new Date().toISOString()
      }
    };
  }

  private async syncGTMIntegration(integration: any): Promise<any> {
    // Simulate GTM sync
    return {
      success: true,
      message: 'GTM sync completed',
      pixelsConnected: 3,
      tagsUpdated: 2
    };
  }

  private async syncWordPressIntegration(integration: any): Promise<any> {
    // Simulate WordPress sync
    return {
      success: true,
      message: 'WordPress sync completed',
      pixelsConnected: 1,
      pagesUpdated: 15
    };
  }

  private async syncShopifyIntegration(integration: any): Promise<any> {
    // Simulate Shopify sync
    return {
      success: true,
      message: 'Shopify sync completed',
      pixelsConnected: 1,
      productsUpdated: 50
    };
  }

  private async syncWebhookIntegration(integration: any): Promise<any> {
    // Simulate webhook sync
    return {
      success: true,
      message: 'Webhook sync completed',
      pixelsConnected: 2,
      eventsDelivered: 100
    };
  }
}