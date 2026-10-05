/**
 * apollo-company-bank-runner-1.test.ts
 *
 * AGENT1-COMPANY-BANK — la corrida REAL de Apollo (adaptador de producción →
 * orquestador → filtros gratuitos reales) con un banco FALSO:
 *
 *   · antes de pagar la primera página saca del banco (una sola vez, ronda 1,
 *     id de extracción = lote, país × macro de la corrida, listas y por completar);
 *   · lo sacado vuelve a pasar los filtros y llega al escritor;
 *   · lo que el tope deja fuera entra al banco (con su evidencia y sus claves);
 *   · al terminar se cierra la extracción (asignada / devuelta / invalidada);
 *   · banco caído ⇒ la corrida es la de siempre.
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
import { toCandidateEvidenceSnapshot } from '../checkpoint';
import { captureApolloCompanyFields } from '../../apollo-company-fields-mapping';
import type { NoveltyIndex } from '../../novelty-checker';
import type {
  DeliveryCappedCompany,
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';
import { inMemoryRunBudgetDeps } from './fixtures';
import type { ApolloCompanyBankPort } from '@/server/prospect-batches/company-bank/apollo-company-bank-port.server';
import type {
  CompanyBankDepositItem,
  CompanyBankDrawnCompany,
  CompanyBankSettleItem,
} from '@/server/prospect-batches/company-bank/company-bank-types';
import { APOLLO_BANK_PAYLOAD_KIND } from '@/server/prospect-batches/company-bank/apollo-company-bank-bridge';

const runBudgetFixture = inMemoryRunBudgetDeps(1_000);

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
  /** Lo que el writer falso declara recortado por el tope de entrega. */
  deliveryCapped?: (names: string[]) => DeliveryCappedCompany[];
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
    authorizeSpend: runBudgetFixture.authorizeSpend,
    settleSpend: runBudgetFixture.settleSpend,
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
        deliveryCappedCompanies: options.deliveryCapped?.(recorder.persistedCandidateNames) ?? [],
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


// ─── Banco falso ──────────────────────────────────────────────────────────────

type BankRecorder = {
  draws: Array<Record<string, unknown>>;
  deposits: CompanyBankDepositItem[][];
  settles: Array<{ drawId: string; outcomes: CompanyBankSettleItem[] }>;
  persistedReads: Array<{ batchId: string; domains: string[] }>;
};

function fakeBank(options: {
  drawn?: CompanyBankDrawnCompany[];
  drawUnavailable?: boolean;
  persistedByDomain?: Record<string, string>;
}): { port: ApolloCompanyBankPort; recorder: BankRecorder } {
  const recorder: BankRecorder = { draws: [], deposits: [], settles: [], persistedReads: [] };
  const port: ApolloCompanyBankPort = {
    store: {
      async deposit(items) {
        recorder.deposits.push([...items]);
        return { status: 'ok', deposited: items.length, skippedClaimed: 0, skippedInBank: 0, skippedInvalid: 0 };
      },
      async draw(input) {
        recorder.draws.push({ ...input });
        if (options.drawUnavailable) return { status: 'unavailable', reason: 'relation does not exist' };
        return { status: 'ok', drawId: input.drawId ?? 'draw', companies: options.drawn ?? [] };
      },
      async settle(drawId, outcomes) {
        recorder.settles.push({ drawId, outcomes: [...outcomes] });
        return { status: 'ok', assigned: 0, invalidated: 0, released: 0, ignored: 0 };
      },
    },
    async countAcceptedByDomain() {
      return 0;
    },
    async readPersistedCandidateIdsByDomain(batchId, domains) {
      recorder.persistedReads.push({ batchId, domains: [...domains] });
      return new Map(Object.entries(options.persistedByDomain ?? {}));
    },
  };
  return { port, recorder };
}

function bankRow(id: string, company: WebSearchResult, tier: 'ready' | 'to_complete' = 'to_complete'): CompanyBankDrawnCompany {
  return {
    id,
    tier,
    sourceProvider: 'apollo',
    claims: [{ type: 'domain', key: String(company.metadata?.['domain']) }],
    payload: { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: toCandidateEvidenceSnapshot(company) },
    missingFields: tier === 'ready' ? [] : ['target_conditions'],
    sourceBatchId: 'batch-anterior',
    bankedAt: '2026-09-30T00:00:00.000Z',
  };
}

const RETAIL = { industry: 'Retail' } as Partial<ApolloTwoRoundWizardRunInput>;

describe('AGENT1-COMPANY-BANK — la corrida de Apollo usa el banco', () => {
  test('saca UNA vez (ronda 1), con el lote como id, país × macro, listas y por completar', async () => {
    const banked = ambiguousCompany({ id: 'org-bank-1', name: 'Bodega Banco', domain: 'bodegabanco.com.co' });
    const fresh = ambiguousCompany({ id: 'org-fresh-1', name: 'Fresca SAS', domain: 'fresca.com.co' });
    const bank = fakeBank({ drawn: [bankRow('bank-1', banked)], persistedByDomain: { 'bodegabanco.com.co': 'cand-9' } });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([fresh]), searchOutput([])],
      enrichmentConfirms: ['bodegabanco.com.co', 'fresca.com.co'],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(RETAIL), { ...deps, companyBank: bank.port });

    assert.equal(bank.recorder.draws.length, 1, 'una sola extracción por corrida');
    const draw = bank.recorder.draws[0];
    assert.equal(draw.countryCode, 'CO');
    assert.equal(draw.macroIndustryKey, 'retail');
    assert.equal(draw.drawId, 'batch-A');
    assert.deepEqual(draw.tiers, ['ready', 'to_complete']);
    assert.equal(draw.limit, 10);

    // La empresa del banco volvió a pasar los filtros y llegó al escritor, PRIMERO.
    assert.ok(recorder.persistedCandidateNames.includes('Bodega Banco'), JSON.stringify(recorder.persistedCandidateNames));
    assert.ok(recorder.persistedCandidateNames.includes('Fresca SAS'));
    assert.ok(
      recorder.persistedCandidateNames.indexOf('Bodega Banco') <
        recorder.persistedCandidateNames.indexOf('Fresca SAS'),
      'lo del banco va antes que lo fresco',
    );

    // Se cierra la extracción: escrita en el lote ⇒ asignada.
    assert.equal(bank.recorder.settles.length, 1);
    assert.equal(bank.recorder.settles[0].drawId, 'batch-A');
    assert.deepEqual(bank.recorder.settles[0].outcomes, [
      { id: 'bank-1', outcome: 'assigned', batchId: 'batch-A', candidateId: 'cand-9' },
    ]);
  });

  test('lo que el tope deja fuera entra al banco con su evidencia, nivel y claves', async () => {
    const a = ambiguousCompany({ id: 'org-a', name: 'Alfa Retail', domain: 'alfaretail.com.co', rank: 1 });
    const b = ambiguousCompany({ id: 'org-b', name: 'Beta Retail', domain: 'betaretail.com.co', rank: 2 });
    const bank = fakeBank({});
    const { deps } = buildDeps({
      rounds: [searchOutput([a, b]), searchOutput([])],
      enrichmentConfirms: ['alfaretail.com.co', 'betaretail.com.co'],
      deliveryCapped: () => [
        {
          name: 'Beta Retail',
          domain: 'betaretail.com.co',
          linkedinUrl: null,
          countryCode: 'CO',
          providerOrganizationId: 'org-b',
          countsTowardTarget: false,
          claims: [{ type: 'domain', key: 'betaretail.com.co' }],
        },
      ],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(RETAIL), { ...deps, companyBank: bank.port });

    assert.equal(bank.recorder.deposits.length, 1);
    const [item] = bank.recorder.deposits[0];
    assert.equal(item.countryCode, 'CO');
    assert.equal(item.macroIndustryKey, 'retail');
    assert.equal(item.tier, 'to_complete');
    assert.equal(item.sourceProvider, 'apollo');
    assert.equal(item.sourceBatchId, 'batch-A');
    assert.deepEqual(item.claims, [{ type: 'domain', key: 'betaretail.com.co' }]);
    const payload = item.payload as { kind: string; evidence: { domain: string; title: string } };
    assert.equal(payload.kind, APOLLO_BANK_PAYLOAD_KIND);
    assert.equal(payload.evidence.domain, 'betaretail.com.co');
    assert.equal(payload.evidence.title, 'Beta Retail');
    // Sin nada sacado del banco no hay nada que cerrar.
    assert.equal(bank.recorder.settles.length, 0);
  });

  test('banco caído ⇒ la corrida es la de siempre (sólo lo fresco)', async () => {
    const fresh = ambiguousCompany({ id: 'org-fresh-1', name: 'Fresca SAS', domain: 'fresca.com.co' });
    const bank = fakeBank({ drawUnavailable: true });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([fresh]), searchOutput([])],
      enrichmentConfirms: ['fresca.com.co'],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(RETAIL), { ...deps, companyBank: bank.port });
    assert.deepEqual(recorder.persistedCandidateNames, ['Fresca SAS']);
    assert.equal(bank.recorder.settles.length, 0);
  });

  test('una fila ilegible del banco se invalida; nunca se inventa una empresa', async () => {
    const fresh = ambiguousCompany({ id: 'org-fresh-1', name: 'Fresca SAS', domain: 'fresca.com.co' });
    const broken: CompanyBankDrawnCompany = {
      ...bankRow('bank-x', fresh),
      payload: { kind: 'otro_formato' },
    };
    const bank = fakeBank({ drawn: [broken] });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([fresh]), searchOutput([])],
      enrichmentConfirms: ['fresca.com.co'],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(RETAIL), { ...deps, companyBank: bank.port });
    assert.deepEqual(recorder.persistedCandidateNames, ['Fresca SAS']);
    assert.deepEqual(bank.recorder.settles[0]?.outcomes, [
      { id: 'bank-x', outcome: 'invalidated', reason: 'unreadable_payload' },
    ]);
  });

  test('sin macro industria reconocible no se toca el banco', async () => {
    const fresh = ambiguousCompany({ id: 'org-fresh-1', name: 'Fresca SAS', domain: 'fresca.com.co' });
    const bank = fakeBank({});
    const { deps } = buildDeps({ rounds: [searchOutput([fresh]), searchOutput([])], enrichmentConfirms: ['fresca.com.co'] });
    await runApolloTwoRoundWizardDiscovery(
      runInput({ industry: 'Supermercados e Hipermercados' } as Partial<ApolloTwoRoundWizardRunInput>),
      { ...deps, companyBank: bank.port },
    );
    assert.equal(bank.recorder.draws.length, 0);
  });
});
