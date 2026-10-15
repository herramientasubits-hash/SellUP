/**
 * Tests — «Proveedores de una empresa», ronda 4 (AGENT1-SUPPLIER-SEARCH-4).
 *
 * Prod 14-10: los proveedores famosos de una gran empresa ya están en HubSpot/SellUp
 * (Bancolombia: 4 de 5 duplicados) ⇒ 2.ª ronda de Claude con medianos y menos
 * conocidos, y un resultado que dice «ya las teníamos» en vez de «se generaron N».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeSupplierSearchRun,
  resolveSupplierRoundPhaseMs,
  SUPPLIER_SEARCH_LEG_METADATA_KEY,
  SUPPLIER_SEARCH_ROUND_MAX_PHASE_MS,
  type SupplierSearchRunDeps,
  type SupplierSearchRunInput,
} from '../wizard-supplier-search';
import type { ClaudeSearchLegOutcome } from '../wizard-claude-search-leg';
import type { CompetitorBatchOutcome } from '../wizard-competitor-run';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import { buildSupplierSearchQueries } from '@/server/agents/prospecting-toolkit/claude-classifier/company-search-run';

const CATALOG = {
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: '2.0.0' },
  industry: { id: '223e4567-e89b-12d3-a456-426614174001', slug: 'technology', name: 'Tecnología' },
  subindustries: [],
} as unknown as CatalogResolutionOutput;

const INPUT: SupplierSearchRunInput = {
  userId: 'u1',
  clientRequestId: '423e4567-e89b-12d3-a456-426614174003',
  countryCode: 'CO',
  countryName: 'Colombia',
  catalogVersion: '2.0.0',
  additionalCriteria: null,
  referenceCompanyName: 'Bancolombia',
  catalogResolution: CATALOG,
  searchDepth: 'standard',
};

function leg(persisted: number, accepted = 0): ClaudeSearchLegOutcome {
  return {
    executed: true,
    persistedCandidates: persisted,
    completeValidCandidates: accepted,
    acceptedIdentities: [],
    estimatedCostUsd: 0.24,
    proposed: 10,
    passedPreFilter: persisted,
  };
}

function deps(options: {
  legs: ClaudeSearchLegOutcome[];
  outcomes: Array<CompetitorBatchOutcome | null>;
  nowMs?: () => number;
}) {
  const calls: Array<{ phaseMs: number; round?: number }> = [];
  const seals: Array<{ status: string; metadata?: Record<string, unknown> | null }> = [];
  let outcomeIndex = 0;
  const d: SupplierSearchRunDeps = {
    resolveSupplierSearchEnabled: () => true,
    runClaudeSupplierSearch: async (input) => {
      calls.push({ phaseMs: input.phaseMs, round: input.round });
      return options.legs[calls.length - 1] ?? { executed: false, reason: 'no_more' };
    },
    countCompetitorBatchOutcome: async () => options.outcomes[outcomeIndex++] ?? null,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    reserveSlot: async () => ({ status: 'reserved', batchId: 'b1' }),
    sealFreeOnlyBatchStatus: async (input) => {
      seals.push(input);
    },
    actionStartedAtMs: 0,
    nowMs: options.nowMs ?? (() => 10_000),
  };
  return { d, calls, seals };
}

describe('1. segunda ronda', () => {
  it('corre si faltan nuevas para Por revisar y suma las dos rondas', async () => {
    const f = deps({
      legs: [leg(5), leg(3)],
      outcomes: [
        { reviewable: 1, hubspotDuplicates: 3, sellupDuplicates: 1 },
        { reviewable: 4, hubspotDuplicates: 3, sellupDuplicates: 1 },
      ],
    });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(
      f.calls.map((c) => c.round),
      [0, 1],
    );
    assert.equal(f.calls[0].phaseMs, SUPPLIER_SEARCH_ROUND_MAX_PHASE_MS);
    assert.equal(result.ok && result.candidateCount, 8);
    assert.equal(result.ok && result.status, 'success_partial');
    const legMeta = f.seals[0].metadata?.[SUPPLIER_SEARCH_LEG_METADATA_KEY] as { rounds: unknown[]; estimatedCostUsd: number };
    assert.equal(legMeta.rounds.length, 2);
    assert.ok(Math.abs(legMeta.estimatedCostUsd - 0.48) < 1e-9);
  });

  it('no corre si ya hay 10 para revisar', async () => {
    const f = deps({ legs: [leg(10)], outcomes: [{ reviewable: 10, hubspotDuplicates: 0, sellupDuplicates: 0 }] });
    await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(
      f.calls.map((c) => c.round),
      [0],
    );
  });

  it('no corre sin tiempo: queda anotado', async () => {
    let t = 0;
    const f = deps({
      legs: [leg(2)],
      outcomes: [{ reviewable: 2, hubspotDuplicates: 0, sellupDuplicates: 0 }],
      // 1.ª lectura (inicio) = 0; luego ya pasaron 200 s.
      nowMs: () => (t++ === 0 ? 0 : 200_000),
    });
    await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(f.calls.length, 1);
    const legMeta = f.seals[0].metadata?.[SUPPLIER_SEARCH_LEG_METADATA_KEY] as { rounds: Array<{ outcome: { reason?: string } }> };
    assert.equal(legMeta.rounds[1].outcome.reason, 'not_enough_time');
  });

  it('una 2.ª ronda que falla no tumba lo de la primera', async () => {
    const f = deps({
      legs: [leg(3), { executed: false, reason: 'search_failed' }],
      outcomes: [{ reviewable: 3, hubspotDuplicates: 0, sellupDuplicates: 0 }],
    });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(result.ok && result.candidateCount, 3);
  });

  it('tiempo por ronda: 110 s como mucho, nunca dentro de los últimos 150 s', () => {
    assert.equal(resolveSupplierRoundPhaseMs(0), 110_000);
    assert.equal(resolveSupplierRoundPhaseMs(80_000), 70_000);
    assert.equal(resolveSupplierRoundPhaseMs(110_000), null);
  });
});

describe('2. resultado honesto', () => {
  it('todo duplicado ⇒ «sin empresas nuevas» con la causa', async () => {
    const f = deps({
      legs: [leg(4), leg(1)],
      outcomes: [
        { reviewable: 0, hubspotDuplicates: 3, sellupDuplicates: 1 },
        { reviewable: 0, hubspotDuplicates: 4, sellupDuplicates: 1 },
      ],
    });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 'no_new_candidates');
    assert.equal(result.noNewCandidatesBreakdown?.hubspotDuplicateCount, 4);
    assert.equal(result.noNewCandidatesBreakdown?.sellupDuplicateCount, 1);
  });
});

describe('3. consultas de la ronda 2', () => {
  it('piden medianos y menos conocidos; la ronda 1 sigue con las medidas', () => {
    const source = { country: 'Colombia', industry: 'Tecnología', subindustries: [] };
    assert.deepEqual(buildSupplierSearchQueries(source, 'Bancolombia'), [
      'empresas de Tecnología que son proveedores de Bancolombia en Colombia',
      'Bancolombia cliente caso de éxito Tecnología Colombia',
    ]);
    const second = buildSupplierSearchQueries(source, 'Bancolombia', 1);
    assert.equal(second.length, 2);
    assert.match(second[0], /empresas medianas de Tecnología que son proveedores de Bancolombia en Colombia/);
    assert.match(second[1], /menos conocida/);
  });
});
