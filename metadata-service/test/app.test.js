const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const { createApp } = require('../src/app');
const dbLayer = require('../src/db');

// A fake in-memory cache — NOT real Redis. This satisfies the assignment's
// requirement to avoid testing against a live Redis instance.
function createFakeCache({ simulateDown = false } = {}) {
  let store = null;
  return {
    async get() {
      if (simulateDown) return null;
      return store;
    },
    async set(value) {
      if (simulateDown) return; // pretend Redis is unreachable
      store = value;
    },
    async invalidate() {
      store = null;
    },
    isConnected: () => !simulateDown,
    _peek: () => store // test-only helper
  };
}

function createTestDb() {
  // Fresh in-memory SQLite DB per test — fast, isolated, no file left behind.
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      baseFare REAL NOT NULL,
      peakFactor REAL NOT NULL,
      surgeActive INTEGER NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  db.prepare(`
    INSERT INTO metadata (id, baseFare, peakFactor, surgeActive, updatedAt)
    VALUES (1, 100, 1.0, 0, ?)
  `).run(new Date().toISOString());
  return db;
}

// Minimal fetch-free HTTP test helper using Express app directly via supertest-like manual call
async function request(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const http = require('node:http');
    const server = app.listen(0, () => {
      const { port } = server.address();
      const data = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          path: url,
          method,
          headers: data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {}
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('metadata-service', () => {
  test('GET /health reports redis connection status', async () => {
    const db = createTestDb();
    const cache = createFakeCache();
    const app = createApp({ db, cache, dbLayer });

    const res = await request(app, 'GET', '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.redis, true);
  });

  test('GET /api/metadata returns from DB on cache miss and populates cache', async () => {
    const db = createTestDb();
    const cache = createFakeCache();
    const app = createApp({ db, cache, dbLayer });

    const res = await request(app, 'GET', '/api/metadata');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.source, 'db');
    assert.strictEqual(res.body.data.baseFare, 100);
    assert.strictEqual(res.body.data.peakFactor, 1.0);

    // Cache should now be populated
    assert.deepStrictEqual(cache._peek(), res.body.data);
  });

  test('GET /api/metadata returns from cache on second call (cache hit)', async () => {
    const db = createTestDb();
    const cache = createFakeCache();
    const app = createApp({ db, cache, dbLayer });

    await request(app, 'GET', '/api/metadata'); // populates cache
    const res = await request(app, 'GET', '/api/metadata'); // should hit cache
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.source, 'cache');
  });

  test('GET /api/metadata falls back to DB gracefully when Redis is down', async () => {
    const db = createTestDb();
    const cache = createFakeCache({ simulateDown: true });
    const app = createApp({ db, cache, dbLayer });

    const res = await request(app, 'GET', '/api/metadata');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.source, 'db');
    assert.strictEqual(res.body.data.baseFare, 100);
    // Service did not crash even though "Redis" is down
  });

  test('PUT /api/metadata updates DB and overwrites cache immediately (write-through)', async () => {
    const db = createTestDb();
    const cache = createFakeCache();
    const app = createApp({ db, cache, dbLayer });

    await request(app, 'GET', '/api/metadata'); // warm the cache with old values

    const res = await request(app, 'PUT', '/api/metadata', {
      baseFare: 120,
      peakFactor: 2.0,
      surgeActive: true
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.peakFactor, 2.0);
    assert.strictEqual(res.body.data.surgeActive, true);

    // Cache must reflect the new value immediately — no stale surge multiplier
    assert.strictEqual(cache._peek().peakFactor, 2.0);
    assert.strictEqual(cache._peek().surgeActive, true);
  });

  test('PUT /api/metadata rejects invalid payloads', async () => {
    const db = createTestDb();
    const cache = createFakeCache();
    const app = createApp({ db, cache, dbLayer });

    const res = await request(app, 'PUT', '/api/metadata', { baseFare: 'not-a-number' });
    assert.strictEqual(res.status, 400);
  });
});