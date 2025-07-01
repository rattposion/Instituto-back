import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient();

export async function initializeDatabase() {
  try {
    // Testa a conexão buscando um usuário (ajuste conforme o modelo real)
    await prisma.user.findFirst();
    logger.info('Conexão com o banco de dados estabelecida');
  } catch (error) {
    logger.error('Falha na conexão com o banco de dados:', error);
    throw error;
  }
}