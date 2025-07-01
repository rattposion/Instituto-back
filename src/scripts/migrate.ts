import { connectDatabase, query, closeDatabase } from '../config/database';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const migrations = [
  {
    name: 'create_initial_tables',
    sql: `
      -- Create workspaces table
      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        owner_id UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create users table
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        avatar TEXT,
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create workspace_members table
      CREATE TABLE IF NOT EXISTS workspace_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'viewer')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(workspace_id, user_id)
      );

      -- Create pixels table
      CREATE TABLE IF NOT EXISTS pixels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        pixel_id VARCHAR(20) NOT NULL,
        meta_account VARCHAR(100) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
        settings JSONB DEFAULT '{}',
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id),
        is_active BOOLEAN DEFAULT true,
        last_activity TIMESTAMP WITH TIME ZONE,
        events_count INTEGER DEFAULT 0,
        conversions_count INTEGER DEFAULT 0,
        revenue DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(pixel_id, workspace_id)
      );

      -- Create events table
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pixel_id UUID NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
        event_name VARCHAR(100) NOT NULL,
        event_type VARCHAR(20) DEFAULT 'standard' CHECK (event_type IN ('standard', 'custom')),
        parameters JSONB DEFAULT '{}',
        source VARCHAR(20) DEFAULT 'web' CHECK (source IN ('web', 'server', 'mobile')),
        user_agent TEXT,
        ip_address INET,
        status VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'error', 'pending')),
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create conversions table
      CREATE TABLE IF NOT EXISTS conversions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        pixel_id UUID NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
        event_name VARCHAR(100) NOT NULL,
        description TEXT,
        rules JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        created_by UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(name, pixel_id)
      );

      -- Create diagnostics table
      CREATE TABLE IF NOT EXISTS diagnostics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pixel_id UUID NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
        severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'success')),
        category VARCHAR(50) NOT NULL CHECK (category IN ('implementation', 'events', 'performance', 'connection')),
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        url TEXT,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create integrations table
      CREATE TABLE IF NOT EXISTS integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(50) NOT NULL CHECK (type IN ('gtm', 'wordpress', 'shopify', 'webhook')),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        config JSONB NOT NULL DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id),
        last_sync TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create integration_pixels table
      CREATE TABLE IF NOT EXISTS integration_pixels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
        pixel_id UUID NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(integration_id, pixel_id)
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_events_pixel_id ON events(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS idx_pixels_workspace_id ON pixels(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_diagnostics_pixel_id ON diagnostics(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_diagnostics_status ON diagnostics(status);
      CREATE INDEX IF NOT EXISTS idx_conversions_pixel_id ON conversions(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_integrations_workspace_id ON integrations(workspace_id);
    `
  }
];

async function runMigrations() {
  try {
    await connectDatabase();
    logger.info('Starting database migrations...');

    for (const migration of migrations) {
      logger.info(`Running migration: ${migration.name}`);
      await query(migration.sql);
      logger.info(`Migration completed: ${migration.name}`);
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export { runMigrations };