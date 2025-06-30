const express = require('express');
const router = express.Router();
const { PixelConfig } = require('../models');
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

// GET /pixel
router.get('/', async (req, res) => {
  const config = await PixelConfig.findAll();
  res.json(config);
});

// POST /pixel (protegido)
router.post('/', auth, async (req, res) => {
  const { pixelId, enabled } = req.body;
  const config = await PixelConfig.create({ pixelId, enabled });
  res.json(config);
});

// PUT /pixel/:id (protegido)
router.put('/:id', auth, async (req, res) => {
  const { pixelId, enabled } = req.body;
  const config = await PixelConfig.findByPk(req.params.id);
  if (!config) return res.status(404).json({ error: 'Não encontrado' });
  config.pixelId = pixelId;
  config.enabled = enabled;
  await config.save();
  res.json(config);
});

// DELETE /pixel/:id (protegido)
router.delete('/:id', auth, async (req, res) => {
  const config = await PixelConfig.findByPk(req.params.id);
  if (!config) return res.status(404).json({ error: 'Não encontrado' });
  await config.destroy();
  res.json({ success: true });
});

module.exports = router; 