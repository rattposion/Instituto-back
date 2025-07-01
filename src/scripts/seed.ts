import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    // Create admin user
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@metapixel.com' },
      update: {},
      create: {
        email: 'admin@metapixel.com',
        passwordHash: hashedPassword,
        name: 'Admin User',
      },
    });

    // Create default workspace
    const defaultWorkspace = await prisma.workspace.upsert({
      where: { slug: 'default' },
      update: {},
      create: {
        name: 'Default Workspace',
        slug: 'default',
        description: 'Default workspace for new users',
        ownerId: adminUser.id,
      },
    });

    // Add admin to workspace
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: defaultWorkspace.id,
          userId: adminUser.id,
        },
      },
      update: {},
      create: {
        workspaceId: defaultWorkspace.id,
        userId: adminUser.id,
        role: 'ADMIN',
      },
    });

    // Create sample pixels
    const pixel1 = await prisma.pixel.upsert({
      where: {
        pixelId_workspaceId: {
          pixelId: '123456789012345',
          workspaceId: defaultWorkspace.id,
        },
      },
      update: {},
      create: {
        name: 'E-commerce Principal',
        pixelId: '123456789012345',
        metaAccount: 'Minha Empresa Ltda',
        description: 'Pixel principal do e-commerce',
        workspaceId: defaultWorkspace.id,
        createdBy: adminUser.id,
        lastActivity: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      },
    });

    const pixel2 = await prisma.pixel.upsert({
      where: {
        pixelId_workspaceId: {
          pixelId: '987654321098765',
          workspaceId: defaultWorkspace.id,
        },
      },
      update: {},
      create: {
        name: 'Landing Page Promo',
        pixelId: '987654321098765',
        metaAccount: 'Minha Empresa Ltda',
        description: 'Pixel para landing pages promocionais',
        workspaceId: defaultWorkspace.id,
        createdBy: adminUser.id,
        lastActivity: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      },
    });

    // Create sample events
    const events = [
      {
        pixelId: pixel1.id,
        eventName: 'PageView',
        parameters: { page_title: 'Home Page', page_location: 'https://exemplo.com/' },
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      },
      {
        pixelId: pixel1.id,
        eventName: 'ViewContent',
        parameters: { content_name: 'Produto A', content_category: 'Eletrônicos' },
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      },
      {
        pixelId: pixel1.id,
        eventName: 'AddToCart',
        parameters: { content_name: 'Produto A', value: 99.90, currency: 'BRL' },
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      },
      {
        pixelId: pixel1.id,
        eventName: 'Purchase',
        parameters: { content_name: 'Produto A', value: 99.90, currency: 'BRL' },
        createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
      },
      {
        pixelId: pixel2.id,
        eventName: 'PageView',
        parameters: { page_title: 'Promo Landing', page_location: 'https://exemplo.com/promo' },
        createdAt: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
      },
      {
        pixelId: pixel2.id,
        eventName: 'Lead',
        parameters: { content_name: 'Newsletter Signup' },
        createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      },
    ];

    for (const event of events) {
      await prisma.event.create({
        data: {
          pixelId: event.pixelId,
          eventName: event.eventName,
          parameters: event.parameters,
          source: 'WEB',
          createdAt: event.createdAt,
        },
      });
    }

    // Create sample conversions
    await prisma.conversion.upsert({
      where: {
        name_pixelId: {
          name: 'Compra E-commerce',
          pixelId: pixel1.id,
        },
      },
      update: {},
      create: {
        name: 'Compra E-commerce',
        pixelId: pixel1.id,
        eventName: 'Purchase',
        description: 'Conversão de compra no e-commerce',
        createdBy: adminUser.id,
      },
    });

    await prisma.conversion.upsert({
      where: {
        name_pixelId: {
          name: 'Lead Newsletter',
          pixelId: pixel2.id,
        },
      },
      update: {},
      create: {
        name: 'Lead Newsletter',
        pixelId: pixel2.id,
        eventName: 'Lead',
        description: 'Conversão de lead da newsletter',
        createdBy: adminUser.id,
      },
    });

    // Update pixel statistics
    await prisma.pixel.update({
      where: { id: pixel1.id },
      data: {
        eventsCount: 4,
        conversionsCount: 1,
        revenue: 99.90,
      },
    });

    await prisma.pixel.update({
      where: { id: pixel2.id },
      data: {
        eventsCount: 2,
        conversionsCount: 1,
        revenue: 0,
      },
    });

    logger.info('Database seeding completed successfully');
    console.log('\n=== SEED DATA CREATED ===');
    console.log('Admin User:');
    console.log('  Email: admin@metapixel.com');
    console.log('  Password: admin123');
    console.log('\nWorkspace: Default Workspace');
    console.log('Pixels: E-commerce Principal, Landing Page Promo');
    console.log('Sample events and conversions created');
    console.log('========================\n');
  } catch (error) {
    logger.error('Seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Seeding completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

export { seedDatabase };