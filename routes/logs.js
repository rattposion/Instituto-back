// Rotas para listagem e exportação de logs de Pixel
// Protegidas por autenticação
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');
const { Parser } = require('json2csv'); // Para exportação CSV

// =========================
// Listar logs de um Pixel (com filtro por nível)
// =========================
router.get('/pixel/:pixelId', auth, async (req, res) => {
  const { level } = req.query; // INFO, WARNING, ERROR
  try {
    const where = { pixelId: req.params.pixelId };
    if (level) where.level = level;
    const logs = await prisma.pixelLog.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar logs.' });
  }
});

// =========================
// Exportar logs em CSV
// =========================
router.get('/pixel/:pixelId/export/csv', auth, async (req, res) => {
  try {
    const logs = await prisma.pixelLog.findMany({
      where: { pixelId: req.params.pixelId },
      orderBy: { createdAt: 'desc' }
    });
    const parser = new Parser();
    const csv = parser.parse(logs);
    res.header('Content-Type', 'text/csv');
    res.attachment('logs.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar logs.' });
  }
});

// =========================
// Exportar logs em JSON
// =========================
router.get('/pixel/:pixelId/export/json', auth, async (req, res) => {
  try {
    const logs = await prisma.pixelLog.findMany({
      where: { pixelId: req.params.pixelId },
      orderBy: { createdAt: 'desc' }
    });
    res.header('Content-Type', 'application/json');
    res.attachment('logs.json');
    res.send(JSON.stringify(logs, null, 2));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar logs.' });
  }
});

module.exports = router; 