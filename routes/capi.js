// Rotas para configuração e envio de eventos via Conversion API (CAPI)
// Protegidas por autenticação
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');
const fetch = require('node-fetch'); // Para enviar eventos para a Meta

// =========================
// Configurar token e ativar/desativar CAPI para um Pixel
// =========================
router.put('/pixel/:pixelId/config', auth, async (req, res) => {
  const { token, enabled } = req.body;
  try {
    // Atualiza ou cria configuração CAPI
    const config = await prisma.cAPIConfig.upsert({
      where: { pixelId: req.params.pixelId },
      update: { token, enabled },
      create: { pixelId: req.params.pixelId, token, enabled }
    });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao configurar CAPI.' });
  }
});

// =========================
// Buscar configuração CAPI de um Pixel
// =========================
router.get('/pixel/:pixelId/config', auth, async (req, res) => {
  try {
    const config = await prisma.cAPIConfig.findUnique({ where: { pixelId: req.params.pixelId } });
    if (!config) return res.status(404).json({ error: 'Configuração não encontrada.' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configuração.' });
  }
});

// =========================
// Enviar evento para Meta via CAPI
// =========================
router.post('/pixel/:pixelId/send', auth, async (req, res) => {
  const { event } = req.body; // Deve conter os dados do evento no formato esperado pela Meta
  try {
    // Busca configuração CAPI
    const config = await prisma.cAPIConfig.findUnique({ where: { pixelId: req.params.pixelId } });
    if (!config || !config.enabled) {
      return res.status(400).json({ error: 'CAPI não configurado ou desativado.' });
    }
    // Monta o endpoint da Meta
    const url = `https://graph.facebook.com/v18.0/${req.params.pixelId}/events?access_token=${config.token}`;
    // Envia o evento para a Meta
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    const metaResponse = await response.json();
    // Loga o envio
    await prisma.pixelLog.create({
      data: {
        pixelId: req.params.pixelId,
        message: `CAPI: ${JSON.stringify(metaResponse)}`,
        level: response.ok ? 'INFO' : 'ERROR'
      }
    });
    res.json(metaResponse);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar evento para Meta.' });
  }
});

// =========================
// Listar logs de envio CAPI de um Pixel
// =========================
router.get('/pixel/:pixelId/logs', auth, async (req, res) => {
  try {
    const logs = await prisma.pixelLog.findMany({
      where: { pixelId: req.params.pixelId, message: { contains: 'CAPI:' } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar logs.' });
  }
});

module.exports = router; 