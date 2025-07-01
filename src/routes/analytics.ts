import { Router } from 'express';
import { query } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validateQuery } from '../middleware/validation';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const dashboardQuerySchema = Joi.object({
  timeframe: Joi.string().valid('1h', '24h', '7d', '30d').default('7d')
});

// Get dashboard analytics
router.get('/dashboard', authenticateToken, validateQuery(dashboardQuerySchema), async (req: AuthRequest, res, next) => {
  try {
    const { timeframe = '7d' } = req.query;

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

    // Get overall stats
    const statsResult = await query(
      `SELECT 
        COUNT(DISTINCT p.id) as total_pixels,
        COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_pixels,
        COUNT(DISTINCT CASE WHEN p.status = 'error' THEN p.id END) as error_pixels,
        COUNT(DISTINCT CASE WHEN p.status = 'inactive' THEN p.id END) as inactive_pixels
      FROM pixels p
      WHERE p.workspace_id = $1`,
      [req.user!.workspaceId]
    );

    // Get events stats
    const eventsStatsResult = await query(
      `SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE DATE(e.created_at) = CURRENT_DATE) as events_today,
        COUNT(*) FILTER (WHERE e.status = 'success') as successful_events,
        COUNT(*) FILTER (WHERE e.status = 'error') as failed_events
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter}`,
      [req.user!.workspaceId]
    );

    // Get conversions stats
    const conversionsStatsResult = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE e.event_name = 'Purchase') as total_conversions,
        COUNT(*) FILTER (WHERE e.event_name = 'Purchase' AND DATE(e.created_at) = CURRENT_DATE) as conversions_today,
        COALESCE(SUM(CASE WHEN e.event_name = 'Purchase' THEN (e.parameters->>'value')::numeric END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN e.event_name = 'Purchase' AND DATE(e.created_at) = CURRENT_DATE THEN (e.parameters->>'value')::numeric END), 0) as revenue_today
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter} AND e.parameters->>'value' IS NOT NULL`,
      [req.user!.workspaceId]
    );

    // Get events timeline
    const timelineResult = await query(
      `SELECT 
        DATE(e.created_at) as date,
        COUNT(*) as events,
        COUNT(*) FILTER (WHERE e.event_name = 'Purchase') as conversions,
        COALESCE(SUM(CASE WHEN e.event_name = 'Purchase' THEN (e.parameters->>'value')::numeric END), 0) as revenue
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter}
      GROUP BY DATE(e.created_at)
      ORDER BY date`,
      [req.user!.workspaceId]
    );

    // Get top events
    const topEventsResult = await query(
      `SELECT 
        e.event_name,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER()), 2) as percentage
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 ${dateFilter}
      GROUP BY e.event_name
      ORDER BY count DESC
      LIMIT 5`,
      [req.user!.workspaceId]
    );

    // Get recent pixels activity
    const recentPixelsResult = await query(
      `SELECT 
        p.id,
        p.name,
        p.pixel_id,
        p.status,
        p.last_activity,
        COUNT(e.id) FILTER (WHERE DATE(e.created_at) = CURRENT_DATE) as events_today
      FROM pixels p
      LEFT JOIN events e ON p.id = e.pixel_id
      WHERE p.workspace_id = $1
      GROUP BY p.id, p.name, p.pixel_id, p.status, p.last_activity
      ORDER BY p.last_activity DESC NULLS LAST
      LIMIT 10`,
      [req.user!.workspaceId]
    );

    const stats = statsResult.rows[0];
    const eventsStats = eventsStatsResult.rows[0];
    const conversionsStats = conversionsStatsResult.rows[0];

    // Calculate conversion rate
    const conversionRate = eventsStats.total_events > 0 
      ? ((conversionsStats.total_conversions / eventsStats.total_events) * 100).toFixed(2)
      : '0.00';

    res.json({
      success: true,
      data: {
        summary: {
          totalPixels: parseInt(stats.total_pixels),
          activePixels: parseInt(stats.active_pixels),
          errorPixels: parseInt(stats.error_pixels),
          inactivePixels: parseInt(stats.inactive_pixels),
          totalEvents: parseInt(eventsStats.total_events),
          eventsToday: parseInt(eventsStats.events_today),
          successfulEvents: parseInt(eventsStats.successful_events),
          failedEvents: parseInt(eventsStats.failed_events),
          totalConversions: parseInt(conversionsStats.total_conversions),
          conversionsToday: parseInt(conversionsStats.conversions_today),
          totalRevenue: parseFloat(conversionsStats.total_revenue),
          revenueToday: parseFloat(conversionsStats.revenue_today),
          conversionRate: parseFloat(conversionRate)
        },
        timeline: timelineResult.rows,
        topEvents: topEventsResult.rows,
        recentPixels: recentPixelsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get workspace overview
router.get('/overview', authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    // Get workspace info
    const workspaceResult = await query(
      `SELECT 
        w.id,
        w.name,
        w.created_at,
        COUNT(DISTINCT wm.user_id) as member_count,
        COUNT(DISTINCT p.id) as pixel_count
      FROM workspaces w
      LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
      LEFT JOIN pixels p ON w.id = p.workspace_id
      WHERE w.id = $1
      GROUP BY w.id, w.name, w.created_at`,
      [req.user!.workspaceId]
    );

    // Get recent activity
    const recentActivityResult = await query(
      `SELECT 
        'event' as type,
        e.event_name as title,
        p.name as description,
        e.created_at as timestamp
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1
      UNION ALL
      SELECT 
        'pixel' as type,
        'Pixel created: ' || p.name as title,
        'New pixel added' as description,
        p.created_at as timestamp
      FROM pixels p
      WHERE p.workspace_id = $1
      ORDER BY timestamp DESC
      LIMIT 20`,
      [req.user!.workspaceId]
    );

    // Get monthly stats
    const monthlyStatsResult = await query(
      `SELECT 
        DATE_TRUNC('month', e.created_at) as month,
        COUNT(*) as events,
        COUNT(*) FILTER (WHERE e.event_name = 'Purchase') as conversions,
        COALESCE(SUM(CASE WHEN e.event_name = 'Purchase' THEN (e.parameters->>'value')::numeric END), 0) as revenue
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 AND e.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', e.created_at)
      ORDER BY month`,
      [req.user!.workspaceId]
    );

    res.json({
      success: true,
      data: {
        workspace: workspaceResult.rows[0],
        recentActivity: recentActivityResult.rows,
        monthlyStats: monthlyStatsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get realtime analytics
router.get('/realtime', authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    // Get events from last hour
    const realtimeEventsResult = await query(
      `SELECT 
        e.event_name,
        p.name as pixel_name,
        e.created_at,
        e.source
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 AND e.created_at >= NOW() - INTERVAL '1 hour'
      ORDER BY e.created_at DESC
      LIMIT 50`,
      [req.user!.workspaceId]
    );

    // Get active pixels count
    const activePixelsResult = await query(
      `SELECT COUNT(DISTINCT p.id) as active_pixels
      FROM pixels p
      JOIN events e ON p.id = e.pixel_id
      WHERE p.workspace_id = $1 AND e.created_at >= NOW() - INTERVAL '5 minutes'`,
      [req.user!.workspaceId]
    );

    // Get events per minute for last hour
    const eventsPerMinuteResult = await query(
      `SELECT 
        DATE_TRUNC('minute', e.created_at) as minute,
        COUNT(*) as events
      FROM events e
      JOIN pixels p ON e.pixel_id = p.id
      WHERE p.workspace_id = $1 AND e.created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY DATE_TRUNC('minute', e.created_at)
      ORDER BY minute`,
      [req.user!.workspaceId]
    );

    res.json({
      success: true,
      data: {
        recentEvents: realtimeEventsResult.rows,
        activePixels: parseInt(activePixelsResult.rows[0]?.active_pixels || 0),
        eventsPerMinute: eventsPerMinuteResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;