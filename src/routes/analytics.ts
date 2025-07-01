import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { authenticate } from '../middleware/auth';
import { validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const analyticsController = new AnalyticsController();

// All routes require authentication
router.use(authenticate);

// Get dashboard analytics
router.get('/dashboard', 
  validateQuery(schemas.pagination),
  asyncHandler(analyticsController.getDashboardAnalytics)
);

// Get workspace overview
router.get('/overview', asyncHandler(analyticsController.getWorkspaceOverview));

// Get events analytics
router.get('/events', 
  validateQuery(schemas.pagination),
  asyncHandler(analyticsController.getEventsAnalytics)
);

// Get conversions analytics
router.get('/conversions', asyncHandler(analyticsController.getConversionsAnalytics));

// Get revenue analytics
router.get('/revenue', asyncHandler(analyticsController.getRevenueAnalytics));

// Get funnel analytics
router.get('/funnel', asyncHandler(analyticsController.getFunnelAnalytics));

// Get real-time analytics
router.get('/realtime', asyncHandler(analyticsController.getRealtimeAnalytics));

// Export analytics data
router.get('/export', asyncHandler(analyticsController.exportAnalytics));

export default router;