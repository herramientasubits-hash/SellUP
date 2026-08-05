/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — LinkedIn empresarial y número de empleados:
 * mapeo, persistencia, contrato de completitud y presentación.
 *
 * Los doce casos del contrato, sin Apollo real, sin Supabase real, sin créditos.
 *
 * El caso 8 es el que cierra el defecto original: Apollo devolvía el número de
 * empleados, el writer lo omitía y la fila quedaba en NULL. Si alguien vuelve a
 * quitar la escritura de la columna, ese test falla.
 *
 * Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  captureApolloCompanyFields,
  captureApolloCompanyLinkedIn,
  captureApolloEmployeeCount,
  mergeCompanyLinkedInCapture,
  mergeEmployeeCountCapture,
  MAX_VALID_EMPLOYEE_COUNT,
} from '../apollo-company-fields-mapping';
import {
  evaluateCandidateTargetEligibility,
  buildCandidateCompletenessCounters,
  resolveCandidateStatusForCompleteness,
  toSubindustryMatchVerdict,
  INCOMPLETE_CANDIDATE_REVIEW_FLAG,
} from '../candidate-completeness-contract';
import {
  resolveLinkedInFieldDisplay,
  resolveEmployeeCountFieldDisplay,
} from '@/modules/prospect-batches/candidate-company-fields-display';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidateWriterInput, CatalogContextResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const OBSERVED_AT = '2026-08-05T22:20:00.000Z';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NEW_BATCH_ID = 'batch-li-emp-0000-0000-000000000001';

// ─── Fixtures del payload del proveedor ──────────────────────────────────────

/**
 * Resultado tal como lo entrega `mapApolloOrganizationToSearchResult`: LinkedIn y
 * tamaño viven tanto planos como dentro de `apollo_profile`.
 */
function makeApolloResult(options: {
  linkedinUrl?: string | number | null;
  employeeCount?: number | string | null;
  enrichmentFieldsAdded?: string[];
}): Record<string, unknown> {
  const { linkedinUrl, employeeCount, enrichmentFieldsAdded } = options;
  return {
    title: 'Merqueo',
    url: 'http://www.merqueo.com',
    snippet: 'Empresa: Merqueo',
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: '5a9f18f9a6da98d997805bb3',
      domain: 'merqueo.com',
      ...(linkedinUrl !== undefined ? { linkedin_url: linkedinUrl } : {}),
      ...(employeeCount !== undefined ? { employee_count: employeeCount } : {}),
      ...(enrichmentFieldsAdded
        ? { apollo_enrichment_fields_added: enrichmentFieldsAdded }
        : {}),
      apollo_profile: {
        organization_id: '5a9f18f9a6da98d997805bb3',
        primary_domain: 'merqueo.com',
        ...(linkedinUrl !== undefined ? { linkedin_url: linkedinUrl } : {}),
        ...(employeeCount !== undefined
          ? { estimated_num_employees: employeeCount }
          : {}),
      },
    },
  };
}

// ─── Fixtures del writer ─────────────────────────────────────────────────────

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

type CandidateFieldOverrides = {
  linkedinUrl?: string | null;
  employeeCount?: number | null;
  linkedinStatus?: 'confirmed' | 'not_returned' | 'invalid' | 'mapping_failed';
  employeeCountStatus?: 'confirmed' | 'not_returned' | 'invalid' | 'mapping_failed';
  sourceOperation?: 'organizations_search' | 'organization_enrichment';
  sectorEvidenceState?: string | null;
};

function makeApolloPipelineOutput(overrides: CandidateFieldOverrides = {}) {
  const linkedinStatus =
    overrides.linkedinStatus ?? (overrides.linkedinUrl ? 'confirmed' : 'not_returned');
  const employeeCountStatus =
    overrides.employeeCountStatus ??
    (overrides.employeeCount != null ? 'confirmed' : 'not_returned');
  const sourceOperation = overrides.sourceOperation ?? 'organizations_search';

  const candidate = {
    name: 'Merqueo',
    website: 'https://merqueo.com',
    domain: 'merqueo.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: 'https://merqueo.com',
    sourceTitle: 'Merqueo — Supermercado en línea en Colombia',
    sourceSnippet: 'Supermercado en línea colombiano de alimentos y consumo masivo.',
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    sectorEvidenceState: overrides.sectorEvidenceState ?? 'sector_evidence_confirmed',
    companyLinkedInUrl: overrides.linkedinUrl ?? null,
    ...(overrides.employeeCount != null ? { employeeCount: overrides.employeeCount } : {}),
    providerCompanyFields: {
      linkedin: {
        companyLinkedInUrl: overrides.linkedinUrl ?? null,
        status: linkedinStatus,
        sourceProvider: linkedinStatus === 'not_returned' ? null : 'apollo',
        sourceOperation: linkedinStatus === 'not_returned' ? null : sourceOperation,
        observedAt: linkedinStatus === 'not_returned' ? null : OBSERVED_AT,
        rawValue: overrides.linkedinUrl ?? null,
        reason: null,
      },
      employeeCount: {
        employeeCount: overrides.employeeCount ?? null,
        status: employeeCountStatus,
        sourceProvider: employeeCountStatus === 'not_returned' ? null : 'apollo',
        sourceOperation: employeeCountStatus === 'not_returned' ? null : sourceOperation,
        observedAt: employeeCountStatus === 'not_returned' ? null : OBSERVED_AT,
        rawValue: overrides.employeeCount ?? null,
        reason: null,
      },
    },
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name: 'Merqueo', website: 'https://merqueo.com', domain: 'merqueo.com' },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new' as const,
      confidenceScore: 0.9,
      fitScore: 0.85,
      dataCompletenessScore: 0.8,
      recommendedAction: 'approve_for_review' as const,
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

  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail y Consumo',
      webSearchProvider: 'apollo_organizations',
      mode: 'multi_query' as const,
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: 'Supermercados en Colombia',
    webSearch: {
      provider: 'apollo_organizations',
      query: 'test',
      results: [],
      resultsCount: 1,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates: [candidate],
    summary: {
      requested: 1,
      searched: 1,
      returned: 1,
      highQualityNew: 1,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'apollo_organizations',
      pipelineVersion: 'apollo-two-round-1',
      executedAt: OBSERVED_AT,
      total_raw_evaluated: 1,
    },
  };
}

type FakeAdminStats = {
  candidateInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
};

class ChainResult {
  constructor(private readonly _val: unknown) {}
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
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }
  single(): Promise<unknown> { return Promise.resolve(this._val); }
}

/**
 * @param missingLinkedInColumn simula una base donde la migración 108 no se aplicó:
 *   el primer insert con `linkedin_url` falla con PGRST204.
 */
function makeFakeAdmin(stats: FakeAdminStats, missingLinkedInColumn = false): SupabaseClient {
  let candidateSeq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(col: string) {
                if (col === 'source') return new ChainResult({ data: [], error: null });
                return {
                  single: () =>
                    Promise.resolve({ data: null, error: { message: 'Not found' } }),
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: null });
          },
          insert() {
            return {
              select() {
                return {
                  single: () => Promise.resolve({ data: { id: NEW_BATCH_ID }, error: null }),
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
            stats.candidateInsertCalls.push({ ...data });
            if (missingLinkedInColumn && 'linkedin_url' in data) {
              return {
                select() {
                  return {
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: {
                          code: 'PGRST204',
                          message:
                            "Could not find the 'linkedin_url' column of 'prospect_candidates' in the schema cache",
                        },
                      }),
                  };
                },
              };
            }
            const id = `cand-li-emp-${++candidateSeq}`;
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === 'provider_usage_logs') {
        return { select: () => new ChainResult({ data: [], error: null }) };
      }
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

async function runWriter(
  overrides: CandidateFieldOverrides,
  options: { missingLinkedInColumn?: boolean } = {},
): Promise<{ stats: FakeAdminStats; row: Record<string, unknown>; metadata: Record<string, unknown> }> {
  const stats: FakeAdminStats = { candidateInsertCalls: [], batchUpdateCalls: [] };
  const input = {
    pipelineOutput: makeApolloPipelineOutput(
      overrides,
    ) as unknown as CandidateWriterInput['pipelineOutput'],
    triggeredByUserId: USER_A,
    ownerId: USER_A,
    source: 'agent_1' as const,
    dryRun: false,
  } as unknown as CandidateWriterInput;

  await writeProspectingCandidates(
    input,
    makeFakeAdmin(stats, options.missingLinkedInColumn ?? false),
  );

  const rows = stats.candidateInsertCalls;
  assert.ok(rows.length > 0, 'el writer no intentó insertar ningún candidato');
  const row = rows[rows.length - 1];
  return { stats, row, metadata: row.metadata as Record<string, unknown> };
}

// ─── 1. Search devuelve ambos → ambos persistidos ────────────────────────────

describe('A1-APOLLO-LINKEDIN-EMPLOYEES-1 — mapeo y persistencia', () => {
  it('1. search devuelve LinkedIn y employee count → ambos persistidos', async () => {
    const capture = captureApolloCompanyFields(
      makeApolloResult({
        linkedinUrl: 'http://www.linkedin.com/company/merqueo',
        employeeCount: 470,
      }),
      OBSERVED_AT,
    );

    assert.equal(capture.linkedin.status, 'confirmed');
    assert.equal(capture.linkedin.companyLinkedInUrl, 'https://www.linkedin.com/company/merqueo');
    assert.equal(capture.linkedin.sourceOperation, 'organizations_search');
    assert.equal(capture.employeeCount.status, 'confirmed');
    assert.equal(capture.employeeCount.employeeCount, 470);
    assert.equal(capture.employeeCount.sourceOperation, 'organizations_search');

    const { row, metadata } = await runWriter({
      linkedinUrl: 'https://www.linkedin.com/company/merqueo',
      employeeCount: 470,
    });

    assert.equal(row.linkedin_url, 'https://www.linkedin.com/company/merqueo');
    assert.equal(row.employee_count, 470);
    assert.equal(row.employee_count_source, 'apollo');

    const linkedInBlock = metadata.company_linkedin as Record<string, unknown>;
    assert.equal(linkedInBlock.company_linkedin_url, 'https://www.linkedin.com/company/merqueo');
    assert.equal(linkedInBlock.linkedin_status, 'confirmed');
    assert.equal(linkedInBlock.linkedin_source_provider, 'apollo');
    assert.equal(linkedInBlock.linkedin_source_operation, 'organizations_search');
    assert.equal(linkedInBlock.linkedin_observed_at, OBSERVED_AT);
    assert.equal(linkedInBlock.linkedin_mapping_status, 'confirmed');

    const employeeBlock = metadata.company_employee_count as Record<string, unknown>;
    assert.equal(employeeBlock.employee_count, 470);
    assert.equal(employeeBlock.employee_count_status, 'confirmed');
    assert.equal(employeeBlock.employee_count_source, 'apollo');
    assert.equal(employeeBlock.employee_count_source_operation, 'organizations_search');
    assert.equal(employeeBlock.employee_count_observed_at, OBSERVED_AT);
  });

  // ─── 2. Sólo el enrichment los devuelve ────────────────────────────────────

  it('2. sólo el enrichment los devuelve → ambos persistidos y atribuidos al enrichment', async () => {
    const capture = captureApolloCompanyFields(
      makeApolloResult({
        linkedinUrl: 'https://www.linkedin.com/company/frubana',
        employeeCount: 1800,
        enrichmentFieldsAdded: ['linkedin_url', 'estimated_num_employees'],
      }),
      OBSERVED_AT,
    );

    assert.equal(capture.linkedin.sourceOperation, 'organization_enrichment');
    assert.equal(capture.employeeCount.sourceOperation, 'organization_enrichment');

    const { row, metadata } = await runWriter({
      linkedinUrl: 'https://www.linkedin.com/company/frubana',
      employeeCount: 1800,
      sourceOperation: 'organization_enrichment',
    });

    assert.equal(row.employee_count, 1800);
    assert.equal(row.linkedin_url, 'https://www.linkedin.com/company/frubana');
    assert.equal(
      (metadata.company_employee_count as Record<string, unknown>)
        .employee_count_source_operation,
      'organization_enrichment',
    );
    assert.equal(
      (metadata.company_linkedin as Record<string, unknown>).linkedin_source_operation,
      'organization_enrichment',
    );
  });

  // ─── 3. El search lo trae y el enrichment no → se conserva ─────────────────

  it('3. search devuelve LinkedIn y el enrichment no → se conserva el valor', () => {
    const fromSearch = captureApolloCompanyLinkedIn(
      makeApolloResult({ linkedinUrl: 'https://www.linkedin.com/company/merqueo' }),
      OBSERVED_AT,
    );
    const fromEnrichment = captureApolloCompanyLinkedIn(makeApolloResult({}), OBSERVED_AT);

    assert.equal(fromEnrichment.status, 'not_returned');

    const merged = mergeCompanyLinkedInCapture(fromSearch, fromEnrichment);
    assert.equal(merged.status, 'confirmed');
    assert.equal(merged.companyLinkedInUrl, 'https://www.linkedin.com/company/merqueo');
    assert.equal(merged.sourceOperation, 'organizations_search');
  });

  // ─── 4. Un employee count válido no se convierte en null ───────────────────

  it('4. un employee count válido no se convierte en null', () => {
    const confirmed = captureApolloEmployeeCount(
      makeApolloResult({ employeeCount: 470 }),
      OBSERVED_AT,
    );
    const absent = captureApolloEmployeeCount(makeApolloResult({}), OBSERVED_AT);

    assert.equal(mergeEmployeeCountCapture(confirmed, absent).employeeCount, 470);
    assert.equal(mergeEmployeeCountCapture(confirmed, absent).status, 'confirmed');

    // Un cero del proveedor tampoco degrada el valor confirmado, y por sí solo
    // NUNCA es un dato de tamaño.
    const zero = captureApolloEmployeeCount(makeApolloResult({ employeeCount: 0 }), OBSERVED_AT);
    assert.equal(zero.status, 'invalid');
    assert.equal(zero.employeeCount, null);
    assert.equal(mergeEmployeeCountCapture(confirmed, zero).employeeCount, 470);

    const tooLarge = captureApolloEmployeeCount(
      makeApolloResult({ employeeCount: MAX_VALID_EMPLOYEE_COUNT + 1 }),
      OBSERVED_AT,
    );
    assert.equal(tooLarge.status, 'invalid');
    assert.equal(tooLarge.employeeCount, null);
  });

  // ─── 5. Perfil personal de LinkedIn → rechazado ────────────────────────────

  it('5. un perfil personal de LinkedIn se rechaza', () => {
    for (const personal of [
      'https://www.linkedin.com/in/juan-perez',
      'http://linkedin.com/pub/alguien/1/2/3',
      'https://www.linkedin.com/school/universidad',
    ]) {
      const capture = captureApolloCompanyLinkedIn(
        makeApolloResult({ linkedinUrl: personal }),
        OBSERVED_AT,
      );
      assert.equal(capture.status, 'invalid', `debía rechazar ${personal}`);
      assert.equal(capture.companyLinkedInUrl, null);
      assert.ok(capture.reason?.startsWith('linkedin_url_rejected:'));
    }

    // Un host que no es LinkedIn tampoco pasa.
    const notLinkedIn = captureApolloCompanyLinkedIn(
      makeApolloResult({ linkedinUrl: 'https://facebook.com/company/merqueo' }),
      OBSERVED_AT,
    );
    assert.equal(notLinkedIn.status, 'invalid');
  });

  // ─── 6. URL empresarial válida → aceptada y canonizada ─────────────────────

  it('6. una URL empresarial válida se acepta y se canoniza', () => {
    const cases: readonly [string, string][] = [
      ['http://www.linkedin.com/company/grupoexito', 'https://www.linkedin.com/company/grupoexito'],
      ['linkedin.com/company/alpina/', 'https://www.linkedin.com/company/alpina'],
      [
        'https://www.linkedin.com/company/cencosud-s-a-?trk=abc',
        'https://www.linkedin.com/company/cencosud-s-a-',
      ],
    ];

    for (const [raw, expected] of cases) {
      const capture = captureApolloCompanyLinkedIn(
        makeApolloResult({ linkedinUrl: raw }),
        OBSERVED_AT,
      );
      assert.equal(capture.status, 'confirmed', `debía aceptar ${raw}`);
      assert.equal(capture.companyLinkedInUrl, expected);
      assert.equal(capture.sourceProvider, 'apollo');
      assert.equal(capture.observedAt, OBSERVED_AT);
    }
  });

  // ─── 7. Ausencia del proveedor ≠ fallo de mapeo ────────────────────────────

  it('7. Apollo no devuelve LinkedIn → not_returned, nunca mapping_failed', () => {
    const absent = captureApolloCompanyLinkedIn(makeApolloResult({}), OBSERVED_AT);
    assert.equal(absent.status, 'not_returned');
    assert.equal(absent.reason, 'apollo_did_not_return_company_linkedin_url');
    // Una ausencia no inventa procedencia.
    assert.equal(absent.sourceProvider, null);
    assert.equal(absent.sourceOperation, null);
    assert.equal(absent.observedAt, null);

    // Un string vacío es ausencia, no un valor inválido.
    const empty = captureApolloCompanyLinkedIn(
      makeApolloResult({ linkedinUrl: '   ' }),
      OBSERVED_AT,
    );
    assert.equal(empty.status, 'not_returned');

    // Un tipo inesperado SÍ es inválido: el proveedor devolvió algo.
    const wrongType = captureApolloCompanyLinkedIn(
      makeApolloResult({ linkedinUrl: 42 }),
      OBSERVED_AT,
    );
    assert.equal(wrongType.status, 'invalid');

    const absentEmployees = captureApolloEmployeeCount(makeApolloResult({}), OBSERVED_AT);
    assert.equal(absentEmployees.status, 'not_returned');
    assert.equal(absentEmployees.reason, 'apollo_did_not_return_employee_count');
  });

  // ─── 8. El writer NO puede omitir el employee count ────────────────────────

  it('8. Apollo devuelve employee count y el writer lo escribe en la columna', async () => {
    const { row, metadata } = await runWriter({
      linkedinUrl: 'https://www.linkedin.com/company/merqueo',
      employeeCount: 470,
    });

    // Éste es el test que falla si alguien vuelve a quitar la escritura: la
    // corrida del 2026-08-05 dejó `employee_count = NULL` con 470 en el payload.
    assert.equal(
      row.employee_count,
      470,
      'el writer omitió el employee count que el proveedor devolvió',
    );
    assert.equal(row.employee_count_source, 'apollo');
    assert.equal(
      (metadata.company_employee_count as Record<string, unknown>).employee_count,
      470,
    );
  });

  it('8b. un employee count no confirmado no escribe la columna ni la inventa en cero', async () => {
    const { row } = await runWriter({
      linkedinUrl: 'https://www.linkedin.com/company/merqueo',
      employeeCount: null,
      employeeCountStatus: 'not_returned',
    });

    assert.equal('employee_count' in row, false, 'no debía escribir la columna');
    assert.notEqual(row.employee_count, 0);
  });

  it('8c. si la columna linkedin_url no existe, el candidato se persiste igual', async () => {
    const { stats, metadata } = await runWriter(
      { linkedinUrl: 'https://www.linkedin.com/company/merqueo', employeeCount: 470 },
      { missingLinkedInColumn: true },
    );

    // Dos intentos: el primero con la columna, el reintento sin ella.
    const attempts = stats.candidateInsertCalls;
    assert.equal(attempts.length, 2);
    assert.ok('linkedin_url' in attempts[0]);
    assert.equal('linkedin_url' in attempts[1], false);
    // El valor sigue vivo en la metadata estructurada.
    assert.equal(
      (metadata.company_linkedin as Record<string, unknown>).company_linkedin_url,
      'https://www.linkedin.com/company/merqueo',
    );
  });
});

// ─── 9–12. Contrato de completitud y conteo hacia el target ──────────────────

describe('A1-APOLLO-LINKEDIN-EMPLOYEES-1 — contrato de completitud', () => {
  const completeInput = {
    persistenceSuccess: true,
    subindustryMatch: 'confirmed' as const,
    employeeCountStatus: 'confirmed' as const,
    linkedinStatus: 'confirmed' as const,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass' as const,
    qualityGate: 'pass' as const,
  };

  it('un candidato que cumple todas las condiciones cuenta hacia el target', () => {
    const result = evaluateCandidateTargetEligibility(completeInput);
    assert.equal(result.countsTowardTarget, true);
    assert.deepEqual(result.failedConditions, []);
  });

  it('9. un candidato sin employee count no cuenta hacia el target', () => {
    for (const status of ['not_returned', 'invalid', 'mapping_failed'] as const) {
      const result = evaluateCandidateTargetEligibility({
        ...completeInput,
        employeeCountStatus: status,
      });
      assert.equal(result.countsTowardTarget, false, `status=${status}`);
      assert.ok(result.failedConditions.includes('employee_count_status'));
    }
  });

  it('10. un candidato sin LinkedIn no cuenta hacia el target', () => {
    for (const status of ['not_returned', 'invalid', 'mapping_failed'] as const) {
      const result = evaluateCandidateTargetEligibility({
        ...completeInput,
        linkedinStatus: status,
      });
      assert.equal(result.countsTowardTarget, false, `status=${status}`);
      assert.ok(result.failedConditions.includes('linkedin_status'));
    }
  });

  it('la regla es fail-closed en subindustria, duplicado y gates', () => {
    assert.equal(
      evaluateCandidateTargetEligibility({ ...completeInput, subindustryMatch: 'unknown' })
        .countsTowardTarget,
      false,
    );
    assert.equal(
      evaluateCandidateTargetEligibility({ ...completeInput, duplicateStatus: null })
        .countsTowardTarget,
      false,
    );
    assert.equal(
      evaluateCandidateTargetEligibility({
        ...completeInput,
        duplicateStatus: 'possible_duplicate',
      }).countsTowardTarget,
      false,
    );
    assert.equal(
      evaluateCandidateTargetEligibility({ ...completeInput, ownershipGate: 'unknown' })
        .countsTowardTarget,
      false,
    );
    assert.equal(
      evaluateCandidateTargetEligibility({ ...completeInput, qualityGate: 'fail' })
        .countsTowardTarget,
      false,
    );
    assert.equal(
      evaluateCandidateTargetEligibility({ ...completeInput, persistenceSuccess: false })
        .countsTowardTarget,
      false,
    );

    // La evidencia sectorial ausente NO se lee como confirmada.
    assert.equal(toSubindustryMatchVerdict(undefined), 'unknown');
    assert.equal(toSubindustryMatchVerdict(null), 'unknown');
    assert.equal(
      toSubindustryMatchVerdict('sector_evidence_missing_needs_enrichment'),
      'not_confirmed',
    );
    assert.equal(toSubindustryMatchVerdict('sector_evidence_confirmed'), 'confirmed');
  });

  it('11. un candidato incompleto se persiste como needs_review, no se descarta', async () => {
    const incomplete = evaluateCandidateTargetEligibility({
      ...completeInput,
      linkedinStatus: 'not_returned',
    });
    assert.equal(
      resolveCandidateStatusForCompleteness('high_quality_new', incomplete),
      'needs_review',
    );
    assert.equal(
      resolveCandidateStatusForCompleteness('high_quality_new', {
        countsTowardTarget: true,
        failedConditions: [],
      }),
      'high_quality_new',
    );

    // Runtime del writer: el candidato SÍ se escribe, degradado y marcado.
    const { row, metadata } = await runWriter({
      linkedinUrl: null,
      linkedinStatus: 'not_returned',
      employeeCount: 470,
    });

    assert.equal(row.status, 'needs_review');
    assert.deepEqual(row.review_flags, [INCOMPLETE_CANDIDATE_REVIEW_FLAG]);
    const targetCompleteness = metadata.target_completeness as Record<string, unknown>;
    assert.equal(targetCompleteness.counts_toward_target, false);
    assert.deepEqual(targetCompleteness.failed_conditions, ['linkedin_status']);
    // `mapQualityLabelToStatus` ya manda TODO candidato persistible a revisión, así
    // que aquí el estado base coincide con el persistido: la degradación es una red
    // de seguridad para el día en que ese mapeo cambie, no el mecanismo principal.
    // Lo que hace visible la incompletitud es la marca de revisión y este bloque.
    assert.equal(targetCompleteness.base_status, 'needs_review');
    assert.equal(targetCompleteness.persisted_status, 'needs_review');
  });

  it('12. las métricas distinguen persistidos de completos', async () => {
    const counters = buildCandidateCompletenessCounters([
      { countsTowardTarget: true, failedConditions: [] },
      { countsTowardTarget: false, failedConditions: ['linkedin_status'] },
      {
        countsTowardTarget: false,
        failedConditions: ['linkedin_status', 'employee_count_status'],
      },
    ]);

    assert.equal(counters.persisted_candidates, 3);
    assert.equal(counters.complete_valid_candidates, 1);
    assert.equal(counters.incomplete_candidates, 2);
    assert.equal(counters.target_count, 1);
    assert.equal(counters.failed_condition_counts.linkedin_status, 2);
    assert.equal(counters.failed_condition_counts.employee_count_status, 1);

    // Runtime del writer: el lote publica los cuatro contadores por separado.
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchUpdateCalls: [] };
    const input = {
      pipelineOutput: makeApolloPipelineOutput({
        linkedinUrl: null,
        linkedinStatus: 'not_returned',
        employeeCount: 470,
      }) as unknown as CandidateWriterInput['pipelineOutput'],
      triggeredByUserId: USER_A,
      ownerId: USER_A,
      source: 'agent_1' as const,
      dryRun: false,
    } as unknown as CandidateWriterInput;

    await writeProspectingCandidates(input, makeFakeAdmin(stats));

    const withCompleteness = stats.batchUpdateCalls
      .map((call) => call.metadata as Record<string, unknown> | undefined)
      .filter((metadata): metadata is Record<string, unknown> =>
        Boolean(metadata && metadata.company_fields_completeness),
      );
    assert.ok(
      withCompleteness.length > 0,
      'el lote no publicó company_fields_completeness',
    );
    const completeness = withCompleteness[withCompleteness.length - 1]
      .company_fields_completeness as Record<string, unknown>;
    assert.equal(completeness.persisted_candidates, 1);
    assert.equal(completeness.complete_valid_candidates, 0);
    assert.equal(completeness.incomplete_candidates, 1);
    assert.equal(completeness.target_count, 0);
  });
});

// ─── UI: cada estado tiene su mensaje ────────────────────────────────────────

describe('A1-APOLLO-LINKEDIN-EMPLOYEES-1 — presentación por estado', () => {
  it('la ausencia del proveedor y la pérdida interna NO se ven igual', () => {
    const notReturned = resolveLinkedInFieldDisplay(
      { company_linkedin: { linkedin_status: 'not_returned' } },
      null,
    );
    assert.equal(notReturned.kind, 'not_returned');
    assert.equal(notReturned.message, 'Apollo no devolvió LinkedIn empresarial');

    const internalLoss = resolveLinkedInFieldDisplay(
      {
        company_linkedin: {
          linkedin_status: 'confirmed',
          company_linkedin_url: 'https://www.linkedin.com/company/merqueo',
          linkedin_source_provider: 'apollo',
          linkedin_source_operation: 'organizations_search',
        },
      },
      null,
    );
    assert.equal(internalLoss.kind, 'internal_loss');
    assert.equal(internalLoss.message, 'No se pudo guardar el LinkedIn obtenido');
    assert.notEqual(internalLoss.message, notReturned.message);

    const mappingFailed = resolveLinkedInFieldDisplay(
      { company_linkedin: { linkedin_status: 'mapping_failed' } },
      null,
    );
    assert.equal(mappingFailed.kind, 'internal_loss');

    const withUrl = resolveLinkedInFieldDisplay(
      {
        company_linkedin: {
          linkedin_status: 'confirmed',
          linkedin_source_provider: 'apollo',
          linkedin_source_operation: 'organization_enrichment',
        },
      },
      'https://www.linkedin.com/company/merqueo',
    );
    assert.equal(withUrl.kind, 'value');
    assert.equal(withUrl.url, 'https://www.linkedin.com/company/merqueo');
    assert.equal(withUrl.sourceLabel, 'Fuente: Apollo · enriquecimiento de empresa');
  });

  it('el número de empleados muestra valor, fuente o el motivo real de su ausencia', () => {
    const value = resolveEmployeeCountFieldDisplay(
      {
        company_employee_count: {
          employee_count: 470,
          employee_count_status: 'confirmed',
          employee_count_source: 'apollo',
          employee_count_source_operation: 'organization_enrichment',
        },
      },
      470,
    );
    assert.equal(value.kind, 'value');
    assert.equal(value.value, 470);
    assert.equal(value.sourceLabel, 'Fuente: Apollo · enriquecimiento de empresa');

    const notReturned = resolveEmployeeCountFieldDisplay(
      { company_employee_count: { employee_count_status: 'not_returned' } },
      null,
    );
    assert.equal(notReturned.kind, 'not_returned');
    assert.equal(notReturned.message, 'Apollo no devolvió el número de empleados');

    const invalid = resolveEmployeeCountFieldDisplay(
      { company_employee_count: { employee_count_status: 'invalid' } },
      null,
    );
    assert.equal(invalid.kind, 'invalid');
    assert.equal(invalid.message, 'Apollo devolvió un número de empleados no válido');

    const internalLoss = resolveEmployeeCountFieldDisplay(
      {
        company_employee_count: {
          employee_count: 1800,
          employee_count_status: 'confirmed',
          employee_count_source: 'apollo',
        },
      },
      null,
    );
    assert.equal(internalLoss.kind, 'internal_loss');
    assert.equal(internalLoss.value, 1800);
    assert.equal(
      internalLoss.message,
      'No se pudo guardar el número de empleados obtenido',
    );

    // Un candidato de otra ruta no afirma nada sobre Apollo.
    const unknown = resolveEmployeeCountFieldDisplay({}, null);
    assert.equal(unknown.kind, 'unknown');
    assert.equal(unknown.message, null);
  });
});
