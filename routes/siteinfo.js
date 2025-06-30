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

// GET /siteinfo
router.get('/', async (req, res) => {
  const info = await prisma.siteInfo.findMany();
  res.json(info);
});

// POST /siteinfo (protegido)
router.post('/', auth, async (req, res) => {
  const { key, value } = req.body;
  const info = await prisma.siteInfo.create({ data: { key, value } });
  res.json(info);
});

// PUT /siteinfo/:id (protegido)
router.put('/:id', auth, async (req, res) => {
  const { key, value } = req.body;
  const info = await prisma.siteInfo.update({
    where: { id: Number(req.params.id) },
    data: { key, value }
  }).catch(() => null);
  if (!info) return res.status(404).json({ error: 'Não encontrado' });
  res.json(info);
});

// DELETE /siteinfo/:id (protegido)
router.delete('/:id', auth, async (req, res) => {
  const info = await prisma.siteInfo.delete({
    where: { id: Number(req.params.id) }
  }).catch(() => null);
  if (!info) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ success: true });
});

module.exports = router; 