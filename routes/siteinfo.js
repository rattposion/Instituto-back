const express = require('express');
const router = express.Router();
const { SiteInfo } = require('../models');
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
  const info = await SiteInfo.findAll();
  res.json(info);
});

// POST /siteinfo (protegido)
router.post('/', auth, async (req, res) => {
  const { key, value } = req.body;
  const info = await SiteInfo.create({ key, value });
  res.json(info);
});

// PUT /siteinfo/:id (protegido)
router.put('/:id', auth, async (req, res) => {
  const { key, value } = req.body;
  const info = await SiteInfo.findByPk(req.params.id);
  if (!info) return res.status(404).json({ error: 'Não encontrado' });
  info.key = key;
  info.value = value;
  await info.save();
  res.json(info);
});

// DELETE /siteinfo/:id (protegido)
router.delete('/:id', auth, async (req, res) => {
  const info = await SiteInfo.findByPk(req.params.id);
  if (!info) return res.status(404).json({ error: 'Não encontrado' });
  await info.destroy();
  res.json({ success: true });
});

module.exports = router; 