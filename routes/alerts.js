// Rotas CRUD para gerenciamento de Alertas de Pixel
// Protegidas por autenticação
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');

// =========================
// Listar alertas de um Pixel
// =========================
router.get('/pixel/:pixelId', auth, async (req, res) => {
  try {
    // Busca alertas do Pixel
    const alerts = await prisma.alert.findMany({
      where: { pixelId: req.params.pixelId },
      orderBy: { triggeredAt: 'desc' }
    });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar alertas.' });
  }
});

// =========================
// Criar novo alerta para um Pixel
// =========================
router.post('/pixel/:pixelId', auth, async (req, res) => {
  const { type, message } = req.body;
  try {
    // Cria o alerta
    const alert = await prisma.alert.create({
      data: {
        pixelId: req.params.pixelId,
        type,
        message
      }
    });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar alerta.' });
  }
});

// =========================
// Buscar alerta por ID
// =========================
router.get('/:id', auth, async (req, res) => {
  try {
    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) return res.status(404).json({ error: 'Alerta não encontrado.' });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar alerta.' });
  }
});

// =========================
// Deletar alerta
// =========================
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.alert.delete({ where: { id: req.params.id } });
    res.json({ message: 'Alerta deletado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar alerta.' });
  }
});

module.exports = router; 