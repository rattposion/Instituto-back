// Rotas CRUD para gerenciamento de Pixels (Meta Pixel)
// Protegidas por autenticação e checagem de roles
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');
const role = require('../middlewares/role');

// =========================
// Listar todos os Pixels do usuário logado (ou do workspace)
// =========================
router.get('/', auth, async (req, res) => {
  try {
    // Busca todos os pixels do usuário OU dos workspaces que ele participa
    const pixels = await prisma.pixel.findMany({
      where: {
        OR: [
          { ownerId: req.user.id },
          { workspace: { members: { some: { userId: req.user.id } } } }
        ]
      },
      include: { workspace: true, owner: true }
    });
    res.json(pixels);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar pixels.' });
  }
});

// =========================
// Criar novo Pixel
// =========================
router.post('/', auth, role('ADMIN', 'MANAGER'), async (req, res) => {
  const { name, pixelId, workspaceId } = req.body;
  try {
    // Validação simples do ID do Pixel
    if (!/^\d{15,}$/.test(pixelId)) {
      return res.status(400).json({ error: 'ID do Pixel inválido.' });
    }
    // Cria o Pixel
    const pixel = await prisma.pixel.create({
      data: {
        name,
        pixelId,
        workspaceId,
        ownerId: req.user.id,
        status: 'ACTIVE'
      }
    });
    res.json(pixel);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar Pixel.' });
  }
});

// =========================
// Buscar Pixel por ID
// =========================
router.get('/:id', auth, async (req, res) => {
  try {
    const pixel = await prisma.pixel.findUnique({
      where: { id: req.params.id },
      include: { workspace: true, owner: true, events: true, conversions: true, logs: true, capiConfig: true, alerts: true }
    });
    if (!pixel) return res.status(404).json({ error: 'Pixel não encontrado.' });
    // Verifica se o usuário tem acesso
    if (pixel.ownerId !== req.user.id && !pixel.workspace.members.some(m => m.userId === req.user.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(pixel);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar Pixel.' });
  }
});

// =========================
// Atualizar Pixel
// =========================
router.put('/:id', auth, role('ADMIN', 'MANAGER'), async (req, res) => {
  const { name, status } = req.body;
  try {
    // Atualiza nome e status
    const pixel = await prisma.pixel.update({
      where: { id: req.params.id },
      data: { name, status }
    });
    res.json(pixel);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar Pixel.' });
  }
});

// =========================
// Deletar Pixel
// =========================
router.delete('/:id', auth, role('ADMIN'), async (req, res) => {
  try {
    await prisma.pixel.delete({ where: { id: req.params.id } });
    res.json({ message: 'Pixel deletado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar Pixel.' });
  }
});

module.exports = router; 