/**
 * Tests — Lusha Enrichment Runner × Observe-Only Routing Wiring
 * (Agente 2A, Hito 17B.4X.7C.4C)
 *
 * executeContactEnrichmentLushaRun talks to Supabase/Lusha directly (no DI
 * seam like the Apollo runner), so full success-path mocking would require
 * mocking @supabase/supabase-js + the Lusha client end-to-end — out of scope
 * for this hito. Instead this suite combines:
 *  - a behavioral test for the ONE branch that's reachable without any
 *    mocking (missing credentials — mirrors the existing 17B.4L test
 *    pattern) to prove scenario F holds for Lusha too, and
 *  - structural/static-source checks proving: every wiring call site passes
 *    actualProvider: 'lusha' (manual-Lusha routing math itself is already
 *    covered by routing-observation-wiring.test.ts scenario E/E2), the
 *    credential/disabled/invalid-context branches never call the wiring
 *    helper, and the Lusha runner never imports the Apollo runner (no
 *    automatic cross-provider call is even structurally possible).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { executeContactEnrichmentLushaRun } from '../lusha-enrichment-runner';

const RUN_ID = 'test-run-17b4x7c4c-001';
const TRIGGERED_BY = 'user-17b4x7c4c';

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {
    ENABLE_LUSHA_CONTACT_ENRICHMENT: process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
  };
});

afterEach(() => {
  for (const [key, val] of Object.entries(envSnapshot)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

describe('executeContactEnrichmentLushaRun × routing observation (17B.4X.7C.4C)', () => {
  it('F — missing credentials (no real Lusha call attempted): result carries no routing/fallback claim', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];

    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);

    assert.equal(result.status, 'missing_api_key');
    assert.equal(result.candidatesCreated, 0);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('would_recommend_fallback'), 'result must not fabricate a routing observation');
    assert.ok(!serialized.includes('routing_mode'));
  });
});

describe('Lusha routing wiring — structural checks', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'lusha-enrichment-runner.ts'),
    'utf8',
  );

  it('never imports the Apollo runner (no automatic cross-provider call is possible)', () => {
    assert.equal(source.includes('apollo-enrichment-runner'), false);
    assert.equal(/apollo-people-adapter/.test(source), false);
  });

  it('never creates a second attempt', () => {
    assert.equal(/attempt_order:\s*2\b/.test(source), false);
  });

  it('every buildRoutingObservation call site in this file passes actualProvider: \'lusha\'', () => {
    const callSites = source.split('buildRoutingObservation({').length - 1;
    assert.equal(callSites, 6, 'expected exactly 6 wiring call sites (2 discovery modes × error/zero/success)');
    // Each call site's actualProvider literal must be 'lusha' — never 'apollo'
    // (this file never calls Apollo, so it must never claim to observe one).
    const blocks = source.split('buildRoutingObservation({').slice(1);
    for (const block of blocks) {
      const head = block.slice(0, 300);
      assert.match(head, /actualProvider:\s*'lusha'/);
    }
  });

  it('missing_api_key / disabled / invalid_account / invalid_search_context branches never call the wiring helper', () => {
    // These are the only branches where no real Lusha API call happens.
    // Cutting the source at each such literal and checking the immediate
    // vicinity (up to the next status update) never mentions
    // buildRoutingObservation keeps this honest without re-parsing the AST.
    const forbiddenNeighborhoods = [
      "status: 'disabled'",
      "status: 'missing_api_key'",
      "error: 'account_not_found'",
      "error: 'account_archived'",
      "error: 'invalid_search_context'",
    ];
    for (const needle of forbiddenNeighborhoods) {
      const idx = source.indexOf(needle);
      assert.ok(idx >= 0, `expected to find literal: ${needle}`);
      const windowText = source.slice(Math.max(0, idx - 400), idx + 400);
      assert.equal(
        windowText.includes('buildRoutingObservation'),
        false,
        `branch near "${needle}" must not call buildRoutingObservation — no real provider call happened here`,
      );
    }
  });
});
