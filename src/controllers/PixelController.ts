import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class PixelController {
  async getPixels(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let pixelsResult, countResult;
    if (search) {
      pixelsResult = await Database.query(
        `SELECT * FROM pixels WHERE workspace_id = $1 AND (name ILIKE $2 OR pixel_id ILIKE $2) ORDER BY ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $3 OFFSET $4`,
        [req.user!.workspaceId, `%${search}%`, limit, offset]
      );
      countResult = await Database.query(
        'SELECT COUNT(*) FROM pixels WHERE workspace_id = $1 AND (name ILIKE $2 OR pixel_id ILIKE $2)',
        [req.user!.workspaceId, `%${search}%`]
      );
    } else {
      pixelsResult = await Database.query(
        `SELECT * FROM pixels WHERE workspace_id = $1 ORDER BY ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $2 OFFSET $3`,
        [req.user!.workspaceId, limit, offset]
      );
      countResult = await Database.query(
        'SELECT COUNT(*) FROM pixels WHERE workspace_id = $1',
        [req.user!.workspaceId]
      );
    }
    const pixels = pixelsResult.rows;
    const count = parseInt(countResult.rows[0].count, 10);
    res.json({
      success: true,
      data: pixels,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / Number(limit))
      }
    });
  }

  async getPixelById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const result = await Database.query(
      'SELECT * FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    const pixel = result.rows[0];
    if (!pixel) {
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
    const existingResult = await Database.query(
      'SELECT id FROM pixels WHERE pixel_id = $1 AND workspace_id = $2 LIMIT 1',
      [pixelId, req.user!.workspaceId]
    );
    if (existingResult.rows.length > 0) {
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
    const insertResult = await Database.query(
      'INSERT INTO pixels (id, name, pixel_id, meta_account, workspace_id, status, events_count, conversions_count, revenue, settings) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [pixelData.id, pixelData.name, pixelData.pixel_id, pixelData.meta_account, pixelData.workspace_id, pixelData.status, pixelData.events_count, pixelData.conversions_count, pixelData.revenue, pixelData.settings]
    );
    const pixel = insertResult.rows[0];
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
    const existingResult = await Database.query(
      'SELECT * FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (existingResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }
    const updateData: any = {
      updated_at: new Date().toISOString()
    };
    if (name !== undefined) updateData.name = name;
    if (metaAccount !== undefined) updateData.meta_account = metaAccount;
    if (settings !== undefined) updateData.settings = settings;
    const updateResult = await Database.query(
      'UPDATE pixels SET name = $1, meta_account = $2, settings = $3, updated_at = $4 WHERE id = $5 RETURNING *',
      [name, metaAccount, settings, updateData.updated_at, id]
    );
    const pixel = updateResult.rows[0];
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
    const existingResult = await Database.query(
      'SELECT name FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (existingResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }
    // Delete related data first (events, conversions, diagnostics)
    await Database.query('DELETE FROM events WHERE pixel_id = $1', [id]);
    await Database.query('DELETE FROM conversions WHERE pixel_id = $1', [id]);
    await Database.query('DELETE FROM diagnostics WHERE pixel_id = $1', [id]);
    // Delete pixel
    await Database.query('DELETE FROM pixels WHERE id = $1', [id]);
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'pixel.delete',
      'pixel',
      id,
      { name: existingResult.rows[0].name },
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
    const pixelResult = await Database.query(
      'SELECT id FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (timeframe) {
      case '1h': startDate.setHours(startDate.getHours() - 1); break;
      case '24h': startDate.setDate(startDate.getDate() - 1); break;
      case '7d': startDate.setDate(startDate.getDate() - 7); break;
      case '30d': startDate.setDate(startDate.getDate() - 30); break;
      default: startDate.setDate(startDate.getDate() - 7);
    }
    // Get events analytics
    const eventsResult = await Database.query(
      'SELECT event_name, timestamp, parameters FROM events WHERE pixel_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC',
      [id, startDate.toISOString(), endDate.toISOString()]
    );
    const analytics = this.processAnalyticsData(eventsResult.rows || []);
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
    const pixelResult = await Database.query(
      'SELECT id FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }
    let baseQuery = 'SELECT * FROM events WHERE pixel_id = $1';
    let params: any[] = [id];
    if (eventName) {
      baseQuery += ' AND event_name = $2';
      params.push(eventName);
    }
    if (status === 'processed') {
      baseQuery += eventName ? ' AND processed = $3' : ' AND processed = $2';
      params.push(true);
    } else if (status === 'error') {
      baseQuery += eventName ? ' AND error_message IS NOT NULL' : ' AND error_message IS NOT NULL';
    }
    baseQuery += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    const eventsResult = await Database.query(baseQuery, params);
    const countResult = await Database.query('SELECT COUNT(*) FROM events WHERE pixel_id = $1', [id]);
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

  async testPixelConnection(req: AuthRequest, res: Response) {
    const { id } = req.params;
    // Check if pixel exists and belongs to workspace
    const pixelResult = await Database.query(
      'SELECT * FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (pixelResult.rows.length === 0) {
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
    await Database.query(
      'UPDATE pixels SET status = $1, last_activity = $2 WHERE id = $3',
      [testResult.connected ? 'active' : 'error', testResult.lastEvent.toISOString(), id]
    );
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
      await Database.query(
        'INSERT INTO audit_logs (id, workspace_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [uuidv4(), workspaceId, userId, action, resourceType, resourceId, details, req.ip, req.get('User-Agent')]
      );
    } catch (error) {
      logger.error('Failed to log audit event:', error);
    }
  }
}