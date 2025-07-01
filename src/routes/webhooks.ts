import { Router } from 'express';
import { WebhookController } from '../controllers/WebhookController';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const webhookController = new WebhookController();

// Webhook endpoints (no authentication required)
router.post('/meta/:pixelId', asyncHandler(webhookController.handleMetaWebhook));
router.post('/gtm/:integrationId', asyncHandler(webhookController.handleGTMWebhook));
router.post('/shopify/:integrationId', asyncHandler(webhookController.handleShopifyWebhook));
router.post('/custom/:integrationId', asyncHandler(webhookController.handleCustomWebhook));

// Webhook verification endpoints
router.get('/meta/:pixelId', asyncHandler(webhookController.verifyMetaWebhook));

export default router;