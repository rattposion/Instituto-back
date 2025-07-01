import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class PixelController {
  async getPixels(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('pixels')
      .select('*', { count: 'exact' })
      .eq('workspace_id', req.user!.workspaceId)
      .range(offset, offset + Number(limit) - 1)
      .order(sortBy as string, { ascending: sortOrder === 'asc' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,pixel_id.ilike.%${search}%`);
    }

    const { data: pixels, error, count } = await query;

    if (error) {
      logger.error('Error fetching pixels:', error);
      throw createError('Failed to fetch pixels', 500);
    }

    res.json({
      success: true,
      data: pixels,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getPixelById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: pixel, error } = await supabase
      .from('pixels')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (error || !pixel) {
      throw createError('Pixel not found', 404);
    }

    res.json({
      success: true,
      data: pixel
    });
  }

  async createPixel(req: AuthRequest, res: Response) {
    const { name, pixelId, metaAccount } = req.body;

    // Check if pixel ID already exists in workspace
    const { data: existingPixel } = await supabase
      .from('pixels')
      .select('id')
      .eq('pixel_id', pixelId)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (existingPixel) {
      throw createError('Pixel ID already exists in this workspace', 409);
    }

    const pixelData = {
      id: uuidv4(),
      name,
      pixel_id: pixelId,
      meta_account: metaAccount,
      workspace_id: req.user!.workspaceId,
      status: 'inactive',
      events_count: 0,
      conversions_count: 0,
      revenue: 0,
      settings: {}
    };

    const { data: pixel, error } = await supabase
      .from('pixels')
      .insert(pixelData)
      .select()
      .single();

    if (error) {
      logger.error('Error creating pixel:', error);
      throw createError('Failed to create pixel', 500);
    }

    // Log audit event
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'pixel.create',
      'pixel',
      pixel.id,
      { name, pixelId, metaAccount },
      req
    );

    res.status(201).json({
      success: true,
      data: pixel
    });
  }

  async updatePixel(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, metaAccount, settings } = req.body;

    // Check if pixel exists and belongs to workspace
    const { data: existingPixel, error: fetchError } = await supabase
      .from('pixels')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingPixel) {
      throw createError('Pixel not found', 404);
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (metaAccount !== undefined) updateData.meta_account = metaAccount;
    if (settings !== undefined) updateData.settings = settings;

    const { data: pixel, error } = await supabase
      .from('pixels')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating pixel:', error);
      throw createError('Failed to update pixel', 500);
    }

    // Log audit event
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'pixel.update',
      'pixel',
      id,
      updateData,
      req
    );

    res.json({
      success: true,
      data: pixel
    });
  }

  async deletePixel(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if pixel exists and belongs to workspace
    const { data: existingPixel, error: fetchError } = await supabase
      .from('pixels')
      .select('name')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingPixel) {
      throw createError('Pixel not found', 404);
    }

    // Delete related data first (events, conversions, etc.)
    await supabase.from('events').delete().eq('pixel_id', id);
    await supabase.from('conversions').delete().eq('pixel_id', id);
    await supabase.from('diagnostics').delete().eq('pixel_id', id);

    // Delete pixel
    const { error } = await supabase
      .from('pixels')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Error deleting pixel:', error);
      throw createError('Failed to delete pixel', 500);
    }

    // Log audit event
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'pixel.delete',
      'pixel',
      id,
      { name: existingPixel.name },
      req
    );

    res.json({
      success: true,
      message: 'Pixel deleted successfully'
    });
  }

  async getPixelAnalytics(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;

    // Check if pixel exists and belongs to workspace
    const { data: pixel, error: pixelError } = await supabase
      .from('pixels')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (pixelError || !pixel) {
      throw createError('Pixel not found', 404);
    }

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

    // Get events analytics
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('event_name, timestamp, parameters')
      .eq('pixel_id', id)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true });

    if (eventsError) {
      logger.error('Error fetching events analytics:', eventsError);
      throw createError('Failed to fetch analytics', 500);
    }

    // Process analytics data
    const analytics = this.processAnalyticsData(eventsData || []);

    res.json({
      success: true,
      data: analytics
    });
  }

  async getPixelEvents(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { page = 1, limit = 20, eventName, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    // Check if pixel exists and belongs to workspace
    const { data: pixel, error: pixelError } = await supabase
      .from('pixels')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (pixelError || !pixel) {
      throw createError('Pixel not found', 404);
    }

    let query = supabase
      .from('events')
      .select('*', { count: 'exact' })
      .eq('pixel_id', id)
      .range(offset, offset + Number(limit) - 1)
      .order('timestamp', { ascending: false });

    if (eventName) {
      query = query.eq('event_name', eventName);
    }

    if (status === 'processed') {
      query = query.eq('processed', true);
    } else if (status === 'error') {
      query = query.not('error_message', 'is', null);
    }

    const { data: events, error, count } = await query;

    if (error) {
      logger.error('Error fetching pixel events:', error);
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

  async testPixelConnection(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if pixel exists and belongs to workspace
    const { data: pixel, error: pixelError } = await supabase
      .from('pixels')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (pixelError || !pixel) {
      throw createError('Pixel not found', 404);
    }

    // TODO: Implement actual pixel connection test with Meta API
    const testResult = {
      connected: true,
      lastEvent: new Date(),
      eventsLast24h: Math.floor(Math.random() * 1000),
      status: 'healthy'
    };

    // Update pixel status based on test
    await supabase
      .from('pixels')
      .update({
        status: testResult.connected ? 'active' : 'error',
        last_activity: testResult.lastEvent.toISOString()
      })
      .eq('id', id);

    res.json({
      success: true,
      data: testResult
    });
  }

  private processAnalyticsData(events: any[]) {
    const eventsByDay: { [key: string]: number } = {};
    const eventsByType: { [key: string]: number } = {};
    let totalRevenue = 0;
    let totalConversions = 0;

    events.forEach(event => {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      eventsByDay[day] = (eventsByDay[day] || 0) + 1;
      eventsByType[event.event_name] = (eventsByType[event.event_name] || 0) + 1;

      if (event.event_name === 'Purchase' && event.parameters?.value) {
        totalRevenue += parseFloat(event.parameters.value);
        totalConversions++;
      }
    });

    return {
      totalEvents: events.length,
      totalRevenue,
      totalConversions,
      conversionRate: events.length > 0 ? (totalConversions / events.length) * 100 : 0,
      eventsByDay,
      eventsByType,
      topEvents: Object.entries(eventsByType)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }))
    };
  }

  private async logAuditEvent(
    workspaceId: string,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    details: any,
    req: AuthRequest
  ) {
    try {
      await supabase
        .from('audit_logs')
        .insert({
          id: uuidv4(),
          workspace_id: workspaceId,
          user_id: userId,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          details,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        });
    } catch (error) {
      logger.error('Failed to log audit event:', error);
    }
  }
}