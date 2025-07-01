import { supabase } from '../config/database';
import { hashPassword } from '../utils/crypto';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    // Create demo workspace
    const workspaceId = uuidv4();
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .insert({
        id: workspaceId,
        name: 'Demo Workspace',
        slug: 'demo-workspace',
        description: 'Workspace de demonstração com dados de exemplo',
        owner_id: '', // Will be updated after user creation
        settings: {
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
          dateFormat: 'DD/MM/YYYY'
        },
        is_active: true
      })
      .select()
      .single();

    if (workspaceError) {
      throw workspaceError;
    }

    // Create demo user
    const userId = uuidv4();
    const passwordHash = await hashPassword('demo123456');
    
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: userId,
        name: 'Demo User',
        email: 'demo@metapixel.com',
        password_hash: passwordHash,
        role: 'admin',
        workspace_id: workspaceId,
        is_active: true,
        email_verified: true
      })
      .select()
      .single();

    if (userError) {
      throw userError;
    }

    // Update workspace owner
    await supabase
      .from('workspaces')
      .update({ owner_id: userId })
      .eq('id', workspaceId);

    // Create workspace member record
    await supabase
      .from('workspace_members')
      .insert({
        id: uuidv4(),
        workspace_id: workspaceId,
        user_id: userId,
        role: 'admin',
        invited_by: userId,
        joined_at: new Date().toISOString()
      });

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

    const { error: pixelsError } = await supabase
      .from('pixels')
      .insert(pixels);

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

    const { error: eventsError } = await supabase
      .from('events')
      .insert(events);

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

    const { error: conversionsError } = await supabase
      .from('conversions')
      .insert(conversions);

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

    const { error: integrationsError } = await supabase
      .from('integrations')
      .insert(integrations);

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

    const { error: diagnosticsError } = await supabase
      .from('diagnostics')
      .insert(diagnostics);

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