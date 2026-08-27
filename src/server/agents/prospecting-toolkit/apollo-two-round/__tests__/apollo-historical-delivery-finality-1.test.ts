/**
 * apollo-historical-delivery-finality-1.test.ts
 *
 * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY — cobertura CONDUCTUAL de la
 * PERMANENCIA de la memoria de entrega.
 *
 * Lo que este corte cierra: `discarded` fuera de cooldown (31 d revisado / 91 d
 * sin revisar) volvía a ser una empresa NUEVA. Agente 1 la había entregado, la
 * usuaria la había descartado y meses después Apollo la volvía a COBRAR y a
 * entregar como si nunca hubiera existido.
 *
 * Cada caso atraviesa la ruta REAL (adaptador de producción → orquestador →
 * gates baratos reales → evaluador histórico) y lo que se afirma es lo único que
 * importa económicamente:
 *
 *   enrichCascade / enrichOrganization NO se invocan  ·  0 filas  ·  0 accepted
 *
 * Todo offline por inyección.
 * REAL_PROVIDER_CALLS = 0 · REAL_CREDITS = 0 · HUBSPOT_WRITES = 0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import { defaultApolloTwoRoundConfig } from '../index';
import { captureApolloCompanyFields } from '../../apollo-company-fields-mapping';
import type { NoveltyIndex } from '../../novelty-checker';
import type {
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_OBSERVED_AT = '2026-08-10T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Edad REAL contra el reloj del proceso. `evaluateCandidateNovelty` compara con
 * `Date.now()`, así que una fecha fija de fixture convertiría «31 días» en
 * cualquier otra cosa el día que se ejecute la suite.
 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function correlation(overrides: Record<string, string> = {}) {
  return {
    wizardRunId: 'run-1',
    clientRequestId: 'client-A',
    batchId: 'batch-A',
    reservationId: 'reservation-A',
    requestFingerprint: 'fingerprint-A',
    idempotencyKey: 'idempotency-A',
    ...overrides,
  };
}

/**
 * 🔴 Evidencia sectorial AMBIGUA a propósito: es la única forma de que estas
 * pruebas no sean vacías. Un candidato cuyo sector las señales gratuitas ya
 * CONFIRMAN nunca compite por un enrichment, así que afirmar «0 enrichment»
 * sobre él no probaría nada. El control § C de esta suite demuestra que con
 * evidencia ambigua y SIN historia el enrichment SÍ se compra.
 */
function ambiguousCompany(options: {
  id: string;
  name: string;
  domain: string;
  rank?: number;
}): WebSearchResult {
  return {
    title: options.name,
    url: `https://${options.domain}`,
    snippet: 'compañía colombiana con operaciones en Bogotá',
    source: 'apollo_organizations',
    rank: options.rank ?? 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: options.id,
      domain: options.domain,
      industry: null,
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 500,
      estimated_num_employees: 500,
      linkedin_url: `https://www.linkedin.com/company/${options.id}`,
      apollo_profile: { industry: null, industries: [] },
    },
  };
}

function searchOutput(results: WebSearchResult[], credits = 1): WebSearchOutput {
  return {
    provider: 'apollo_organizations',
    query: 'supermercados',
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: { usage: { credits_used: credits } },
  };
}

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
  const providerCompanyFields = captureApolloCompanyFields(result, FIXTURE_OBSERVED_AT);
  return {
    name: result.title,
    website: result.url,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Supermercados e Hipermercados',
    sourceUrl: result.url,
    sourceTitle: result.title,
    sourceSnippet: result.snippet ?? null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 0,
      input: { name: result.title, domain },
      matches: [],
      summary: 'test',
      checkedSources: ['sellup', 'hubspot'],
    } as ProspectingPipelineCandidate['duplicateCheck'],
    scoring: {
      qualityLabel: 'high_quality_new',
    } as ProspectingPipelineCandidate['scoring'],
    providerCompanyFields,
    companyLinkedInUrl: providerCompanyFields.linkedin.companyLinkedInUrl,
    ...(providerCompanyFields.employeeCount.status === 'confirmed'
      ? { employeeCount: providerCompanyFields.employeeCount.employeeCount }
      : {}),
  };
}

/**
 * Fila histórica de `prospect_candidates`, como la devuelve `buildNoveltyIndex`
 * — incluidas las tres columnas de procedencia que el clasificador canónico lee.
 */
function historyRow(options: {
  domain: string;
  name: string;
  status: string;
  batchId?: string;
  /** Días desde la revisión. `null` ⇒ `reviewed_at IS NULL` (memoria negativa). */
  reviewedDaysAgo?: number | null;
  ageDays?: number;
  duplicateStatus?: string;
  sourcePrimary?: string | null;
  reviewNotes?: string | null;
  metadata?: Record<string, unknown>;
  taxIdentifier?: string | null;
  countryCode?: string | null;
}): Record<string, unknown> {
  const age = daysAgo(options.ageDays ?? 400);
  return {
    id: `hist-${options.domain}`,
    batch_id: options.batchId ?? 'batch-historico',
    name: options.name,
    domain: options.domain,
    website: `https://${options.domain}`,
    status: options.status,
    duplicate_status: options.duplicateStatus ?? 'new_candidate',
    reviewed_at:
      options.reviewedDaysAgo === null || options.reviewedDaysAgo === undefined
        ? null
        : daysAgo(options.reviewedDaysAgo),
    updated_at: age,
    created_at: age,
    metadata: options.metadata ?? {},
    tax_id: null,
    tax_identifier: options.taxIdentifier ?? null,
    country_code: options.countryCode === undefined ? 'CO' : options.countryCode,
    source_primary: options.sourcePrimary ?? null,
    review_notes: options.reviewNotes ?? null,
  };
}

type Recorder = {
  searchCalls: number;
  enrichCascadeCalls: string[];
  enrichOrganizationCalls: number;
  persistedCandidateNames: string[];
  historicalLoadedDomains: string[][];
  observedRejectionReasons: string[];
};

function buildDeps(options: {
  rounds: WebSearchOutput[];
  history?: Record<string, Record<string, unknown>[]>;
  historyDegraded?: boolean;
  excludedDomains?: string[];
  enrichmentConfirms?: string[];
  config?: Partial<ReturnType<typeof defaultApolloTwoRoundConfig>>;
}): { deps: Partial<ApolloTwoRoundProductionDeps>; recorder: Recorder } {
  const recorder: Recorder = {
    searchCalls: 0,
    enrichCascadeCalls: [],
    enrichOrganizationCalls: 0,
    persistedCandidateNames: [],
    historicalLoadedDomains: [],
    observedRejectionReasons: [],
  };

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async () => {
      const output = options.rounds[recorder.searchCalls] ?? searchOutput([], 0);
      recorder.searchCalls++;
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async (
      results: WebSearchResult[],
      _cap: number,
      hooks?: { enrichOrg?: (params: unknown) => Promise<unknown> },
    ) => {
      const domain = (results[0]?.metadata?.['domain'] as string) ?? '';
      recorder.enrichCascadeCalls.push(domain);
      if (hooks?.enrichOrg) await hooks.enrichOrg({ domain });
      const confirms = options.enrichmentConfirms?.includes(domain) ?? false;
      const enriched = confirms
        ? results.map((r) => ({
            ...r,
            snippet: `${r.snippet ?? ''} cadena de supermercados y autoservicio con tiendas de abarrotes`,
          }))
        : results;
      return {
        results: enriched,
        meta: {
          enabled: true,
          cascade_version: 'test',
          entries: [{ domain, enriched: true, fields_added: [] }],
        },
      };
    }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    enrichOrganization: (async () => {
      recorder.enrichOrganizationCalls++;
      return { success: true, data: undefined };
    }) as never,

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
      recorder.persistedCandidateNames = writerInput.pipelineOutput.candidates.map(
        (c) => c.name,
      );
      return {
        dryRun: false,
        batchId: 'batch-A',
        candidatesCreated: writerInput.pipelineOutput.candidates.length,
        candidatesSkipped: 0,
        createdCandidateIds: writerInput.pipelineOutput.candidates.map(
          (_c, i) => `candidate-${i + 1}`,
        ),
        skipped: [],
        status: 'success',
        errors: [],
      };
    }) as unknown as ApolloTwoRoundProductionDeps['persistCandidates'],

    loadNegativeMemory: async (scope) => ({
      scope,
      excludedDomains: new Set<string>(options.excludedDomains ?? []),
      excludedDomainsSample: options.excludedDomains ?? [],
      excludedIdentityKeys: new Set<string>(),
      excludedIdentityKeysSample: [],
      previousCandidateCount: (options.excludedDomains ?? []).length,
      previousBatchCount: (options.excludedDomains ?? []).length > 0 ? 1 : 0,
    }),

    loadPrepaidHistoricalIndex: async ({ domains }) => {
      recorder.historicalLoadedDomains.push([...domains]);
      if (options.historyDegraded === true) {
        return { index: new Map() as NoveltyIndex, degraded: true };
      }
      const index = new Map<string, unknown[]>();
      for (const domain of domains) {
        const rows = options.history?.[domain];
        if (rows && rows.length > 0) index.set(domain, rows);
      }
      return { index: index as unknown as NoveltyIndex, degraded: false };
    },

    loadCheckpoint: async () => null,
    saveCheckpoint: async (_batchId, checkpoint) => {
      for (const reason of checkpoint.observed_rejection_reasons ?? []) {
        if (!recorder.observedRejectionReasons.includes(reason)) {
          recorder.observedRejectionReasons.push(reason);
        }
      }
      return {
        kind: 'written',
        checkpointVersion: checkpoint.checkpoint_version,
        serializedBytes: 0,
        compacted: false,
      };
    },
    loadEnrichmentUnitCostUsd: async () => 0.02,
    logEnrichmentUsage: (async () => ({ kind: 'logged' as const })) as never,
    resolveConfig: () => ({ ...defaultApolloTwoRoundConfig(), ...(options.config ?? {}) }),
  };

  return { deps, recorder };
}

function runInput(
  overrides: Partial<ApolloTwoRoundWizardRunInput> = {},
): ApolloTwoRoundWizardRunInput {
  const corr = (overrides.correlation ?? correlation()) as ReturnType<typeof correlation>;
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Supermercados e Hipermercados',
    subindustries: [],
    additionalCriteria: null,
    reservedBatchId: corr.batchId,
    triggeredByUserId: 'user-1',
    ownerId: 'user-1',
    correlation: corr,
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: 12,
    ...overrides,
  } as ApolloTwoRoundWizardRunInput;
}

/**
 * Corre una empresa AMBIGUA contra UNA fila histórica y devuelve las tres cifras
 * que gobiernan el corte.
 */
async function runAgainstHistory(options: {
  domain: string;
  name: string;
  row?: Record<string, unknown>;
  enrichmentConfirms?: boolean;
}): Promise<{
  enrichmentCalls: string[];
  enrichOrganizationCalls: number;
  persisted: string[];
  /**
   * `undefined` cuando la corrida no llegó a declarar el conteo. NO se colapsa a
   * 0: «no informó nada» no es prueba de «creó 0», y las aserciones exigen el 0
   * explícito.
   */
  candidatesCreated: number | undefined;
  rejectionReasons: string[];
  historicalLoadedDomains: string[][];
}> {
  const { deps, recorder } = buildDeps({
    rounds: [
      searchOutput([
        ambiguousCompany({ id: 'org-1', name: options.name, domain: options.domain }),
      ]),
    ],
    history: options.row ? { [options.domain]: [options.row] } : {},
    enrichmentConfirms: options.enrichmentConfirms === false ? [] : [options.domain],
  });
  const result = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
  return {
    enrichmentCalls: recorder.enrichCascadeCalls,
    enrichOrganizationCalls: recorder.enrichOrganizationCalls,
    persisted: recorder.persistedCandidateNames,
    candidatesCreated: result.candidatesCreated,
    rejectionReasons: recorder.observedRejectionReasons,
    historicalLoadedDomains: recorder.historicalLoadedDomains,
  };
}

function assertBlocked(
  outcome: Awaited<ReturnType<typeof runAgainstHistory>>,
  label: string,
): void {
  assert.deepEqual(outcome.enrichmentCalls, [], `${label}: enrichmentCalls debe ser 0`);
  assert.equal(
    outcome.enrichOrganizationCalls,
    0,
    `${label}: enrichOrganization debe ser 0`,
  );
  assert.deepEqual(outcome.persisted, [], `${label}: 0 filas nuevas`);
  assert.equal(outcome.candidatesCreated, 0, `${label}: accepted-for-target = 0`);
  assert.ok(
    outcome.rejectionReasons.includes('cooldown_or_prior_suggestion'),
    `${label}: el rechazo debe CONSTAR — observados: ${JSON.stringify(outcome.rejectionReasons)}`,
  );
}

// ─── § 9 · discarded CON revisión: la ventana de 30 d ya no rehabilita ────────

describe('§ 9 · discarded revisado — la memoria de entrega es permanente', () => {
  test('5 días (DENTRO del viejo cooldown): 0 enrichment, 0 fila', async () => {
    const outcome = await runAgainstHistory({
      domain: 'superequis.com.co',
      name: 'Superequis',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 5,
        ageDays: 40,
      }),
    });
    assertBlocked(outcome, 'discarded reviewed 5d');
  });

  test('🔴 31 días (FUERA del cooldown de 30 d): antes volvía a entrar; ahora NO', async () => {
    const outcome = await runAgainstHistory({
      domain: 'superequis.com.co',
      name: 'Superequis',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 31,
        ageDays: 90,
      }),
    });
    assertBlocked(outcome, 'discarded reviewed 31d');
  });

  test('200 días: mismo resultado — la edad no rehabilita', async () => {
    const outcome = await runAgainstHistory({
      domain: 'superequis.com.co',
      name: 'Superequis',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 200,
        ageDays: 240,
      }),
    });
    assertBlocked(outcome, 'discarded reviewed 200d');
  });
});

// ─── § 10 · discarded SIN revisión: la ventana de 90 d ya no rehabilita ───────

describe('§ 10 · discarded sin revisión — memoria negativa permanente', () => {
  for (const ageDays of [31, 91, 200]) {
    test(`${ageDays} días sin reviewed_at: 0 enrichment, 0 fila`, async () => {
      const outcome = await runAgainstHistory({
        domain: 'superequis.com.co',
        name: 'Superequis',
        row: historyRow({
          domain: 'superequis.com.co',
          name: 'Superequis',
          status: 'discarded',
          reviewedDaysAgo: null,
          ageDays,
        }),
      });
      assertBlocked(outcome, `discarded unreviewed ${ageDays}d`);
    });
  }
});

// ─── § 16 · historia de un AÑO ───────────────────────────────────────────────

describe('§ 16 · una entrega de hace 365 días sigue siendo una entrega', () => {
  test('discarded 365 d: enrichmentCalls = 0', async () => {
    const outcome = await runAgainstHistory({
      domain: 'superequis.com.co',
      name: 'Superequis',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 365,
        ageDays: 380,
      }),
    });
    assertBlocked(outcome, 'discarded 365d');
  });
});

// ─── § 11 / § 12 / § 13 · paridad del resto de la matriz ─────────────────────

describe('§ 11 / § 12 / § 13 · la matriz completa de estados sigue cerrada', () => {
  const cases: { status: string; reviewedDaysAgo: number | null; label: string }[] = [
    { status: 'duplicate', reviewedDaysAgo: 500, label: 'duplicate 500d (§ 11)' },
    { status: 'approved', reviewedDaysAgo: 200, label: 'approved 200d (§ 12)' },
    {
      status: 'converted_to_account',
      reviewedDaysAgo: 200,
      label: 'converted_to_account 200d (§ 12)',
    },
    { status: 'generated', reviewedDaysAgo: null, label: 'generated antiguo (§ 13)' },
    { status: 'normalized', reviewedDaysAgo: null, label: 'normalized antiguo (§ 13)' },
    { status: 'needs_review', reviewedDaysAgo: null, label: 'needs_review antiguo' },
  ];

  for (const scenario of cases) {
    test(`${scenario.label}: 0 enrichment, 0 fila`, async () => {
      const outcome = await runAgainstHistory({
        domain: 'superequis.com.co',
        name: 'Superequis',
        row: historyRow({
          domain: 'superequis.com.co',
          name: 'Superequis',
          status: scenario.status,
          reviewedDaysAgo: scenario.reviewedDaysAgo,
          ageDays: 400,
        }),
      });
      assertBlocked(outcome, scenario.label);
    });
  }
});

// ─── § 15 · multi-ejecución REAL ─────────────────────────────────────────────

describe('§ 15 · dos ejecuciones distintas, la empresa entregada y descartada', () => {
  test('ejecución B (otro clientRequestId, otro lote): 0 enrichment, 0 fila', async () => {
    // EJECUCIÓN A — se paga y se entrega. Punto de partida de la historia.
    const { deps: depsA, recorder: recA } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-x', name: 'Superequis', domain: 'superequis.com.co' }),
        ]),
      ],
      enrichmentConfirms: ['superequis.com.co'],
    });
    const first = await runApolloTwoRoundWizardDiscovery(
      runInput({ correlation: correlation() }),
      depsA,
    );
    assert.deepEqual(recA.enrichCascadeCalls, ['superequis.com.co']);
    assert.deepEqual(recA.persistedCandidateNames, ['Superequis']);
    assert.equal(first.batchId, 'batch-A');

    // La usuaria la DESCARTA, y pasan 200 días.
    // EJECUCIÓN B — otra correlación, otro lote. La historia no viaja por
    // checkpoint: viaja por `prospect_candidates`.
    const { deps: depsB, recorder: recB } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-x', name: 'Superequis', domain: 'superequis.com.co' }),
        ]),
      ],
      history: {
        'superequis.com.co': [
          historyRow({
            domain: 'superequis.com.co',
            name: 'Superequis',
            status: 'discarded',
            batchId: 'batch-A',
            reviewedDaysAgo: 200,
            ageDays: 240,
          }),
        ],
      },
      enrichmentConfirms: ['superequis.com.co'],
    });
    const second = await runApolloTwoRoundWizardDiscovery(
      runInput({
        correlation: correlation({
          clientRequestId: 'client-B',
          batchId: 'batch-B',
          reservationId: 'reservation-B',
          requestFingerprint: 'fingerprint-B',
          idempotencyKey: 'idempotency-B',
        }),
      }),
      depsB,
    );

    assert.notEqual('client-A', 'client-B');
    assert.deepEqual(recB.enrichCascadeCalls, [], 'ENRICHMENT sobre X debe ser 0');
    assert.equal(recB.enrichOrganizationCalls, 0);
    assert.deepEqual(recB.persistedCandidateNames, [], 'X no se persiste como nueva');
    assert.equal(second.candidatesCreated, 0, 'accepted-for-target = 0');
    assert.ok(recB.observedRejectionReasons.includes('cooldown_or_prior_suggestion'));
  });
});

// ─── § 17 · cross-source ─────────────────────────────────────────────────────

describe('§ 17 · una entrega descartada de OTRA fuente también es histórica', () => {
  test('lote histórico source != agent_1, discarded 200 d: bloqueado pre-pago', async () => {
    const outcome = await runAgainstHistory({
      domain: 'superefe.com.co',
      name: 'Superefe',
      row: historyRow({
        domain: 'superefe.com.co',
        name: 'Superefe',
        status: 'discarded',
        // Entregada por la ruta GRATUITA (`socrata_colombia`): el ámbito NO es la
        // etiqueta del lote, es la FILA.
        batchId: 'batch-socrata-1',
        sourcePrimary: 'socrata_colombia',
        reviewedDaysAgo: 200,
        ageDays: 240,
      }),
    });
    assertBlocked(outcome, 'cross-source discarded 200d');
  });
});

// ─── § C · CONTROL de que la suite no es vacía ───────────────────────────────

describe('§ C · control — sin historia, la misma empresa SÍ se compra', () => {
  test('sin fila histórica: enrichment ocurre y el candidato se persiste', async () => {
    const outcome = await runAgainstHistory({
      domain: 'supernueva.com.co',
      name: 'Supernueva',
      row: undefined,
    });
    assert.deepEqual(
      outcome.enrichmentCalls,
      ['supernueva.com.co'],
      'sin historia el enrichment DEBE ocurrir: si no, «0 enrichment» no prueba nada',
    );
    assert.deepEqual(outcome.persisted, ['Supernueva']);
    assert.equal(outcome.candidatesCreated, 1);
  });
});

// ─── § 18 · control de FALSO POSITIVO ────────────────────────────────────────

describe('§ 18 · mismo nombre, dominio distinto: NO se bloquea', () => {
  test('Siesa/siesa.com histórico no bloquea Siesa/siesa-enterprise.com.co', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({
            id: 'org-siesa-2',
            name: 'Siesa',
            domain: 'siesa-enterprise.com.co',
          }),
        ]),
      ],
      // La fila histórica se indexa por SU dominio: nunca coincide con el nuevo.
      history: {
        'siesa.com': [
          historyRow({
            domain: 'siesa.com',
            name: 'Siesa',
            status: 'discarded',
            reviewedDaysAgo: 200,
            ageDays: 240,
          }),
        ],
      },
      enrichmentConfirms: ['siesa-enterprise.com.co'],
    });
    const result = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(
      recorder.enrichCascadeCalls,
      ['siesa-enterprise.com.co'],
      'dos empresas DISTINTAS que comparten nombre no se sacrifican por la permanencia',
    );
    assert.deepEqual(recorder.persistedCandidateNames, ['Siesa']);
    assert.equal(result.candidatesCreated, 1);
  });
});

// ─── § 19 · variantes del MISMO dominio ──────────────────────────────────────

describe('§ 19 · variantes de dominio resuelven a la misma identidad histórica', () => {
  for (const variant of [
    'https://www.superequis.com.co',
    'www.superequis.com.co/',
    'SUPEREQUIS.COM.CO',
  ]) {
    test(`la fila histórica escrita como «${variant}» sigue bloqueando`, async () => {
      const { deps, recorder } = buildDeps({
        rounds: [
          searchOutput([
            ambiguousCompany({
              id: 'org-x',
              name: 'Superequis',
              domain: 'superequis.com.co',
            }),
          ]),
        ],
        history: {
          // El índice se sigue construyendo con la clave normalizada —así lo hace
          // `buildNoveltyIndex`—, pero la COLUMNA de la fila trae la variante.
          'superequis.com.co': [
            {
              ...historyRow({
                domain: 'superequis.com.co',
                name: 'Superequis',
                status: 'discarded',
                reviewedDaysAgo: 200,
                ageDays: 240,
              }),
              domain: variant,
            },
          ],
        },
        enrichmentConfirms: ['superequis.com.co'],
      });
      const result = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
      assert.deepEqual(recorder.enrichCascadeCalls, [], variant);
      assert.deepEqual(recorder.persistedCandidateNames, [], variant);
      assert.equal(result.candidatesCreated, 0, variant);
    });
  }
});

// ─── § 2 · procedencia no productiva NO congela un dominio real ──────────────

describe('§ 2 · smoke/QA descartado NO es una entrega', () => {
  const nonProductive: { label: string; row: Record<string, unknown> }[] = [
    {
      label: 'metadata.smoke_test',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 365,
        ageDays: 380,
        metadata: { smoke_test: true },
      }),
    },
    {
      label: 'source_primary = smoke_script',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 365,
        ageDays: 380,
        sourcePrimary: 'smoke_script',
      }),
    },
  ];

  for (const scenario of nonProductive) {
    test(`${scenario.label}: NO bloquea — el enrichment puede ocurrir`, async () => {
      const outcome = await runAgainstHistory({
        domain: 'superequis.com.co',
        name: 'Superequis',
        row: scenario.row,
      });
      assert.deepEqual(
        outcome.enrichmentCalls,
        ['superequis.com.co'],
        `${scenario.label}: una fila de prueba nunca se entregó a nadie y no puede congelar un dominio real`,
      );
      assert.equal(outcome.candidatesCreated, 1, scenario.label);
    });
  }
});

// ─── § 20 / § 21 · objetivo y hueco parcial intactos ─────────────────────────

describe('§ 20 / § 21 · el hueco de Apollo no se recalcula desde la historia', () => {
  test('X histórica descartada dentro del hueco: X aporta 0, A/B/C sobreviven', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-x', name: 'Superequis', domain: 'superequis.com.co', rank: 1 }),
          ambiguousCompany({ id: 'org-a', name: 'Superaes', domain: 'superaes.com.co', rank: 2 }),
          ambiguousCompany({ id: 'org-b', name: 'Superbes', domain: 'superbes.com.co', rank: 3 }),
          ambiguousCompany({ id: 'org-c', name: 'Superces', domain: 'superces.com.co', rank: 4 }),
        ]),
      ],
      history: {
        'superequis.com.co': [
          historyRow({
            domain: 'superequis.com.co',
            name: 'Superequis',
            status: 'discarded',
            reviewedDaysAgo: 200,
            ageDays: 240,
          }),
        ],
      },
      enrichmentConfirms: [
        'superaes.com.co',
        'superbes.com.co',
        'superces.com.co',
        'superequis.com.co',
      ],
      config: { maxEnrichmentsPerRun: 6 },
    });
    const result = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.ok(
      !recorder.enrichCascadeCalls.includes('superequis.com.co'),
      `X no debe recibir enrichment — llamadas: ${JSON.stringify(recorder.enrichCascadeCalls)}`,
    );
    assert.ok(
      !recorder.persistedCandidateNames.includes('Superequis'),
      'X no cuenta como accepted-for-target',
    );
    // Las otras tres NO se sacrifican: el hueco lo sigue gobernando la demanda
    // canónica del proveedor, no la historia.
    for (const name of ['Superaes', 'Superbes', 'Superces']) {
      assert.ok(
        recorder.persistedCandidateNames.includes(name),
        `${name} debe sobrevivir — persistidos: ${JSON.stringify(recorder.persistedCandidateNames)}`,
      );
    }
    assert.equal(result.candidatesCreated, 3);
  });
});

// ─── § 25 · la consulta histórica está ACOTADA ───────────────────────────────

describe('§ 25 · la historia se consulta por los dominios de la corrida', () => {
  test('los dominios pedidos son exactamente los candidatos de la ronda', async () => {
    const outcome = await runAgainstHistory({
      domain: 'superequis.com.co',
      name: 'Superequis',
      row: historyRow({
        domain: 'superequis.com.co',
        name: 'Superequis',
        status: 'discarded',
        reviewedDaysAgo: 200,
        ageDays: 240,
      }),
    });
    assert.ok(outcome.historicalLoadedDomains.length >= 1, 'debe haber al menos una carga');
    for (const batch of outcome.historicalLoadedDomains) {
      for (const domain of batch) {
        assert.equal(
          domain,
          'superequis.com.co',
          `la consulta no puede pedir dominios ajenos a la corrida: ${domain}`,
        );
      }
    }
  });
});
