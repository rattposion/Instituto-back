// Rotas para integrações (GTM, WordPress, Shopify, Webhooks)
// Protegidas por autenticação
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');

// =========================
// Listar instruções de integração (manual)
// =========================
router.get('/instructions', auth, (req, res) => {
  // Retorna instruções básicas para GTM, WordPress, Shopify
  res.json({
    gtm: 'Adicione o Pixel no GTM usando a tag HTML personalizada.',
    wordpress: 'Use um plugin de Pixel ou adicione o script no header.',
    shopify: 'Cole o código do Pixel em Configurações > Checkout > Scripts.'
  });
});

// =========================
// Cadastrar Webhook para disparos externos
// =========================
router.post('/webhooks', auth, async (req, res) => {
  const { pixelId, url, eventType } = req.body;
  try {
    // Salva o webhook (pode ser expandido para um model próprio)
    // Aqui apenas simula o cadastro
    res.json({ message: 'Webhook cadastrado (simulado).', pixelId, url, eventType });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao cadastrar webhook.' });
  }
});

// =========================
// Disparar teste de Webhook
// =========================
router.post('/webhooks/test', auth, async (req, res) => {
  const { url, payload } = req.body;
  try {
    // Dispara um POST para o webhook
    // Aqui apenas simula o disparo
    res.json({ message: 'Teste de webhook disparado (simulado).', url, payload });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao disparar teste.' });
  }
});

module.exports = router; 