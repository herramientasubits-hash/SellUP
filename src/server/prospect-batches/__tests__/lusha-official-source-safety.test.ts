/**
 * Q3F-5BB.10C2 / AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — static safety for the
 * provider-neutral official-source resolver wiring shared by Lusha AND Apollo.
 *
 * Locks the "safe client" boundary required by 10C1/10C2:
 *   - The CO resolver (pure intake layer) NEVER builds a client / reads env / does DB.
 *   - The snapshot-query boundary is READ-ONLY (no insert/update/delete/upsert).
 *   - The wiring uses the APPROVED `createSupabaseAdminClient` factory — never an
 *     inline `createClient(process.env…)` — and only for a read.
 *
 * The wiring file moved from `lusha-official-source-resolvers.ts` to the
 * provider-neutral `official-source-resolvers.ts` (both Lusha and Apollo now
 * import the SAME factory) — this test targets the new location so the same
 * invariants keep holding for both callers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const RESOLVER = read('src/server/agents/prospect-intake/resolvers/colombia-official-source-resolver.ts');
const QUERY = read('src/server/prospect-batches/colombia-snapshot-query.ts');
const WIRING = read('src/server/prospect-batches/official-source-resolvers.ts');

/** Strip comments so forbidden-pattern checks target real CODE only. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('CO resolver is pure (no client / env / db in the intake layer)', () => {
  const c = code(RESOLVER);
  it('never builds a Supabase client or reads env', () => {
    assert.doesNotMatch(c, /createClient|createSupabaseAdminClient/);
    assert.doesNotMatch(c, /process\.env/);
    assert.doesNotMatch(c, /@supabase\/supabase-js/);
  });
  it('never accesses a table directly', () => {
    assert.doesNotMatch(c, /\.from\(\s*['"]/);
    assert.doesNotMatch(c, /\.(insert|update|delete|upsert)\s*\(/);
  });
});

describe('snapshot query boundary is READ-ONLY', () => {
  const c = code(QUERY);
  it('performs no write operations', () => {
    assert.doesNotMatch(c, /\.(insert|update|delete|upsert)\s*\(/);
  });
  it('does not build a client itself (client is injected)', () => {
    assert.doesNotMatch(c, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(c, /process\.env/);
  });
});

describe('wiring uses the approved service-role factory only', () => {
  const c = code(WIRING);
  it('uses createSupabaseAdminClient, never an inline createClient(process.env…)', () => {
    assert.match(c, /createSupabaseAdminClient\(/);
    assert.doesNotMatch(c, /createClient\s*\(\s*process\.env/);
  });
  it('performs no write operations of its own', () => {
    assert.doesNotMatch(c, /\.(insert|update|delete|upsert)\s*\(/);
    assert.doesNotMatch(c, /\.from\(\s*['"]/);
  });
});
