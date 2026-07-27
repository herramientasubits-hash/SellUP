/**
 * Q3F-5BB.10C1 — static-safety guard for `source-enrichment.ts`.
 *
 * Complements the layer-wide `static-safety.test.ts` with checks specific to the
 * official-source enrichment abstraction: it must stay a PURE / INJECTED module —
 * no Supabase, no env, no fetch, no provider/HubSpot clients, no DB writes
 * (including `.update(`), no migrations, no `identity_key`, and crucially no
 * import of a source-catalog runtime resolver that would auto-build a
 * service-role client (e.g. the Colombia tax-identifier resolver).
 *
 * Comments are stripped before matching so this file's own doc comments (which
 * legitimately name the forbidden things) don't trip the checks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(HERE, '..', 'source-enrichment.ts');

function readCode(p: string): string {
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const CODE = readCode(TARGET);

describe('Q3F-5BB.10C1 source-enrichment — static safety', () => {
  it('never imports a Supabase client', () => {
    assert.doesNotMatch(CODE, /supabase|createClient|createSupabaseAdminClient/i);
  });

  it('never reads process.env', () => {
    assert.doesNotMatch(CODE, /process\.env/);
  });

  it('never uses fetch / network', () => {
    assert.doesNotMatch(CODE, /\bfetch\s*\(/);
    assert.doesNotMatch(CODE, /\baxios\b|XMLHttpRequest/);
  });

  it('never imports provider runtime or HubSpot clients', () => {
    assert.doesNotMatch(CODE, /lusha-client|lusha-preview|lusha-pending-review/i);
    assert.doesNotMatch(CODE, /apollo-organization-enrichment|apollo-organizations-usage/i);
    assert.doesNotMatch(CODE, /tavily-usage-logging|web-search-tool|web-search-providers/i);
    assert.doesNotMatch(CODE, /hubspot/i);
  });

  it('never imports a source-catalog runtime resolver', () => {
    // The real CO/MX/EC resolvers build a service-role client from env; this pure
    // layer must only depend on the INJECTED OfficialSourceResolver interface.
    assert.doesNotMatch(CODE, /source-catalog/i);
    assert.doesNotMatch(CODE, /resolve-candidate-tax-identifier|enrich-candidates-with-validated-sources/i);
    assert.doesNotMatch(CODE, /tax-identifier-resolution/i);
  });

  it('never performs DB writes (insert/upsert/update/delete) or table access', () => {
    assert.doesNotMatch(CODE, /\.from\(\s*['"]/);
    assert.doesNotMatch(CODE, /\.(insert|upsert|update|delete)\s*\(/);
    assert.doesNotMatch(CODE, /supabase\s+db\s+push/i);
  });

  it('never references migrations or identity_key', () => {
    assert.doesNotMatch(CODE, /migrations?\//);
    assert.doesNotMatch(CODE, /identity_key/);
  });

  it('only imports from the intake layer itself', () => {
    const imports = [...CODE.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith('./') || spec.startsWith('../'),
        `source-enrichment.ts should only import relative intake modules, saw "${spec}"`,
      );
    }
  });
});
