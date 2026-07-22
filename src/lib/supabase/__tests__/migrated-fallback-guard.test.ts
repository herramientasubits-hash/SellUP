// H2 — Supabase admin env-guard anti-regression (consolidated static guard)
//
// Single protected set covering EVERY file already migrated off the inline
//   const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://<prod>.supabase.co';
//   const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
// pattern to the fail-closed createSupabaseAdminClient() factory.
//
// This test reads each migrated file as plain text (no dynamic import, no
// network) and fails if any of them REINTRODUCES a hardcoded production
// fallback. It is the anti-regression lock the H2 hito asks for: batch1 and
// batch2a static tests each guard a subset; this consolidates all migrated
// files into one set and closes the one previously-unguarded file (the
// automatic-routing orchestrator, whose existing static test only checks
// wiring, not the fallback patterns).
//
// SCOPE: only the explicitly-migrated files below are protected. The ~40
// remaining inline call sites across the codebase are intentionally NOT
// asserted here — they are tracked for incremental migration (see the
// 17B.4X.7C.5D.1 report) and would make this guard fail on already-known
// debt. Keeping the set explicit is deliberate: a new file is protected only
// once it is added here, at migration time.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// src/lib/supabase/__tests__ → up 4 → repo root
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

// The full migrated protected set (H2). Adding a file here is how it becomes
// protected — do so at the moment it is migrated to createSupabaseAdminClient().
const MIGRATED_FILES = [
  'src/modules/system-status/activity-actions.ts',
  'src/modules/system-status/actions.ts',
  'src/modules/automations/actions.ts',
  'src/app/api/debug/ai-provider-health/route.ts',
  'src/modules/access/commercial-scope.ts',
  'src/modules/access/commercial-scope-filter-options.ts',
  'src/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator.ts',
  'src/modules/ai-config/provider-ai-detail-queries.ts',
  'src/server/services/migo-connection.ts',
  'src/server/services/tavily-connection.ts',
  'src/server/services/apollo-connection.ts',
  'src/server/services/samu-connection.ts',
  'src/server/services/lusha-connection.ts',
  'src/server/services/lusha-credential-diagnostics.ts',
  'src/server/services/ai-connection.ts',
  'src/server/services/google-cse-connection.ts',
  'src/server/services/hubspot-connection.ts',
  'src/server/services/slack-connection.ts',
  'src/app/api/integrations/slack/oauth/start/route.ts',
  'src/app/api/integrations/slack/oauth/callback/route.ts',
  'src/app/auth/callback/route.ts',
  'src/app/api/integrations/google-drive/oauth/callback/route.ts',
  'src/app/api/integrations/google-drive/oauth/start/route.ts',
  'src/server/services/google-drive-connection.ts',
] as const;

const PRODUCTION_HOST = 'lrdruowtadwbdulndlph.supabase.co';

describe('H2 — migrated files never reintroduce a hardcoded Supabase fallback', () => {
  for (const relPath of MIGRATED_FILES) {
    const source = readFileSync(path.join(repoRoot, relPath), 'utf8');

    it(`${relPath} does not contain the hardcoded production host`, () => {
      assert.equal(
        source.includes(PRODUCTION_HOST),
        false,
        `${relPath} reintroduced the hardcoded production Supabase host`,
      );
    });

    it(`${relPath} does not contain the NEXT_PUBLIC_SUPABASE_URL || fallback pattern`, () => {
      assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\|\|/);
    });

    it(`${relPath} does not contain the NEXT_PUBLIC_SUPABASE_URL ?? fallback pattern`, () => {
      assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\?\?/);
    });

    it(`${relPath} does not build an admin client inline via createClient(process.env.NEXT_PUBLIC_SUPABASE_URL...)`, () => {
      assert.doesNotMatch(
        source,
        /createClient\s*\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL/,
      );
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
  }
});

describe('H2 — files drop the legacy enrichment_configuration_unavailable error', () => {
  // The pre-migration ai-connection.ts, google-cse-connection.ts, hubspot-connection.ts,
  // slack-connection.ts, the two slack OAuth route handlers, and the auth
  // callback route all threw `enrichment_configuration_unavailable` from their
  // inline getAdminSupabase(). The fail-closed factory now throws
  // UnsafeSupabaseEnvironmentError instead, so the legacy string must not
  // survive (as code or as a live throw) in any migrated file.
  const LEGACY_ERROR_FILES = [
    'src/server/services/ai-connection.ts',
    'src/server/services/google-cse-connection.ts',
    'src/server/services/hubspot-connection.ts',
    'src/server/services/slack-connection.ts',
    'src/app/api/integrations/slack/oauth/start/route.ts',
    'src/app/api/integrations/slack/oauth/callback/route.ts',
    'src/app/auth/callback/route.ts',
  ] as const;

  for (const relPath of LEGACY_ERROR_FILES) {
    it(`${relPath} does not reintroduce the enrichment_configuration_unavailable error`, () => {
      const source = readFileSync(path.join(repoRoot, relPath), 'utf8');
      assert.equal(
        source.includes('enrichment_configuration_unavailable'),
        false,
        `${relPath} must not carry the legacy enrichment_configuration_unavailable error`,
      );
    });
  }
});

describe('H2 — protected set stays explicit (allowlist discipline)', () => {
  it('has no duplicate entries', () => {
    assert.equal(new Set(MIGRATED_FILES).size, MIGRATED_FILES.length);
  });

  it('every protected file is readable at its declared path (catches renames/moves)', () => {
    for (const relPath of MIGRATED_FILES) {
      assert.doesNotThrow(
        () => readFileSync(path.join(repoRoot, relPath), 'utf8'),
        `${relPath} is no longer readable — update the protected set if it moved`,
      );
    }
  });

  it('the fail-closed factory it depends on still exists and never hardcodes a fallback host', () => {
    const admin = readFileSync(
      path.join(repoRoot, 'src/lib/supabase/admin.ts'),
      'utf8',
    );
    assert.match(admin, /export function createSupabaseAdminClient\(/);
    assert.match(admin, /getSupabaseServiceRoleEnv\(\)/);
    // The factory body must not contain the production host as a live fallback.
    // (The doc comment references the pattern it replaces, so scope the check to
    // the function body rather than the whole file.)
    const factoryBody =
      admin.slice(admin.indexOf('export function createSupabaseAdminClient('));
    assert.equal(
      factoryBody.includes(PRODUCTION_HOST),
      false,
      'createSupabaseAdminClient() body must not hardcode the production host',
    );
  });
});
