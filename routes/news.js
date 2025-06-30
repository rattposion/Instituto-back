const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'umsegredoseguro');
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// GET /news
router.get('/', async (req, res) => {
  const news = await prisma.news.findMany();
  res.json(news);
});

// POST /news (protegido)
router.post('/', auth, async (req, res) => {
  const { title, content } = req.body;
  const news = await prisma.news.create({ data: { title, content } });
  res.json(news);
});

// PUT /news/:id (protegido)
router.put('/:id', auth, async (req, res) => {
  const { title, content } = req.body;
  const news = await prisma.news.update({
    where: { id: Number(req.params.id) },
    data: { title, content }
  }).catch(() => null);
  if (!news) return res.status(404).json({ error: 'Não encontrado' });
  res.json(news);
});

// DELETE /news/:id (protegido)
router.delete('/:id', auth, async (req, res) => {
  const news = await prisma.news.delete({
    where: { id: Number(req.params.id) }
  }).catch(() => null);
  if (!news) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ success: true });
});

module.exports = router; 