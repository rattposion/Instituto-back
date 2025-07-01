import { Express } from 'express';
import authRoutes from './auth';
import userRoutes from './users';
import workspaceRoutes from './workspaces';
import pixelRoutes from './pixels';
import eventRoutes from './events';
import conversionRoutes from './conversions';
import diagnosticRoutes from './diagnostics';
import integrationRoutes from './integrations';
import analyticsRoutes from './analytics';
import webhookRoutes from './webhooks';

export const setupRoutes = (app: Express) => {
  // API version prefix
  const apiPrefix = '/api/v1';

  // Routes
  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/users`, userRoutes);
  app.use(`${apiPrefix}/workspaces`, workspaceRoutes);
  app.use(`${apiPrefix}/pixels`, pixelRoutes);
  app.use(`${apiPrefix}/events`, eventRoutes);
  app.use(`${apiPrefix}/conversions`, conversionRoutes);
  app.use(`${apiPrefix}/diagnostics`, diagnosticRoutes);
  app.use(`${apiPrefix}/integrations`, integrationRoutes);
  app.use(`${apiPrefix}/analytics`, analyticsRoutes);
  app.use(`${apiPrefix}/webhooks`, webhookRoutes);
};