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
    assert.equal(report.batchIdentity.acceptedUnique, 0);
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
    assert.equal(report.batchIdentity.acceptedUnique, 1);
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
    assert.equal(report.batchIdentity.acceptedUnique, 1);
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
    assert.equal(report.batchIdentity.acceptedUnique, 2);
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
      matchMethod: 'tax_identifier',
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
    assert.equal(result.batchIdentityMetrics?.accepted_unique, 1);
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
    assert.equal(result.batchIdentityMetrics?.accepted_unique, 2);
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
