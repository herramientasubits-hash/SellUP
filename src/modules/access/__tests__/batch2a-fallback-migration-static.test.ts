// Static source-inspection tests for 17B.4X.7C.5D.3B (Batch 2A Access Scope
// Supabase fallback migration). Reads the 2 migrated files as plain text —
// no dynamic import, no network — and asserts each one:
//   - no longer contains the hardcoded production Supabase URL
//   - no longer contains the `NEXT_PUBLIC_SUPABASE_URL ||` / `??` fallback
//     pattern
//   - imports and uses createSupabaseAdminClient() from src/lib/supabase/admin
//
// Both files transitively call createClient() from '@/lib/supabase/server'
// (next/headers cookies()) via resolveCommercialScope() / resolveCurrentUserRow(),
// so they cannot be invoked directly under `node --test` — same limitation
// documented in src/lib/supabase/__tests__/batch1-fallback-migration-static.test.ts
// and src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts.
// Behavioral coverage of the scope/visibility rules themselves lives in
// commercial-scope-logic.test.ts (pure helpers), which this migration does not touch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

const BATCH2A_FILES = [
  'src/modules/access/commercial-scope.ts',
  'src/modules/access/commercial-scope-filter-options.ts',
];

const PRODUCTION_HOST = 'lrdruowtadwbdulndlph.supabase.co';

describe('17B.4X.7C.5D.3B — Batch 2A files no longer hardcode a Supabase fallback', () => {
  for (const relPath of BATCH2A_FILES) {
    const source = readFileSync(path.join(repoRoot, relPath), 'utf8');

    it(`${relPath} does not contain the hardcoded production host`, () => {
      assert.equal(source.includes(PRODUCTION_HOST), false);
    });

    it(`${relPath} does not contain the NEXT_PUBLIC_SUPABASE_URL || fallback pattern`, () => {
      assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\|\|/);
    });

    it(`${relPath} does not contain the NEXT_PUBLIC_SUPABASE_URL ?? fallback pattern`, () => {
      assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\?\?/);
    });

    it(`${relPath} does not read SUPABASE_SERVICE_ROLE_KEY directly (guard owns that read)`, () => {
      assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
    });

    it(`${relPath} imports createSupabaseAdminClient from @/lib/supabase/admin`, () => {
      assert.match(
        source,
        /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
      );
    });

    it(`${relPath} calls createSupabaseAdminClient()`, () => {
      assert.match(source, /createSupabaseAdminClient\(\)/);
    });

    it(`${relPath} no longer imports createClient directly from @supabase/supabase-js as an admin factory`, () => {
      assert.doesNotMatch(source, /createClient as createAdminClient/);
    });
  }
});

describe('17B.4X.7C.5D.3B — commercial-scope.ts preserves its visibility contract', () => {
  const source = readFileSync(
    path.join(repoRoot, 'src/modules/access/commercial-scope.ts'),
    'utf8',
  );

  it('still resolves admin / self / team scope reasons unchanged', () => {
    assert.match(source, /scopeReason:\s*'admin'/);
    assert.match(source, /scopeReason:\s*'self'/);
    assert.match(source, /scopeReason:\s*hasRealScope/);
    assert.match(source, /'team_group_and_reports'/);
    assert.match(source, /'team_without_scope_fallback_self'/);
  });

  it('still exports resolveCommercialScope', () => {
    assert.match(source, /export async function resolveCommercialScope\(/);
  });
});

describe('17B.4X.7C.5D.3B — commercial-scope-filter-options.ts preserves its options shape', () => {
  const source = readFileSync(
    path.join(repoRoot, 'src/modules/access/commercial-scope-filter-options.ts'),
    'utf8',
  );

  it('still exports resolveScopeOwnerFilter and getCommercialScopeFilterOptions', () => {
    assert.match(source, /export async function resolveScopeOwnerFilter\(/);
    assert.match(source, /export async function getCommercialScopeFilterOptions\(/);
  });

  it('still exports EMPTY_SCOPE_FILTER_OPTIONS and the same option interfaces', () => {
    assert.match(source, /export const EMPTY_SCOPE_FILTER_OPTIONS/);
    assert.match(source, /export interface ScopeUserOption/);
    assert.match(source, /export interface ScopeGroupOption/);
    assert.match(source, /export interface ScopeRoleOption/);
    assert.match(source, /export interface ScopeFilterOptions/);
  });
});

describe('17B.4X.7C.5D.3B — scope discipline (out-of-scope areas untouched)', () => {
  const OUT_OF_SCOPE_DIRS = [
    'src/modules/source-catalog',
    'src/server/agents/contact-enrichment-toolkit',
    'src/modules/industry-mapping',
    'src/modules/prospecting-config',
    'src/server/agents/prospecting-toolkit',
    'src/app/api/debug',
  ];

  it('none of the Batch 2A migrated files live under an out-of-scope directory', () => {
    for (const relPath of BATCH2A_FILES) {
      for (const outOfScopeDir of OUT_OF_SCOPE_DIRS) {
        assert.equal(
          relPath.startsWith(outOfScopeDir),
          false,
          `${relPath} unexpectedly falls under out-of-scope dir ${outOfScopeDir}`,
        );
      }
    }
  });
});
