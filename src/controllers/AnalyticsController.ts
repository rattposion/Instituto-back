import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export class AnalyticsController {
  async getDashboardAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d' } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
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

    try {
      // Get all data in parallel
      const [pixelsResult, eventsResult, conversionsResult, diagnosticsResult] = await Promise.all([
        // Pixels data
        Database.query('SELECT id, status, events_count, conversions_count, revenue FROM pixels WHERE workspace_id = $1', [req.user!.workspaceId]),
        
        // Events data
        Database.query(`
          SELECT event_name, timestamp, parameters, processed,
          pixels.workspace_id, pixels.id AS pixel_id
          FROM events
          INNER JOIN pixels ON events.pixel_id = pixels.id
          WHERE pixels.workspace_id = $1 AND timestamp >= $2 AND timestamp <= $3
        `, [req.user!.workspaceId, startDate.toISOString(), endDate.toISOString()]),
        
        // Conversions data
        Database.query(`
          SELECT total_conversions, total_value, conversion_rate,
          pixels.workspace_id, pixels.id AS pixel_id
          FROM conversions
          INNER JOIN pixels ON conversions.pixel_id = pixels.id
          WHERE pixels.workspace_id = $1
        `, [req.user!.workspaceId]),
        
        // Diagnostics data
        Database.query(`
          SELECT severity, status,
          pixels.workspace_id, pixels.id AS pixel_id
          FROM diagnostics
          INNER JOIN pixels ON diagnostics.pixel_id = pixels.id
          WHERE pixels.workspace_id = $1
        `, [req.user!.workspaceId])
      ]);

      const pixels = pixelsResult.rows || [];
      const events = eventsResult.rows || [];
      const conversions = conversionsResult.rows || [];
      const diagnostics = diagnosticsResult.rows || [];

      // Process analytics
      const analytics = {
        overview: {
          totalPixels: pixels.length,
          activePixels: pixels.filter(p => p.status === 'active').length,
          totalEvents: events.length,
          totalConversions: conversions.reduce((sum, c) => sum + c.total_conversions, 0),
          totalRevenue: conversions.reduce((sum, c) => sum + parseFloat(c.total_value || 0), 0),
          averageConversionRate: conversions.length > 0 
            ? conversions.reduce((sum, c) => sum + c.conversion_rate, 0) / conversions.length 
            : 0
        },
        trends: {
          eventsByDay: this.groupEventsByDay(events),
          eventsByType: this.groupEventsByType(events),
          conversionsByDay: this.groupConversionsByDay(events)
        },
        health: {
          totalIssues: diagnostics.filter(d => d.status === 'active').length,
          criticalIssues: diagnostics.filter(d => d.severity === 'error' && d.status === 'active').length,
          warningIssues: diagnostics.filter(d => d.severity === 'warning' && d.status === 'active').length
        },
        topPixels: pixels
          .sort((a, b) => b.events_count - a.events_count)
          .slice(0, 5)
          .map(p => ({
            id: p.id,
            eventsCount: p.events_count,
            conversionsCount: p.conversions_count,
            revenue: parseFloat(p.revenue || 0)
          }))
      };

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error fetching dashboard analytics:', error);
      throw createError('Failed to fetch analytics', 500);
    }
  }

  async getWorkspaceOverview(req: AuthRequest, res: Response) {
    try {
      const [pixelsResult, membersResult, integrationsResult] = await Promise.all([
        Database.query('SELECT status FROM pixels WHERE workspace_id = $1', [req.user!.workspaceId]),
        
        Database.query('SELECT role FROM workspace_members WHERE workspace_id = $1', [req.user!.workspaceId]),
        
        Database.query('SELECT status FROM integrations WHERE workspace_id = $1', [req.user!.workspaceId])
      ]);

      const pixels = pixelsResult.rows || [];
      const members = membersResult.rows || [];
      const integrations = integrationsResult.rows || [];

      const overview = {
        pixels: {
          total: pixels.length,
          active: pixels.filter(p => p.status === 'active').length,
          inactive: pixels.filter(p => p.status === 'inactive').length,
          error: pixels.filter(p => p.status === 'error').length
        },
        team: {
          total: members.length,
          admins: members.filter(m => m.role === 'admin').length,
          managers: members.filter(m => m.role === 'manager').length,
          viewers: members.filter(m => m.role === 'viewer').length
        },
        integrations: {
          total: integrations.length,
          active: integrations.filter(i => i.status === 'active').length,
          inactive: integrations.filter(i => i.status === 'inactive').length,
          error: integrations.filter(i => i.status === 'error').length
        }
      };

      res.json({
        success: true,
        data: overview
      });
    } catch (error) {
      logger.error('Error fetching workspace overview:', error);
      throw createError('Failed to fetch overview', 500);
    }
  }

  async getEventsAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d', pixelId, eventName } = req.query;

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

    try {
      let query = Database.query(`
        SELECT event_name, timestamp, parameters, processed, error_message,
        pixels.workspace_id, pixels.id AS pixel_id
        FROM events
        INNER JOIN pixels ON events.pixel_id = pixels.id
        WHERE pixels.workspace_id = $1 AND timestamp >= $2 AND timestamp <= $3
      `, [req.user!.workspaceId, startDate.toISOString(), endDate.toISOString()]);

      if (pixelId) {
        query = query.addParam(pixelId);
      }

      if (eventName) {
        query = query.addParam(eventName);
      }

      const { rows: events, error } = await query;

      if (error) {
        logger.error('Error fetching events analytics:', error);
        throw createError('Failed to fetch events analytics', 500);
      }

      const analytics = {
        summary: {
          totalEvents: events?.length || 0,
          processedEvents: events?.filter(e => e.processed).length || 0,
          failedEvents: events?.filter(e => e.error_message).length || 0,
          successRate: events?.length > 0 
            ? (events.filter(e => e.processed && !e.error_message).length / events.length) * 100 
            : 0
        },
        trends: {
          eventsByHour: this.groupEventsByHour(events || []),
          eventsByDay: this.groupEventsByDay(events || []),
          eventsByType: this.groupEventsByType(events || [])
        },
        topEvents: Object.entries(this.groupEventsByType(events || []))
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([name, count]) => ({ name, count }))
      };

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error in getEventsAnalytics:', error);
      throw createError('Failed to fetch events analytics', 500);
    }
  }

  async getConversionsAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d' } = req.query;

    try {
      const { rows: conversions, error } = await Database.query(`
        SELECT *,
        pixels.workspace_id, pixels.id AS pixel_id
        FROM conversions
        INNER JOIN pixels ON conversions.pixel_id = pixels.id
        WHERE pixels.workspace_id = $1
      `, [req.user!.workspaceId]);

      if (error) {
        logger.error('Error fetching conversions analytics:', error);
        throw createError('Failed to fetch conversions analytics', 500);
      }

      const analytics = {
        summary: {
          totalConversions: conversions?.reduce((sum, c) => sum + c.total_conversions, 0) || 0,
          totalValue: conversions?.reduce((sum, c) => sum + parseFloat(c.total_value || 0), 0) || 0,
          averageValue: conversions?.length > 0 
            ? conversions.reduce((sum, c) => sum + parseFloat(c.average_value || 0), 0) / conversions.length 
            : 0,
          averageRate: conversions?.length > 0 
            ? conversions.reduce((sum, c) => sum + c.conversion_rate, 0) / conversions.length 
            : 0
        },
        byConversion: conversions?.map(c => ({
          id: c.id,
          name: c.name,
          totalConversions: c.total_conversions,
          totalValue: parseFloat(c.total_value || 0),
          conversionRate: c.conversion_rate,
          isActive: c.is_active
        })) || []
      };

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error in getConversionsAnalytics:', error);
      throw createError('Failed to fetch conversions analytics', 500);
    }
  }

  async getRevenueAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d' } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
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

    try {
      const { rows: events, error } = await Database.query(`
        SELECT event_name, timestamp, parameters,
        pixels.workspace_id, pixels.id AS pixel_id
        FROM events
        INNER JOIN pixels ON events.pixel_id = pixels.id
        WHERE pixels.workspace_id = $1 AND event_name = $2 AND timestamp >= $3 AND timestamp <= $4
      `, ['Purchase', req.user!.workspaceId, startDate.toISOString(), endDate.toISOString()]);

      if (error) {
        logger.error('Error fetching revenue analytics:', error);
        throw createError('Failed to fetch revenue analytics', 500);
      }

      const revenueByDay: { [key: string]: number } = {};
      const ordersByDay: { [key: string]: number } = {};
      let totalRevenue = 0;
      let totalOrders = 0;

      events?.forEach(event => {
        const day = new Date(event.timestamp).toISOString().split('T')[0];
        const value = parseFloat(event.parameters?.value || 0);
        
        revenueByDay[day] = (revenueByDay[day] || 0) + value;
        ordersByDay[day] = (ordersByDay[day] || 0) + 1;
        totalRevenue += value;
        totalOrders++;
      });

      const analytics = {
        summary: {
          totalRevenue,
          totalOrders,
          averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
        },
        trends: {
          revenueByDay,
          ordersByDay
        }
      };

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error in getRevenueAnalytics:', error);
      throw createError('Failed to fetch revenue analytics', 500);
    }
  }

  async getFunnelAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d', pixelId } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
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

    try {
      let query = Database.query(`
        SELECT event_name, timestamp,
        pixels.workspace_id, pixels.id AS pixel_id
        FROM events
        INNER JOIN pixels ON events.pixel_id = pixels.id
        WHERE pixels.workspace_id = $1 AND timestamp >= $2 AND timestamp <= $3
      `, [req.user!.workspaceId, startDate.toISOString(), endDate.toISOString()]);

      if (pixelId) {
        query = query.addParam(pixelId);
      }

      const { rows: events, error } = await query;

      if (error) {
        logger.error('Error fetching funnel analytics:', error);
        throw createError('Failed to fetch funnel analytics', 500);
      }

      // Define funnel steps
      const funnelSteps = [
        { name: 'Page Views', eventName: 'PageView', count: 0 },
        { name: 'Content Views', eventName: 'ViewContent', count: 0 },
        { name: 'Add to Cart', eventName: 'AddToCart', count: 0 },
        { name: 'Initiate Checkout', eventName: 'InitiateCheckout', count: 0 },
        { name: 'Purchase', eventName: 'Purchase', count: 0 }
      ];

      // Count events for each step
      const eventCounts: { [key: string]: number } = {};
      events?.forEach(event => {
        eventCounts[event.event_name] = (eventCounts[event.event_name] || 0) + 1;
      });

      funnelSteps.forEach(step => {
        step.count = eventCounts[step.eventName] || 0;
      });

      // Calculate conversion rates
      const funnelWithRates = funnelSteps.map((step, index) => {
        const previousStep = index > 0 ? funnelSteps[index - 1] : null;
        const conversionRate = previousStep && previousStep.count > 0 
          ? (step.count / previousStep.count) * 100 
          : 100;

        return {
          ...step,
          conversionRate: Math.round(conversionRate * 100) / 100
        };
      });

      res.json({
        success: true,
        data: {
          steps: funnelWithRates,
          totalVisitors: funnelSteps[0].count,
          totalConversions: funnelSteps[funnelSteps.length - 1].count,
          overallConversionRate: funnelSteps[0].count > 0 
            ? (funnelSteps[funnelSteps.length - 1].count / funnelSteps[0].count) * 100 
            : 0
        }
      });
    } catch (error) {
      logger.error('Error in getFunnelAnalytics:', error);
      throw createError('Failed to fetch funnel analytics', 500);
    }
  }

  async getRealtimeAnalytics(req: AuthRequest, res: Response) {
    const last15Minutes = new Date(Date.now() - 15 * 60 * 1000);

    try {
      const { rows: recentEvents, error } = await Database.query(`
        SELECT event_name, timestamp, parameters,
        pixels.workspace_id, pixels.name
        FROM events
        INNER JOIN pixels ON events.pixel_id = pixels.id
        WHERE pixels.workspace_id = $1 AND timestamp >= $2 AND timestamp <= $3
      `, [req.user!.workspaceId, last15Minutes.toISOString(), Date.now().toISOString()]);

      if (error) {
        logger.error('Error fetching realtime analytics:', error);
        throw createError('Failed to fetch realtime analytics', 500);
      }

      const analytics = {
        activeUsers: recentEvents?.length || 0,
        eventsPerMinute: this.groupEventsByMinute(recentEvents || []),
        topEvents: Object.entries(this.groupEventsByType(recentEvents || []))
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([name, count]) => ({ name, count })),
        recentEvents: recentEvents?.slice(0, 10).map(event => ({
          eventName: event.event_name,
          timestamp: event.timestamp,
          pixelName: event.pixels.name,
          value: event.parameters?.value || null
        })) || []
      };

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error in getRealtimeAnalytics:', error);
      throw createError('Failed to fetch realtime analytics', 500);
    }
  }

  async exportAnalytics(req: AuthRequest, res: Response) {
    const { format = 'json', timeframe = '7d', type = 'events' } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
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

    try {
      let data: any[] = [];

      if (type === 'events') {
        const { rows: events, error } = await Database.query(`
          SELECT *, pixels.name, pixels.workspace_id
          FROM events
          INNER JOIN pixels ON events.pixel_id = pixels.id
          WHERE pixels.workspace_id = $1 AND timestamp >= $2 AND timestamp <= $3
        `, [req.user!.workspaceId, startDate.toISOString(), endDate.toISOString()]);

        if (error) throw error;
        data = events || [];
      }

      if (format === 'csv') {
        const csv = this.convertToCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${type}-export.csv`);
        res.send(csv);
      } else {
        res.json({
          success: true,
          data: {
            exportedAt: new Date().toISOString(),
            timeframe,
            type,
            totalRecords: data.length,
            records: data
          }
        });
      }
    } catch (error) {
      logger.error('Error exporting analytics:', error);
      throw createError('Failed to export analytics', 500);
    }
  }

  private groupEventsByDay(events: any[]): { [key: string]: number } {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    });
    return grouped;
  }

  private groupEventsByHour(events: any[]): { [key: string]: number } {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      const hour = new Date(event.timestamp).toISOString().substring(0, 13);
      grouped[hour] = (grouped[hour] || 0) + 1;
    });
    return grouped;
  }

  private groupEventsByMinute(events: any[]): { [key: string]: number } {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      const minute = new Date(event.timestamp).toISOString().substring(0, 16);
      grouped[minute] = (grouped[minute] || 0) + 1;
    });
    return grouped;
  }

  private groupEventsByType(events: any[]): { [key: string]: number } {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      grouped[event.event_name] = (grouped[event.event_name] || 0) + 1;
    });
    return grouped;
  }

  private groupConversionsByDay(events: any[]): { [key: string]: number } {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      if (event.event_name === 'Purchase') {
        const day = new Date(event.timestamp).toISOString().split('T')[0];
        grouped[day] = (grouped[day] || 0) + 1;
      }
    });
    return grouped;
  }

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (typeof value === 'object' && value !== null) {
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        }
        return `"${String(value || '').replace(/"/g, '""')}"`;
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }
}