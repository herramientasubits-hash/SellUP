// Static source-inspection tests for 17B.4X.7C.5D.3A (Batch 1 low-risk
// Supabase fallback migration). Reads the 4 migrated files as plain text —
// no dynamic import, no network — and asserts each one:
//   - no longer contains the hardcoded production Supabase URL
//   - no longer contains the `NEXT_PUBLIC_SUPABASE_URL ||` / `??` fallback
//     pattern
//   - imports and uses createSupabaseAdminClient() from src/lib/supabase/admin
//
// Mirrors the read-file-as-text approach already used in
// src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts
// for modules that transitively import '@/lib/supabase/server' (cookies()).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

const BATCH1_FILES = [
  'src/modules/system-status/activity-actions.ts',
  'src/modules/system-status/actions.ts',
  'src/modules/automations/actions.ts',
  'src/app/api/debug/ai-provider-health/route.ts',
];

const PRODUCTION_HOST = 'lrdruowtadwbdulndlph.supabase.co';

describe('17B.4X.7C.5D.3A — Batch 1 files no longer hardcode a Supabase fallback', () => {
  for (const relPath of BATCH1_FILES) {
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

    it(`${relPath} imports createSupabaseAdminClient from src/lib/supabase/admin`, () => {
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

describe('17B.4X.7C.5D.3A — scope discipline (out-of-scope areas untouched)', () => {
  const OUT_OF_SCOPE_DIRS = [
    'src/modules/source-catalog',
    'src/server/agents/contact-enrichment-toolkit',
    'src/modules/industry-mapping',
  ];

  it('none of the Batch 1 migrated files live under an out-of-scope directory', () => {
    for (const relPath of BATCH1_FILES) {
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
