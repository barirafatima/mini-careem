Evaluation of metadata-service against Assignment 02
1. Caching works and is defensible with graceful degradation (5 pts)

Strong. Cache-aside on reads, write-through on writes, both correctly implemented:

GET checks cache → miss falls to SQLite → repopulates cache (app.js)
PUT writes to SQLite first, then immediately overwrites the cache — this is exactly right for avoiding stale surge multipliers (the assignment's #3 requirement)
Redis failures are caught at every call site in cache.js (get, set, invalidate all try/catch) and degrade to connected = false rather than throwing
The ready event handler self-healing connected back to true on reconnect is a nice touch — many student implementations only handle the initial connect and never recover

One real gap: there's a TTL (EX: TTL_SECONDS, 60s) on the Redis key, but no test exercises TTL expiry — only explicit invalidation via write-through. If Redis is up and 60 seconds pass without a write, does the next GET correctly treat it as a cache miss and refetch from SQLite? Almost certainly yes, since client.get() returns null after expiry, but it's untested. A note in the README about why TTL exists as a second line of defense (in case an update path is ever added that bypasses the write-through invalidation) would strengthen the "defensible" part of this criterion.

Minor: invalidate() is defined in cache.js and exposed in the fake cache, but never called anywhere in app.js. Either remove it as dead code or note in the README what it's for (e.g., admin/ops tooling later).

2. Follows microservices principles (2 pts)

Good. Own SQLite file, own Redis key namespace (metadata:current), no calls into any other service's store, reachable only via the gateway per your earlier session. API-only boundary is respected — nothing here reaches into Wallet/Drivers/Tracking's data.

3. Unit tests (2 pts)

Good, and correctly avoids the live-Redis deduction. createFakeCache is a genuine in-memory fake, not a real client — satisfies the assignment's explicit "-2 for tests on a live Redis instance" rule. Six tests cover: health/connection status, cache miss+populate, cache hit, degraded-mode fallback, write-through invalidation, and payload validation. That's solid coverage of the core cache-aside/write-through contract.

Gap: no test for a malformed/missing surgeActive alone (only baseFare is tested as invalid), and no test verifying updatedAt actually changes on PUT. Neither is critical, but worth a line or two if you have time.

4. Documentation (1 pt) 

Matches the actual code exactly. Every claim I can verify against app.js/cache.js/db.js is true: cache-aside on GET, write-through on PUT, connected flag gating cache reads, ready event self-healing, 60s TTL, SQLite as source of truth. Nothing oversold.
The surge-staleness explanation is genuinely good — explicitly reasoning about why TTL alone isn't sufficient and why write-through closes that gap is exactly the kind of design justification the assignment is asking for, not just a description of what the code does.
Stack justification paragraph does the required thing: names the choice (Node/Express, SQLite, redis client) and defends it in one paragraph, same as Wallet/Drivers/Tracking's READMEs.
Small honesty gap: "Verified end-to-end" in the surge section is a claim about manual testing, but there's no test in app.test.js asserting a GET immediately after a PUT returns the new value from cache in the same request cycle (the write-through test checks cache._peek() directly, not via a follow-up GET). Either add that as an actual test, or soften the wording to "manually verified via curl" since that's what actually happened (per your terminal session) rather than implying it's covered by the automated suite.
Minor: the README doesn't mention invalidate() existing in cache.js as dead/unused code — not required, but since the doc is otherwise very precise, a one-line note would keep it fully accurate.

Automatic deductions — checked
Touching another service's DB: not observed, no violation
Tests against live Redis: not observed — fake cache confirmed, no violation
Not reachable via gateway: not observed — your manual testing in the earlier session confirmed GET/PUT through localhost:8080/api/metadata/ work