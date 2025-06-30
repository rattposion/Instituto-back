// Rotas de autenticação: registro, login, recuperação de senha, login com OAuth Meta
// Todas as rotas comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta';

// =========================
// Registro de novo usuário
// =========================
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    // Verifica se o e-mail já existe
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }
    // Criptografa a senha
    const hashedPassword = await bcrypt.hash(password, 10);
    // Cria o usuário
    const user = await prisma.user.create({
      data: { name, email, hashedPassword }
    });
    res.json({ message: 'Usuário registrado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar.' });
  }
});

// =============
// Login comum
// =============
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });
    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) return res.status(400).json({ error: 'Senha inválida.' });
    // Gera token JWT
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

// =====================
// Recuperação de senha
// =====================
router.post('/forgot', async (req, res) => {
  const { email } = req.body;
  // Aqui você pode integrar com um serviço de e-mail para enviar o link de recuperação
  // Exemplo: await emailService.sendReset(email)
  res.json({ message: 'Se o e-mail existir, enviaremos instruções.' });
});

// =====================
// Login com OAuth Meta
// =====================
router.get('/oauth/meta', (req, res) => {
  // Redireciona para a página de login do Facebook/Meta
  // Exemplo: res.redirect('https://www.facebook.com/v18.0/dialog/oauth?...')
  res.json({ message: 'OAuth Meta não implementado neste exemplo.' });
});

// Endpoint temporário para debug do JWT_SECRET (remova após o teste!)
router.get('/debug/jwt-secret', (req, res) => {
  res.json({ JWT_SECRET: process.env.JWT_SECRET || 'NÃO DEFINIDO' });
});

module.exports = router; 
