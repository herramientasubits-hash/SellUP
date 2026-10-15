/**
 * Tests — «Proveedores de una empresa», Fase 2, ronda 2 (AGENT1-SUPPLIER-SEARCH-PUBLIC-2).
 *
 * Prod 15-10 (Alcaldía de Medellín × Tecnología, lote b9e5636b): SECOP dejó 7 nuevas
 * para revisar, pero (1) las aceptadas salían en 0 porque sólo se sumaba lo de Claude y
 * (2) Claude corrió dos rondas (US$0,50) para 2 empresas que el rescate descartó.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeSupplierSearchRun,
  resolveClaudeRoundsAfterPublic,
  SUPPLIER_SEARCH_LEG_METADATA_KEY,
  type SupplierSearchRunDeps,
  type SupplierSearchRunInput,
} from '../wizard-supplier-search';
import type { ClaudeSearchLegOutcome } from '../wizard-claude-search-leg';
import type { CompetitorBatchOutcome } from '../wizard-competitor-run';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { PublicBuyerStepOutcome } from '@/server/prospect-batches/supplier-search/public-buyer-suppliers';

const INPUT: SupplierSearchRunInput = {
  userId: 'u1',
  clientRequestId: '423e4567-e89b-12d3-a456-426614174003',
  countryCode: 'CO',
  countryName: 'Colombia',
  catalogVersion: '2.0.0',
  additionalCriteria: null,
  referenceCompanyName: 'Alcaldía de Medellín',
  catalogResolution: {
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: '2.0.0' },
    industry: { id: '223e4567-e89b-12d3-a456-426614174001', slug: 'technology', name: 'Tecnología' },
    subindustries: [],
  } as unknown as CatalogResolutionOutput,
  searchDepth: 'standard',
};

function step(written: number, withoutWebsite: number): PublicBuyerStepOutcome {
  return {
    executed: true,
    buyer: { taxId: '890905211', name: 'ALCALDIA DE MEDELLIN', matchedBy: 'exact' },
    sourceKey: 'co_secop2_buyer_suppliers',
    tableVersion: 'py-unspsc-dncp-macro-v1',
    read: 59,
    outsideIndustry: 13,
    publicEntitiesExcluded: 3,
    offered: written + withoutWebsite,
    written,
    writeFailed: false,
    recordedWithoutWebsite: withoutWebsite,
    relationships: [],
  };
}

const CLAUDE: ClaudeSearchLegOutcome = {
  executed: true,
  persistedCandidates: 1,
  completeValidCandidates: 0,
  acceptedIdentities: [],
  estimatedCostUsd: 0.25,
  proposed: 4,
  passedPreFilter: 2,
};

const ids = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

function deps(options: {
  publicStep: PublicBuyerStepOutcome;
  outcomes: CompetitorBatchOutcome[];
  publicAccepted?: string[] | null | 'absent';
  webAccepted?: string[];
}) {
  const claudeRounds: number[] = [];
  const seals: Array<{ status: string; metadata?: Record<string, unknown> | null }> = [];
  let outcomeIndex = 0;
  const d: SupplierSearchRunDeps = {
    resolveSupplierSearchEnabled: () => true,
    runPublicBuyerSuppliers: async () => options.publicStep,
    runClaudeSupplierSearch: async (input) => (claudeRounds.push(input.round ?? 0), CLAUDE),
    countCompetitorBatchOutcome: async () => options.outcomes[Math.min(outcomeIndex++, options.outcomes.length - 1)],
    rescueBatchInline: async () => true,
    listAcceptedCandidateIds: async () => options.webAccepted ?? [],
    ...(options.publicAccepted === 'absent'
      ? {}
      : { listAcceptedPublicCandidateIds: async () => options.publicAccepted as string[] | null }),
    tagPublicBuyerSuppliers: async () => 0,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    reserveSlot: async () => ({ status: 'reserved', batchId: 'b1' }),
    sealFreeOnlyBatchStatus: async (input) => {
      seals.push(input);
    },
    actionStartedAtMs: 0,
    nowMs: () => 10_000,
  };
  return { d, claudeRounds, seals };
}

const reviewable = (n: number): CompetitorBatchOutcome => ({ reviewable: n, hubspotDuplicates: 0, sellupDuplicates: 0 });

describe('1. las de compras públicas cuentan para la meta', () => {
  it('el caso de Medellín: 7 para revisar ⇒ 7 aceptadas (6 con web + 1 rescatada, sin la descartada)', async () => {
    const f = deps({ publicStep: step(7, 5), outcomes: [reviewable(7), reviewable(7)], publicAccepted: ids(7) });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 7);
    assert.equal(result.acceptedForTarget?.acceptedFreeForTarget, 7);
    assert.equal(result.status, 'success_partial');
    assert.equal(result.candidateCount, 7);
  });

  it('con 10 o más de compras públicas, la meta se cumple sin Claude', async () => {
    const f = deps({ publicStep: step(10, 0), outcomes: [reviewable(10)], publicAccepted: ids(10) });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeRounds, []);
    assert.equal(result.ok && result.status, 'success_target_reached');
    assert.equal(result.ok && result.targetReached, true);
  });

  it('sin la lectura, cuentan las escritas con web (como la capa gratuita al escribir)', async () => {
    for (const publicAccepted of ['absent', null] as const) {
      const f = deps({ publicStep: step(6, 0), outcomes: [reviewable(6)], publicAccepted });
      const result = await executeSupplierSearchRun(INPUT, f.d);
      assert.equal(result.ok && result.acceptedForTarget?.acceptedForTargetTotal, 6);
    }
  });

});

describe('2. Claude no corre si compras públicas trajo proveedores (AGENT1-SUPPLIER-SEARCH-PUBLIC-3)', () => {
  it('5 o más para revisar ⇒ Claude no corre', async () => {
    const f = deps({ publicStep: step(7, 5), outcomes: [reviewable(7)], publicAccepted: ids(7) });
    await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeRounds, []);
    const leg = f.seals[0].metadata?.[SUPPLIER_SEARCH_LEG_METADATA_KEY] as Record<string, unknown>;
    assert.equal(leg.claude_rounds_allowed, 0);
    assert.equal(leg.public_accepted, 7);
  });

  it('el caso del Ministerio de Educación: 4 con web y 8 sin web ⇒ tampoco corre', async () => {
    const f = deps({ publicStep: step(4, 8), outcomes: [reviewable(4), reviewable(5)], publicAccepted: ids(5) });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeRounds, []);
    assert.equal(result.ok && result.acceptedForTarget?.acceptedForTargetTotal, 5);
    assert.equal(result.ok && result.status, 'success_partial');
  });

  it('aunque todas salgan duplicadas, si SECOP trajo proveedores Claude no corre', async () => {
    const f = deps({ publicStep: step(3, 0), outcomes: [{ reviewable: 0, hubspotDuplicates: 3, sellupDuplicates: 0 }], publicAccepted: [] });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeRounds, []);
    assert.equal(result.ok && result.status, 'no_new_candidates');
  });

  it('si SECOP no trajo a nadie de la industria, Claude hace sus dos rondas (Fase 1)', async () => {
    const f = deps({ publicStep: step(0, 0), outcomes: [reviewable(0), reviewable(1)], publicAccepted: [] });
    await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeRounds, [0, 1]);
  });

  it('la regla', () => {
    assert.equal(resolveClaudeRoundsAfterPublic(null), 2);
    assert.equal(resolveClaudeRoundsAfterPublic({ executed: false, reason: 'not_public_entity' }), 2);
    assert.equal(resolveClaudeRoundsAfterPublic(step(0, 0)), 2);
    assert.equal(resolveClaudeRoundsAfterPublic(step(0, 1)), 0);
    assert.equal(resolveClaudeRoundsAfterPublic(step(4, 8)), 0);
  });
});
