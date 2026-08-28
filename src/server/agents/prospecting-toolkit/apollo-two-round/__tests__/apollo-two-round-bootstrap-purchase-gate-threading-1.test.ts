/**
 * apollo-two-round-bootstrap-purchase-gate-threading-1.test.ts —
 * El runner de producción REAL contra el cascade REAL.
 *
 * AGENT1-APOLLO-BOOTSTRAP-PURCHASE-GATE-THREADING-1 · §§ 5, 6, 8, 9, 12, 13, 14.
 *
 * 🔑 Por qué esta suite inyecta `enrichOrganization` y NO `enrichCascade`:
 *
 *   Todas las suites anteriores del hilo mockean `enrichCascade` entero, y un
 *   cascade mockeado siempre devuelve `enriched: true`. Por eso ninguna vio nunca
 *   el defecto: el gate que rechazaba —`evaluateApolloEnrichmentEligibility`, que
 *   vive DENTRO del cascade— no llegaba a ejecutarse en ninguna prueba. Aquí el
 *   cascade es el de producción y lo único simulado es el transporte HTTP, así
 *   que el gate de compra corre de verdad.
 *
 * Cohorte: los VEINTE resultados reales del lote `74a49b01`. Cero llamadas al
 * proveedor, cero créditos, cero escrituras, cero migraciones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { fromCandidateEvidenceSnapshot } from '../checkpoint';
import { defaultApolloTwoRoundConfig } from '../index';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import { APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY } from '../../apollo-sector-evidence-bootstrap-audit';
import { APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY } from '../../apollo-sector-evidence-bootstrap';
import {
  RETEST_SALUD_BUDGET_AFTER,
  RETEST_SALUD_COOLDOWN_DOMAINS,
  RETEST_SALUD_LIVE_OUTCOME,
  RETEST_SALUD_RECONSTRUCTED_HUBSPOT_DUPLICATE_DOMAINS,
  RETEST_SALUD_REQUEST,
  RETEST_SALUD_SELECTED_DOMAINS,
  RETEST_SALUD_SELLUP_DUPLICATE_DOMAINS,
  RETEST_SALUD_SNAPSHOTS,
} from '../../__tests__/fixtures/apollo-retest-salud-74a49b01';
import {
  buildPublishedCatalogTermsResolution,
  CATALOG_VERSION,
} from '../../__tests__/fixtures/sellup-published-catalog-search-terms';
import type {
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';

// ─── Arnés ────────────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: RETEST_SALUD_REQUEST.wizardRunId,
  clientRequestId: 'client-purchase-gate-1',
  batchId: RETEST_SALUD_REQUEST.batchId,
  reservationId: 'reservation-purchase-gate-1',
  requestFingerprint: 'fingerprint-purchase-gate-1',
  idempotencyKey: 'idempotency-purchase-gate-1',
};

/** Precio unitario REAL de `apollo/organization_enrichment` en Producción. */
const ENRICHMENT_UNIT_COST_USD = 0.00875;

const RESULTS: readonly WebSearchResult[] = RETEST_SALUD_SNAPSHOTS.map((snapshot) =>
  fromCandidateEvidenceSnapshot(snapshot.evidence),
);

function domainOf(result: WebSearchResult): string {
  return ((result.metadata as Record<string, unknown> | undefined)?.['domain'] as string) ?? '';
}

type BootstrapPreconditionOverrides = Partial<{
  provider_search_executed: boolean;
  query_coverage_complete: boolean;
  catalog_version_coherent: boolean;
  catalog_terms_resolved: boolean;
}>;

function searchOutput(
  results: readonly WebSearchResult[],
  preconditions: BootstrapPreconditionOverrides = {},
): WebSearchOutput {
  return {
    provider: 'apollo_organizations',
    query: 'salud',
    results: [...results],
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: {
      usage: { credits_used: results.length },
      // La corrida live emitió DOS búsquedas porque el proveedor declaró dos
      // páginas; sin ese hecho la ronda 2 no se emite y la cohorte sería de 10.
      apollo_pagination: { total_pages: 2 },
      [APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY]: {
        provider_search_executed: true,
        query_coverage_complete: true,
        catalog_version_coherent: true,
        catalog_terms_resolved: true,
        ...preconditions,
      },
    },
  } as unknown as WebSearchOutput;
}

/** El perfil que el crédito compra: clasificación que la búsqueda no traía. */
function withEnrichedProfile(result: WebSearchResult): WebSearchResult {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  return {
    ...result,
    metadata: {
      ...meta,
      industry: 'pharmaceuticals',
      keywords: ['laboratorio farmaceutico'],
      apollo_profile: {
        ...((meta['apollo_profile'] as Record<string, unknown>) ?? {}),
        industry: 'pharmaceuticals',
        industries: ['pharmaceuticals'],
        keywords: ['laboratorio farmaceutico'],
      },
      apollo_enrichment_fields_added: ['industry', 'keywords'],
    },
  } as unknown as WebSearchResult;
}

function duplicateMatchesFor(domain: string): { source: string; status: string; confidence: number }[] {
  // AGENT1-APOLLO-NET-NEW-PAGINATION § 3 — `readDuplicateVerdict` ahora filtra
  // por la confianza exacta de dominio/tax_identifier exacto, no por `status`
  // a secas. Estos conjuntos son dominios, así que la réplica de la corrida
  // real conserva su verdad de duplicado por DOMINIO con la confianza real que
  // cada checker emite para ese eje (95 SellUp, 92 HubSpot) — no un match de
  // nombre, que ya no bastaría.
  if (RETEST_SALUD_SELLUP_DUPLICATE_DOMAINS.has(domain)) {
    return [{ source: 'sellup', status: 'existing_in_sellup', confidence: 95 }];
  }
  if (RETEST_SALUD_RECONSTRUCTED_HUBSPOT_DUPLICATE_DOMAINS.has(domain)) {
    return [{ source: 'hubspot', status: 'existing_in_hubspot', confidence: 92 }];
  }
  return [];
}

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = domainOf(result);
  const matches = duplicateMatchesFor(domain);
  return {
    name: result.title,
    website: result.url,
    domain,
    country: RETEST_SALUD_REQUEST.country,
    countryCode: RETEST_SALUD_REQUEST.countryCode,
    industry: RETEST_SALUD_REQUEST.industry,
    sourceUrl: result.url,
    sourceTitle: result.title,
    sourceSnippet: result.snippet ?? null,
    websiteVerification: null,
    duplicateCheck: {
      status: matches.length > 0 ? 'existing_in_hubspot' : 'new_candidate',
      confidence: 0,
      input: { name: result.title, domain },
      matches,
      summary: 'replay',
      checkedSources: ['sellup', 'hubspot'],
    } as ProspectingPipelineCandidate['duplicateCheck'],
    scoring: { qualityLabel: 'high_quality_new' } as ProspectingPipelineCandidate['scoring'],
  };
}

type Recorder = {
  /** Dominios que llegaron a la llamada HTTP de `organization_enrichment`. */
  enrichOrganizationCalls: string[];
  /** Filas económicas escritas — una por operación pagada. */
  usageLogDomains: string[];
  writerBatchMetadata: Record<string, unknown> | null;
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
};

type PurchaseEntry = {
  candidate_key: string;
  selected_for_enrichment: boolean;
  selection_rank: number | null;
  enrichment_status: string;
  enrichment_executed: boolean;
  post_enrichment_sector_state: string | null;
  purchase: {
    authorized: boolean;
    block_reason: string | null;
    attempted: boolean;
    skip_reason: string | null;
    cascade_ineligibility_reason: string | null;
  } | null;
};

type BootstrapBlock = {
  bootstrap_authorized: boolean;
  bootstrap_eligible_count: number;
  bootstrap_selected_for_enrichment_count: number;
  bootstrap_purchase_authorized_count: number;
  bootstrap_purchase_attempted_count: number;
  bootstrap_enrichment_executed_count: number;
  candidates: PurchaseEntry[];
};

function buildDeps(
  options: {
    rounds?: WebSearchOutput[];
    enrichmentUnitCostUsd?: number | null;
    cooldownDomains?: ReadonlySet<string>;
    enrichmentFails?: boolean;
    maxEnrichmentsPerRun?: number;
  } = {},
): { deps: Partial<ApolloTwoRoundProductionDeps>; recorder: Recorder } {
  const recorder: Recorder = {
    enrichOrganizationCalls: [],
    usageLogDomains: [],
    writerBatchMetadata: null,
    savedCheckpoints: [],
  };
  const rounds = options.rounds ?? [
    searchOutput(RESULTS.slice(0, 10)),
    searchOutput(RESULTS.slice(10, 20)),
  ];
  let searchCalls = 0;

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async () => {
      const output = rounds[searchCalls] ?? searchOutput([]);
      searchCalls++;
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    // 🔑 `enrichCascade` NO se inyecta: corre el de producción, con su gate de
    // compra real. Lo único simulado es el transporte.
    enrichOrganization: (async ({ domain }: { domain: string }) => {
      recorder.enrichOrganizationCalls.push(domain);
      if (options.enrichmentFails === true) {
        return { success: false, error: { statusCode: 500, message: 'simulated' } };
      }
      const source = RESULTS.find((result) => domainOf(result) === domain);
      const enriched = source ? withEnrichedProfile(source) : null;
      return {
        success: true,
        data: {
          industry: 'pharmaceuticals',
          keywords: ['laboratorio farmaceutico'],
          primary_domain: domain,
          ...((enriched?.metadata as Record<string, unknown> | undefined)?.['apollo_profile'] ?? {}),
        },
      };
    }) as never,

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
      extraBatchMetadata?: Record<string, unknown> | null;
    }) => {
      recorder.writerBatchMetadata = writerInput.extraBatchMetadata ?? null;
      return {
        dryRun: false,
        batchId: CORRELATION.batchId,
        candidatesCreated: writerInput.pipelineOutput.candidates.length,
        candidatesSkipped: 0,
        createdCandidateIds: [],
        skipped: [],
        status: 'success',
        errors: [],
      };
    }) as unknown as ApolloTwoRoundProductionDeps['persistCandidates'],

    loadNegativeMemory: async (scope) => ({
      scope,
      excludedDomains: new Set(options.cooldownDomains ?? RETEST_SALUD_COOLDOWN_DOMAINS),
      excludedDomainsSample: [],
      excludedIdentityKeys: new Set<string>(),
      excludedIdentityKeysSample: [],
      previousCandidateCount: 0,
      previousBatchCount: 0,
    }),

    loadCheckpoint: async () => null,
    saveCheckpoint: async (_batchId, checkpoint) => {
      recorder.savedCheckpoints.push(checkpoint);
      return {
        kind: 'written',
        checkpointVersion: checkpoint.checkpoint_version,
        serializedBytes: 0,
        compacted: false,
      };
    },
    loadEnrichmentUnitCostUsd: async () =>
      options.enrichmentUnitCostUsd === undefined
        ? ENRICHMENT_UNIT_COST_USD
        : options.enrichmentUnitCostUsd,
    logEnrichmentUsage: (async (usage: { domain: string }) => {
      recorder.usageLogDomains.push(usage.domain);
      return { kind: 'logged' as const };
    }) as never,
    resolveConfig: () => ({
      ...defaultApolloTwoRoundConfig(),
      targetEligibleCompanies: RETEST_SALUD_REQUEST.targetEligibleCompanies,
      maxRoundsPerRun: RETEST_SALUD_REQUEST.maxRoundsPerRun,
      maxResultsPerRound: RETEST_SALUD_REQUEST.maxResultsPerRound,
      maxRawResultsPerRun: RETEST_SALUD_REQUEST.maxRawResultsPerRun,
      maxEnrichmentsPerRun:
        options.maxEnrichmentsPerRun ?? RETEST_SALUD_REQUEST.maxEnrichmentsPerRun,
    }),
  };

  return { deps, recorder };
}

function runInput(
  overrides: Partial<ApolloTwoRoundWizardRunInput> = {},
): ApolloTwoRoundWizardRunInput {
  return {
    country: RETEST_SALUD_REQUEST.country,
    countryCode: RETEST_SALUD_REQUEST.countryCode,
    industry: RETEST_SALUD_REQUEST.industry,
    subindustries: [...RETEST_SALUD_REQUEST.subindustries],
    subindustryCatalogTerms: buildPublishedCatalogTermsResolution(),
    selectionCatalogVersion: CATALOG_VERSION,
    additionalCriteria: null,
    reservedBatchId: CORRELATION.batchId,
    triggeredByUserId: 'user-1',
    ownerId: 'user-1',
    correlation: CORRELATION,
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: RETEST_SALUD_REQUEST.reservedCredits,
    ...overrides,
  };
}

function readBootstrapBlock(recorder: Recorder): BootstrapBlock {
  const metadata = recorder.writerBatchMetadata;
  assert.ok(metadata, 'el writer recibe metadata de lote aunque no persista nada');
  const block = metadata[APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY];
  assert.ok(block && typeof block === 'object', 'falta el bloque de bootstrap');
  return block as BootstrapBlock;
}

function selectedEntries(block: BootstrapBlock): PurchaseEntry[] {
  return block.candidates.filter((entry) => entry.selected_for_enrichment);
}

async function runRetest(
  options: Parameters<typeof buildDeps>[0] = {},
): Promise<{ recorder: Recorder; block: BootstrapBlock }> {
  const { deps, recorder } = buildDeps(options);
  await runApolloTwoRoundWizardDiscovery(runInput(), deps);
  return { recorder, block: readBootstrapBlock(recorder) };
}

// ─── § 13 · el replay de la corrida live ──────────────────────────────────────

describe('§ 13 · REGRESIÓN `74a49b01` — 5 seleccionados, 0 ejecutados', () => {
  it('BEFORE: sin la autorización enhebrada el gate de compra bloquea los 5', async () => {
    // Reproduce el estado de producción `6808835f`: el cascade REAL evalúa sin
    // `sectorEvidenceBootstrap`, exactamente como en la corrida live.
    const { deps, recorder } = buildDeps();
    const stripped: Partial<ApolloTwoRoundProductionDeps> = {
      ...deps,
      enrichCascade: (async (
        results: WebSearchResult[],
        maxEnrichments: number,
        cascadeDeps: unknown,
        options: { eligibility?: Record<string, unknown> },
      ) => {
        const { runApolloOrganizationEnrichmentCascade } = await import(
          '../../apollo-organization-enrichment-cascade'
        );
        // Se suelta EXACTAMENTE el campo que producción `6808835f` no enviaba.
        const eligibility = { ...(options.eligibility ?? {}) };
        delete eligibility['sectorEvidenceBootstrap'];
        return runApolloOrganizationEnrichmentCascade(
          results,
          maxEnrichments,
          cascadeDeps as never,
          { eligibility: eligibility as never },
        );
      }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],
    };
    await runApolloTwoRoundWizardDiscovery(runInput(), stripped);
    const block = readBootstrapBlock(recorder);

    assert.equal(block.bootstrap_eligible_count, RETEST_SALUD_LIVE_OUTCOME.bootstrapEligible);
    assert.equal(
      block.bootstrap_selected_for_enrichment_count,
      RETEST_SALUD_LIVE_OUTCOME.selectedForEnrichment,
    );
    assert.equal(
      block.bootstrap_enrichment_executed_count,
      RETEST_SALUD_LIVE_OUTCOME.enrichmentsExecuted,
      'el desenlace live: 5 cupos gastados en decidir, 0 compras',
    );
    assert.deepEqual(recorder.enrichOrganizationCalls, [], 'ni una llamada a Apollo');
    assert.deepEqual(recorder.usageLogDomains, [], 'ni una fila económica');

    for (const entry of selectedEntries(block)) {
      assert.equal(entry.purchase?.attempted, true, 'el cascade sí se invocó');
      assert.equal(
        entry.purchase?.skip_reason,
        'cascade_eligibility_blocked',
        'y devolvió eligibility_blocked, como en la corrida live',
      );
      assert.equal(
        entry.purchase?.cascade_ineligibility_reason,
        RETEST_SALUD_LIVE_OUTCOME.cascadeIneligibilityReason,
        'con el motivo fino que la forense tuvo que descubrir con un replay',
      );
    }
  });

  it('AFTER: con la autorización enhebrada, los 5 seleccionados compran', async () => {
    const { recorder, block } = await runRetest();

    assert.equal(block.bootstrap_authorized, true);
    assert.equal(block.bootstrap_eligible_count, RETEST_SALUD_LIVE_OUTCOME.bootstrapEligible);
    assert.equal(
      block.bootstrap_selected_for_enrichment_count,
      RETEST_SALUD_LIVE_OUTCOME.selectedForEnrichment,
      'la lógica de ranking NO se tocó: la misma selección',
    );
    assert.equal(
      block.bootstrap_purchase_authorized_count,
      RETEST_SALUD_LIVE_OUTCOME.selectedForEnrichment,
    );
    assert.equal(
      block.bootstrap_enrichment_executed_count,
      RETEST_SALUD_LIVE_OUTCOME.selectedForEnrichment,
      '5 de 5 ejecutan donde la corrida live ejecutó 0',
    );
    assert.equal(recorder.enrichOrganizationCalls.length, 5);
    assert.equal(recorder.usageLogDomains.length, 5, 'una fila económica por compra');

    for (const entry of selectedEntries(block)) {
      assert.equal(entry.purchase?.authorized, true);
      assert.equal(entry.purchase?.skip_reason, null);
      assert.equal(entry.purchase?.cascade_ineligibility_reason, null);
    }
  });

  it('la cohorte seleccionada es la MISMA que la live — cero deriva de ranking', async () => {
    const { recorder } = await runRetest();
    assert.deepEqual(
      [...recorder.enrichOrganizationCalls].sort(),
      [...RETEST_SALUD_SELECTED_DOMAINS].sort(),
    );
  });
});

// ─── § 4 · sólo los SELECCIONADOS pueden gastar ───────────────────────────────

describe('§ 4 · bootstrap-eligible NO es permiso para comprar', () => {
  it('los 20 elegibles no se convierten en 20 compras', async () => {
    const { recorder, block } = await runRetest();

    assert.equal(block.bootstrap_eligible_count, 20);
    assert.equal(recorder.enrichOrganizationCalls.length, 5);
    assert.ok(
      block.bootstrap_purchase_authorized_count <= RETEST_SALUD_REQUEST.maxEnrichmentsPerRun,
      'jamás más autorizaciones de compra que enrichments permite el cap',
    );
  });

  it('un elegible no seleccionado no llega ni al gate de compra', async () => {
    const { block } = await runRetest();
    const notSelected = block.candidates.filter((entry) => !entry.selected_for_enrichment);

    assert.ok(notSelected.length > 0, 'la cohorte tiene elegibles que no compitieron');
    for (const entry of notSelected) {
      assert.equal(entry.purchase, null, 'nadie le preguntó al gate de compra por él');
      assert.equal(entry.enrichment_executed, false);
    }
  });

  it('con el cap en 1, sólo UNA compra ocurre pese a 20 elegibles', async () => {
    const { recorder, block } = await runRetest({ maxEnrichmentsPerRun: 1 });
    assert.equal(recorder.enrichOrganizationCalls.length, 1);
    assert.equal(block.bootstrap_purchase_authorized_count, 1);
  });

  it('con el cap en 0, ninguna compra ocurre', async () => {
    const { recorder } = await runRetest({ maxEnrichmentsPerRun: 0 });
    assert.deepEqual(recorder.enrichOrganizationCalls, []);
  });
});

// ─── § 3 · fail-closed a través del runner ────────────────────────────────────

describe('§ 3 · fail-closed — una precondición ausente cancela toda compra', () => {
  const BLOCKED: { field: keyof BootstrapPreconditionOverrides; blockReason: string }[] = [
    { field: 'query_coverage_complete', blockReason: 'query_coverage_incomplete' },
    { field: 'catalog_version_coherent', blockReason: 'catalog_version_incoherent' },
    { field: 'catalog_terms_resolved', blockReason: 'catalog_terms_unresolved' },
    { field: 'provider_search_executed', blockReason: 'provider_search_not_executed' },
  ];

  for (const { field, blockReason } of BLOCKED) {
    it(`\`${field}\` en false ⇒ 0 compras y el motivo lo dice`, async () => {
      const { recorder, block } = await runRetest({
        rounds: [
          searchOutput(RESULTS.slice(0, 10), { [field]: false }),
          searchOutput(RESULTS.slice(10, 20), { [field]: false }),
        ],
      });

      assert.equal(block.bootstrap_authorized, false);
      assert.equal(block.bootstrap_eligible_count, 0, 'sin autorización nadie es elegible');
      assert.deepEqual(recorder.enrichOrganizationCalls, [], 'cero llamadas, cero créditos');
      assert.equal(
        (block as unknown as Record<string, unknown>)['bootstrap_block_reason'],
        blockReason,
      );
    });
  }

  it('una sola ronda con la pregunta equivocada cancela la corrida entera', async () => {
    const { recorder } = await runRetest({
      rounds: [
        searchOutput(RESULTS.slice(0, 10)),
        searchOutput(RESULTS.slice(10, 20), { query_coverage_complete: false }),
      ],
    });
    assert.deepEqual(recorder.enrichOrganizationCalls, []);
  });
});

// ─── § 6 · la degradación de estado ───────────────────────────────────────────

describe('§ 6 · una compra que NUNCA ocurrió no degrada al candidato', () => {
  it('sin pricing activo, los seleccionados conservan `bootstrap_eligible`', async () => {
    const { recorder, block } = await runRetest({ enrichmentUnitCostUsd: null });

    assert.deepEqual(recorder.enrichOrganizationCalls, []);
    const selected = selectedEntries(block);
    assert.ok(selected.length > 0, 'hubo selección aunque no hubiera pricing');
    for (const entry of selected) {
      assert.equal(
        entry.purchase?.skip_reason,
        'enrichment_pricing_unavailable',
        'el motivo real, no un genérico',
      );
      assert.equal(
        entry.post_enrichment_sector_state,
        'sector_evidence_missing_bootstrap_eligible',
        'el estado que tenía: nada se compró, así que nada pudo moverlo',
      );
    }
  });

  it('el candidato NO cae en `needs_enrichment` por una compra no intentada', async () => {
    const { block } = await runRetest({ enrichmentUnitCostUsd: null });
    const degraded = selectedEntries(block).filter(
      (entry) => entry.post_enrichment_sector_state === 'sector_evidence_missing_needs_enrichment',
    );
    assert.deepEqual(
      degraded.map((entry) => entry.candidate_key),
      [],
      'la degradación que la corrida live aplicó a sus 5 mejores candidatos',
    );
  });

  it('una compra que SÍ se intentó y falló se declara como intento, no como salto', async () => {
    // Contraparte honesta: aquí el crédito salió. Y sale UNA sola vez — un 500 es
    // un cobro INDETERMINADO, y el orquestador detiene los enrichments restantes
    // en vez de seguir gastando sobre una operación sin confirmar. Ese freno es
    // previo a este hito y sigue intacto.
    const { recorder, block } = await runRetest({ enrichmentFails: true });

    assert.equal(recorder.enrichOrganizationCalls.length, 1, 'la llamada ocurrió');
    const attempted = selectedEntries(block).filter((entry) => entry.purchase?.attempted === true);
    assert.equal(attempted.length, 1);
    for (const entry of attempted) {
      assert.equal(entry.purchase?.authorized, true);
      assert.equal(entry.purchase?.skip_reason, null, 'no fue un salto: fue un fallo');
    }
  });
});

// ─── § 9 · la cadena completa hasta la admisión ───────────────────────────────

describe('§ 9 · bootstrap → compra → precisión → admisión #276', () => {
  /**
   * Cohorte CONTROLADA, y por qué no es la live.
   *
   * Con las subindustrias que el retest pidió de verdad, la vía de #276 es
   * inalcanzable por una razón que este hito no toca: `Laboratorios
   * Farmacéuticos` NO tiene regla de precisión (el veredicto sale
   * `subindustry_not_mapped`, cobertura 11/73 tras #268). Una hija sin regla no
   * puede confirmarse, y sin confirmación no hay admisión. Se prueba abajo como
   * hecho, y se declara como límite.
   *
   * Para probar que la CADENA existe hace falta una hija que SÍ tenga regla. Estas
   * tres la tienen, son de un sector sin política legacy —que es la condición de
   * #276— y sus resultados llegan sin la clave `keywords`, como los devuelve el
   * proveedor cuando no clasifica: si llegara con `[]`, el array vacío de la
   * búsqueda ganaría al del perfil comprado y ninguna keyword sobreviviría.
   */
  const CONTROLLED_ORGS = [
    { id: 'gruposaludco', name: 'Grupo Salud CO', domain: 'gruposaludco.com.co', rank: 1 },
    { id: 'laboratorioco', name: 'Laboratorio CO', domain: 'laboratorioco.com.co', rank: 2 },
    { id: 'epsco', name: 'EPS CO', domain: 'epsco.com.co', rank: 3 },
  ];

  const CONTROLLED_SUBINDUSTRIES = [
    'Redes Hospitalarias y Clínicas',
    'Laboratorios Clínicos y Diagnóstico',
    'Medicina Prepagada y EPS',
  ];

  /** Sin un solo campo clasificatorio, y sin la clave `keywords`. */
  function controlledResult(org: (typeof CONTROLLED_ORGS)[number]): WebSearchResult {
    return {
      title: org.name,
      url: `https://${org.domain}`,
      snippet: `Empresa: ${org.name} | País: Colombia | [Fuente: Apollo Organizations]`,
      source: 'apollo_organizations',
      rank: org.rank,
      provider: 'apollo_organizations',
      metadata: {
        apollo_organization_id: org.id,
        domain: org.domain,
        linkedin_url: `https://www.linkedin.com/company/${org.id}`,
        country: 'Colombia',
        apollo_profile: { primary_domain: org.domain },
      },
    } as unknown as WebSearchResult;
  }

  const CONFIRMING_KEYWORDS: Record<string, string[]> = {
    'gruposaludco.com.co': ['red hospitalaria'],
    'laboratorioco.com.co': ['laboratorio clinico'],
    'epsco.com.co': ['entidad promotora de salud'],
  };

  async function runControlled(keywordsByDomain: Record<string, string[]>): Promise<{
    recorder: Recorder;
    block: BootstrapBlock;
  }> {
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput(CONTROLLED_ORGS.map(controlledResult))],
    });
    const controlled: Partial<ApolloTwoRoundProductionDeps> = {
      ...deps,
      enrichOrganization: (async ({ domain }: { domain: string }) => {
        recorder.enrichOrganizationCalls.push(domain);
        return {
          success: true,
          data: {
            industry: 'hospital & health care',
            keywords: keywordsByDomain[domain] ?? [],
            primary_domain: domain,
          },
        };
      }) as never,
    };
    await runApolloTwoRoundWizardDiscovery(
      runInput({ subindustries: [...CONTROLLED_SUBINDUSTRIES] }),
      controlled,
    );
    return { recorder, block: readBootstrapBlock(recorder) };
  }

  it('search sin clasificación → bootstrap → compra → hija confirmada → admisión', async () => {
    const { recorder, block } = await runControlled(CONFIRMING_KEYWORDS);

    assert.equal(block.bootstrap_eligible_count, CONTROLLED_ORGS.length);
    assert.equal(block.bootstrap_purchase_authorized_count, CONTROLLED_ORGS.length);
    assert.equal(recorder.enrichOrganizationCalls.length, CONTROLLED_ORGS.length);
    assert.ok(
      (block as unknown as Record<string, number>)[
        'sector_admitted_by_requested_subindustry_precision_count'
      ] > 0,
      'la vía de #276 es ALCANZABLE: sin este fix nunca llegó a ejercitarse',
    );
  });

  it('sólo la industria PADRE no admite a nadie', async () => {
    // Se compra igual, y no admite: la implicación no se invierte.
    const { recorder, block } = await runControlled({});

    assert.equal(recorder.enrichOrganizationCalls.length, CONTROLLED_ORGS.length);
    assert.equal(
      (block as unknown as Record<string, number>)[
        'sector_admitted_by_requested_subindustry_precision_count'
      ],
      0,
    );
  });

  it('LÍMITE DECLARADO: la hija que el retest pidió no tiene regla de precisión', async () => {
    // El fix hace que se COMPRE. Que la compra admita depende de que la hija
    // pedida tenga regla, y `Laboratorios Farmacéuticos` no la tiene. Es el
    // seguimiento de cobertura de Wave 1, no este hito.
    const { block } = await runRetest();

    assert.equal(
      block.bootstrap_enrichment_executed_count,
      RETEST_SALUD_LIVE_OUTCOME.selectedForEnrichment,
      'la compra sí ocurre',
    );
    assert.equal(
      (block as unknown as Record<string, number>)[
        'sector_admitted_by_requested_subindustry_precision_count'
      ],
      0,
      'y no admite, porque la hija pedida no está mapeada — límite, no regresión',
    );
    for (const entry of selectedEntries(block)) {
      assert.equal(entry.post_enrichment_sector_state, 'sector_not_mapped');
    }
  });
});

// ─── § 8 · caps y presupuesto ─────────────────────────────────────────────────

describe('§ 8 · los caps no se mueven', () => {
  it('<= 2 búsquedas, <= 5 enrichments, <= 25 créditos', async () => {
    const { recorder } = await runRetest();
    const checkpoint = recorder.savedCheckpoints.at(-1);
    assert.ok(checkpoint, 'la corrida deja checkpoint');

    assert.ok(checkpoint.round_summaries.length <= RETEST_SALUD_REQUEST.maxRoundsPerRun);
    assert.ok(recorder.enrichOrganizationCalls.length <= RETEST_SALUD_REQUEST.maxEnrichmentsPerRun);

    const credits = checkpoint.totals.search_credits + checkpoint.totals.enrichment_credits;
    assert.ok(
      credits <= RETEST_SALUD_REQUEST.reservedCredits,
      `créditos ${credits} dentro del cap de ${RETEST_SALUD_REQUEST.reservedCredits}`,
    );
  });

  it('el fix no compra un segundo enrichment por candidato', async () => {
    const { recorder } = await runRetest();
    assert.equal(
      new Set(recorder.enrichOrganizationCalls).size,
      recorder.enrichOrganizationCalls.length,
      'ningún dominio se enriquece dos veces',
    );
  });

  it('el presupuesto de agosto es un hecho LEÍDO, nunca modificado por la suite', () => {
    assert.equal(
      RETEST_SALUD_BUDGET_AFTER.budgetCredits -
        RETEST_SALUD_BUDGET_AFTER.creditsConsumed -
        RETEST_SALUD_BUDGET_AFTER.creditsReserved,
      RETEST_SALUD_BUDGET_AFTER.available,
    );
  });
});

// ─── § 12 · reconciliación terminal ───────────────────────────────────────────

describe('§ 12 · cada resultado único, exactamente una disposición', () => {
  it('20 resultados ⇒ 20 disposiciones, 0 sin clasificar, 0 repetidas', async () => {
    const { recorder } = await runRetest();
    const checkpoint = recorder.savedCheckpoints.at(-1);
    assert.ok(checkpoint);

    const keys = checkpoint.candidate_snapshots.map((snapshot) => snapshot.candidate_key);
    assert.equal(keys.length, RETEST_SALUD_SNAPSHOTS.length);
    assert.equal(new Set(keys).size, keys.length, 'ninguna clave repetida');
  });

  it('la disposición terminal que el runner publica cierra 20/20 sin `unclassified`', async () => {
    // Se lee del bloque que el runner escribe, no de una proyección propia: una
    // segunda proyección podría discrepar de la que de verdad se persiste.
    const { recorder } = await runRetest();
    const observability = (recorder.writerBatchMetadata ?? {})[
      APOLLO_TWO_ROUND_OBSERVABILITY_KEY
    ] as Record<string, unknown> | undefined;
    assert.ok(observability, 'el runner publica su bloque de observabilidad');

    const dispositions = observability['candidate_final_dispositions'] as {
      total_unique_results: number;
      unclassified_count: number;
      breakdown: Record<string, number>;
    };

    assert.equal(dispositions.total_unique_results, RETEST_SALUD_SNAPSHOTS.length);
    assert.equal(dispositions.unclassified_count, 0, 'ningún candidato fantasma');
    assert.equal(
      Object.values(dispositions.breakdown).reduce((total, count) => total + count, 0),
      RETEST_SALUD_SNAPSHOTS.length,
      'el desglose suma exactamente los 20 resultados únicos',
    );
  });
});

// ─── § 14 · observabilidad ────────────────────────────────────────────────────

describe('§ 14 · los seis estados del recorrido, distinguibles sin replay', () => {
  it('elegible, seleccionado, autorizado, intentado, ejecutado y por qué no', async () => {
    const { block } = await runRetest();

    assert.equal(typeof block.bootstrap_eligible_count, 'number');
    assert.equal(typeof block.bootstrap_selected_for_enrichment_count, 'number');
    assert.equal(typeof block.bootstrap_purchase_authorized_count, 'number');
    assert.equal(typeof block.bootstrap_purchase_attempted_count, 'number');
    assert.equal(typeof block.bootstrap_enrichment_executed_count, 'number');

    for (const entry of selectedEntries(block)) {
      assert.ok(entry.purchase, 'el seleccionado lleva su traza de compra');
      assert.equal(typeof entry.purchase.authorized, 'boolean');
      assert.equal(typeof entry.purchase.attempted, 'boolean');
      assert.ok('skip_reason' in entry.purchase);
      assert.ok('cascade_ineligibility_reason' in entry.purchase);
    }
  });

  it('la traza vive DENTRO del bloque de bootstrap, no en una verdad paralela', async () => {
    const { recorder } = await runRetest();
    const metadata = recorder.writerBatchMetadata ?? {};
    const parallelBlocks = Object.keys(metadata).filter((key) =>
      key.includes('purchase_gate'),
    );
    assert.deepEqual(parallelBlocks, [], 'ningún bloque nuevo que pueda discrepar');
  });
});
