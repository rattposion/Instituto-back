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
      const { error } = await prisma.$executeRaw`EXECUTE ${migrationSQL}`;
      
      if (error) {
        logger.error(`