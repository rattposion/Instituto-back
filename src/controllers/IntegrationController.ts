import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class IntegrationController {
  async getIntegrations(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, type, status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('integrations')
      .select('*', { count: 'exact' })
      .eq('workspace_id', req.user!.workspaceId)
      .range(offset, offset + Number(limit) - 1)
      .order(sortBy as string, { ascending: sortOrder === 'asc' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (type) {
      query = query.eq('type', type);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: integrations, error, count } = await query;

    if (error) {
      logger.error('Error fetching integrations:', error);
      throw createError('Failed to fetch integrations', 500);
    }

    res.json({
      success: true,
      data: integrations,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getIntegrationById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (error || !integration) {
      throw createError('Integration not found', 404);
    }

    res.json({
      success: true,
      data: integration
    });
  }

  async createIntegration(req: AuthRequest, res: Response) {
    const { type, name, description, config } = req.body;

    // Validate integration type
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
      pixels_connected: 0
    };

    const { data: integration, error } = await supabase
      .from('integrations')
      .insert(integrationData)
      .select()
      .single();

    if (error) {
      logger.error('Error creating integration:', error);
      throw createError('Failed to create integration', 500);
    }

    res.status(201).json({
      success: true,
      data: integration
    });
  }

  async updateIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, description, config, status } = req.body;

    // Check if integration exists and belongs to workspace
    const { data: existingIntegration, error: fetchError } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingIntegration) {
      throw createError('Integration not found', 404);
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (config !== undefined) updateData.config = config;
    if (status !== undefined) updateData.status = status;

    const { data: integration, error } = await supabase
      .from('integrations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating integration:', error);
      throw createError('Failed to update integration', 500);
    }

    res.json({
      success: true,
      data: integration
    });
  }

  async deleteIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if integration exists and belongs to workspace
    const { data: existingIntegration, error: fetchError } = await supabase
      .from('integrations')
      .select('name')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingIntegration) {
      throw createError('Integration not found', 404);
    }

    const { error } = await supabase
      .from('integrations')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Error deleting integration:', error);
      throw createError('Failed to delete integration', 500);
    }

    res.json({
      success: true,
      message: 'Integration deleted successfully'
    });
  }

  async testIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if integration exists and belongs to workspace
    const { data: integration, error: fetchError } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !integration) {
      throw createError('Integration not found', 404);
    }

    // Perform integration-specific test
    const testResult = await this.performIntegrationTest(integration);

    // Update integration status based on test result
    await supabase
      .from('integrations')
      .update({
        status: testResult.success ? 'active' : 'error',
        last_sync: new Date().toISOString()
      })
      .eq('id', id);

    res.json({
      success: true,
      data: testResult
    });
  }

  async syncIntegration(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if integration exists and belongs to workspace
    const { data: integration, error: fetchError } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !integration) {
      throw createError('Integration not found', 404);
    }

    // Perform integration-specific sync
    const syncResult = await this.performIntegrationSync(integration);

    // Update integration with sync results
    await supabase
      .from('integrations')
      .update({
        status: syncResult.success ? 'active' : 'error',
        last_sync: new Date().toISOString(),
        pixels_connected: syncResult.pixelsConnected || integration.pixels_connected
      })
      .eq('id', id);

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
        message: error.message || 'Test failed'
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
        message: error.message || 'Sync failed'
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