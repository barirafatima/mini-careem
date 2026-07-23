const { createApp } = require('./app');
const { createCache } = require('./cache');
const dbLayer = require('./db');

const PORT = process.env.PORT || 8084;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

async function main() {
  const db = dbLayer.initDb();
  const cache = createCache(REDIS_URL);
  await cache.connect();

  const app = createApp({ db, cache, dbLayer });
  app.listen(PORT, () => {
    console.log(`metadata-service listening on ${PORT}`);
  });
}

main();