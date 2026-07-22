/**
 * Tests — EC-SCVS-11-PRETOOL — Controlled pilot allowlist runner
 *
 * Two layers, both fully offline (fake Supabase + registry stub — no network,
 * no snapshot, no provider, no production):
 *
 *   A) Helper allowlist guards on `enrichEcBatchWithValidatedSources`.
 *   B) Runner core (`ec-scvs-controlled-pilot`) argument/decision/orchestration
 *      guards, plus static safety scans on the runner core + CLI + helper source.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  enrichEcBatchWithValidatedSources,
  summarizeEcScvsControlledRun,
  type EcBatchValidatedSourceEnrichmentResult,
} from '../enrich-ec-batch-with-validated-sources';
import { ENRICHMENT_ADAPTER_REGISTRY } from '../enrichment-adapter-registry';
import type { SourceEnrichmentAdapter, SourceEnrichmentOutput } from '../types';
import {
  parseEcScvsControlledPilotArgs,
  decideEcScvsControlledPilot,
  resolveSupabaseProjectRef,
  runEcScvsControlledPilot,
  EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE,
  EC_SCVS_EXPECTED_PROJECT_REF,
  EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES,
} from '../ec-scvs-controlled-pilot';

// ── Fake Supabase (captures updates; select is allowlist-agnostic) ──────────────

interface CapturedUpdate {
  id: unknown;
  metadata: Record<string, unknown>;
}

function makeFakeSupabase(candidates: Array<Record<string, unknown>>) {
  const updates: CapturedUpdate[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: candidates, error: null });
            },
          };
        },
        update(payload: { metadata: Record<string, unknown> }) {
          return {
            eq(_col: string, val: unknown) {
              updates.push({ id: val, metadata: payload.metadata });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return {
    client: client as unknown as Parameters<typeof enrichEcBatchWithValidatedSources>[0],
    updates,
  };
}

// ── Registry stub (offline: never touches snapshot/network) ─────────────────────

const originalEcAdapter = ENRICHMENT_ADAPTER_REGISTRY.ec_scvs;

function stubEcAdapter(fn: () => Promise<SourceEnrichmentOutput> | SourceEnrichmentOutput) {
  const stub: SourceEnrichmentAdapter = {
    sourceKey: 'ec_scvs',
    supportedCapabilities: ['enrichment_after_discovery'],
    async enrichCandidate() {
      return fn();
    },
  };
  ENRICHMENT_ADAPTER_REGISTRY.ec_scvs = stub;
}

function stubMatched() {
  stubEcAdapter(() => ({
    sourceKey: 'ec_scvs',
    status: 'matched',
    matchedBy: null,
    confidence: 1,
    sourceYear: 2026,
    priorityBoost: 0,
    signals: { record_identity_key: 'expediente:EC:redacted', expediente_found: true },
  }));
}

afterEach(() => {
  ENRICHMENT_ADAPTER_REGISTRY.ec_scvs = originalEcAdapter;
});

const FULL_RUC = '0990012345001';

function ecCandidate(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Empresa ${id}`,
    legal_name: null,
    country_code: 'EC',
    tax_identifier: FULL_RUC,
    sector_description: null,
    metadata: {},
    ...extra,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A) Helper allowlist guards
// ════════════════════════════════════════════════════════════════════════════

describe('EC-SCVS-11-PRETOOL — helper allowlist', () => {
  it('1. without candidateIds preserves current full-batch behavior', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1'), ecCandidate('c2')]);

    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1');

    assert.equal(result.allowlistApplied, false);
    assert.equal(result.dryRun, false);
    assert.equal(updates.length, 2, 'both candidates written when no allowlist');
    assert.equal(result.updatedCount, 2);
  });

  it('2. with candidateIds processes ONLY the requested ids', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1'), ecCandidate('c2'), ecCandidate('c3')]);

    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c2'],
    });

    assert.equal(result.allowlistApplied, true);
    assert.equal(result.selectedCount, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, 'c2');
  });

  it('3. rejects an empty allowlist (fail-closed, no writes)', async () => {
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', { candidateIds: [] });

    assert.equal(result.aborted, true);
    assert.ok(result.errors.includes('empty_allowlist'));
    assert.equal(updates.length, 0);
  });

  it('4. rejects more than the strict maximum', async () => {
    const { client, updates } = makeFakeSupabase([
      ecCandidate('c1'), ecCandidate('c2'), ecCandidate('c3'),
      ecCandidate('c4'), ecCandidate('c5'), ecCandidate('c6'),
    ]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
    });

    assert.equal(result.aborted, true);
    assert.ok(result.errors.some((e) => e.startsWith('candidate_count_exceeds_max')));
    assert.equal(updates.length, 0);
  });

  it('5. rejects duplicate candidate ids', async () => {
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c1', 'c1'],
    });

    assert.equal(result.aborted, true);
    assert.ok(result.errors.includes('duplicate_candidate_ids'));
    assert.equal(updates.length, 0);
  });

  it('6. rejects a requested id that is not present in the batch', async () => {
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c1', 'cX'],
    });

    assert.equal(result.aborted, true);
    assert.ok(result.errors.some((e) => e.startsWith('allowlist_ids_not_in_batch')));
    assert.equal(updates.length, 0);
  });

  it('7. rejects a non-EC candidate under requireEcCountry', async () => {
    const { client, updates } = makeFakeSupabase([ecCandidate('c1', { country_code: 'CO' })]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c1'],
      requireEcCountry: true,
    });

    assert.equal(result.aborted, true);
    assert.equal(result.guardRejectedCount, 1);
    assert.ok(result.errors.some((e) => e.startsWith('non_ec_candidates_rejected')));
    assert.equal(updates.length, 0);
  });

  it('8. dryRun=true computes results but issues NO update', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c1'],
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.matchedCount, 1, 'still computed');
    assert.equal(result.updatedCount, 0);
    assert.equal(updates.length, 0, 'no write in dry-run');
  });

  it('9. dryRun=false writes ONLY the expected allowlisted ids', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1'), ecCandidate('c2')]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', {
      candidateIds: ['c1'],
      dryRun: false,
    });

    assert.equal(result.updatedCount, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, 'c1');
  });

  it('10. never selects or processes candidates outside the allowlist', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1'), ecCandidate('c2'), ecCandidate('c3')]);
    await enrichEcBatchWithValidatedSources(client, 'batch-1', { candidateIds: ['c2'] });

    assert.deepEqual(updates.map((u) => u.id), ['c2']);
  });

  it('11. never exposes raw_data in persisted metadata', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    await enrichEcBatchWithValidatedSources(client, 'batch-1', { candidateIds: ['c1'] });

    assert.ok(!JSON.stringify(updates[0].metadata).includes('raw_data'));
  });

  it('12. never persists the full RUC in metadata', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    await enrichEcBatchWithValidatedSources(client, 'batch-1', { candidateIds: ['c1'] });

    assert.ok(
      !JSON.stringify(updates[0].metadata).includes(FULL_RUC),
      'full RUC must never appear in persisted metadata',
    );
  });

  it('13. adapter error is fail-soft and the summary sanitizes/truncates errors', async () => {
    stubEcAdapter(() => {
      throw new Error('boom');
    });
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    // Must resolve, never reject
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-1', { candidateIds: ['c1'] });
    assert.equal(result.errorCount, 1);
    // Writes still happen fail-soft (status=error persisted), but no throw.
    assert.equal(updates.length, 1);

    // Sanitized truncation via the summary helper.
    const longErr = 'x'.repeat(500);
    const fake = { ...result, errors: [longErr] } as EcBatchValidatedSourceEnrichmentResult;
    const summary = summarizeEcScvsControlledRun('batch-1', 1, fake);
    assert.ok(summary.errors[0].length <= 201);
    assert.ok(summary.errors[0].endsWith('…'));
    assert.ok(!JSON.stringify(summary).includes(FULL_RUC));
    assert.ok(!JSON.stringify(summary).includes('raw_data'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B) Runner core — args / decision / orchestration
// ════════════════════════════════════════════════════════════════════════════

describe('EC-SCVS-11-PRETOOL — runner arg parsing & decision', () => {
  it('parses batch-id, candidate-ids, execute, confirm', () => {
    const args = parseEcScvsControlledPilotArgs([
      '--batch-id', 'b1',
      '--candidate-ids', 'c1, c2 ,c3',
      '--execute',
      '--confirm', EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE,
    ]);
    assert.equal(args.batchId, 'b1');
    assert.deepEqual(args.candidateIds, ['c1', 'c2', 'c3']);
    assert.equal(args.execute, true);
    assert.equal(args.confirm, EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE);
  });

  it('throws on any forbidden bypass flag', () => {
    for (const flag of ['--force', '--yes', '--unsafe', '--full-generation']) {
      assert.throws(() => parseEcScvsControlledPilotArgs(['--batch-id', 'b', flag]));
    }
  });

  const okRef = { projectRef: EC_SCVS_EXPECTED_PROJECT_REF };

  it('1. rejects --execute without confirmation', () => {
    const d = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: null },
      okRef,
    );
    assert.equal(d.ok, false);
    assert.equal(d.willWrite, false);
    assert.equal(d.code, 'confirmation_required');
  });

  it('2. rejects an incorrect confirmation phrase', () => {
    const d = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: 'nope' },
      okRef,
    );
    assert.equal(d.ok, false);
    assert.equal(d.code, 'confirmation_required');
  });

  it('rejects a write to an unexpected project ref', () => {
    const d = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE },
      { projectRef: 'some-other-ref' },
    );
    assert.equal(d.ok, false);
    assert.equal(d.code, 'ambiguous_project_ref');
  });

  it('3. rejects more than the maximum number of ids', () => {
    const many = Array.from({ length: EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES + 1 }, (_, i) => `c${i}`);
    const d = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: many, execute: false, confirm: null },
      okRef,
    );
    assert.equal(d.ok, false);
    assert.equal(d.code, 'too_many_candidate_ids');
  });

  it('4. rejects duplicate ids', () => {
    const d = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1', 'c1'], execute: false, confirm: null },
      okRef,
    );
    assert.equal(d.ok, false);
    assert.equal(d.code, 'duplicate_candidate_ids');
  });

  it('rejects an empty allowlist and a missing batch id', () => {
    assert.equal(
      decideEcScvsControlledPilot({ batchId: 'b1', candidateIds: [], execute: false, confirm: null }, okRef).code,
      'empty_candidate_ids',
    );
    assert.equal(
      decideEcScvsControlledPilot({ batchId: '', candidateIds: ['c1'], execute: false, confirm: null }, okRef).code,
      'missing_batch_id',
    );
  });

  it('permits dry-run with a well-formed allowlist and permits a fully-confirmed write', () => {
    const dry = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: false, confirm: null },
      okRef,
    );
    assert.deepEqual([dry.ok, dry.willWrite], [true, false]);

    const write = decideEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE },
      okRef,
    );
    assert.deepEqual([write.ok, write.willWrite], [true, true]);
  });

  it('resolveSupabaseProjectRef extracts the ref and fails closed on junk', () => {
    assert.equal(
      resolveSupabaseProjectRef(`https://${EC_SCVS_EXPECTED_PROJECT_REF}.supabase.co`),
      EC_SCVS_EXPECTED_PROJECT_REF,
    );
    assert.equal(resolveSupabaseProjectRef('http://localhost:54321'), null);
    assert.equal(resolveSupabaseProjectRef(null), null);
  });
});

describe('EC-SCVS-11-PRETOOL — runner orchestration (fake client)', () => {
  const okRef = EC_SCVS_EXPECTED_PROJECT_REF;

  it('refuses --execute without confirmation and never creates a client', async () => {
    let created = 0;
    const out = await runEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: null },
      {
        createSupabaseClient: () => {
          created++;
          return makeFakeSupabase([ecCandidate('c1')]).client;
        },
        projectRef: okRef,
      },
    );
    assert.equal(out.refused, true);
    assert.equal(out.code, 'confirmation_required');
    assert.equal(created, 0, 'no client created on refusal');
  });

  it('5/6. refuses a non-EC candidate (helper guard aborts) with no write', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1', { country_code: 'CO' })]);
    const out = await runEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE },
      { createSupabaseClient: () => client, projectRef: okRef },
    );
    assert.equal(out.refused, true);
    assert.equal(out.code, 'enrichment_guard_aborted');
    assert.equal(updates.length, 0);
  });

  it('7. dry-run does not write', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1')]);
    const out = await runEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: false, confirm: null },
      { createSupabaseClient: () => client, projectRef: okRef },
    );
    assert.equal(out.ok, true);
    assert.equal(out.dryRun, true);
    assert.equal(updates.length, 0);
    assert.equal(out.summary?.updated_candidate_count, 0);
  });

  it('8. execute delegates to the helper with the explicit allowlist', async () => {
    stubMatched();
    const { client, updates } = makeFakeSupabase([ecCandidate('c1'), ecCandidate('c2')]);
    const out = await runEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: true, confirm: EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE },
      { createSupabaseClient: () => client, projectRef: okRef },
    );
    assert.equal(out.ok, true);
    assert.equal(out.willWrite, true);
    assert.deepEqual(updates.map((u) => u.id), ['c1'], 'only the allowlisted id is written');
  });

  it('9. the outcome summary is sanitized (no full RUC, no raw_data)', async () => {
    stubMatched();
    const { client } = makeFakeSupabase([ecCandidate('c1')]);
    const out = await runEcScvsControlledPilot(
      { batchId: 'b1', candidateIds: ['c1'], execute: false, confirm: null },
      { createSupabaseClient: () => client, projectRef: okRef },
    );
    const serialized = JSON.stringify(out.summary);
    assert.ok(!serialized.includes(FULL_RUC));
    assert.ok(!serialized.includes('raw_data'));
    assert.equal(out.summary?.batch_id, 'b1');
    assert.equal(out.summary?.requested_candidate_count, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Static safety guards on source (no providers / no full generation / no db push)
// ════════════════════════════════════════════════════════════════════════════

describe('EC-SCVS-11-PRETOOL — static safety guards', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coreSrc = readFileSync(path.resolve(here, '../ec-scvs-controlled-pilot.ts'), 'utf8');
  const helperSrc = readFileSync(path.resolve(here, '../enrich-ec-batch-with-validated-sources.ts'), 'utf8');
  const cliSrc = readFileSync(
    path.resolve(here, '../../../../../scripts/source-catalog/run-ec-scvs-controlled-pilot.ts'),
    'utf8',
  );

  const FORBIDDEN_PROVIDERS = /apollo|lusha|hubspot|slack|sales.?navigator|axios|node-fetch/i;

  it('runner core imports ONLY the approved enrichment entrypoint (no providers)', () => {
    assert.ok(coreSrc.includes('enrichEcBatchWithValidatedSources'));
    const imports = coreSrc.split('\n').filter((l) => l.trim().startsWith('import'));
    for (const line of imports) {
      assert.ok(!FORBIDDEN_PROVIDERS.test(line), `unexpected provider import: ${line}`);
      assert.ok(!/prospect-generation/.test(line), `must not import prospect-generation: ${line}`);
    }
  });

  it('runner core does not call full prospect generation or db migrations', () => {
    // Prose may mention prospect-generation to explain what it must NOT do; assert
    // on actual invocations/imports instead of comment text.
    assert.ok(!/\bgenerateProspects\s*\(|\brunProspectGeneration\s*\(/.test(coreSrc));
    assert.ok(!/from ['"][^'"]*prospect-generation/.test(coreSrc), 'no prospect-generation import');
    assert.ok(!/apply_migration|dbPush|db\s+push|createBranch/.test(coreSrc));
  });

  it('runner core pins the strict max, exact phrase and expected project ref', () => {
    assert.ok(coreSrc.includes('EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES = 5'));
    assert.ok(coreSrc.includes("'EC-SCVS CONTROLLED LIVE PILOT APROBADO'"));
    assert.ok(coreSrc.includes("'lrdruowtadwbdulndlph'"));
  });

  it('CLI never imports prospect-generation or providers, and guards its entry point', () => {
    const cliImports = cliSrc.split('\n').filter((l) => l.trim().startsWith('import'));
    for (const line of cliImports) {
      assert.ok(!FORBIDDEN_PROVIDERS.test(line), `unexpected provider import in CLI: ${line}`);
      assert.ok(!/prospect-generation/.test(line), `CLI must not import prospect-generation: ${line}`);
    }
    // Delegates only to the approved entrypoint (via the core) and guards main().
    assert.ok(cliSrc.includes('runEcScvsControlledPilot'));
    assert.ok(cliSrc.includes("callerFile.includes('run-ec-scvs-controlled-pilot')"));
  });

  it('helper never persists raw_data and stays EC-only', () => {
    assert.ok(!helperSrc.includes("'raw_data'") && !helperSrc.includes('"raw_data"'));
    assert.ok(helperSrc.includes("EC_COUNTRY_CODE = 'EC'"));
  });
});
