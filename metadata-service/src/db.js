const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'metadata.db');

function initDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      baseFare REAL NOT NULL,
      peakFactor REAL NOT NULL,
      surgeActive INTEGER NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  const existing = db.prepare('SELECT * FROM metadata WHERE id = 1').get();
  if (!existing) {
    db.prepare(`
      INSERT INTO metadata (id, baseFare, peakFactor, surgeActive, updatedAt)
      VALUES (1, ?, ?, ?, ?)
    `).run(100, 1.0, 0, new Date().toISOString());
  }
  return db;
}

function getMetadata(db) {
  const row = db.prepare('SELECT * FROM metadata WHERE id = 1').get();
  return {
    baseFare: row.baseFare,
    peakFactor: row.peakFactor,
    surgeActive: !!row.surgeActive,
    updatedAt: row.updatedAt
  };
}

function updateMetadata(db, { baseFare, peakFactor, surgeActive }) {
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE metadata
    SET baseFare = ?, peakFactor = ?, surgeActive = ?, updatedAt = ?
    WHERE id = 1
  `).run(baseFare, peakFactor, surgeActive ? 1 : 0, updatedAt);
  return getMetadata(db);
}

module.exports = { initDb, getMetadata, updateMetadata };