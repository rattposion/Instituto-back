import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { verifyHmacSignature } from '../utils/crypto';
import { v4 as uuidv4 } from 'uuid';

export class WebhookController {
  async handleMetaWebhook(req: Request, res: Response) {
    const { pixelId } = req.params;
    const signature = req.get('X-Hub-Signature-256');
    const payload = req.body;

    try {
      // Verify pixel exists
      const { data: pixel, error: pixelError } = await supabase
        .from('pixels')
        .select('id, workspace_id')
        .eq('pixel_id', pixelId)
        .single();

      if (pixelError || !pixel) {
        throw createError('Pixel not found', 404);
      }

      // Verify webhook signature if configured
      // In production, you would verify the signature using Meta's webhook secret

      // Process webhook payload
      if (payload.object === 'page') {
        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === 'leadgen') {
              await this.processLeadGenEvent(pixel, change.value);
            }
          }
        }
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Meta webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  async verifyMetaWebhook(req: Request, res: Response) {
    const { pixelId } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Verify the webhook subscription
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      logger.info(`Meta webhook verified for pixel: ${pixelId}`);
      res.status(200).send(challenge);
    } else {
      logger.warn(`Meta webhook verification failed for pixel: ${pixelId}`);
      res.status(403).json({ error: 'Verification failed' });
    }
  }

  async handleGTMWebhook(req: Request, res: Response) {
    const { integrationId } = req.params;
    const payload = req.body;

    try {
      // Verify integration exists
      const { data: integration, error: integrationError } = await supabase
        .from('integrations')
        .select('*')
        .eq('id', integrationId)
        .eq('type', 'gtm')
        .single();

      if (integrationError || !integration) {
        throw createError('Integration not found', 404);
      }

      // Process GTM webhook data
      await this.processGTMData(integration, payload);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('GTM webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  async handleShopifyWebhook(req: Request, res: Response) {
    const { integrationId } = req.params;
    const payload = req.body;
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    try {
      // Verify integration exists
      const { data: integration, error: integrationError } = await supabase
        .from('integrations')
        .select('*')
        .eq('id', integrationId)
        .eq('type', 'shopify')
        .single();

      if (integrationError || !integration) {
        throw createError('Integration not found', 404);
      }

      // Verify Shopify webhook signature
      const webhookSecret = integration.config.webhookSecret;
      if (webhookSecret && hmacHeader) {
        const isValid = verifyHmacSignature(
          JSON.stringify(payload),
          hmacHeader,
          webhookSecret
        );

        if (!isValid) {
          throw createError('Invalid webhook signature', 401);
        }
      }

      // Process Shopify webhook data
      await this.processShopifyData(integration, payload);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Shopify webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  async handleCustomWebhook(req: Request, res: Response) {
    const { integrationId } = req.params;
    const payload = req.body;
    const signature = req.get('X-Webhook-Signature');

    try {
      // Verify integration exists
      const { data: integration, error: integrationError } = await supabase
        .from('integrations')
        .select('*')
        .eq('id', integrationId)
        .eq('type', 'webhook')
        .single();

      if (integrationError || !integration) {
        throw createError('Integration not found', 404);
      }

      // Verify custom webhook signature if configured
      const webhookSecret = integration.config.secret;
      if (webhookSecret && signature) {
        const isValid = verifyHmacSignature(
          JSON.stringify(payload),
          signature,
          webhookSecret
        );

        if (!isValid) {
          throw createError('Invalid webhook signature', 401);
        }
      }

      // Process custom webhook data
      await this.processCustomWebhookData(integration, payload);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Custom webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  private async processLeadGenEvent(pixel: any, leadData: any) {
    try {
      // Create lead event
      const eventData = {
        id: uuidv4(),
        pixel_id: pixel.id,
        event_name: 'Lead',
        event_type: 'standard',
        parameters: {
          lead_id: leadData.leadgen_id,
          form_id: leadData.form_id,
          ad_id: leadData.ad_id,
          value: 0,
          currency: 'USD'
        },
        source: 'webhook',
        timestamp: new Date().toISOString(),
        processed: false
      };

      await supabase
        .from('events')
        .insert(eventData);

      logger.info(`Lead event created for pixel ${pixel.id}`);
    } catch (error) {
      logger.error('Error processing lead gen event:', error);
    }
  }

  private async processGTMData(integration: any, payload: any) {
    try {
      // Process GTM container data
      if (payload.type === 'container_version_published') {
        await supabase
          .from('integrations')
          .update({
            last_sync: new Date().toISOString(),
            status: 'active'
          })
          .eq('id', integration.id);

        logger.info(`GTM container updated for integration ${integration.id}`);
      }
    } catch (error) {
      logger.error('Error processing GTM data:', error);
    }
  }

  private async processShopifyData(integration: any, payload: any) {
    try {
      // Get connected pixels for this integration
      const { data: pixels } = await supabase
        .from('pixels')
        .select('id')
        .eq('workspace_id', integration.workspace_id);

      if (!pixels || pixels.length === 0) {
        return;
      }

      // Process different Shopify webhook types
      switch (payload.topic || req.get('X-Shopify-Topic')) {
        case 'orders/create':
          await this.processShopifyOrder(pixels[0], payload, 'Purchase');
          break;
        case 'orders/updated':
          await this.processShopifyOrder(pixels[0], payload, 'Purchase');
          break;
        case 'carts/create':
          await this.processShopifyCart(pixels[0], payload, 'AddToCart');
          break;
        case 'checkouts/create':
          await this.processShopifyCheckout(pixels[0], payload, 'InitiateCheckout');
          break;
        default:
          logger.info(`Unhandled Shopify webhook type: ${payload.topic}`);
      }
    } catch (error) {
      logger.error('Error processing Shopify data:', error);
    }
  }

  private async processShopifyOrder(pixel: any, orderData: any, eventName: string) {
    const eventData = {
      id: uuidv4(),
      pixel_id: pixel.id,
      event_name: eventName,
      event_type: 'standard',
      parameters: {
        order_id: orderData.id,
        value: parseFloat(orderData.total_price || 0),
        currency: orderData.currency || 'USD',
        content_ids: orderData.line_items?.map((item: any) => item.product_id) || [],
        content_type: 'product',
        num_items: orderData.line_items?.length || 0
      },
      source: 'webhook',
      timestamp: new Date().toISOString(),
      processed: false
    };

    await supabase
      .from('events')
      .insert(eventData);

    logger.info(`Shopify ${eventName} event created for pixel ${pixel.id}`);
  }

  private async processShopifyCart(pixel: any, cartData: any, eventName: string) {
    const eventData = {
      id: uuidv4(),
      pixel_id: pixel.id,
      event_name: eventName,
      event_type: 'standard',
      parameters: {
        cart_id: cartData.id,
        value: parseFloat(cartData.total_price || 0),
        currency: cartData.currency || 'USD',
        content_ids: cartData.line_items?.map((item: any) => item.product_id) || [],
        content_type: 'product'
      },
      source: 'webhook',
      timestamp: new Date().toISOString(),
      processed: false
    };

    await supabase
      .from('events')
      .insert(eventData);

    logger.info(`Shopify ${eventName} event created for pixel ${pixel.id}`);
  }

  private async processShopifyCheckout(pixel: any, checkoutData: any, eventName: string) {
    const eventData = {
      id: uuidv4(),
      pixel_id: pixel.id,
      event_name: eventName,
      event_type: 'standard',
      parameters: {
        checkout_id: checkoutData.id,
        value: parseFloat(checkoutData.total_price || 0),
        currency: checkoutData.currency || 'USD',
        content_ids: checkoutData.line_items?.map((item: any) => item.product_id) || [],
        content_type: 'product'
      },
      source: 'webhook',
      timestamp: new Date().toISOString(),
      processed: false
    };

    await supabase
      .from('events')
      .insert(eventData);

    logger.info(`Shopify ${eventName} event created for pixel ${pixel.id}`);
  }

  private async processCustomWebhookData(integration: any, payload: any) {
    try {
      // Get connected pixels for this integration
      const { data: pixels } = await supabase
        .from('pixels')
        .select('id')
        .eq('workspace_id', integration.workspace_id);

      if (!pixels || pixels.length === 0) {
        return;
      }

      // Process custom webhook payload
      const eventData = {
        id: uuidv4(),
        pixel_id: pixels[0].id,
        event_name: payload.event_name || 'CustomEvent',
        event_type: 'custom',
        parameters: payload.parameters || payload,
        source: 'webhook',
        timestamp: payload.timestamp || new Date().toISOString(),
        processed: false
      };

      await supabase
        .from('events')
        .insert(eventData);

      logger.info(`Custom webhook event created for pixel ${pixels[0].id}`);
    } catch (error) {
      logger.error('Error processing custom webhook data:', error);
    }
  }
}