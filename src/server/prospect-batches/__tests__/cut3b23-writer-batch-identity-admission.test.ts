/**
 * AGENT1-CUT3B23 — admisión por identidad de lote EN LOS ESCRITORES REALES.
 *
 * Las suites del registro prueban la semántica; ésta prueba que los escritores
 * la USAN: que un duplicado duro no llega a `INSERT`, que no se cuenta como
 * error, que no reescribe al ganador y que un `discarded` sembrado no bloquea.
 *
 * Sin Supabase real, sin red, sin proveedores, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeStructuredSourceCandidatesPreview } from '@/server/agents/prospecting-toolkit/structured-source-candidate-writer';
import type { StructuredSourceCandidateDraft } from '@/server/agents/prospecting-toolkit/structured-candidate-types';
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';

// ══════════════════════════════════════════════════════════════════════════════
// ESCRITOR GRATUITO — structured-source-candidate-writer
// ══════════════════════════════════════════════════════════════════════════════

type FreeStats = {
  candidateInserts: Array<Record<string, unknown>>;
  seedSelects: number;
};

/**
 * Cliente falso encadenable. Sirve al PREFILTRO fiscal del checker de novedad
 * (`.select().in().eq()`) y a la siembra del registro (`.select().eq().in()`),
 * que resuelven los filtros en distinto orden.
 */
function makeFreeClientFixed(
  existingBatchRows: Array<Record<string, unknown>>,
  stats: FreeStats,
): SupabaseClient {
  function chain(rowsFor: (filters: Record<string, unknown>) => unknown[]) {
    const filters: Record<string, unknown> = {};
    const node: Record<string, unknown> = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return node;
      },
      in(column: string, values: unknown[]) {
        filters[column] = values;
        return node;
      },
      limit() {
        return node;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: rowsFor(filters), error: null }).then(resolve, reject);
      },
    };
    return node;
  }

  return {
    from(table: string) {
      if (table === 'prospect_candidates') {
        return {
          insert(row: Record<string, unknown>) {
            stats.candidateInserts.push({ ...row });
            return Promise.resolve({ error: null });
          },
          select(columns: string) {
            const isSeed = columns.includes('source_trace');
            if (isSeed) stats.seedSelects += 1;
            return chain((filters) => {
              if (!isSeed) return [];
              const statuses = (filters['status'] as string[]) ?? [];
              return existingBatchRows.filter((r) => statuses.includes(String(r['status'])));
            });
          },
        };
      }
      if (table === 'prospect_batches') {
        return {
          insert() {
            return {
              select() {
                return { single: async () => ({ data: { id: 'batch-1' }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'accounts') {
        return { select: () => chain(() => []) };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function draft(overrides: Partial<StructuredSourceCandidateDraft> = {}): StructuredSourceCandidateDraft {
  return {
    name: 'EMPRESA GRATUITA UNO',
    legalName: 'EMPRESA GRATUITA UNO S.A.S.',
    taxId: '900123456',
    taxIdentifierType: 'NIT',
    country: 'Colombia',
    countryCode: 'CO',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    region: 'BOGOTA D.C.',
    website: null,
    sectorCode: '2100',
    sectorDescription: 'Farmacéuticos',
    legalStatus: 'ACTIVA',
    employeeCountStatus: 'unknown_requires_manual_validation',
    reviewStatus: 'needs_manual_review',
    commercialFitStatus: 'needs_manual_review',
    hubspotMatchStatus: 'not_attempted',
    recyclableStatus: null,
    reviewFlags: [],
    sourceTrace: { sourceProvider: 'public_source', sourceKey: 'co_siis_discovery' },
    hubspotTrace: { attempted: false },
    commercialTrace: { reviewFlags: [] },
    ...overrides,
  } as StructuredSourceCandidateDraft;
}

const FREE_INPUT_BASE = {
  dryRun: false as const,
  requestedByUserId: 'user-1',
  country: 'Colombia',
  countryCode: 'CO',
  sourceKey: 'co_siis_discovery',
  sourceProvider: 'public_source',
  batchSource: 'agent_1',
  dataset: 'co_siis_discovery',
  runHubspotCheck: false,
};

function seedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'existing-free-row',
    name: 'EMPRESA YA PERSISTIDA',
    domain: null,
    website: null,
    country_code: 'CO',
    tax_id: '900123456',
    tax_identifier: '900123456',
    status: 'needs_review',
    metadata: null,
    source_trace: null,
    ...overrides,
  };
}

describe('CUT-3B23 — escritor GRATUITO: admisión por identidad de lote', () => {
  it('un lote ADOPTADO que ya contiene la misma identidad fiscal hace saltar al candidato', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };
    const client = makeFreeClientFixed([seedRow()], stats);

    const report = await writeStructuredSourceCandidatesPreview(client, {
      ...FREE_INPUT_BASE,
      batchId: 'batch-adopted',
      candidates: [draft()],
    });

    assert.equal(stats.seedSelects, 1, 'la siembra tiene que consultar el lote');
    assert.equal(stats.candidateInserts.length, 0, 'el duplicado no puede persistirse');
    assert.equal(report.batchIdentity.rawDiscovered, 1);
    assert.equal(report.batchIdentity.duplicateSkipped, 1);
    assert.equal(report.batchIdentity.identityAdmittedUnique, 0);
    // 🔴 § 15 — un duplicado NO es un error.
    assert.equal(report.batchIdentity.errors, 0);
    assert.equal(report.errors.length, 0);
    assert.equal(report.batchIdentity.seededCount, 1);
    assert.equal(report.batchIdentity.seedDegraded, false);
  });

  it('🔴 una fila `discarded` sembrada NO bloquea al candidato legítimo', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };
    const client = makeFreeClientFixed([seedRow({ status: 'discarded' })], stats);

    const report = await writeStructuredSourceCandidatesPreview(client, {
      ...FREE_INPUT_BASE,
      batchId: 'batch-adopted',
      candidates: [draft()],
    });

    assert.equal(stats.candidateInserts.length, 1);
    assert.equal(report.batchIdentity.identityAdmittedUnique, 1);
    assert.equal(report.batchIdentity.duplicateSkipped, 0);
    assert.equal(report.batchIdentity.seededCount, 0, '`discarded` no se siembra');
  });

  it('dos candidatos con la MISMA identidad fiscal en una sola llamada persisten UNO', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };
    const client = makeFreeClientFixed([], stats);

    const report = await writeStructuredSourceCandidatesPreview(client, {
      ...FREE_INPUT_BASE,
      candidates: [
        draft({ name: 'EMPRESA UNO' }),
        draft({ name: 'EMPRESA UNO DUPLICADA', taxId: '900.123.456-7' }),
      ],
    });

    assert.equal(stats.candidateInserts.length, 1);
    assert.equal(stats.candidateInserts[0].name, 'EMPRESA UNO');
    assert.equal(report.batchIdentity.rawDiscovered, 2);
    assert.equal(report.batchIdentity.identityAdmittedUnique, 1);
    assert.equal(report.batchIdentity.duplicateSkipped, 1);
    assert.equal(report.batchIdentity.errors, 0);
    // El GANADOR conserva su procedencia intacta: nadie la reescribe.
    assert.equal(stats.candidateInserts[0].source_primary, 'public_source');
  });

  it('dos identidades fiscales distintas persisten LAS DOS', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };
    const client = makeFreeClientFixed([], stats);

    const report = await writeStructuredSourceCandidatesPreview(client, {
      ...FREE_INPUT_BASE,
      candidates: [
        draft({ name: 'EMPRESA UNO', taxId: '900123456' }),
        draft({ name: 'EMPRESA DOS', taxId: '800987654' }),
      ],
    });

    assert.equal(stats.candidateInserts.length, 2);
    assert.equal(report.batchIdentity.identityAdmittedUnique, 2);
    assert.equal(report.batchIdentity.duplicateSkipped, 0);
  });

  it('el candidato saltado queda declarado en el reporte por item', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };
    const client = makeFreeClientFixed([], stats);

    const report = await writeStructuredSourceCandidatesPreview(client, {
      ...FREE_INPUT_BASE,
      candidates: [draft({ name: 'EMPRESA UNO' }), draft({ name: 'EMPRESA UNO COPIA' })],
    });

    const skippedItem = report.items.find((item) => item.name === 'EMPRESA UNO COPIA');
    assert.ok(skippedItem);
    assert.equal(skippedItem.shouldWrite, false);
    assert.equal(skippedItem.skippedReason, 'batch_identity_duplicate:fiscal_identity');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCRITOR LUSHA — lusha-pending-review
// ══════════════════════════════════════════════════════════════════════════════

function noDuplicateResult(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function lushaCompany(overrides: Partial<LushaPreviewCompany>): LushaPreviewCompany {
  return {
    name: 'Clinica Uno',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
    providerCompanyId: 'pc-default',
    ...overrides,
  };
}

function lushaSuccess(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

const LUSHA_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const LUSHA_ACTOR = { internalUserId: 'user-1' };

/** Resolver oficial inyectado: devuelve SIEMPRE la misma identidad fiscal fuerte. */
function sameTaxResolver(taxIdentifier: string): OfficialSourceResolver {
  return {
    countryCode: 'CO',
    sourceKey: 'co_siis',
    canResolve: () => true,
    resolve: () => ({
      status: 'matched',
      countryCode: 'CO',
      sourceKey: 'co_siis',
      confidence: 1,
      matchMethod: 'tax_id',
      taxIdentifier,
      taxIdentifierType: 'NIT',
      legalName: 'RAZON SOCIAL OFICIAL S.A.S.',
      legalStatus: 'ACTIVA',
      warnings: [],
      issues: [],
    }),
  };
}

function makeLushaDeps(
  search: LushaPreviewResult,
  resolvers: OfficialSourceResolver[] = [],
) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateBatches: [] as LushaPendingReviewCandidateRow[][],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => ((input.page ?? 0) > 0 ? lushaSuccess([]) : search),
    insertBatch: async (row) => {
      calls.batches.push(row);
      return { id: `batch-${calls.batches.length}` };
    },
    insertCandidates: async (rows) => {
      calls.candidateBatches.push(rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicateResult(input),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
    officialSourceResolvers: resolvers,
  };
  return { deps, calls };
}

describe('CUT-3B23 — escritor LUSHA: admisión por identidad de lote', () => {
  it('dos ids de proveedor y DOMINIOS distintos con la MISMA identidad fiscal persisten UNO', async () => {
    const { deps, calls } = makeLushaDeps(
      lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-1', name: 'Clinica Uno', domain: 'uno.com' }),
        lushaCompany({ providerCompanyId: 'pc-2', name: 'Clinica Dos', domain: 'dos.com' }),
      ]),
      [sameTaxResolver('900123456')],
    );

    const result = await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR);

    assert.equal(result.ok, true);
    assert.equal(calls.candidateBatches.length, 1);
    assert.equal(calls.candidateBatches[0].length, 1, 'sólo una fila puede persistirse');
    assert.equal(result.batchIdentityDuplicateSkippedCount, 1);
    assert.equal(result.insertedCandidatesCount, 1);
    assert.equal(result.batchIdentityMetrics?.duplicate_skipped, 1);
    assert.equal(result.batchIdentityMetrics?.identity_admitted_unique, 1);
    // § 3 — y la fila EXISTE: `persisted_unique` se reconcilia con `insertedCount`.
    assert.equal(result.batchIdentityMetrics?.persisted_unique, 1);
    // 🔴 un duplicado no es un error.
    assert.equal(result.batchIdentityMetrics?.errors, 0);
    assert.equal(result.status, 'success');
  });

  it('el GANADOR es el primero y conserva su identidad de proveedor', async () => {
    const { deps, calls } = makeLushaDeps(
      lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-1', name: 'Clinica Uno', domain: 'uno.com' }),
        lushaCompany({ providerCompanyId: 'pc-2', name: 'Clinica Dos', domain: 'dos.com' }),
      ]),
      [sameTaxResolver('900123456')],
    );

    await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR);

    const row = calls.candidateBatches[0][0];
    assert.equal(row.name, 'Clinica Uno');
    const trace = row.source_trace as Record<string, unknown>;
    assert.equal(trace.providerCompanyId, 'pc-1');
  });

  it('sin identidad fiscal común las dos empresas se persisten', async () => {
    const { deps, calls } = makeLushaDeps(
      lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-1', name: 'Clinica Uno', domain: 'uno.com' }),
        lushaCompany({ providerCompanyId: 'pc-2', name: 'Clinica Dos', domain: 'dos.com' }),
      ]),
    );

    const result = await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR);

    assert.equal(calls.candidateBatches[0].length, 2);
    assert.equal(result.batchIdentityDuplicateSkippedCount, 0);
    assert.equal(result.batchIdentityMetrics?.identity_admitted_unique, 2);
    assert.equal(result.batchIdentityMetrics?.persisted_unique, 2);
  });

  it('la métrica de identidad de lote es sólo numérica: nunca el NIT', async () => {
    const { deps } = makeLushaDeps(
      lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-1', name: 'Clinica Uno', domain: 'uno.com' }),
      ]),
      [sameTaxResolver('900123456')],
    );

    const result = await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR);

    for (const value of Object.values(result.batchIdentityMetrics ?? {})) {
      assert.equal(typeof value, 'number');
    }
    assert.equal(JSON.stringify(result.batchIdentityMetrics).includes('900123456'), false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REVIEW-FIX § 1 — la verdad del residual DESPUÉS de la admisión de identidad
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Deps de Lusha que CUENTAN las llamadas al proveedor y permiten forzar una
 * inserción parcial. Contar las llamadas es lo que prueba que esta corrección es
 * de VERACIDAD y no de gasto: el número de peticiones no puede moverse.
 */
function makeCountingLushaDeps(
  search: LushaPreviewResult,
  resolvers: OfficialSourceResolver[] = [],
  options: { insertedCountOverride?: number } = {},
) {
  const calls = {
    searches: 0,
    batches: [] as LushaPendingReviewBatchRow[],
    candidateBatches: [] as LushaPendingReviewCandidateRow[][],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      calls.searches += 1;
      return (input.page ?? 0) > 0 ? lushaSuccess([]) : search;
    },
    insertBatch: async (row) => {
      calls.batches.push(row);
      return { id: `batch-${calls.batches.length}` };
    },
    insertCandidates: async (rows) => {
      calls.candidateBatches.push(rows);
      return { insertedCount: options.insertedCountOverride ?? rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicateResult(input),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
    officialSourceResolvers: resolvers,
  };
  return { deps, calls };
}

/** Dos empresas del proveedor, con dominios e ids distintos. */
const TWO_COMPANIES = [
  lushaCompany({ providerCompanyId: 'pc-1', name: 'Clinica Uno', domain: 'uno.com' }),
  lushaCompany({ providerCompanyId: 'pc-2', name: 'Clinica Dos', domain: 'dos.com' }),
];

describe('CUT-3B23 REVIEW-FIX § 1 — residual y motivo de parada POST-admisión', () => {
  it('🔴 objetivo 2 · el registro retira 1 ⇒ aceptado 1, hueco 1 y el motivo YA NO dice `target_reached`', async () => {
    const { deps, calls } = makeCountingLushaDeps(
      lushaSuccess(TWO_COMPANIES),
      // Misma identidad fiscal para las dos ⇒ la admisión retira una.
      [sameTaxResolver('900123456')],
      {},
    );

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: 2 },
    );

    assert.equal(result.ok, true);
    // Lo aceptado contra el objetivo es POST-admisión.
    assert.equal(result.multiBranch?.acceptedForTargetTotal, 1);
    // …y el hueco residual FINAL lo dice, en vez de heredar el pre-admisión.
    assert.equal(result.remainingGapFinal, 1);
    assert.equal(result.multiBranch?.remainingGapFinal, 1);
    // El informe imposible «objetivo 2 · aceptado 1 · hueco 0 · target_reached»
    // ya no puede emitirse.
    assert.notEqual(result.stopReason, 'target_reached');
    assert.equal(result.stopReason, 'post_admission_identity_gap');
    assert.equal(result.multiBranch?.stopReason, 'post_admission_identity_gap');
    // 🔴 Y NADA de esto reabre gasto.
    assert.equal(calls.searches, 1, 'no se pide una página más');
    assert.equal(result.creditsCharged, 1, 'los créditos no se mueven');
    assert.equal(result.batchIdentityDuplicateSkippedCount, 1);
  });

  it('control: sin duplicado, el mismo objetivo se cumple y el gasto es IDÉNTICO', async () => {
    const { deps, calls } = makeCountingLushaDeps(lushaSuccess(TWO_COMPANIES));

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: 2 },
    );

    assert.equal(result.multiBranch?.acceptedForTargetTotal, 2);
    assert.equal(result.remainingGapFinal, 0);
    assert.equal(result.stopReason, 'target_reached');
    // Mismas peticiones y mismos créditos que en el caso con duplicado.
    assert.equal(calls.searches, 1);
    assert.equal(result.creditsCharged, 1);
  });

  it('🔴 § 3 — si el motor confirma MENOS filas de las admitidas, manda `insertedCount`', async () => {
    const { deps } = makeCountingLushaDeps(lushaSuccess(TWO_COMPANIES), [], {
      insertedCountOverride: 1,
    });

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: 2 },
    );

    assert.equal(result.insertedCandidatesCount, 1);
    assert.equal(result.multiBranch?.acceptedForTargetTotal, 1, 'lo escrito, no lo admitido');
    assert.equal(result.remainingGapFinal, 1);
    assert.notEqual(result.stopReason, 'target_reached');
    assert.equal(result.stopReason, 'post_admission_persistence_gap');
    assert.equal(result.batchIdentityMetrics?.identity_admitted_unique, 2);
    assert.equal(result.batchIdentityMetrics?.persisted_unique, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REVIEW-FIX § 4 — los duplicados del registro entran en `skippedCount`
// ══════════════════════════════════════════════════════════════════════════════

describe('CUT-3B23 REVIEW-FIX § 4 — `skippedCount` incluye los duplicados de lote', () => {
  it('🔴 una empresa retirada SÓLO por el registro suma en `skippedCount` y no en `errors`', async () => {
    const { deps } = makeCountingLushaDeps(lushaSuccess(TWO_COMPANIES), [
      sameTaxResolver('900123456'),
    ]);

    const result = await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR);

    assert.equal(result.batchIdentityDuplicateSkippedCount, 1);
    assert.equal(result.skippedCount, 1, 'la UI no puede decir «0 omitidas»');
    assert.equal(result.batchIdentityMetrics?.errors, 0);
  });

  it('sin duplicados de lote, `skippedCount` no se infla: sigue en 0', async () => {
    const { deps } = makeCountingLushaDeps(lushaSuccess(TWO_COMPANIES));

    const result = await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR);

    assert.equal(result.batchIdentityDuplicateSkippedCount, 0);
    assert.equal(result.skippedCount, 0, 'sin doble conteo');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REVIEW-FIX § 3 — escritor GRATUITO: admitido ≠ persistido
// ══════════════════════════════════════════════════════════════════════════════

/** Igual que `makeFreeClientFixed`, pero el INSERT del candidato FALLA. */
function makeFreeClientFailingInsert(stats: FreeStats): SupabaseClient {
  const base = makeFreeClientFixed([], stats) as unknown as {
    from(table: string): Record<string, unknown>;
  };
  return {
    from(table: string) {
      const node = base.from(table);
      if (table !== 'prospect_candidates') return node;
      return {
        ...node,
        insert(row: Record<string, unknown>) {
          stats.candidateInserts.push({ ...row });
          return Promise.resolve({ error: { message: 'insert rejected' } });
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('CUT-3B23 REVIEW-FIX § 3 — escritor GRATUITO: un insert fallido NO cuenta como aceptado', () => {
  it('🔴 identidad admitida + INSERT fallido ⇒ `errors` 1 y `persistedUnique` 0', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };

    const report = await writeStructuredSourceCandidatesPreview(
      makeFreeClientFailingInsert(stats),
      { ...FREE_INPUT_BASE, candidates: [draft()] },
    );

    assert.equal(stats.candidateInserts.length, 1, 'se intentó escribir');
    assert.equal(report.batchIdentity.identityAdmittedUnique, 1, 'pasó la admisión');
    assert.equal(report.batchIdentity.persistedUnique, 0, '🔴 pero la fila NO existe');
    assert.equal(report.batchIdentity.errors, 1);
    assert.equal(report.batchIdentity.duplicateSkipped, 0);
  });

  it('un INSERT que funciona sube `persistedUnique` y deja `errors` en 0', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };

    const report = await writeStructuredSourceCandidatesPreview(
      makeFreeClientFixed([], stats),
      { ...FREE_INPUT_BASE, candidates: [draft()] },
    );

    assert.equal(report.batchIdentity.identityAdmittedUnique, 1);
    assert.equal(report.batchIdentity.persistedUnique, 1);
    assert.equal(report.batchIdentity.errors, 0);
  });

  it('un duplicado duro no persiste, no falla y no cuenta como fila', async () => {
    const stats: FreeStats = { candidateInserts: [], seedSelects: 0 };

    const report = await writeStructuredSourceCandidatesPreview(
      makeFreeClientFixed([], stats),
      {
        ...FREE_INPUT_BASE,
        candidates: [draft({ name: 'EMPRESA UNO' }), draft({ name: 'EMPRESA UNO COPIA' })],
      },
    );

    assert.equal(report.batchIdentity.duplicateSkipped, 1);
    assert.equal(report.batchIdentity.errors, 0);
    assert.equal(report.batchIdentity.persistedUnique, 1, 'sólo el ganador existe');
  });
});
