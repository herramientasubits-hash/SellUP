// Tests for src/modules/system-status/activity-actions.ts —
// 17B.4X.7C.5D.3A (Batch 1 Supabase fallback migration).
//
// activity-actions.ts transitively imports '@/lib/supabase/server', which
// uses next/headers cookies() — invoking any exported function here
// requires a live Next.js request context that does not exist under
// `node --test`. This mirrors the documented limitation in
// src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts:
// static source-inspection proves the DB-client wiring without executing
// next/headers or touching a real Supabase project.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(moduleDir, '..', 'activity-actions.ts'), 'utf8');

describe('activity-actions.ts — admin client wiring (post 17B.4X.7C.5D.3A)', () => {
  it('imports createSupabaseAdminClient from @/lib/supabase/admin', () => {
    assert.match(
      source,
      /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
    );
  });

  it('getAdminClient() delegates to createSupabaseAdminClient() with no fallback', () => {
    const start = source.indexOf('function getAdminClient()');
    assert.ok(start !== -1, 'expected to find function getAdminClient()');
    const body = source.slice(start, start + 200);
    assert.match(body, /createSupabaseAdminClient\(\)/);
  });

  it('does not contain a hardcoded Supabase project URL', () => {
    assert.equal(source.includes('lrdruowtadwbdulndlph.supabase.co'), false);
  });

  it('does not read SUPABASE_SERVICE_ROLE_KEY directly (guard owns that read)', () => {
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('getActivityViewerContext and getPlatformActivity still call getAdminClient() (public surface unchanged)', () => {
    assert.match(source, /export async function getActivityViewerContext[\s\S]*?getAdminClient\(\)/);
    assert.match(source, /export async function getPlatformActivity[\s\S]*?getAdminClient\(\)/);
  });
});
