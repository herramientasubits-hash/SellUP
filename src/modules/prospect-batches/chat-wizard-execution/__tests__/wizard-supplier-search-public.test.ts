/**
 * Tests — «Proveedores de una empresa», Fase 2 en la corrida (AGENT1-SUPPLIER-SEARCH-PUBLIC-1):
 * compras públicas primero, Claude sólo si faltan, rescate y «Proveedor de X» al final.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeSupplierSearchRun, type SupplierSearchRunDeps, type SupplierSearchRunInput } from '../wizard-supplier-search';
import type { ClaudeSearchLegOutcome } from '../wizard-claude-search-leg';
import type { CompetitorBatchOutcome } from '../wizard-competitor-run';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  SUPPLIER_PUBLIC_BUYER_METADATA_KEY,
  type PublicBuyerStepOutcome,
} from '@/server/prospect-batches/supplier-search/public-buyer-suppliers';

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
  referenceCompanyName: 'Alcaldía de Medellín',
  catalogResolution: CATALOG,
  searchDepth: 'standard',
};

function step(written: number, withoutWebsite = 0): PublicBuyerStepOutcome {
  return {
    executed: true,
    buyer: { taxId: '890905211', name: 'ALCALDIA DE MEDELLIN', matchedBy: 'exact' },
    sourceKey: 'co_secop2_buyer_suppliers',
    tableVersion: 'py-unspsc-dncp-macro-v1',
    read: 30,
    outsideIndustry: 10,
    publicEntitiesExcluded: 2,
    offered: written + withoutWebsite,
    written,
    writeFailed: false,
    recordedWithoutWebsite: withoutWebsite,
    relationships: [{ taxId: '900092385', name: 'UNE', evidenceUrl: 'https://community.secop.gov.co/p1', evidence: 'e' }],
  };
}

const CLAUDE: ClaudeSearchLegOutcome = {
  executed: true,
  persistedCandidates: 2,
  completeValidCandidates: 0,
  acceptedIdentities: [],
  estimatedCostUsd: 0.24,
  proposed: 10,
  passedPreFilter: 2,
};

function deps(options: {
  publicStep?: () => Promise<PublicBuyerStepOutcome>;
  claude?: ClaudeSearchLegOutcome;
  outcomes?: Array<CompetitorBatchOutcome | null>;
  overrides?: Partial<SupplierSearchRunDeps>;
}) {
  const claudeCalls: number[] = [];
  const publicCalls: Array<{ macroIndustryKey: string; referenceCompanyName: string }> = [];
  const seals: Array<{ status: string; metadata?: Record<string, unknown> | null }> = [];
  const rescues: number[] = [];
  const tags: string[][] = [];
  let outcomeIndex = 0;
  const d: SupplierSearchRunDeps = {
    resolveSupplierSearchEnabled: () => true,
    runPublicBuyerSuppliers: async (input) => {
      publicCalls.push(input);
      return (options.publicStep ?? (async () => step(3)))();
    },
    runClaudeSupplierSearch: async (input) => {
      claudeCalls.push(input.round ?? 0);
      return options.claude ?? CLAUDE;
    },
    countCompetitorBatchOutcome: async () => {
      const list = options.outcomes ?? [{ reviewable: 3, hubspotDuplicates: 0, sellupDuplicates: 0 }];
      return list[Math.min(outcomeIndex++, list.length - 1)] ?? null;
    },
    rescueBatchInline: async (input) => (rescues.push(input.windowMs), true),
    listAcceptedCandidateIds: async () => ['w1'],
    listAcceptedPublicCandidateIds: async () => ['p1', 'p2'],
    tagPublicBuyerSuppliers: async (input) => (tags.push(input.relationships.map((r) => r.taxId)), 1),
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    reserveSlot: async () => ({ status: 'reserved', batchId: 'b1' }),
    sealFreeOnlyBatchStatus: async (input) => {
      seals.push(input);
    },
    actionStartedAtMs: 0,
    nowMs: () => 10_000,
    ...options.overrides,
  };
  return { d, claudeCalls, publicCalls, seals, rescues, tags };
}

describe('compras públicas en la corrida de Proveedores', () => {
  it('corren primero con la macro de la industria; con proveedores, Claude no corre', async () => {
    const f = deps({
      outcomes: [
        { reviewable: 3, hubspotDuplicates: 0, sellupDuplicates: 0 },
        { reviewable: 5, hubspotDuplicates: 0, sellupDuplicates: 0 },
      ],
    });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.publicCalls, [
      { batchId: 'b1', referenceCompanyName: 'Alcaldía de Medellín', countryCode: 'CO', macroIndustryKey: 'technology' },
    ]);
    // AGENT1-SUPPLIER-SEARCH-PUBLIC-3 — SECOP trajo proveedores ⇒ 0 rondas de Claude.
    assert.deepEqual(f.claudeCalls, []);
    assert.equal(result.ok && result.claudeSearchLeg?.executed && result.claudeSearchLeg.persistedCandidates, 3);
    assert.deepEqual(f.tags, [['900092385']]);
    // Aceptadas tras el rescate: las de compras públicas (la mitad gratuita).
    assert.equal(result.ok && result.acceptedForTarget?.acceptedForTargetTotal, 2);
    const block = f.seals[0].metadata?.[SUPPLIER_PUBLIC_BUYER_METADATA_KEY] as Record<string, unknown>;
    assert.equal(block.written, 3);
    assert.equal(block.suppliers, 1);
    assert.equal(block.tagged, 1);
    assert.equal('relationships' in block, false);
  });

  it('si ya hay 10 para revisar, Claude no corre (0 costo)', async () => {
    const f = deps({ publicStep: async () => step(10), outcomes: [{ reviewable: 10, hubspotDuplicates: 0, sellupDuplicates: 0 }] });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeCalls, []);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.candidateCount, 10);
    assert.equal(result.claudeSearchLeg?.executed && result.claudeSearchLeg.estimatedCostUsd, 0);
  });

  it('sólo sin web: el rescate corre igual y lo admitido cuenta', async () => {
    const f = deps({
      publicStep: async () => step(0, 4),
      claude: { ...CLAUDE, persistedCandidates: 0, passedPreFilter: 0 },
      // Única lectura: la de después del rescate (nada escrito antes y Claude no corre).
      outcomes: [{ reviewable: 3, hubspotDuplicates: 0, sellupDuplicates: 0 }],
    });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.claudeCalls, []);
    assert.equal(f.rescues.length, 1);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 'success_partial');
    assert.equal(result.candidateCount, 3);
    assert.equal(f.seals[0].status, 'ready_for_review');
  });

  it('si Claude falla, lo de compras públicas se queda', async () => {
    const f = deps({ claude: { executed: false, reason: 'quota_exhausted' } });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.candidateCount, 3);
  });

  it('un tropiezo en compras públicas no tumba la corrida', async () => {
    const f = deps({
      publicStep: async () => {
        throw new Error('timeout');
      },
    });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(result.ok, true);
    assert.equal(f.claudeCalls[0], 0);
    const block = f.seals[0].metadata?.[SUPPLIER_PUBLIC_BUYER_METADATA_KEY] as Record<string, unknown>;
    assert.deepEqual(block, { executed: false, reason: 'failed:timeout' });
    assert.deepEqual(f.tags, []);
  });

  it('fuera de Colombia y Chile no se consulta', async () => {
    const f = deps({});
    await executeSupplierSearchRun({ ...INPUT, countryCode: 'PE', countryName: 'Perú' }, f.d);
    assert.deepEqual(f.publicCalls, []);
    assert.equal(f.seals[0].metadata?.[SUPPLIER_PUBLIC_BUYER_METADATA_KEY], undefined);
  });

  it('Chile sí consulta (órdenes de compra de ChileCompra cargadas)', async () => {
    const f = deps({});
    await executeSupplierSearchRun({ ...INPUT, countryCode: 'CL', countryName: 'Chile' }, f.d);
    assert.equal(f.publicCalls.length, 1);
  });
});
