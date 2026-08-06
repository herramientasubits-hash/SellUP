/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 — el gate de subindustria
 * deja de dejar contar candidatos ambiguos o sin mapeo hacia el objetivo.
 *
 * El defecto que cierran estos tests, medido en la corrida real
 * `wizard_run_id=551fd2c2…` / `batch_id=8c86eb06…` (Colombia · Retail y Consumo
 * · Tiendas por Departamento, Moda y Calzado):
 *
 *   subindustry_confirmed        0
 *   subindustry_ambiguous        4
 *   complete_valid_candidates    3   ← LA14, Olímpica y Quala contaron sin
 *   target_count                 3     tener la subindustria confirmada.
 *
 * `candidate-writer.ts` decidía `subindustryMatch` con
 * `toSubindustryMatchVerdict(candidate.sectorEvidenceState)` — el veredicto de
 * relevancia sectorial/de INDUSTRIA, subindustria-ciego para cualquier
 * subindustria sin catálogo de anclas propio— e ignoraba por completo
 * `providerEnrichmentCapture.precision`, que YA tenía el veredicto correcto
 * (`subindustry_match: 'ambiguous'`, `subindustry_mapped: false`) para los
 * cuatro. Sólo Arturo Calle, cuya industria declarada no activó el gate
 * sectorial amplio, quedó fuera por casualidad de redacción, no por regla.
 *
 * Todo offline: sin Apollo real, sin Tavily real, sin Supabase real, sin
 * escrituras en Producción, sin HubSpot, sin gasto. Ninguna empresa real está
 * codificada — los cuatro patrones son sintéticos y reproducen el PATRÓN de
 * industria observado, no los datos reales de una compañía.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessApolloSubindustryPrecision,
  type ApolloSubindustryPrecisionAssessment,
} from '../apollo-subindustry-precision';
import {
  captureApolloEnrichmentForPersistence,
  PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES,
} from '../apollo-enrichment-persistence-capture';
import {
  resolveCandidateSubindustryRequirement,
  evaluateCandidateSubindustryTargetEligibility,
  buildCandidateCompletenessCounters,
  type CandidateCanonicalTargetEligibility,
} from '../candidate-completeness-contract';
import { resolveCandidateSubindustryStatus } from '@/modules/prospect-batches/candidate-subindustry-status-display';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidateWriterInput, CatalogContextResult } from '../types';
import type { WebSearchResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const REQUESTED_SUBINDUSTRY = 'Tiendas por Departamento, Moda y Calzado';

function providerResult(
  title: string,
  metadata: Record<string, unknown>,
): WebSearchResult {
  return {
    title,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata,
  } as unknown as WebSearchResult;
}

// ─── § A–H · resolveCandidateSubindustryRequirement ──────────────────────────

describe('§ A–H · resolveCandidateSubindustryRequirement — invariantes', () => {
  test('A/D — subindustry_mapped=false con sectorEvidenceState=confirmed NO cuenta (el defecto exacto de la corrida real)', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('LA14', { industry: 'retail', city: 'Cali' }),
      'Una Subindustria Sin Catálogo',
    );
    assert.equal(precision.subindustryMapped, false);
    assert.equal(precision.subindustryMatch, 'ambiguous');

    const requirement = resolveCandidateSubindustryRequirement({
      // El gate sectorial amplio SÍ confirmó — es exactamente lo que pasó en
      // la corrida real para LA14, Olímpica y Quala.
      sectorEvidenceState: 'sector_evidence_confirmed',
      subindustryPrecision: precision,
    });

    assert.equal(requirement.subindustryRequirementApplied, true);
    assert.equal(requirement.subindustryMapped, false);
    assert.equal(requirement.subindustryMatch, 'ambiguous');
    // La corrección: el veredicto de industria NUNCA sustituye al de subindustria.
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });

  test('A — subindustry_match=confirmed es obligatorio para contar', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('Moda Norte', { industry: 'retail', keywords: ['fashion retail'] }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'confirmed');

    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      subindustryPrecision: precision,
    });
    assert.equal(requirement.eligibilityVerdict, 'confirmed');
    assert.equal(requirement.subindustryMapped, true);
  });

  test('B — ambiguous (mapeada) no cuenta, aun con sectorEvidenceState confirmado', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('Comercial Genérica', { industry: 'retail' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMapped, true);
    assert.equal(precision.subindustryMatch, 'ambiguous');

    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      subindustryPrecision: precision,
    });
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });

  test('E — industryMatch=confirmed NUNCA convierte un veredicto ambiguo o sin mapeo en confirmado', () => {
    // industry declarado coincide con un ancla (industryMatch='confirmed'),
    // pero SIN evidencia positiva en ningún otro campo la subindustria sigue
    // sin demostrarse: el módulo exige evidencia, no basta con no contradecir.
    const precision = assessApolloSubindustryPrecision(
      providerResult('Empresa X', { industry: 'department store' }),
      REQUESTED_SUBINDUSTRY,
    );
    // La industria declarada ES un ancla ⇒ evidencia de industria también
    // cuenta como evidencia (el módulo la incluye vía CLASSIFYING_FIELDS), así
    // que este caso SÍ confirma — lo que importa es que confirma por
    // EVIDENCIA, no porque `industryMatch` se lea como sustituto.
    assert.equal(precision.subindustryMatch, 'confirmed');

    // El caso que de verdad ejercita la invariante: industria de sector
    // amplio compatible, pero SIN ningún ancla de familia.
    const broadOnly = assessApolloSubindustryPrecision(
      providerResult('Empresa Y', { industry: 'retail' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(broadOnly.industryMatch, 'broad_compatible');
    assert.notEqual(broadOnly.subindustryMatch, 'confirmed');
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      subindustryPrecision: broadOnly,
    });
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });

  test('sin subindustria pedida, la pregunta no aplica: decide sectorEvidenceState como siempre', () => {
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      subindustryPrecision: null,
    });
    assert.equal(requirement.subindustryRequirementApplied, false);
    assert.equal(requirement.subindustryMatch, 'not_requested');
    assert.equal(requirement.eligibilityVerdict, 'confirmed');

    const notConfirmed = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      subindustryPrecision: null,
    });
    assert.equal(notConfirmed.eligibilityVerdict, 'not_confirmed');
  });
});

// ─── § 8 · fixture de referencia — antes / después de la corrida real ────────

describe('§ 8 · fixture de referencia de la corrida 8c86eb06…', () => {
  /** Los cuatro patrones de industria observados, en el orden de la corrida real. */
  function fourRealWorldPatterns(): ApolloSubindustryPrecisionAssessment[] {
    return [
      assessApolloSubindustryPrecision(
        providerResult('Quala-patrón', { industry: 'food production' }),
        REQUESTED_SUBINDUSTRY,
      ),
      assessApolloSubindustryPrecision(
        providerResult('Olímpica-patrón', { industry: 'retail' }),
        REQUESTED_SUBINDUSTRY,
      ),
      assessApolloSubindustryPrecision(
        providerResult('Arturo Calle-patrón', { industry: 'textiles' }),
        REQUESTED_SUBINDUSTRY,
      ),
      assessApolloSubindustryPrecision(
        providerResult('LA14-patrón', { industry: 'retail' }),
        REQUESTED_SUBINDUSTRY,
      ),
    ];
  }

  test('ANTES (defecto): sectorEvidenceState confirmado + veredicto ignorado ⇒ 3/4 contaban', () => {
    const patterns = fourRealWorldPatterns();
    // Reproduce la lectura ANTERIOR al fix: `toSubindustryMatchVerdict` sólo
    // conocía `sectorEvidenceState`. Con el gate amplio confirmando a tres de
    // los cuatro (el patrón real observado) y el cuarto sin confirmar por la
    // industria declarada, ASÍ contaban antes.
    const legacySectorEvidenceStates = [
      'sector_evidence_confirmed', // Quala
      'sector_evidence_confirmed', // Olímpica
      'sector_evidence_missing_needs_enrichment', // Arturo Calle
      'sector_evidence_confirmed', // LA14
    ] as const;

    const legacyCountsTowardTarget = legacySectorEvidenceStates.map(
      (state) => state === 'sector_evidence_confirmed',
    );
    assert.equal(legacyCountsTowardTarget.filter(Boolean).length, 3);
    // Lo que importa de los cuatro veredictos REALES: ninguno es `confirmed`,
    // sin importar si cada uno resuelve a `ambiguous` o a `rejected` (el
    // patrón de industria de cada empresa decide cuál, y eso es correcto:
    // ver § 6 casos D/E). El defecto nunca estuvo en el veredicto de
    // subindustria —que ya era fail-closed— sino en que el writer lo ignoraba.
    assert.equal(patterns.filter((p) => p.subindustryMatch === 'confirmed').length, 0);
  });

  test('DESPUÉS (corregido): los cuatro resuelven por el veredicto de subindustria, ninguno cuenta', () => {
    const patterns = fourRealWorldPatterns();
    const legacySectorEvidenceStates = [
      'sector_evidence_confirmed',
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_confirmed',
    ] as const;

    const eligibilities: CandidateCanonicalTargetEligibility[] = patterns.map(
      (precision, index) =>
        evaluateCandidateSubindustryTargetEligibility({
          persistenceSuccess: true,
          sectorEvidenceState: legacySectorEvidenceStates[index],
          subindustryPrecision: precision,
          employeeCountStatus: 'confirmed',
          linkedinStatus: 'confirmed',
          duplicateStatus: 'no_match',
          ownershipGate: 'pass',
          qualityGate: 'pass',
        }),
    );

    assert.ok(eligibilities.every((e) => e.countsTowardTarget === false));
    assert.ok(eligibilities.every((e) => e.completeValid === false));
    assert.ok(eligibilities.every((e) => e.reviewOnly === true));
    assert.ok(
      eligibilities.every((e) => e.reviewOnlyReasons.includes('subindustry_match')),
    );

    const counters = buildCandidateCompletenessCounters(eligibilities);
    assert.equal(counters.persisted_candidates, 4);
    // Exactamente el resultado obligatorio del § 8: 0, no 3.
    assert.equal(counters.complete_valid_candidates, 0);
    assert.equal(counters.review_only_candidates, 4);
    assert.equal(counters.target_count, 0);
    const targetEligibleCompanies = 5;
    const targetReached = counters.target_count >= targetEligibleCompanies;
    assert.equal(targetReached, false);
  });
});

// ─── Integración real del writer — providerEnrichmentCapture, no sectorEvidenceState ─

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

type FakeAdminStats = { candidateInsertCalls: Record<string, unknown>[] };

function makeFakeAdmin(stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;
  return {
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
          update() {
            return new ChainResult({ error: null });
          },
          insert() {
            return {
              select() {
                return {
                  single: () =>
                    Promise.resolve({ data: { id: 'batch-subindustry-fail-closed-1' }, error: null }),
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
            const id = `cand-subindustry-fail-closed-${++candidateSeq}`;
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
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

/**
 * Candidato mínimo, real en forma, para ejercitar `writeProspectingCandidates`
 * de punta a punta con un `providerEnrichmentCapture.precision` real —no un
 * doble que reimplemente la regla.
 */
function makeCandidateFixture(options: {
  name: string;
  industry: string;
  sectorEvidenceState: string;
  requestedSubindustry?: string | null;
}) {
  const requestedSubindustry =
    options.requestedSubindustry === undefined ? REQUESTED_SUBINDUSTRY : options.requestedSubindustry;
  const precision = assessApolloSubindustryPrecision(
    providerResult(options.name, { industry: options.industry }),
    requestedSubindustry,
  );
  const capture = captureApolloEnrichmentForPersistence({
    result: providerResult(options.name, { industry: options.industry }),
    precision,
    provenance: {
      sourceProvider: 'apollo',
      sourceOperation: 'organization_enrichment',
      sourceRequestId: 'organization_enrichment:test-batch:test-request',
      observedAt: '2026-08-06T14:26:42.000Z',
    },
  });

  // `.com.co` — dominio con TLD reconocido por el ownership gate y evidencia de
  // país fuerte, igual que las cuatro empresas reales de la corrida `8c86eb06…`.
  const slug = options.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const domain = `${slug}.com.co`;
  const candidate = {
    name: options.name,
    website: `https://www.${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: `https://www.${domain}`,
    sourceTitle: options.name,
    sourceSnippet: `Empresa: ${options.name} | País: Colombia`,
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
    sectorEvidenceState: options.sectorEvidenceState,
    providerEnrichmentCapture: capture,
    companyLinkedInUrl: 'https://www.linkedin.com/company/test',
    // El ICP size gate lee este campo TOP-LEVEL (`extractCandidateCompanySize`),
    // no `providerCompanyFields.employeeCount`: sin él, tamaño desconocido
    // bloquea al candidato antes de llegar al contrato de completitud.
    employeeCount: 1500,
    providerCompanyFields: {
      linkedin: {
        companyLinkedInUrl: 'https://www.linkedin.com/company/test',
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-08-06T14:26:42.000Z',
        rawValue: 'https://www.linkedin.com/company/test',
        reason: null,
      },
      employeeCount: {
        employeeCount: 1500,
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-08-06T14:26:42.000Z',
        rawValue: 1500,
        reason: null,
      },
    },
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name: options.name, website: null, domain: null },
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

  return { candidate, precision };
}

async function runWriterWithCandidates(
  candidates: ReturnType<typeof makeCandidateFixture>['candidate'][],
): Promise<{ rows: Record<string, unknown>[] }> {
  const stats: FakeAdminStats = { candidateInsertCalls: [] };
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
      requested: candidates.length,
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
      executedAt: '2026-08-06T14:26:42.000Z',
      total_raw_evaluated: candidates.length,
      subindustries: [REQUESTED_SUBINDUSTRY],
    },
  };

  const input = {
    pipelineOutput: pipelineOutput as unknown as CandidateWriterInput['pipelineOutput'],
    triggeredByUserId: 'aaaaaaaa-0000-0000-0000-000000000001',
    ownerId: 'aaaaaaaa-0000-0000-0000-000000000001',
    source: 'agent_1' as const,
    dryRun: false,
    extraBatchMetadata: { subindustries: [REQUESTED_SUBINDUSTRY] },
  } as unknown as CandidateWriterInput;

  await writeProspectingCandidates(input, makeFakeAdmin(stats));
  return { rows: stats.candidateInsertCalls };
}

describe('Integración real del writer — providerEnrichmentCapture decide, no sectorEvidenceState', () => {
  it('un candidato con sectorEvidenceState=confirmed pero subindustria sin mapear NO cuenta hacia el objetivo', async () => {
    const { candidate } = makeCandidateFixture({
      // ASCII a propósito: el slug del fixture no transliteral tildes igual
      // que `company-ownership-gate.ts`, y un acento en el nombre desalinea el
      // dominio sintético con el nombre — nada que ver con la regla que este
      // test ejercita.
      name: 'Bazar Uno',
      industry: 'retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
      // Subindustria genuinamente SIN catálogo (distinta de la ya mapeada por
      // este PR), para ejercitar el caso `subindustry_mapped: false` de punta
      // a punta a través del writer real.
      requestedSubindustry: 'Software Empresarial (SaaS / ERP / CRM)',
    });

    const { rows } = await runWriterWithCandidates([candidate]);
    assert.equal(rows.length, 1);
    const metadata = rows[0].metadata as Record<string, unknown>;
    const targetCompleteness = metadata.target_completeness as Record<string, unknown>;

    assert.equal(targetCompleteness.counts_toward_target, false);
    assert.deepEqual(targetCompleteness.failed_conditions, ['subindustry_match']);
    assert.equal(targetCompleteness.subindustry_requirement_applied, true);
    assert.equal(targetCompleteness.subindustry_mapped, false);
    assert.equal(targetCompleteness.subindustry_match, 'ambiguous');
    assert.equal(rows[0].status, 'needs_review');

    // La columna de clasificación se queda intacta: sin subindustria
    // confirmada no hay nada que clasificar. Cero riesgo de 23514.
    assert.equal('classification_source' in rows[0], false);
  });

  it('un candidato con evidencia positiva de la subindustria SÍ cuenta, y classification_source es compatible con la CHECK 093', async () => {
    const { candidate } = makeCandidateFixture({
      name: 'Moda Confirmada',
      industry: 'fashion retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
    });

    const { rows } = await runWriterWithCandidates([candidate]);
    const metadata = rows[0].metadata as Record<string, unknown>;
    const targetCompleteness = metadata.target_completeness as Record<string, unknown>;

    assert.equal(targetCompleteness.counts_toward_target, true);
    assert.deepEqual(targetCompleteness.failed_conditions, []);
    assert.equal(targetCompleteness.subindustry_mapped, true);
    assert.equal(targetCompleteness.subindustry_match, 'confirmed');

    // FORENSICS-1 / PR #238 — la columna lleva el vocabulario de QUIÉN
    // clasificó ('writer'), nunca el de la EVIDENCIA. Ese es el defecto que
    // producía el error 23514 contra la CHECK de la migración 093.
    assert.equal(rows[0].classification_source, 'writer');
    assert.ok(
      PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES.includes(
        rows[0].classification_source as never,
      ),
      'classification_source debe estar en el dominio de la CHECK 093',
    );
  });

  it('cuatro candidatos con el patrón real de la corrida 8c86eb06…: ninguno cuenta, target_count=0', async () => {
    // ASCII a propósito — ver nota en el primer test de este describe.
    const patterns = [
      { name: 'Bazar Uno', industry: 'food production' },
      { name: 'Bazar Dos', industry: 'retail' },
      { name: 'Bazar Tres', industry: 'textiles' },
      { name: 'Bazar Cuatro', industry: 'retail' },
    ];

    const candidates = patterns.map(({ name, industry }) =>
      makeCandidateFixture({ name, industry, sectorEvidenceState: 'sector_evidence_confirmed' })
        .candidate,
    );

    const { rows } = await runWriterWithCandidates(candidates);
    assert.equal(rows.length, 4);

    const countsTowardTarget = rows.map(
      (row) => (row.metadata as Record<string, unknown>).target_completeness as Record<string, unknown>,
    ).map((tc) => tc.counts_toward_target);

    // El resultado obligatorio del § 8: cero, no tres.
    assert.deepEqual(countsTowardTarget, [false, false, false, false]);
    assert.ok(rows.every((row) => row.status === 'needs_review'));
  });
});

// ─── UI — verdicto «Sin mapeo», distinto de «Ambigua» ────────────────────────

describe('§ 9 · UI — «Sin mapeo» es distinto de «Ambigua», nunca contradictorio', () => {
  function unmappedCandidateMetadata(): Record<string, unknown> {
    return {
      apollo_enrichment_capture: {
        precision: {
          requested_subindustry: REQUESTED_SUBINDUSTRY,
          subindustry_mapped: false,
          industry_match: 'unknown',
          subindustry_match: 'ambiguous',
          subindustry_confidence: 0,
          subindustry_evidence: [],
          classification_source: 'none',
          disqualifying_signals: [],
          verdict_reason: 'subindustry_not_mapped',
        },
      },
      target_completeness: {
        counts_toward_target: false,
        failed_conditions: ['subindustry_match'],
        base_status: 'needs_review',
        persisted_status: 'needs_review',
      },
    };
  }

  it('el veredicto de pantalla es «unmapped», no «ambiguous»', () => {
    const status = resolveCandidateSubindustryStatus(unmappedCandidateMetadata());
    assert.equal(status.verdict, 'unmapped');
    assert.equal(status.verdictLabel, 'Sin mapeo');
  });

  it('el mensaje explica la ausencia de reglas, no una evidencia insuficiente', () => {
    const status = resolveCandidateSubindustryStatus(unmappedCandidateMetadata());
    assert.match(
      String(status.notConfirmedMessage),
      /todavía no tiene reglas suficientes/,
    );
  });

  it('nunca cuenta hacia el objetivo', () => {
    const status = resolveCandidateSubindustryStatus(unmappedCandidateMetadata());
    assert.equal(status.countsTowardTarget, false);
    assert.equal(status.countsTowardTargetLabel, 'No');
  });

  it('el motivo de revisión es «Subindustria sin mapeo», no «Subindustria ambigua»', () => {
    const status = resolveCandidateSubindustryStatus(unmappedCandidateMetadata());
    assert.deepEqual(
      status.reviewReasons.map((r) => r.key),
      ['subindustry_not_mapped'],
    );
  });

  it('contrato de imposibilidad: Ambigua/Sin mapeo + Cuenta=Sí nunca puede darse', () => {
    // No es una aserción sobre datos: es estructural. `resolveCandidateSubindustryStatus`
    // sólo puede devolver `countsTowardTarget: true` leyendo `counts_toward_target`
    // de la metadata, y el writer sólo lo persiste como `true` cuando
    // `subindustryMatch === 'confirmed'` (ver § A del contrato). Ambigua y Sin
    // mapeo excluyen `confirmed` por construcción del evaluador — no hay
    // combinación de metadata real que produzca la contradicción.
    for (const mapped of [true, false]) {
      const status = resolveCandidateSubindustryStatus({
        apollo_enrichment_capture: {
          precision: {
            requested_subindustry: REQUESTED_SUBINDUSTRY,
            subindustry_mapped: mapped,
            subindustry_match: 'ambiguous',
          },
        },
        target_completeness: { counts_toward_target: false, failed_conditions: ['subindustry_match'] },
      });
      assert.ok(status.verdict === 'ambiguous' || status.verdict === 'unmapped');
      assert.equal(status.countsTowardTarget, false);
    }
  });
});
