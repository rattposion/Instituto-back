import { Database } from '../config/database';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const migrations = [
  {
    name: '001_initial_schema',
    sql: `
      -- Create workspaces table
      CREATE TABLE IF NOT EXISTS workspaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text UNIQUE NOT NULL,
        description text,
        owner_id uuid,
        settings jsonb DEFAULT '{}',
        is_active boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      -- Create users table
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE NOT NULL,
        name text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
        avatar text,
        workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
        is_active boolean DEFAULT true,
        email_verified boolean DEFAULT false,
        last_login timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      -- Create workspace_members table
      CREATE TABLE IF NOT EXISTS workspace_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
        invited_by uuid REFERENCES users(id),
        joined_at timestamptz,
        created_at timestamptz DEFAULT now(),
        UNIQUE(workspace_id, user_id)
      );

      -- Create pixels table
      CREATE TABLE IF NOT EXISTS pixels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        pixel_id text NOT NULL,
        meta_account text NOT NULL,
        workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
        status text DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'error')),
        last_activity timestamptz,
        events_count integer DEFAULT 0,
        conversions_count integer DEFAULT 0,
        revenue decimal(12,2) DEFAULT 0,
        settings jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE(workspace_id, pixel_id)
      );

      -- Create events table
      CREATE TABLE IF NOT EXISTS events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pixel_id uuid REFERENCES pixels(id) ON DELETE CASCADE,
        event_name text NOT NULL,
        event_type text DEFAULT 'standard' CHECK (event_type IN ('standard', 'custom')),
        parameters jsonb DEFAULT '{}',
        source text DEFAULT 'web' CHECK (source IN ('web', 'server', 'mobile')),
        user_agent text,
        ip_address inet,
        timestamp timestamptz DEFAULT now(),
        processed boolean DEFAULT false,
        error_message text,
        created_at timestamptz DEFAULT now()
      );

      -- Create conversions table
      CREATE TABLE IF NOT EXISTS conversions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        pixel_id uuid REFERENCES pixels(id) ON DELETE CASCADE,
        event_name text NOT NULL,
        rules jsonb DEFAULT '[]',
        conversion_rate decimal(5,2) DEFAULT 0,
        total_conversions integer DEFAULT 0,
        total_value decimal(12,2) DEFAULT 0,
        average_value decimal(12,2) DEFAULT 0,
        is_active boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      -- Create diagnostics table
      CREATE TABLE IF NOT EXISTS diagnostics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pixel_id uuid REFERENCES pixels(id) ON DELETE CASCADE,
        severity text NOT NULL CHECK (severity IN ('error', 'warning', 'info', 'success')),
        category text NOT NULL CHECK (category IN ('implementation', 'events', 'performance', 'connection')),
        title text NOT NULL,
        description text NOT NULL,
        url text,
        status text DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
        last_checked timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(),
        UNIQUE(pixel_id, title)
      );

      -- Create integrations table
      CREATE TABLE IF NOT EXISTS integrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
        type text NOT NULL CHECK (type IN ('gtm', 'wordpress', 'shopify', 'webhook')),
        name text NOT NULL,
        description text,
        config jsonb DEFAULT '{}',
        status text DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'error')),
        last_sync timestamptz,
        pixels_connected integer DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      -- Create api_keys table
      CREATE TABLE IF NOT EXISTS api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
        name text NOT NULL,
        key_hash text NOT NULL UNIQUE,
        permissions text[] DEFAULT '{}',
        last_used timestamptz,
        expires_at timestamptz,
        is_active boolean DEFAULT true,
        created_at timestamptz DEFAULT now()
      );

      -- Create audit_logs table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id uuid,
        details jsonb DEFAULT '{}',
        ip_address inet,
        user_agent text,
        created_at timestamptz DEFAULT now()
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_workspace_id ON users(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_pixels_workspace_id ON pixels(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_pixels_pixel_id ON pixels(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_events_pixel_id ON events(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS idx_conversions_pixel_id ON conversions(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_diagnostics_pixel_id ON diagnostics(pixel_id);
      CREATE INDEX IF NOT EXISTS idx_integrations_workspace_id ON integrations(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON api_keys(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_id ON audit_logs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

      -- Update workspace owner reference
      ALTER TABLE workspaces ADD CONSTRAINT IF NOT EXISTS fk_workspaces_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

      -- Create updated_at trigger function
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Create triggers for updated_at
      DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
      CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_pixels_updated_at ON pixels;
      CREATE TRIGGER update_pixels_updated_at BEFORE UPDATE ON pixels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_conversions_updated_at ON conversions;
      CREATE TRIGGER update_conversions_updated_at BEFORE UPDATE ON conversions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
      CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  }
];

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    // Create migrations table if it doesn't exist
    await Database.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      // Check if migration has already been run
      const result = await Database.query(
        'SELECT id FROM migrations WHERE name = $1',
        [migration.name]
      );

      if (result.rows.length > 0) {
        logger.info(`Migration ${migration.name} already executed, skipping...`);
        continue;
      }

      logger.info(`Running migration: ${migration.name}`);
      
      // Execute migration in a transaction
      await Database.transaction(async (client) => {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name]
        );
      });
      
      logger.info(`Migration ${migration.name} completed successfully`);
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migrations if called directly
if (require.main === module) {
  runMigrations();
}

export { runMigrations };