// Q3F-5AY.7B — /ai-usage freshness regression (static scan, no live render).
//
// The Q3F-5AY.7 backfill populated prospect_candidates.record_origin in the DB
// with no code deploy. The read model resolves persisted classification
// correctly (see clean-production.test.ts §13–15), but the /ai-usage route was
// serving a stale cached render, so the panel showed Persistido 0 / Derivado
// 182 instead of 166 / 16. The fix forces the route dynamic + no-store so live
// admin reads are always reflected. This test locks that in so a future refactor
// cannot silently reintroduce caching on this surface.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_SRC = readFileSync(
  join(HERE, '..', '..', '..', 'app', '(sellup)', 'ai-usage', 'page.tsx'),
  'utf8',
);

describe('Q3F-5AY.7B — /ai-usage stays fresh for live admin reads', () => {
  it('declares the force-dynamic route segment config', () => {
    assert.ok(
      /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(PAGE_SRC),
      'ai-usage/page.tsx must export `const dynamic = \'force-dynamic\'` so the ' +
        'Agent 1 effectiveness panel reflects post-backfill persisted classification',
    );
  });
});
