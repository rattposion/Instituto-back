// Rotas CRUD para gerenciamento de Workspaces e Membros
// Protegidas por autenticação e checagem de roles
// Totalmente comentadas e prontas para uso

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const auth = require('../middlewares/auth');
const role = require('../middlewares/role');

// =========================
// Listar todos os Workspaces do usuário logado
// =========================
router.get('/', auth, async (req, res) => {
  try {
    // Busca workspaces onde o usuário é membro
    const workspaces = await prisma.workspace.findMany({
      where: {
        members: { some: { userId: req.user.id } }
      },
      include: { owner: true, members: { include: { user: true } }, pixels: true }
    });
    res.json(workspaces);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar workspaces.' });
  }
});

// =========================
// Criar novo Workspace
// =========================
router.post('/', auth, async (req, res) => {
  const { name } = req.body;
  try {
    // Cria o workspace e adiciona o usuário como owner/admin
    const workspace = await prisma.workspace.create({
      data: {
        name,
        ownerId: req.user.id,
        members: {
          create: [{ userId: req.user.id, role: 'ADMIN' }]
        }
      },
      include: { members: true }
    });
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar workspace.' });
  }
});

// =========================
// Buscar Workspace por ID
// =========================
router.get('/:id', auth, async (req, res) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.params.id },
      include: { owner: true, members: { include: { user: true } }, pixels: true }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace não encontrado.' });
    // Verifica se o usuário é membro
    if (!workspace.members.some(m => m.userId === req.user.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar workspace.' });
  }
});

// =========================
// Atualizar Workspace (nome)
// =========================
router.put('/:id', auth, role('ADMIN', 'MANAGER'), async (req, res) => {
  const { name } = req.body;
  try {
    const workspace = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { name }
    });
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar workspace.' });
  }
});

// =========================
// Deletar Workspace
// =========================
router.delete('/:id', auth, role('ADMIN'), async (req, res) => {
  try {
    await prisma.workspace.delete({ where: { id: req.params.id } });
    res.json({ message: 'Workspace deletado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar workspace.' });
  }
});

// =========================
// Adicionar membro ao Workspace
// =========================
router.post('/:id/members', auth, role('ADMIN', 'MANAGER'), async (req, res) => {
  const { userId, role: memberRole } = req.body;
  try {
    // Adiciona membro ao workspace
    const member = await prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId: req.params.id,
        role: memberRole || 'USER'
      }
    });
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar membro.' });
  }
});

// =========================
// Remover membro do Workspace
// =========================
router.delete('/:id/members/:memberId', auth, role('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    await prisma.workspaceMember.delete({ where: { id: req.params.memberId } });
    res.json({ message: 'Membro removido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover membro.' });
  }
});

// =========================
// Alterar role de um membro
// =========================
router.put('/:id/members/:memberId', auth, role('ADMIN'), async (req, res) => {
  const { role: newRole } = req.body;
  try {
    const member = await prisma.workspaceMember.update({
      where: { id: req.params.memberId },
      data: { role: newRole }
    });
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar role do membro.' });
  }
});

module.exports = router; 