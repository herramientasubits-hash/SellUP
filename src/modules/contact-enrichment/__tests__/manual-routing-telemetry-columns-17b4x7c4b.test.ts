// Tests — MANUAL_ROUTING_TELEMETRY_COLUMNS (Hito 17B.4X.7C.4B)
//
// Pure value test: every attempt-creation path live today (legacy
// startContactEnrichmentRun, bulk, and the request-linked RPC) is a human
// picking a provider through the wizard — no automatic routing decision is
// ever made. This constant is the single source of truth for the labels
// that fact gets persisted as. No DB, no network.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MANUAL_ROUTING_TELEMETRY_COLUMNS } from '../request-attempt-types';

describe('MANUAL_ROUTING_TELEMETRY_COLUMNS', () => {
  it('is manual/manual/not_applicable — matches migration 091 column defaults', () => {
    assert.deepEqual(MANUAL_ROUTING_TELEMETRY_COLUMNS, {
      routing_mode: 'manual',
      provider_attempt_role: 'manual',
      fallback_reason: 'not_applicable',
    });
  });

  it('does not include routing_policy_version (no policy is evaluated for manual attempts)', () => {
    assert.ok(!('routing_policy_version' in MANUAL_ROUTING_TELEMETRY_COLUMNS));
  });
});

describe('startContactEnrichmentRun — routing telemetry wiring (static source check)', () => {
  // No live Supabase call is exercised here (startContactEnrichmentRun has no
  // injectable admin-client deps, and this hito forbids live provider/DB
  // calls in tests) — this asserts the insert call site actually spreads the
  // shared constant, so the two can't silently drift apart.
  const runnerSource = readFileSync(
    join(process.cwd(), 'src/server/agents/contact-enrichment-toolkit/contact-enrichment-runner.ts'),
    'utf-8',
  );

  it('imports MANUAL_ROUTING_TELEMETRY_COLUMNS from request-attempt-types', () => {
    assert.match(
      runnerSource,
      /import \{ MANUAL_ROUTING_TELEMETRY_COLUMNS \} from '@\/modules\/contact-enrichment\/request-attempt-types'/,
    );
  });

  it('spreads MANUAL_ROUTING_TELEMETRY_COLUMNS into the contact_enrichment_runs insert payload', () => {
    const insertBlock = runnerSource.match(
      /\.from\('contact_enrichment_runs'\)\s*\n\s*\.insert\(\{([\s\S]*?)\}\)/,
    );
    assert.ok(insertBlock, 'contact_enrichment_runs insert call not found');
    assert.ok(insertBlock![1].includes('...MANUAL_ROUTING_TELEMETRY_COLUMNS'));
  });
});
