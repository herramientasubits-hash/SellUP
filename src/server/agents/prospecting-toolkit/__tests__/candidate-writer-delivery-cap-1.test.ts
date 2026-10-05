/**
 * AGENT1-DELIVERY-CAP-1 — el writer de Apollo/Tavily entrega como MÁXIMO
 * `maxDeliveredCandidates` empresas por escritura, COMPLETAS PRIMERO.
 *
 * Decisión de la dueña («opción B»): lo que no cabe NO se persiste y, por tanto,
 * NO reclama la empresa para este vendedor. X6.13 sigue vigente para lo demás:
 * sin el tope, todo lo elegible se escribe.
 *
 * Lo que esta suite demuestra contra `writeProspectingCandidates` REAL (sin
 * reimplementar la regla en un doble):
 *
 *   (a) 12 elegibles + tope 10 ⇒ 10 filas insertadas; la metadata declara 2
 *       recortadas (`precision_gate.target_cap_exclusions`,
 *       `target_cap.delivery_cap`, `target_cap.delivery_capped_count`).
 *   (b) COMPLETAS PRIMERO: con las completas al FINAL del orden de entrada, todas
 *       se persisten y las recortadas son incompletas.
 *   (c) sin tope (`undefined` o `null`) ⇒ las 12 se insertan (X6.13 intacto).
 *   (d) un tope por debajo del objetivo sube al objetivo (tope 3, objetivo 5 ⇒ 5).
 *
 * «Completa» = `providerEnrichmentCapture.precision` real con la subindustria
 * pedida confirmada. «Incompleta» = el MISMO candidato sin captura de precisión
 * (la ruta fail-closed del § 3 de SUBINDUSTRY-FAIL-CLOSED): sigue siendo elegible
 * y se persiste en revisión, pero no cuenta para el objetivo.
 *
 * Doble de cliente admin inyectado: sin Supabase, sin Apollo, sin Tavily, sin
 * HubSpot, sin proveedores y sin créditos.
 *
 * LIVE_APOLLO_CALLS = 0 · LIVE_TAVILY_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeProspectingCandidates } from '../candidate-writer';
import { assessApolloSubindustryPrecisionForRequest } from '../apollo-subindustry-precision';
import { captureApolloEnrichmentForPersistence } from '../apollo-enrichment-persistence-capture';
import type { CandidateWriterInput, CatalogContextResult, DeliveryCappedCompany, WebSearchResult } from '../types';
import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { buildBankPipelineOutput } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import {
  PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
  projectCandidateForBank,
  readBankPipelineCandidate,
} from '@/server/prospect-batches/company-bank/pipeline-candidate-bank-payload';

const REQUESTED_SUBINDUSTRY = 'Tiendas por Departamento, Moda y Calzado';
const USER_ID = 'aaaaaaaa-0000-0000-0000-0000000000dc';
const TARGET = 5;

const FAKE_CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

// ─── Doble de cliente admin ───────────────────────────────────────────────────

class ChainResult {
  constructor(private readonly value: unknown) {}
  eq(): ChainResult { return this; }
  neq(): ChainResult { return this; }
  in(): ChainResult { return this; }
  not(): ChainResult { return this; }
  gte(): ChainResult { return this; }
  limit(): ChainResult { return this; }
  select(): ChainResult { return this; }
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this.value).then(onFulfilled, onRejected);
  }
  single(): Promise<unknown> { return Promise.resolve(this.value); }
}

type Stats = {
  candidateInserts: Record<string, unknown>[];
  batchUpdates: Record<string, unknown>[];
};

function makeFakeAdmin(stats: Stats): SupabaseClient {
  let candidateSeq = 0;
  return {
    // CUT-3B4-CORRECCIÓN — la 126 SIN aplicar se declara como lo hace la BASE.
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(col: string) {
                if (col === 'source') return new ChainResult({ data: [], error: null });
                return { single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }) };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdates.push({ ...data });
            return new ChainResult({ error: null });
          },
          insert() {
            return {
              select() {
                return {
                  single: () => Promise.resolve({ data: { id: 'batch-delivery-cap-1' }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select() {
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInserts.push({ ...data });
            const id = `cand-delivery-cap-${++candidateSeq}`;
            return { select() { return { single: () => Promise.resolve({ data: { id }, error: null }) }; } };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === 'provider_usage_logs') {
        return { select: () => new ChainResult({ data: [], error: null }) };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Fábrica de candidatos ────────────────────────────────────────────────────

/** Nombres ASCII: el slug del dominio sintético tiene que coincidir con el nombre. */
const NAMES = [
  'Almacen Alfa', 'Almacen Beta', 'Almacen Gamma', 'Almacen Delta',
  'Almacen Epsilon', 'Almacen Zeta', 'Almacen Eta', 'Almacen Theta',
  'Almacen Iota', 'Almacen Kappa', 'Almacen Lambda', 'Almacen Omicron',
] as const;

function makeCandidate(name: string, complete: boolean) {
  const result = {
    title: name,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: { industry: 'fashion retail' },
  } as unknown as WebSearchResult;
  const precision = assessApolloSubindustryPrecisionForRequest(result, [REQUESTED_SUBINDUSTRY]);
  const capture = complete
    ? captureApolloEnrichmentForPersistence({
        result,
        precision,
        provenance: {
          sourceProvider: 'apollo',
          sourceOperation: 'organization_enrichment',
          sourceRequestId: 'organization_enrichment:batch-delivery-cap-1:test',
          observedAt: '2026-10-01T12:00:00.000Z',
        },
      })
    : null;

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const domain = `${slug}.com.co`;
  const companyLinkedInUrl = `https://www.linkedin.com/company/${slug}`;
  return {
    name,
    website: `https://www.${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: `https://www.${domain}`,
    sourceTitle: name,
    sourceSnippet: `Empresa: ${name} | País: Colombia`,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: {
      domain,
      status: 'verified' as const,
      skipped: false,
      confidence: 88,
      redirected: false,
      httpStatus: 200,
      skipReason: null,
    },
    sectorEvidenceState: 'sector_evidence_confirmed',
    providerEnrichmentCapture: capture,
    companyLinkedInUrl,
    employeeCount: 1500,
    providerCompanyFields: {
      linkedin: {
        companyLinkedInUrl,
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-10-01T12:00:00.000Z',
        rawValue: companyLinkedInUrl,
        reason: null,
      },
      employeeCount: {
        employeeCount: 1500,
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-10-01T12:00:00.000Z',
        rawValue: 1500,
        reason: null,
      },
    },
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name, website: null, domain: null },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'needs_review' as const,
      confidenceScore: 0.75,
      fitScore: 0.45,
      dataCompletenessScore: 0.6,
      recommendedAction: 'review_manually' as const,
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
  };
}

type Candidate = ReturnType<typeof makeCandidate>;

/** 12 candidatos; `completeIndexes` dice cuáles llevan captura de precisión. */
function buildCandidates(completeIndexes: ReadonlySet<number> = new Set()): Candidate[] {
  return NAMES.map((name, index) => makeCandidate(name, completeIndexes.has(index)));
}

async function runWriter(
  candidates: Candidate[],
  options: {
    maxDeliveredCandidates?: number | null;
    targetPersistibleCandidates?: number | null;
    holdBatchStatus?: boolean;
    candidateProvenance?: 'apollo' | null;
  },
): Promise<{ stats: Stats; candidatesCreated: number; deliveryCappedCompanies: readonly DeliveryCappedCompany[] }> {
  const stats: Stats = { candidateInserts: [], batchUpdates: [] };
  const pipelineOutput = {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail y Consumo',
      webSearchProvider: 'apollo_organizations',
      mode: 'multi_query' as const,
      subindustries: [REQUESTED_SUBINDUSTRY],
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: REQUESTED_SUBINDUSTRY,
    webSearch: {
      provider: 'apollo_organizations',
      query: 'test',
      results: [],
      resultsCount: candidates.length,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: TARGET,
      searched: candidates.length,
      returned: candidates.length,
      highQualityNew: 0,
      needsReview: candidates.length,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'apollo_organizations',
      pipelineVersion: 'apollo-two-round-1',
      executedAt: '2026-10-01T12:00:00.000Z',
      total_raw_evaluated: candidates.length,
      subindustries: [REQUESTED_SUBINDUSTRY],
    },
  };

  const input = {
    pipelineOutput: pipelineOutput as unknown as CandidateWriterInput['pipelineOutput'],
    triggeredByUserId: USER_ID,
    ownerId: USER_ID,
    source: 'agent_1' as const,
    dryRun: false,
    extraBatchMetadata: { subindustries: [REQUESTED_SUBINDUSTRY] },
    ...('targetPersistibleCandidates' in options
      ? { targetPersistibleCandidates: options.targetPersistibleCandidates }
      : {}),
    ...('maxDeliveredCandidates' in options
      ? { maxDeliveredCandidates: options.maxDeliveredCandidates }
      : {}),
    ...(options.holdBatchStatus !== undefined ? { holdBatchStatus: options.holdBatchStatus } : {}),
    ...(options.candidateProvenance !== undefined ? { candidateProvenance: options.candidateProvenance } : {}),
  } as unknown as CandidateWriterInput;

  const result = await writeProspectingCandidates(input, makeFakeAdmin(stats));
  return {
    stats,
    candidatesCreated: result.candidatesCreated,
    deliveryCappedCompanies: result.deliveryCappedCompanies ?? [],
  };
}

/** La última metadata que el writer escribió en el lote. */
function lastBatchMetadata(stats: Stats): Record<string, unknown> {
  const writes = stats.batchUpdates.filter((u) => u.metadata != null);
  assert.ok(writes.length > 0, 'debe haber una escritura de metadata del lote');
  return writes[writes.length - 1].metadata as Record<string, unknown>;
}

function insertedNames(stats: Stats): string[] {
  return stats.candidateInserts.map((row) => row.name as string);
}

function countsTowardTarget(row: Record<string, unknown>): boolean | undefined {
  const metadata = row.metadata as Record<string, unknown> | undefined;
  const completeness = metadata?.target_completeness as Record<string, unknown> | undefined;
  return completeness?.counts_toward_target as boolean | undefined;
}

// ─── Pruebas ──────────────────────────────────────────────────────────────────

describe('AGENT1-DELIVERY-CAP-1 — writer Apollo/Tavily: tope de entrega por vendedor', () => {
  it('(a) 12 elegibles + tope 10 ⇒ 10 filas y la metadata declara 2 recortadas', async () => {
    const { stats, candidatesCreated } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });

    assert.equal(stats.candidateInserts.length, 10, 'exactamente 10 INSERT');
    assert.equal(candidatesCreated, 10);

    const metadata = lastBatchMetadata(stats);
    const precisionGate = metadata.precision_gate as Record<string, unknown>;
    assert.equal(precisionGate.target_cap_exclusions, 2);

    const targetCap = metadata.target_cap as Record<string, unknown>;
    assert.ok(targetCap, 'con objetivo declarado, el bloque target_cap existe');
    assert.equal(targetCap.target, TARGET);
    assert.equal(targetCap.eligible_before_cap, 12);
    assert.equal(targetCap.persisted_after_cap, 10);
    assert.equal(targetCap.capped_count, 2);
    assert.equal(targetCap.delivery_cap, 10);
    assert.equal(targetCap.delivery_capped_count, 2);
  });

  it('(a) lo recortado NO se escribe: ningún INSERT para las dos últimas', async () => {
    // Todas incompletas ⇒ el orden COMPLETE-FIRST conserva el de entrada.
    const { stats } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });
    assert.deepEqual(insertedNames(stats), NAMES.slice(0, 10));
    for (const name of NAMES.slice(10)) {
      assert.equal(insertedNames(stats).includes(name), false, `${name} no debe reclamarse`);
    }
  });

  it('🔴 STAYS-FREE-1: el writer DEVUELVE lo recortado para que quede registrado (y libre)', async () => {
    const { deliveryCappedCompanies } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });
    assert.deepEqual(deliveryCappedCompanies.map((c) => c.name), NAMES.slice(10));
    const none = await runWriter(buildCandidates(), { maxDeliveredCandidates: null });
    assert.deepEqual(none.deliveryCappedCompanies, []);
  });

  it('🔴 BANK-FIRST-MEASURES-TARGET-1: lo que vuelve del banco se MIDE y una completa cuenta para la meta', async () => {
    // Medido 05-10 (Chile × Salud, lote d92a12ec): 10 filas del banco sin
    // `target_completeness` ⇒ el banco aportaba 0 y la corrida pagaba igual.
    const complete = new Set(NAMES.map((_n, i) => i));
    const fromBank = buildCandidates(complete)
      .slice(0, 3)
      .map((candidate) =>
        readBankPipelineCandidate({
          kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
          candidate: projectCandidateForBank(candidate as never),
          requestedSubindustries: [],
        }),
      );
    assert.ok(fromBank.every((c) => c !== null));
    const stats = { candidateInserts: [] as Record<string, unknown>[], batchUpdates: [] as Record<string, unknown>[] };
    const pipelineOutput = buildBankPipelineOutput({
      industryName: 'Retail y Consumo',
      countryCode: 'CO',
      countryName: 'Colombia',
      requestedTarget: TARGET,
      candidates: fromBank as never,
    });
    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: USER_ID,
        ownerId: USER_ID,
        source: 'agent_1',
        dryRun: false,
        targetPersistibleCandidates: TARGET,
        maxDeliveredCandidates: 10,
        holdBatchStatus: true,
        candidateProvenance: 'apollo',
      } as unknown as CandidateWriterInput,
      makeFakeAdmin(stats),
    );
    assert.equal(stats.candidateInserts.length, 3);
    for (const row of stats.candidateInserts) {
      const tc = (row.metadata as Record<string, unknown>).target_completeness as Record<string, unknown> | undefined;
      assert.ok(tc, `${String(row.name)} queda medida (target_completeness)`);
      assert.equal(row.source_primary, 'apollo');
    }
    assert.ok(stats.candidateInserts.some((row) => countsTowardTarget(row) === true), 'una completa del banco cuenta');
    assert.ok((result.persistence?.completeValidCandidates ?? 0) > 0, 'el escritor declara completas medidas');
  });

  it('🔴 BANK-FIRST-1: lo recortado trae el candidato COMPLETO para el banco', async () => {
    const { deliveryCappedCompanies } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });
    for (const company of deliveryCappedCompanies) {
      assert.equal(company.bankCandidate?.name, company.name);
      assert.equal(company.bankCandidate?.domain, company.domain);
      assert.equal('searchTrace' in (company.bankCandidate ?? {}), false);
    }
  });

  it('🔴 BANK-FIRST-1: `holdBatchStatus` ⇒ el escritor NO sella el lote (sólo metadata)', async () => {
    const held = await runWriter(buildCandidates(), { maxDeliveredCandidates: 10, holdBatchStatus: true });
    assert.equal(held.candidatesCreated, 10);
    assert.equal(held.stats.batchUpdates.some((u) => 'status' in u), false, 'ninguna escritura de estado');
    assert.ok(held.stats.batchUpdates.some((u) => u.metadata != null), 'la metadata sí se escribe');
    const sealed = await runWriter(buildCandidates(), { maxDeliveredCandidates: 10 });
    assert.ok(sealed.stats.batchUpdates.some((u) => 'status' in u), 'sin la bandera, se sella como siempre');
  });

  it('🔴 BANK-FIRST-1: `candidateProvenance: apollo` ⇒ las filas son de Apollo', async () => {
    const plain = await runWriter(buildCandidates(), { maxDeliveredCandidates: 10 });
    assert.ok(plain.stats.candidateInserts.every((row) => row.source_primary === 'web_ai'));
    const banked = await runWriter(buildCandidates(), { maxDeliveredCandidates: 10, candidateProvenance: 'apollo' });
    assert.ok(banked.stats.candidateInserts.every((row) => row.source_primary === 'apollo'));
  });

  it('🔴 BANCO: lo recortado trae si contaba para la meta y las MISMAS claves de reclamo', async () => {
    // 12 completas, tope 10 ⇒ se recortan dos COMPLETAS (entran al banco como `ready`).
    const all = new Set(NAMES.map((_name, index) => index));
    const complete = await runWriter(buildCandidates(all), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });
    assert.equal(complete.deliveryCappedCompanies.length, 2);
    for (const company of complete.deliveryCappedCompanies) {
      assert.equal(company.countsTowardTarget, true, `${company.name} contaba para la meta`);
      assert.ok(company.domain, `${company.name} trae dominio`);
      assert.deepEqual(
        company.claims?.find((claim) => claim.type === 'domain'),
        { type: 'domain', key: company.domain },
        `${company.name}: el reclamo de dominio es el que la fila habría tomado`,
      );
    }

    const incomplete = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });
    for (const company of incomplete.deliveryCappedCompanies) {
      assert.equal(company.countsTowardTarget, false, `${company.name} no contaba`);
    }
  });

  it('(b) 🔴 COMPLETAS PRIMERO: con las completas AL FINAL de la entrada, todas se persisten', async () => {
    // Las 4 últimas (8..11) son completas; con tope 10 un recorte por orden de
    // entrada se llevaría dos de ellas (10 y 11).
    const completeIndexes = new Set([8, 9, 10, 11]);
    const { stats } = await runWriter(buildCandidates(completeIndexes), {
      maxDeliveredCandidates: 10,
      targetPersistibleCandidates: TARGET,
    });

    assert.equal(stats.candidateInserts.length, 10);
    const names = insertedNames(stats);
    for (const index of completeIndexes) {
      assert.ok(names.includes(NAMES[index]), `${NAMES[index]} (completa) debe persistirse`);
    }

    // Las 4 completas cuentan para el objetivo; las 6 incompletas escritas no.
    const counting = stats.candidateInserts.filter((row) => countsTowardTarget(row) === true);
    assert.equal(counting.length, 4, 'las cuatro completas cuentan hacia el objetivo');
    assert.deepEqual(
      counting.map((row) => row.name).sort(),
      [...completeIndexes].map((index) => NAMES[index]).sort(),
    );

    // Las recortadas son las dos ÚLTIMAS incompletas (6 y 7), nunca una completa.
    const capped = NAMES.filter((name) => !names.includes(name));
    assert.deepEqual(capped, [NAMES[6], NAMES[7]]);
    for (const name of capped) {
      assert.equal(completeIndexes.has(NAMES.indexOf(name)), false, `${name} recortada es incompleta`);
    }

    const metadata = lastBatchMetadata(stats);
    assert.equal((metadata.target_cap as Record<string, unknown>).delivery_capped_count, 2);
  });

  it('(c) sin tope (undefined) ⇒ las 12 se insertan, como en X6.13', async () => {
    const { stats, candidatesCreated } = await runWriter(buildCandidates(), {
      targetPersistibleCandidates: TARGET,
    });
    assert.equal(stats.candidateInserts.length, 12);
    assert.equal(candidatesCreated, 12);

    const metadata = lastBatchMetadata(stats);
    assert.equal((metadata.precision_gate as Record<string, unknown>).target_cap_exclusions, 0);
    const targetCap = metadata.target_cap as Record<string, unknown>;
    assert.equal(targetCap.capped_count, 0);
    assert.equal(targetCap.delivery_cap, null, 'sin tope declarado');
    assert.equal(targetCap.delivery_capped_count, 0);
  });

  it('(c) tope null ⇒ las 12 se insertan', async () => {
    const { stats } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: null,
      targetPersistibleCandidates: TARGET,
    });
    assert.equal(stats.candidateInserts.length, 12);
    const targetCap = lastBatchMetadata(stats).target_cap as Record<string, unknown>;
    assert.equal(targetCap.delivery_cap, null);
    assert.equal(targetCap.delivery_capped_count, 0);
  });

  it('(c) sin objetivo ni tope: 12 filas y sin bloque target_cap (legacy intacto)', async () => {
    const { stats } = await runWriter(buildCandidates(), {});
    assert.equal(stats.candidateInserts.length, 12);
    const metadata = lastBatchMetadata(stats);
    assert.equal(metadata.target_cap, undefined);
    assert.equal((metadata.precision_gate as Record<string, unknown>).target_cap_exclusions, 0);
  });

  it('(d) un tope por debajo del objetivo sube al objetivo: tope 3 + objetivo 5 ⇒ 5 filas', async () => {
    const { stats } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 3,
      targetPersistibleCandidates: TARGET,
    });
    assert.equal(stats.candidateInserts.length, TARGET);

    const metadata = lastBatchMetadata(stats);
    assert.equal((metadata.precision_gate as Record<string, unknown>).target_cap_exclusions, 7);
    const targetCap = metadata.target_cap as Record<string, unknown>;
    assert.equal(targetCap.delivery_cap, TARGET, 'el tope efectivo es el objetivo, no 3');
    assert.equal(targetCap.delivery_capped_count, 7);
  });

  it('un tope igual o mayor que las elegibles no recorta nada', async () => {
    const { stats } = await runWriter(buildCandidates(), {
      maxDeliveredCandidates: 12,
      targetPersistibleCandidates: TARGET,
    });
    assert.equal(stats.candidateInserts.length, 12);
    const targetCap = lastBatchMetadata(stats).target_cap as Record<string, unknown>;
    assert.equal(targetCap.delivery_cap, 12);
    assert.equal(targetCap.delivery_capped_count, 0);
  });
});
