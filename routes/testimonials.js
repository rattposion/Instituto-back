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

// GET /testimonials
router.get('/', async (req, res) => {
  const testimonials = await prisma.testimonial.findMany();
  res.json(testimonials);
});

// POST /testimonials (protegido)
router.post('/', auth, async (req, res) => {
  const { name, text } = req.body;
  const testimonial = await prisma.testimonial.create({ data: { name, text } });
  res.json(testimonial);
});

// PUT /testimonials/:id (protegido)
router.put('/:id', auth, async (req, res) => {
  const { name, text } = req.body;
  const testimonial = await prisma.testimonial.update({
    where: { id: Number(req.params.id) },
    data: { name, text }
  }).catch(() => null);
  if (!testimonial) return res.status(404).json({ error: 'Não encontrado' });
  res.json(testimonial);
});

// DELETE /testimonials/:id (protegido)
router.delete('/:id', auth, async (req, res) => {
  const testimonial = await prisma.testimonial.delete({
    where: { id: Number(req.params.id) }
  }).catch(() => null);
  if (!testimonial) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ success: true });
});

module.exports = router; 