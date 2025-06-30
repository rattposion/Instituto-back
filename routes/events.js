// Rotas CRUD para gerenciamento de Eventos de Pixel
// Protegidas por autenticação
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');

// =========================
// Listar eventos de um Pixel
// =========================
router.get('/pixel/:pixelId', auth, async (req, res) => {
  try {
    // Busca eventos do Pixel
    const events = await prisma.event.findMany({
      where: { pixelId: req.params.pixelId },
      orderBy: { receivedAt: 'desc' }
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar eventos.' });
  }
});

// =========================
// Criar novo evento para um Pixel
// =========================
router.post('/pixel/:pixelId', auth, async (req, res) => {
  const { type, data } = req.body;
  try {
    // Cria o evento
    const event = await prisma.event.create({
      data: {
        pixelId: req.params.pixelId,
        type,
        data
      }
    });
    // Atualiza o campo lastEventAt do Pixel
    await prisma.pixel.update({
      where: { id: req.params.pixelId },
      data: { lastEventAt: new Date() }
    });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar evento.' });
  }
});

// =========================
// Buscar evento por ID
// =========================
router.get('/:id', auth, async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: 'Evento não encontrado.' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar evento.' });
  }
});

// =========================
// Deletar evento
// =========================
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.event.delete({ where: { id: req.params.id } });
    res.json({ message: 'Evento deletado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar evento.' });
  }
});

module.exports = router; 