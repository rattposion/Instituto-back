// Rotas CRUD para gerenciamento de Conversões Personalizadas
// Protegidas por autenticação
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');

// =========================
// Listar conversões de um Pixel
// =========================
router.get('/pixel/:pixelId', auth, async (req, res) => {
  try {
    // Busca conversões do Pixel
    const conversions = await prisma.customConversion.findMany({
      where: { pixelId: req.params.pixelId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(conversions);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar conversões.' });
  }
});

// =========================
// Criar nova conversão personalizada para um Pixel
// =========================
router.post('/pixel/:pixelId', auth, async (req, res) => {
  const { name, rules } = req.body;
  try {
    // Cria a conversão personalizada
    const conversion = await prisma.customConversion.create({
      data: {
        pixelId: req.params.pixelId,
        name,
        rules
      }
    });
    res.json(conversion);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar conversão.' });
  }
});

// =========================
// Buscar conversão por ID
// =========================
router.get('/:id', auth, async (req, res) => {
  try {
    const conversion = await prisma.customConversion.findUnique({ where: { id: req.params.id } });
    if (!conversion) return res.status(404).json({ error: 'Conversão não encontrada.' });
    res.json(conversion);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar conversão.' });
  }
});

// =========================
// Atualizar conversão personalizada
// =========================
router.put('/:id', auth, async (req, res) => {
  const { name, rules } = req.body;
  try {
    const conversion = await prisma.customConversion.update({
      where: { id: req.params.id },
      data: { name, rules }
    });
    res.json(conversion);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar conversão.' });
  }
});

// =========================
// Deletar conversão personalizada
// =========================
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.customConversion.delete({ where: { id: req.params.id } });
    res.json({ message: 'Conversão deletada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar conversão.' });
  }
});

module.exports = router; 