import { Router } from 'express';
import authRoutes from './auth';
import pixelRoutes from './pixels';
import eventRoutes from './events';
import analyticsRoutes from './analytics';
import conversionRoutes from './conversions';
import diagnosticRoutes from './diagnostics';
import integrationRoutes from './integrations';
import workspaceRoutes from './workspaces';

const router = Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/pixels', pixelRoutes);
router.use('/events', eventRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/conversions', conversionRoutes);
router.use('/diagnostics', diagnosticRoutes);
router.use('/integrations', integrationRoutes);
router.use('/workspaces', workspaceRoutes);

export default router;