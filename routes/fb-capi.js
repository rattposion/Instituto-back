const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

// POST /fb-capi
router.post('/', async (req, res) => {
  const { event_name, event_time, user_data, custom_data } = req.body;
  const pixelId = process.env.FB_PIXEL_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;
  if (!pixelId || !accessToken) {
    return res.status(500).json({ error: 'Pixel ID ou Access Token não configurados' });
  }
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`,
      {
        data: [
          {
            event_name,
            event_time: event_time || Math.floor(Date.now() / 1000),
            user_data: user_data || {},
            custom_data: custom_data || {},
            action_source: 'website',
          }
        ]
      }
    );
    res.json({ success: true, fb_response: response.data });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar para o Facebook', details: err.response?.data || err.message });
  }
});

module.exports = router; 