/**
 * apollo-two-round-prepaid-historical-parity-1.test.ts
 *
 * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY — cobertura CONDUCTUAL, no de función
 * pura.
 *
 * Cada caso atraviesa la ruta REAL:
 *
 *   runApolloTwoRoundWizardDiscovery  (el adaptador de producción)
 *   runApolloTwoRoundDiscovery        (el orquestador)
 *   evaluateApolloEnrichmentEligibility / los gates baratos REALES
 *   evaluatePrepaidHistoricalDuplicate (el evaluador de este corte)
 *
 * y lo que se afirma es lo único que importa económicamente: que
 * `deps.enrichCascade` / `deps.enrichOrganization` NO se invoquen. Un test sobre
 * el evaluador puro no puede demostrar eso — por eso esta suite existe.
 *
 * Todo offline por construcción: proveedor, writer y lecturas de base entran por
 * inyección. REAL_PROVIDER_CALLS = 0 · REAL_CREDITS = 0 · HUBSPOT_WRITES = 0.
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
 * Una empresa que los gates baratos REALES admiten Y cuyo sector queda
 * CONFIRMADO gratis: dominio `.com.co` (evidencia de país), nombre acreditado por
 * el dominio, señales sectoriales explícitas y LinkedIn.
 */
function confirmedCompany(options: {
  id: string;
  name: string;
  domain: string;
  rank?: number;
}): WebSearchResult {
  // El gate de OWNERSHIP —el mismo que aplica el writer— exige que el dominio
  // acredite al nombre. Los fixtures derivan uno del otro a propósito: un
  // desajuste ahí produciría `ownership_mismatch` y la prueba mediría otro gate.
  return {
    title: options.name,
    url: `https://${options.domain}`,
    snippet: 'cadena de supermercados y autoservicio con tiendas de abarrotes',
    source: 'apollo_organizations',
    rank: options.rank ?? 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: options.id,
      domain: options.domain,
      industry: 'retail',
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 500,
      estimated_num_employees: 500,
      linkedin_url: `https://www.linkedin.com/company/${options.id}`,
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

/**
 * 🔴 La MISMA empresa, pero con evidencia sectorial AMBIGUA.
 *
 * Es la única forma de que estas pruebas no sean vacías. Un candidato cuyo sector
 * las señales gratuitas ya CONFIRMAN nunca compite por un enrichment
 * (`selectCandidatesForEnrichment` lo salta con
 * `sector_evidence_already_confirmed`), así que afirmar «0 enrichment» sobre él no
 * probaría nada. Con evidencia ambigua el candidato SÍ es seleccionado y SÍ se le
 * compra — lo demuestra el control de esta misma suite— y sólo la historia
 * pre-pago puede impedirlo.
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

/** Fila histórica de `prospect_candidates`, como la devuelve `buildNoveltyIndex`. */
function historyRow(options: {
  domain: string;
  name: string;
  status: string;
  batchId?: string;
  reviewedAt?: string | null;
  createdAt?: string;
  duplicateStatus?: string;
}): Record<string, unknown> {
  return {
    id: `hist-${options.domain}`,
    batch_id: options.batchId ?? 'batch-historico',
    name: options.name,
    domain: options.domain,
    website: `https://${options.domain}`,
    status: options.status,
    duplicate_status: options.duplicateStatus ?? 'new_candidate',
    reviewed_at: options.reviewedAt ?? null,
    updated_at: options.createdAt ?? '2026-07-13T00:00:00.000Z',
    created_at: options.createdAt ?? '2026-07-13T00:00:00.000Z',
    metadata: {},
    tax_id: null,
    tax_identifier: null,
    country_code: 'CO',
  };
}

type Recorder = {
  searchCalls: number;
  /** Llamadas a la CASCADA de enrichment: el gasto que este corte evita. */
  enrichCascadeCalls: string[];
  /** Llamadas al enrichment de organización (el transporte real). */
  enrichOrganizationCalls: number;
  persistedCandidateNames: string[];
  historicalLoadedDomains: string[][];
  /**
   * Motivos de rechazo BARATO que la corrida observó, tal como viajan al
   * checkpoint durable. Es la superficie que prueba que el rechazo OCURRIÓ, y no
   * sólo que nadie pagó: sin ella, una defensa en profundidad más abajo podría
   * enmascarar la desaparición del gate.
   */
  observedRejectionReasons: string[];
};

function buildDeps(options: {
  rounds: WebSearchOutput[];
  /** Filas históricas por dominio normalizado. */
  history?: Record<string, Record<string, unknown>[]>;
  historyDegraded?: boolean;
  excludedDomains?: string[];
  /**
   * Dominios cuyo enrichment PAGADO confirma el sector. Un candidato ambiguo al
   * que la evidencia comprada no resuelve termina rechazado definitivamente y no
   * se persiste; con esto el caso «compite, se le compra y sobrevive» es
   * observable.
   */
  enrichmentConfirms?: string[];
  /** Sobrescribe la configuración de la corrida (tope de enrichments, objetivo). */
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
    searchApollo: (async (_input: unknown, _maxResults: number) => {
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
      // Se atraviesa el transporte INSTRUMENTADO que el runner inyecta: es lo que
      // en producción decide el desenlace del cobro. Sigue siendo un doble — cero
      // sockets, cero créditos reales.
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
          // `enriched: true` es lo que hace que el runner cuente la operación como
          // EJECUTADA. Sin esta entrada, `notExecuted` degradaría al candidato y
          // ninguna prueba de supervivencia mediría nada.
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

    // § 22 — la memoria negativa REAL de la corrida, no un Set vacío.
    loadNegativeMemory: async (scope) => ({
      scope,
      excludedDomains: new Set<string>(options.excludedDomains ?? []),
      excludedDomainsSample: options.excludedDomains ?? [],
      excludedIdentityKeys: new Set<string>(),
      excludedIdentityKeysSample: [],
      previousCandidateCount: (options.excludedDomains ?? []).length,
      previousBatchCount: (options.excludedDomains ?? []).length > 0 ? 1 : 0,
    }),

    // § 4 — la evidencia histórica pre-pago, inyectada. Es la MISMA forma que
    // `buildNoveltyIndex` devuelve en producción.
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

// ─── § 10 · el caso fundamental Apollo → Apollo ──────────────────────────────

describe('§ 10 · Apollo vuelve a encontrar una empresa que Apollo ya entregó', () => {
  test('ejecución 2 (otro clientRequestId, otro lote): 0 enrichment, 0 fila', async () => {
    // EJECUCIÓN 1 — la empresa X se entregó y quedó `needs_review`.
    const { deps: deps1, recorder: rec1 } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-x', name: 'Superequis', domain: 'superequis.com.co' }),
        ]),
      ],
      enrichmentConfirms: ['superequis.com.co'],
    });
    const first = await runApolloTwoRoundWizardDiscovery(
      runInput({ correlation: correlation() }),
      deps1,
    );
    assert.equal(first.batchId, 'batch-A');
    // La ejecución 1 SÍ paga y SÍ entrega: es el punto de partida de la historia.
    assert.deepEqual(rec1.enrichCascadeCalls, ['superequis.com.co']);
    assert.deepEqual(rec1.persistedCandidateNames, ['Superequis']);

    // EJECUCIÓN 2 — otro clientRequestId, otro lote, misma empresa. La historia
    // NO viaja por checkpoint: viaja por `prospect_candidates`.
    const { deps: deps2, recorder: rec2 } = buildDeps({
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
            status: 'needs_review',
            batchId: 'batch-A',
          }),
        ],
      },
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
      deps2,
    );

    assert.deepEqual(rec2.enrichCascadeCalls, [], 'ENRICHMENT sobre X debe ser 0');
    assert.equal(rec2.enrichOrganizationCalls, 0);
    assert.deepEqual(rec2.persistedCandidateNames, [], 'X no se persiste como nueva');
    assert.equal(second.candidatesCreated, 0, 'accepted-for-target = 0');
    // El RECHAZO tiene que constar: «nadie pagó» también sería cierto si el
    // candidato hubiera muerto por otro motivo más abajo.
    assert.ok(
      rec2.observedRejectionReasons.includes('cooldown_or_prior_suggestion'),
      `motivos observados: ${JSON.stringify(rec2.observedRejectionReasons)}`,
    );
  });
});

// ─── § 11 / § 24 · cross-source ──────────────────────────────────────────────

describe('§ 11 / § 24 · una entrega de otra FUENTE también es histórica', () => {
  test('lote histórico con source != agent_1: 0 enrichment', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-f', name: 'Superefe', domain: 'superefe.com.co' }),
        ]),
      ],
      history: {
        // Entregada por la ruta GRATUITA (`socrata_colombia`). Antes de este
        // corte era invisible para la memoria negativa pre-pago.
        'superefe.com.co': [
          historyRow({
            domain: 'superefe.com.co',
            name: 'Superefe',
            status: 'approved',
            batchId: 'batch-socrata-1',
          }),
        ],
      },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(recorder.enrichCascadeCalls, []);
    assert.equal(recorder.enrichOrganizationCalls, 0);
    assert.deepEqual(recorder.persistedCandidateNames, []);
    assert.ok(
      recorder.observedRejectionReasons.includes('cooldown_or_prior_suggestion'),
      `motivos observados: ${JSON.stringify(recorder.observedRejectionReasons)}`,
    );
  });
});

// ─── § 12 · approved a 45 días ───────────────────────────────────────────────

describe('§ 12 · approved a 45 días, sin cuenta y sin HubSpot', () => {
  test('el enrichment NO se llama (antes sí, y el writer bloqueaba después)', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-45', name: 'Supercuarenta', domain: 'supercuarenta.com.co' }),
        ]),
      ],
      history: {
        'supercuarenta.com.co': [
          historyRow({
            domain: 'supercuarenta.com.co',
            name: 'Supercuarenta',
            status: 'approved',
            // 45 días atrás: fuera de cualquier cooldown de 30 días.
            createdAt: '2026-07-13T00:00:00.000Z',
            reviewedAt: '2026-07-13T00:00:00.000Z',
          }),
        ],
      },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(recorder.enrichCascadeCalls, []);
    assert.equal(recorder.enrichOrganizationCalls, 0);
    assert.deepEqual(recorder.persistedCandidateNames, []);
    assert.ok(
      recorder.observedRejectionReasons.includes('cooldown_or_prior_suggestion'),
      `motivos observados: ${JSON.stringify(recorder.observedRejectionReasons)}`,
    );
  });
});

// ─── § 13 · converted_to_account ─────────────────────────────────────────────

describe('§ 13 · converted_to_account, el estado que el guard no nombraba', () => {
  test('una empresa YA convertida en cuenta no se re-enriquece', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-c', name: 'Superce', domain: 'superce.com.co' }),
        ]),
      ],
      history: {
        'superce.com.co': [
          historyRow({
            domain: 'superce.com.co',
            name: 'Superce',
            status: 'converted_to_account',
          }),
        ],
      },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(recorder.enrichCascadeCalls, []);
    assert.deepEqual(recorder.persistedCandidateNames, []);
  });
});

// ─── § 14 · generated / normalized ───────────────────────────────────────────

describe('§ 14 · generated y normalized son entregas visibles', () => {
  for (const status of ['generated', 'normalized']) {
    test(`status=${status}: 0 enrichment`, async () => {
      const { deps, recorder } = buildDeps({
        rounds: [
          searchOutput([
            ambiguousCompany({ id: `org-${status}`, name: 'Superge', domain: 'superge.com.co' }),
          ]),
        ],
        history: {
          'superge.com.co': [
            historyRow({ domain: 'superge.com.co', name: 'Superge', status }),
          ],
        },
      });

      await runApolloTwoRoundWizardDiscovery(runInput(), deps);

      assert.deepEqual(recorder.enrichCascadeCalls, []);
      assert.deepEqual(recorder.persistedCandidateNames, []);
    });
  }
});

// ─── § 15 · discarded: la política 30/90 d sigue mandando ────────────────────

describe('§ 15 · discarded, dentro y fuera de cooldown', () => {
  test('descartado con revisión hace 10 días: 0 enrichment', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-d10', name: 'Superde', domain: 'superde.com.co' }),
        ]),
      ],
      history: {
        'superde.com.co': [
          historyRow({
            domain: 'superde.com.co',
            name: 'Superde',
            status: 'discarded',
            reviewedAt: tenDaysAgo,
            createdAt: tenDaysAgo,
          }),
        ],
      },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(recorder.enrichCascadeCalls, []);
  });

  test('🔴 FINALITY · descartado con revisión hace 40 días: YA NO se re-compra', async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-d40', name: 'Supercuarentados', domain: 'supercuarentados.com.co' }),
        ]),
      ],
      enrichmentConfirms: ['supercuarentados.com.co'],
      history: {
        'supercuarentados.com.co': [
          historyRow({
            domain: 'supercuarentados.com.co',
            name: 'Supercuarentados',
            status: 'discarded',
            reviewedAt: fortyDaysAgo,
            createdAt: fortyDaysAgo,
          }),
        ],
      },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    // AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY — esta prueba DOCUMENTABA la
    // tensión económica que el corte anterior dejó declarada y sin resolver: a
    // los 40 días el descarte salía del cooldown de 30 d, volvía a competir y se
    // volvía a COMPRAR. Ese es el defecto que este corte cierra por regla de
    // negocio, así que el trinquete se invierte en vez de conservarse.
    assert.deepEqual(
      recorder.enrichCascadeCalls,
      [],
      'una empresa ya entregada no vuelve a costar un crédito por haber sido descartada',
    );
    assert.deepEqual(recorder.persistedCandidateNames, []);
  });
});

// ─── § 22 · la memoria negativa REAL, con un dominio dentro ──────────────────

describe('§ 22 · rama real con negativeMemory.excludedDomains poblado', () => {
  test('un dominio en cooldown no llega al enrichment', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-e', name: 'Examplecompany', domain: 'example.com' }),
          ambiguousCompany({ id: 'org-n', name: 'Supernuevo', domain: 'supernuevo.com.co', rank: 2 }),
        ]),
      ],
      excludedDomains: ['example.com'],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(
      recorder.enrichCascadeCalls.includes('example.com'),
      false,
      'example.com está en cooldown: no se le compra evidencia',
    );
    assert.equal(recorder.persistedCandidateNames.includes('Examplecompany'), false);
  });
});

// ─── § 7 · el falso positivo por nombre NO puede ocurrir ─────────────────────

describe('§ 7 · mismo nombre, identidad fuerte distinta', () => {
  test('NO se bloquea: la empresa compite y se persiste', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-s2', name: 'Siesa Enterprise', domain: 'siesaenterprise.com.co' }),
        ]),
      ],
      enrichmentConfirms: ['siesaenterprise.com.co'],
      history: {
        // Otra empresa, mismo nombre normalizado, DOMINIO distinto.
        'siesa.com.co': [
          historyRow({ domain: 'siesa.com.co', name: 'Siesa', status: 'approved' }),
        ],
      },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(
      recorder.enrichCascadeCalls,
      ['siesaenterprise.com.co'],
      'un homónimo con identidad distinta NO puede quedar bloqueado antes de pagar',
    );
    assert.deepEqual(recorder.persistedCandidateNames, ['Siesa Enterprise']);
  });
});

// ─── § 21 · evidencia degradada = fail OPEN ──────────────────────────────────

describe('§ 21 · una lectura histórica degradada no bloquea', () => {
  test('degraded: la empresa sigue compitiendo', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-g', name: 'Supergedos', domain: 'supergedos.com.co' }),
        ]),
      ],
      enrichmentConfirms: ['supergedos.com.co'],
      historyDegraded: true,
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(recorder.enrichCascadeCalls, ['supergedos.com.co']);
    assert.deepEqual(recorder.persistedCandidateNames, ['Supergedos']);
  });
});

// ─── § 4 · una lectura por conjunto de dominios, nunca por candidato ─────────

describe('§ 4 · coste de lectura acotado', () => {
  test('tres candidatos de una ronda → UNA sola carga histórica', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'o1', name: 'Superuno', domain: 'superuno.com.co', rank: 1 }),
          ambiguousCompany({ id: 'o2', name: 'Superdos', domain: 'superdos.com.co', rank: 2 }),
          ambiguousCompany({ id: 'o3', name: 'Supertres', domain: 'supertres.com.co', rank: 3 }),
        ]),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(
      recorder.historicalLoadedDomains.length,
      1,
      'una carga por ronda, no una por candidato',
    );
    assert.equal(recorder.historicalLoadedDomains[0].length, 3);
  });
});

// ─── CONTROL · sin este caso, todo «0 enrichment» sería vacío ────────────────

describe('CONTROL · el arnés SÍ puede gastar', () => {
  test('una empresa AMBIGUA y SIN historia recibe enrichment', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          ambiguousCompany({ id: 'org-ctl', name: 'Supercontrol', domain: 'supercontrol.com.co' }),
        ]),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(
      recorder.enrichCascadeCalls,
      ['supercontrol.com.co'],
      'si esto falla, ninguna aserción de «0 enrichment» de esta suite prueba nada',
    );
  });

  test('la MISMA empresa con sector CONFIRMADO no se enriquece (por eso el fixture es ambiguo)', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          confirmedCompany({ id: 'org-cfm', name: 'Superconfirmado', domain: 'superconfirmado.com.co' }),
        ]),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    // `selectCandidatesForEnrichment` la salta con
    // `sector_evidence_already_confirmed`: no hay nada que comprar.
    assert.deepEqual(recorder.enrichCascadeCalls, []);
    assert.deepEqual(recorder.persistedCandidateNames, ['Superconfirmado']);
  });
});

// ─── §§ 16 · 17 · 18 · el hueco parcial libre+pago no se mueve ───────────────

describe('§§ 16-18 · el filtrado histórico opera DENTRO del hueco del proveedor', () => {
  test('target 10, gratis 4 ⇒ hueco 6; un duplicado histórico no cuenta ni resta', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([
          // Ya entregada históricamente: NO debe pagarse ni contar.
          ambiguousCompany({
            id: 'org-h',
            name: 'Superhistorica',
            domain: 'superhistorica.com.co',
            rank: 1,
          }),
          // Nueva: sí compite dentro del hueco.
          ambiguousCompany({
            id: 'org-n1',
            name: 'Supernueva',
            domain: 'supernueva.com.co',
            rank: 2,
          }),
        ]),
      ],
      enrichmentConfirms: ['supernueva.com.co'],
      history: {
        'superhistorica.com.co': [
          historyRow({
            domain: 'superhistorica.com.co',
            name: 'Superhistorica',
            status: 'approved',
          }),
        ],
      },
    });

    const outcome = await runApolloTwoRoundWizardDiscovery(
      runInput({
        resultDemand: {
          requestedTarget: 10,
          acceptedBeforeProvider: 4,
          // § 16 — el hueco es 6, no 10. El filtrado histórico no lo reinicia.
          remainingTarget: 6,
          providerRequired: true,
          source: 'free_layer_partial',
        } as never,
      }),
      deps,
    );

    // § 18 — el duplicado histórico no recibe crédito…
    assert.equal(
      recorder.enrichCascadeCalls.includes('superhistorica.com.co'),
      false,
      'HISTORICAL_DUPLICATE_CAN_BE_REENRICHED debe ser NO',
    );
    // …y sí lo recibe la empresa nueva que compite en el mismo hueco.
    assert.deepEqual(recorder.enrichCascadeCalls, ['supernueva.com.co']);

    // § 17 — el duplicado histórico NO cuenta como nuevo y NO consume el hueco.
    assert.deepEqual(recorder.persistedCandidateNames, ['Supernueva']);
    assert.equal(outcome.candidatesCreated, 1);

    // El objetivo declarado de la corrida sigue siendo el de la configuración:
    // el filtrado histórico no reescribe ninguna contabilidad de objetivo.
    assert.equal(
      outcome.targetPersistibleCandidates,
      defaultApolloTwoRoundConfig().targetEligibleCompanies,
    );
  });
});

// ─── § 16 · el hueco del proveedor sigue siendo el TECHO ─────────────────────

describe('§ 16 · el hueco parcial no se reinicia al objetivo pedido', () => {
  test('target 10, gratis 8 ⇒ hueco 2: sobran candidatas y sólo entran 2', async () => {
    const brands = ['Superalfa', 'Superbeta', 'Supergamma', 'Superdelta'];
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput(
          brands.map((brand, index) =>
            ambiguousCompany({
              id: `org-${brand}`,
              name: brand,
              domain: `${brand.toLowerCase()}.com.co`,
              rank: index + 1,
            }),
          ),
        ),
      ],
      enrichmentConfirms: brands.map((b) => `${b.toLowerCase()}.com.co`),
      // El tope de enrichments por corrida (2 por omisión) NO puede ser lo que
      // limite este caso: si lo fuera, la prueba mediría el presupuesto en vez
      // del hueco, y una mutación del hueco pasaría inadvertida.
      config: { maxEnrichmentsPerRun: 5 },
    });

    const outcome = await runApolloTwoRoundWizardDiscovery(
      runInput({
        resultDemand: {
          requestedTarget: 10,
          acceptedBeforeProvider: 8,
          remainingTarget: 2,
          providerRequired: true,
          source: 'free_layer_partial',
        } as never,
      }),
      deps,
    );

    // Si el hueco volviera al objetivo pedido (10), entrarían las cuatro.
    assert.equal(
      recorder.enrichCascadeCalls.length,
      4,
      'las cuatro compiten y se les compra: el tope de enrichments no ata',
    );
    assert.equal(
      recorder.persistedCandidateNames.length,
      2,
      `el hueco es 2, no ${defaultApolloTwoRoundConfig().targetEligibleCompanies}: ${JSON.stringify(
        recorder.persistedCandidateNames,
      )}`,
    );
    assert.equal(outcome.candidatesCreated, 2);
  });
});
