/**
 * Q3F-5BB.4 — Static safety guard for the Lusha pending-review persistence.
 *
 * Source-text proofs (no DOM, no network) that the authorized scope holds. To
 * avoid flagging the files' own safety docstrings, these assertions target real
 * CODE — `import` statements and `.from('<table>')` calls — not prose:
 *   - DB writes are limited to prospect_batches + prospect_candidates.
 *   - No accounts/companies creation, no HubSpot, no enrichment/people search,
 *     no Apollo/Tavily, no provider_usage_logs, no agent_runs.
 *   - Lusha runs through the read-only `executeLushaPreview` core (page/size/
 *     credit guardrails inherited); no bespoke request builder.
 *   - No new migrations shipped with this feature.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  action: join(ROOT, 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
  core: join(ROOT, 'src/server/prospect-batches/lusha-pending-review.ts'),
};

const src = {
  action: readFileSync(FILES.action, 'utf-8'),
  core: readFileSync(FILES.core, 'utf-8'),
};

/** Import specifiers only (module paths) — safe to scan for forbidden deps. */
function importPaths(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

/** Tables referenced via the supabase query builder. */
function fromTables(source: string): string[] {
  return [...source.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]);
}

describe('Persistence action — DB writes limited to batch + candidates', () => {
  it('the query builder only touches prospect_batches and prospect_candidates', () => {
    const tables = new Set(fromTables(src.action));
    for (const table of tables) {
      assert.ok(
        table === 'prospect_batches' || table === 'prospect_candidates',
        `unexpected table access: ${table}`,
      );
    }
    assert.ok(tables.has('prospect_batches'));
    assert.ok(tables.has('prospect_candidates'));
  });

  it('never queries accounts, the audit table, provider_usage_logs, or agent_runs', () => {
    for (const s of [src.action, src.core]) {
      const tables = new Set(fromTables(s));
      assert.ok(!tables.has('accounts'));
      assert.ok(!tables.has('prospect_candidate_audit'));
      assert.ok(!tables.has('provider_usage_logs'));
      assert.ok(!tables.has('agent_runs'));
    }
  });

  it('imports no HubSpot / enrichment / Apollo / Tavily / people-search modules', () => {
    for (const s of [src.action, src.core]) {
      for (const path of importPaths(s)) {
        assert.doesNotMatch(path, /hubspot/i, `forbidden import: ${path}`);
        assert.doesNotMatch(path, /enrich/i, `forbidden import: ${path}`);
        assert.doesNotMatch(path, /apollo/i, `forbidden import: ${path}`);
        assert.doesNotMatch(path, /tavily/i, `forbidden import: ${path}`);
        assert.doesNotMatch(path, /people|contact/i, `forbidden import: ${path}`);
      }
    }
  });
});

describe('Persistence action — Lusha guardrails inherited from the preview core', () => {
  it('runs Lusha through executeLushaPreview (no bespoke request builder)', () => {
    assert.match(src.action, /executeLushaPreview/);
    assert.doesNotMatch(src.action, /buildLushaPreviewRequest/);
    assert.doesNotMatch(src.action, /pagination/);
  });

  it('uses the shared read-only search + timeout constant', () => {
    assert.match(src.action, /searchLushaCompaniesV3/);
    assert.match(src.action, /LUSHA_PREVIEW_TIMEOUT_MS/);
  });
});

describe('Pure core cannot perform I/O of its own', () => {
  it('core imports no supabase / next / http client (all writes injected)', () => {
    for (const path of importPaths(src.core)) {
      assert.doesNotMatch(path, /supabase/i, `core must not import: ${path}`);
      assert.doesNotMatch(path, /next\//, `core must not import: ${path}`);
    }
    assert.doesNotMatch(src.core, /fetch\(/);
    assert.doesNotMatch(src.core, /createClient/);
  });

  it('core exposes exactly two write deps: insertBatch + insertCandidates', () => {
    assert.match(src.core, /insertBatch:/);
    assert.match(src.core, /insertCandidates:/);
    assert.doesNotMatch(src.core, /insertAccount|insertContact|insertUsage/);
  });
});

describe('No new migrations ship with this feature', () => {
  // AGENT1-LUSHA-CI-GUARD-1 — this block used to pin the repo MAXIMUM (`max <= 97`).
  // That number never expressed the invariant: it asserted that nobody, anywhere in
  // the repo, would ever add another migration. Every unrelated feature broke it
  // (098…119: Apollo, phone reveal, macro industry catalog v2), and the only
  // available "repair" was bumping the constant by hand from a PR that had nothing
  // to do with Lusha — which is exactly what had already happened going from 096 to
  // 097, both of them unrelated features. The original comment admitted as much:
  // "this coarse pin just bounds the repo max", delegating the real proof to the
  // name-based guards below.
  //
  // The invariant worth protecting is: this Lusha feature adds no migrations of its
  // own. The documented reason it needs none is that it REUSES nullable columns that
  // already existed. That is what is checked now, without depending on the repo max:
  //   a) the three columns it persists are born in a migration at or before the
  //      feature baseline (all of them in 040_prospect_batches_foundation, inside
  //      CREATE TABLE), and
  //   b) no migration — at any number — retro-adds them via ALTER TABLE.
  //
  // Declared limit: a static guard cannot attribute AUTHORSHIP of a migration to a
  // feature. What it does pin down is this feature's schema surface (a + b) and its
  // naming vocabulary (the two guards that follow). An unrelated feature's migration
  // no longer falsifies the result, which was the actual defect.
  const FEATURE_MIGRATION_BASELINE = 97;

  /** Columns this feature persists, which by contract must already exist. */
  const REUSED_COLUMNS = ['duplicate_status', 'matched_account_id', 'matched_hubspot_company_id'];

  const migrationNumber = (file: string): number => Number.parseInt(file.slice(0, 3), 10);

  function migrationFiles(): string[] {
    return readdirSync(join(ROOT, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql') && Number.isFinite(migrationNumber(f)))
      .sort();
  }

  function migrationSql(file: string): string {
    return readFileSync(join(ROOT, 'supabase/migrations', file), 'utf-8');
  }

  it('the columns this feature persists predate its migration baseline', () => {
    for (const column of REUSED_COLUMNS) {
      const mentioning = migrationFiles().filter((f) => migrationSql(f).includes(column));
      assert.ok(mentioning.length > 0, `${column} must already exist in the schema`);
      const earliest = Math.min(...mentioning.map(migrationNumber));
      assert.ok(
        earliest <= FEATURE_MIGRATION_BASELINE,
        `${column} first appears in migration ${earliest}, after the ${FEATURE_MIGRATION_BASELINE} baseline — this feature must reuse pre-existing columns, not add them`,
      );
    }
  });

  it('no migration adds the columns this feature persists', () => {
    const offending = migrationFiles().filter((f) => {
      const sql = migrationSql(f);
      return REUSED_COLUMNS.some((column) =>
        new RegExp(`ADD\\s+COLUMN\\s+(IF\\s+NOT\\s+EXISTS\\s+)?"?${column}"?`, 'i').test(sql),
      );
    });
    assert.deepEqual(offending, [], 'this feature must not add its persisted columns via a migration');
  });

  it('no migration references a lusha pending-review schema change', () => {
    const dir = join(ROOT, 'supabase/migrations');
    const offending = readdirSync(dir).filter((f) => /pending[_-]?review/i.test(f));
    assert.deepEqual(offending, [], 'this feature must not add a pending-review migration');
  });

  it('no migration references a duplicate-parity schema change', () => {
    const dir = join(ROOT, 'supabase/migrations');
    const offending = readdirSync(dir).filter((f) => /duplicate[_-]?parity/i.test(f));
    assert.deepEqual(offending, [], 'this feature must not add a duplicate-parity migration');
  });
});

describe('Duplicate parity is wired to canonical READ-ONLY helpers (Q3F-5BB.7)', () => {
  it('the action injects the canonical SellUp+HubSpot checker + active-candidate prefetch', () => {
    assert.match(src.action, /checkCompanyDuplicate/);
    assert.match(src.action, /fetchActiveCandidatesForGuard/);
    // Wired as core deps, not a bespoke reimplementation.
    assert.match(src.action, /checkCompanyDuplicate:/);
    assert.match(src.action, /fetchActiveCandidates:/);
  });

  it('the core reuses the canonical pure active-candidate guard + toolkit types', () => {
    const paths = importPaths(src.core);
    assert.ok(paths.some((p) => /active-candidate-identity-guard/.test(p)));
    assert.match(src.core, /checkActiveCandidateDuplicate/);
    // The canonical checker is INJECTED (read-only), never imported into the pure core.
    assert.doesNotMatch(src.core, /from '@\/server\/agents\/prospecting-toolkit\/duplicate-checker'/);
  });

  it('the core no longer hardcodes duplicate_status; it derives it from the resolver', () => {
    // The persisted status flows from resolveLushaCandidateDuplicateState, not a constant.
    assert.match(src.core, /resolveLushaCandidateDuplicateState/);
    assert.match(src.core, /resolution\.dbDuplicateStatus/);
    // The old always-on 'not_performed' trace is gone.
    assert.doesNotMatch(src.core, /accountDuplicateCheck:\s*'not_performed'/);
    // Matched-id columns are populated from the resolution.
    assert.match(src.core, /matched_account_id:\s*resolution\.matchedAccountId/);
    assert.match(src.core, /matched_hubspot_company_id:\s*resolution\.matchedHubspotCompanyId/);
  });
});
