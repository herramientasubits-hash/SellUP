/**
 * Q3F-5BB.10C3-FIX-1 — static source guards for the fail-closed routing fix.
 *
 * Source-text proofs (no DOM, no network) that the three fix layers hold:
 *   P0-1  the Prospectos panel parses ENABLE_LUSHA_PREVIEW via the canonical
 *         helper, never a bespoke `=== 'true'` comparison.
 *   P0-2  the summary UI has a dedicated blocked branch for `blocked_lusha_disabled`
 *         and the Apollo-capable "Generar prospectos" button is gated so it can
 *         never render for a blocked Lusha-eligible search.
 *   P1-3  the read-only dry-route action imports nothing that can spend (no
 *         execution action, no Lusha/Apollo/Tavily client, no DB-write helper),
 *         and the pure route module performs no I/O.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  panel: join(ROOT, 'src/components/prospects/prospects-module-panel.tsx'),
  summary: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx'),
  route: join(ROOT, 'src/modules/prospect-batches/prospect-wizard-route.ts'),
  routeAction: join(ROOT, 'src/modules/prospect-batches/prospect-wizard-route-actions.ts'),
  provider: join(ROOT, 'src/modules/prospect-batches/prospect-discovery-provider.ts'),
  criteria: join(ROOT, 'src/modules/prospect-batches/wizard-lusha-criteria.ts'),
};

const src = {
  panel: readFileSync(FILES.panel, 'utf-8'),
  summary: readFileSync(FILES.summary, 'utf-8'),
  route: readFileSync(FILES.route, 'utf-8'),
  routeAction: readFileSync(FILES.routeAction, 'utf-8'),
  provider: readFileSync(FILES.provider, 'utf-8'),
  criteria: readFileSync(FILES.criteria, 'utf-8'),
};

/** Import specifiers only (module paths). */
function importPaths(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

describe('P0-1 — panel uses the canonical Lusha flag parser', () => {
  it('reads the flag via isLushaPreviewEnabled(), not a bespoke === "true"', () => {
    assert.match(src.panel, /isLushaPreviewEnabled\(\)/);
    assert.doesNotMatch(src.panel, /ENABLE_LUSHA_PREVIEW\s*===\s*'true'/);
    assert.doesNotMatch(src.panel, /process\.env\.ENABLE_LUSHA_PREVIEW/);
  });
});

describe('P0-2 — routing is three-state and fails closed in the UI', () => {
  it('the provider decision layer exposes the blocked_lusha_disabled state', () => {
    assert.match(src.provider, /blocked_lusha_disabled/);
    // Eligibility helper exists and is flag-independent.
    assert.match(src.provider, /isProspectLushaEligible/);
  });

  it('the criteria bridge no longer collapses non-lusha into a hardcoded default_ai', () => {
    // The blocked state is forwarded verbatim (provider: decision.provider).
    assert.match(src.criteria, /provider:\s*decision\.provider/);
  });

  it('the summary has a blocked branch and gates the generate button on it', () => {
    assert.match(src.summary, /blocked_lusha_disabled/);
    assert.match(src.summary, /isLushaBlocked/);
    assert.match(src.summary, /LushaDisabledBlockedPanel/);
    // The Apollo-capable generation button is gated by !isLushaBlocked.
    assert.match(src.summary, /!useLushaFinalSearch && !isLushaBlocked && executionEnabled/);
  });

  it('the blocked panel renders no generation control (no onExecute wiring)', () => {
    // Extract the blocked panel body and prove it never calls onExecute.
    const start = src.summary.indexOf('function LushaDisabledBlockedPanel');
    assert.ok(start >= 0, 'LushaDisabledBlockedPanel must exist');
    const body = src.summary.slice(start, start + 1600);
    assert.doesNotMatch(body, /onExecute/);
    assert.doesNotMatch(body, /Generar prospectos/);
  });
});

describe('P1-3 — dry-route action cannot spend', () => {
  it('the route ACTION imports nothing that can reach a provider, execution, or DB write', () => {
    for (const path of importPaths(src.routeAction)) {
      assert.doesNotMatch(path, /apollo/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /tavily/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /hubspot/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /chat-wizard-execution/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /pending-review/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /lusha-preview-actions/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /lusha-client|lusha-company/i, `forbidden import: ${path}`);
    }
  });

  it('the route ACTION never references the execution / Lusha-run actions by name', () => {
    assert.doesNotMatch(src.routeAction, /executeProspectWizardGenerationAction/);
    assert.doesNotMatch(src.routeAction, /generateLushaPendingReviewBatchAction\s*\(/);
    assert.doesNotMatch(src.routeAction, /previewLushaCompaniesAction\s*\(/);
  });

  it('the route ACTION performs no DB write and no direct provider fetch', () => {
    assert.doesNotMatch(src.routeAction, /\.insert\(/);
    assert.doesNotMatch(src.routeAction, /\.update\(/);
    assert.doesNotMatch(src.routeAction, /\.upsert\(/);
    assert.doesNotMatch(src.routeAction, /\.delete\(/);
    assert.doesNotMatch(src.routeAction, /fetch\(/);
  });

  it('the pure route module does no I/O (no supabase / next / fetch)', () => {
    for (const path of importPaths(src.route)) {
      assert.doesNotMatch(path, /supabase/i, `route must not import: ${path}`);
      assert.doesNotMatch(path, /next\//, `route must not import: ${path}`);
    }
    assert.doesNotMatch(src.route, /fetch\(/);
    assert.doesNotMatch(src.route, /createClient/);
    assert.doesNotMatch(src.route, /process\.env/);
  });
});
