const { createClient } = require('redis');

const REDIS_KEY = 'metadata:current';
const TTL_SECONDS = 60;

function createCache(redisUrl) {
  const client = createClient({ url: redisUrl });
  let connected = false;

  client.on('error', (err) => {
    // Don't crash the process on Redis errors — just log and keep serving from SQLite.
    connected = false;
    console.warn('[redis] connection error:', err.message);
  });

  // node-redis v4 auto-reconnects in the background after a drop. 'ready' fires
  // both on the initial connect AND every successful reconnect, so this is what
  // lets `connected` self-heal instead of latching false forever after one blip.
  client.on('ready', () => {
    connected = true;
    console.log('[redis] connection restored');
  });

  async function connect() {
    try {
      await client.connect();
      connected = true;
      console.log('[redis] connected');
    } catch (err) {
      connected = false;
      console.warn('[redis] initial connect failed, will operate in degraded mode:', err.message);
    }
  }

  async function get() {
    if (!connected) return null;
    try {
      const raw = await client.get(REDIS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[redis] get failed, falling back:', err.message);
      return null;
    }
  }

  async function set(value) {
    if (!connected) return; // silently skip caching if Redis is down
    try {
      await client.set(REDIS_KEY, JSON.stringify(value), { EX: TTL_SECONDS });
    } catch (err) {
      console.warn('[redis] set failed, continuing without cache:', err.message);
    }
  }

  async function invalidate() {
    if (!connected) return;
    try {
      await client.del(REDIS_KEY);
    } catch (err) {
      console.warn('[redis] invalidate failed:', err.message);
    }
  }

  return { connect, get, set, invalidate, isConnected: () => connected };
}

module.exports = { createCache, REDIS_KEY, TTL_SECONDS };