import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    const migrationsDir = path.join(__dirname, '../../supabase/migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      logger.info('No migrations directory found, skipping...');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      logger.info(`Running migration: ${file}`);
      
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      // Execute migration
      const { error } = await prisma.rpc('exec_sql', { sql: migrationSQL });
      
      if (error) {
        logger.error(`Migration ${file} failed:`, error);
        throw error;
      }
      
      logger.info(`Migration ${file} completed successfully`);
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