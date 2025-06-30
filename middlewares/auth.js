// Middleware de autenticação JWT para proteger rotas
// Extrai o token do header Authorization, valida e anexa o usuário à req

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Chave secreta do JWT (deve estar no .env)
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta';

module.exports = async function auth(req, res, next) {
  // Pega o token do header Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido.' });
  }
  try {
    // Valida o token
    const decoded = jwt.verify(token, JWT_SECRET);
    // Busca o usuário no banco
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }
    // Anexa o usuário à requisição
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
} 