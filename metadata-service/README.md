# Metadata Service — Node.js, Express, SQLite, Redis

Serves shared, low-volatility config data — fare rates and the current surge/peak
multiplier — to every other service in mini-Careem. Built to survive rush-hour
traffic spikes without hammering a database, and to never serve a stale surge
multiplier after an admin updates it.

Reachable only through the gateway at `/api/metadata`. No other service's
database is touched, and nothing outside this service touches this service's
store directly.

## What metadata this serves, and where it comes from

The service owns a single source of truth: a small SQLite database
(`better-sqlite3`) with one row holding:

```json
{
  "baseFare": 100,
  "peakFactor": 1.0,
  "surgeActive": false,
  "updatedAt": "2026-07-23T15:08:07.134Z"
}
```

SQLite was chosen over a full Postgres/Mongo instance because this data is a
single small config record, not a growing dataset — a heavyweight DB engine
would be overkill for one row that changes a few times a day. SQLite still
gives durability across restarts (unlike an in-memory object) and is trivial
to containerize with no separate DB service to run.

## How caching works, and what happens when Redis is stale or down

**Read path (cache-aside):**
1. `GET /api/metadata` checks Redis first (`metadata:current` key).
2. On a cache hit, the cached value is returned directly — the SQLite file is
   never touched. Response includes `"source": "cache"`.
3. On a cache miss (key expired, or never set), the service reads from
   SQLite, returns the fresh value, and populates Redis with a 60-second TTL.
   Response includes `"source": "db"`.

**When Redis is down entirely:**
- All Redis calls are wrapped in try/catch. A failed `get()` returns `null`
  (treated as a cache miss); a failed `set()` is logged and silently skipped.
- The service tracks a `connected` flag, set to `false` on any Redis error
  event, so it stops attempting cache reads until the connection is healthy
  again.
- In this degraded mode, every request falls through to SQLite. Responses
  stay correct — just slightly slower, since every request now hits disk
  instead of RAM. The service never crashes or returns a 5xx because Redis is
  unavailable.
- The connection is **self-healing**: the Redis client's `ready` event (fired
  on both initial connect and every automatic reconnect) flips `connected`
  back to `true`, so caching resumes automatically once Redis recovers —
  no restart of this service required.

## How a surge update avoids serving a stale multiplier

TTL expiry alone isn't good enough here — if an admin flips `peakFactor` from
`1.5` to `2.0` during a surge, waiting up to 60 seconds for the old cached
value to expire means riders could be quoted the wrong fare for up to a
minute.

Instead, `PUT /api/metadata` uses a **write-through** strategy:
1. The new values are written to SQLite first (the source of truth).
2. The Redis key is immediately overwritten with the new value in the same
   request — not invalidated and left to repopulate on the next read, but
   set directly, so there is no window where a `GET` could return a miss and
   race against a slow SQLite write.
3. The very next `GET /api/metadata`, even one millisecond later, returns the
   new multiplier from cache. Verified end-to-end: `PUT` a new `peakFactor`,
   then `GET` immediately — no staleness.

## Stack, and why

Node.js + Express was chosen for the same reason Tracking uses it: this
service is I/O-bound (mostly waiting on Redis and SQLite round-trips) rather
than CPU-bound, and Express keeps the surface area small for a service this
simple — a handful of routes and no heavy framework machinery needed. SQLite
(`better-sqlite3`) gives a zero-ops, file-based durable store appropriate for
a single small config record, avoiding the operational overhead of running a
dedicated database server for one row of data. `redis` (the official Node
client) handles the cache layer with built-in reconnection, which this
service leans on directly for graceful degradation. Like Wallet, Drivers, and
Tracking, this service owns its data exclusively — no other service queries
this SQLite file, and this service never touches MySQL or MongoDB.

## Endpoints

| Method | Path            | Description                                    |
|--------|-----------------|-------------------------------------------------|
| GET    | `/health`       | Reports service status and live Redis connection state |
| GET    | `/api/metadata` | Returns current fare/peak metadata (cache-aside) |
| PUT    | `/api/metadata` | Updates metadata (write-through to DB + cache) |

## Running locally

```bash
docker compose up -d --build metadata
curl http://localhost:8080/api/metadata/
```

## Tests

```bash
npm test
```

Unit tests run against a fake in-memory cache (not a live Redis instance),
covering cache-hit, cache-miss, Redis-down fallback, write-through updates,
and payload validation.