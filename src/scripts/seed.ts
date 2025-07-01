import { Database } from '../config/database';
import { hashPassword } from '../utils/crypto';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    // Create demo workspace
    const workspaceId = uuidv4();
    const { data: workspace, error: workspaceError } = await Database.query(`
      INSERT INTO workspaces (id, name, slug, description, owner_id, settings, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [workspaceId, 'Demo Workspace', 'demo-workspace', 'Workspace de demonstração com dados de exemplo', '', '{ "timezone": "America/Sao_Paulo", "currency": "BRL", "dateFormat": "DD/MM/YYYY" }', true]);

    if (workspaceError) {
      throw workspaceError;
    }

    // Create demo user
    const userId = uuidv4();
    const passwordHash = await hashPassword('demo123456');
    
    const { data: user, error: userError } = await Database.query(`
      INSERT INTO users (id, name, email, password_hash, role, workspace_id, is_active, email_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [userId, 'Demo User', 'demo@metapixel.com', passwordHash, 'admin', workspaceId, true, true]);

    if (userError) {
      throw userError;
    }

    // Update workspace owner
    await Database.query(`
      UPDATE workspaces
      SET owner_id = $1
      WHERE id = $2
    `, [userId, workspaceId]);

    // Create workspace member record
    await Database.query(`
      INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [uuidv4(), workspaceId, userId, 'admin', userId, new Date().toISOString()]);

    // Create demo pixels
    const pixels = [
      {
        id: uuidv4(),
        name: 'E-commerce Principal',
        pixel_id: '123456789012345',
        meta_account: 'Demo E-commerce Ltda',
        workspace_id: workspaceId,
        status: 'active',
        events_count: 1247,
        conversions_count: 45,
        revenue: 12500.00,
        last_activity: new Date().toISOString(),
        settings: {
          autoEvents: true,
          conversionTracking: true
        }
      },
      {
        id: uuidv4(),
        name: 'Landing Page Promo',
        pixel_id: '987654321098765',
        meta_account: 'Demo Marketing Ltda',
        workspace_id: workspaceId,
        status: 'active',
        events_count: 856,
        conversions_count: 23,
        revenue: 5600.00,
        last_activity: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        settings: {
          autoEvents: false,
          conversionTracking: true
        }
      },
      {
        id: uuidv4(),
        name: 'Blog Corporativo',
        pixel_id: '456789123456789',
        meta_account: 'Demo Content Ltda',
        workspace_id: workspaceId,
        status: 'inactive',
        events_count: 0,
        conversions_count: 0,
        revenue: 0,
        last_activity: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        settings: {
          autoEvents: true,
          conversionTracking: false
        }
      }
    ];

    const { error: pixelsError } = await Database.query(`
      INSERT INTO pixels (id, name, pixel_id, meta_account, workspace_id, status, events_count, conversions_count, revenue, last_activity, settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [pixels[0].id, pixels[0].name, pixels[0].pixel_id, pixels[0].meta_account, pixels[0].workspace_id, pixels[0].status, pixels[0].events_count, pixels[0].conversions_count, pixels[0].revenue, pixels[0].last_activity, JSON.stringify(pixels[0].settings)]);

    if (pixelsError) {
      throw pixelsError;
    }

    // Create demo events
    const events = [];
    const eventNames = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase', 'Lead'];
    
    for (let i = 0; i < 100; i++) {
      const randomPixel = pixels[Math.floor(Math.random() * 2)]; // Only active pixels
      const randomEvent = eventNames[Math.floor(Math.random() * eventNames.length)];
      const timestamp = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000);
      
      events.push({
        id: uuidv4(),
        pixel_id: randomPixel.id,
        event_name: randomEvent,
        event_type: 'standard',
        parameters: {
          page_title: 'Demo Page',
          page_location: 'https://demo.com/',
          value: randomEvent === 'Purchase' ? Math.random() * 500 + 50 : 0,
          currency: 'BRL'
        },
        source: Math.random() > 0.7 ? 'server' : 'web',
        timestamp: timestamp.toISOString(),
        processed: Math.random() > 0.1 // 90% processed
      });
    }

    const { error: eventsError } = await Database.query(`
      INSERT INTO events (id, pixel_id, event_name, event_type, parameters, source, timestamp, processed)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [events[0].id, events[0].pixel_id, events[0].event_name, events[0].event_type, JSON.stringify(events[0].parameters), events[0].source, events[0].timestamp, events[0].processed]);

    if (eventsError) {
      throw eventsError;
    }

    // Create demo conversions
    const conversions = [
      {
        id: uuidv4(),
        name: 'Compra E-commerce',
        pixel_id: pixels[0].id,
        event_name: 'Purchase',
        rules: [
          {
            type: 'event',
            operator: 'equals',
            field: 'event_name',
            value: 'Purchase'
          }
        ],
        conversion_rate: 3.2,
        total_conversions: 156,
        total_value: 45200.00,
        average_value: 289.74,
        is_active: true
      },
      {
        id: uuidv4(),
        name: 'Lead Newsletter',
        pixel_id: pixels[1].id,
        event_name: 'Lead',
        rules: [
          {
            type: 'event',
            operator: 'equals',
            field: 'event_name',
            value: 'Lead'
          }
        ],
        conversion_rate: 12.5,
        total_conversions: 89,
        total_value: 0,
        average_value: 0,
        is_active: true
      }
    ];

    const { error: conversionsError } = await Database.query(`
      INSERT INTO conversions (id, name, pixel_id, event_name, rules, conversion_rate, total_conversions, total_value, average_value, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [conversions[0].id, conversions[0].name, conversions[0].pixel_id, JSON.stringify(conversions[0].rules), conversions[0].conversion_rate, conversions[0].total_conversions, conversions[0].total_value, conversions[0].average_value, conversions[0].is_active]);

    if (conversionsError) {
      throw conversionsError;
    }

    // Create demo integrations
    const integrations = [
      {
        id: uuidv4(),
        workspace_id: workspaceId,
        type: 'gtm',
        name: 'Google Tag Manager',
        description: 'Integração com GTM para gerenciamento de tags',
        config: {
          containerId: 'GTM-XXXXXXX',
          workspaceId: '12345'
        },
        status: 'active',
        last_sync: new Date().toISOString(),
        pixels_connected: 2
      },
      {
        id: uuidv4(),
        workspace_id: workspaceId,
        type: 'shopify',
        name: 'Loja Shopify',
        description: 'Integração com loja Shopify',
        config: {
          shopDomain: 'demo-store.myshopify.com',
          accessToken: 'demo_token'
        },
        status: 'inactive',
        last_sync: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        pixels_connected: 0
      }
    ];

    const { error: integrationsError } = await Database.query(`
      INSERT INTO integrations (id, workspace_id, type, name, description, config, status, last_sync, pixels_connected)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [integrations[0].id, integrations[0].workspace_id, integrations[0].type, integrations[0].name, integrations[0].description, JSON.stringify(integrations[0].config), integrations[0].status, integrations[0].last_sync, integrations[0].pixels_connected]);

    if (integrationsError) {
      throw integrationsError;
    }

    // Create demo diagnostics
    const diagnostics = [
      {
        id: uuidv4(),
        pixel_id: pixels[0].id,
        severity: 'warning',
        category: 'performance',
        title: 'Taxa de erro elevada',
        description: 'O pixel está apresentando uma taxa de erro de 5% nos últimos eventos',
        status: 'active',
        last_checked: new Date().toISOString()
      },
      {
        id: uuidv4(),
        pixel_id: pixels[2].id,
        severity: 'error',
        category: 'implementation',
        title: 'Pixel inativo',
        description: 'O pixel não está recebendo eventos há mais de 2 horas',
        status: 'active',
        last_checked: new Date().toISOString()
      }
    ];

    const { error: diagnosticsError } = await Database.query(`
      INSERT INTO diagnostics (id, pixel_id, severity, category, title, description, status, last_checked)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [diagnostics[0].id, diagnostics[0].pixel_id, diagnostics[0].severity, diagnostics[0].category, diagnostics[0].title, diagnostics[0].description, diagnostics[0].status, diagnostics[0].last_checked]);

    if (diagnosticsError) {
      throw diagnosticsError;
    }

    logger.info('Database seeding completed successfully!');
    logger.info('Demo credentials:');
    logger.info('Email: demo@metapixel.com');
    logger.info('Password: demo123456');

  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

// Run seeding if called directly
if (require.main === module) {
  seedDatabase();
}

export { seedDatabase };