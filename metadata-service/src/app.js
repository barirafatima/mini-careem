const express = require('express');

function createApp({ db, cache, dbLayer }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', redis: cache.isConnected() });
  });

  // Cache-aside read
  app.get('/api/metadata', async (req, res) => {
    const cached = await cache.get();
    if (cached) {
      return res.json({ source: 'cache', data: cached });
    }
    const fresh = dbLayer.getMetadata(db);
    await cache.set(fresh);
    return res.json({ source: 'db', data: fresh });
  });

  // Write-through update (surge change)
  app.put('/api/metadata', async (req, res) => {
    const { baseFare, peakFactor, surgeActive } = req.body || {};
    if (
      typeof baseFare !== 'number' ||
      typeof peakFactor !== 'number' ||
      typeof surgeActive !== 'boolean'
    ) {
      return res.status(400).json({ error: 'baseFare (number), peakFactor (number), surgeActive (boolean) are required' });
    }
    const updated = dbLayer.updateMetadata(db, { baseFare, peakFactor, surgeActive });
    // Write-through: overwrite cache immediately so no one reads stale data
    await cache.set(updated);
    return res.json({ source: 'db', data: updated });
  });

  return app;
}

module.exports = { createApp };