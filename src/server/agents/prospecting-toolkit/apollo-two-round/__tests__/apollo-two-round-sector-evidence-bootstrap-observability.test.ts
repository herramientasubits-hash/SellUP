/**
 * apollo-two-round-sector-evidence-bootstrap-observability.test.ts —
 * La evidencia que un enrichment de bootstrap COMPRÓ sobrevive al rechazo
 * anterior al writer.
 *
 * AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1 · § 17.
 *
 * El agujero que estas pruebas cierran no es teórico: es la consecuencia directa
 * de dos decisiones deliberadas del hito.
 *
 *   1. la reevaluación posterior al enrichment corre SIN autorización, así que un
 *      sector sin política vuelve a `sector_not_mapped` y el orquestador lo marca
 *      como rechazo definitivo;
 *   2. `prospect_candidates.metadata.apollo_enrichment_capture` —el único sitio
 *      donde vivían las evaluaciones de precisión— sólo se escribe para los
 *      candidatos que llegan al writer.
 *
 *   ⇒ una corrida de Salud pagaba hasta cinco enrichments, adquiría la
 *     clasificación que la búsqueda no traía, y la perdía entera al terminar la
 *     request. Calibrar Wave 1 habría exigido volver a gastar.
 *
 * Todo atraviesa el runner de producción REAL (`runApolloTwoRoundWizardDiscovery`)
 * con el proveedor, el writer y las lecturas de duplicados inyectados. Cero
 * llamadas de red, cero créditos, cero escrituras en Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import type { ApolloTwoRoundCheckpointV1, ApolloTwoRoundCandidateSnapshot } from '../checkpoint';
import { fromCandidateEvidenceSnapshot } from '../checkpoint';
import { defaultApolloTwoRoundConfig } from '../index';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY,
  toApolloSectorEvidenceBootstrapManualReviewRows,
  type ApolloSectorEvidenceBootstrapCandidateAudit,
} from '../../apollo-sector-evidence-bootstrap-audit';
import { APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY } from '../../apollo-sector-evidence-bootstrap';
import {
  RUN1_SALUD_REQUEST,
  RUN1_SALUD_SNAPSHOTS,
} from '../../__tests__/fixtures/apollo-run1-salud-f4c8a60f';
import {
  buildPublishedCatalogTermsResolution,
  CATALOG_VERSION,
} from '../../__tests__/fixtures/sellup-published-catalog-search-terms';
import type {
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'run-bootstrap-1',
  clientRequestId: 'client-bootstrap-1',
  batchId: 'batch-bootstrap-1',
  reservationId: 'reservation-bootstrap-1',
  requestFingerprint: 'fingerprint-bootstrap-1',
  idempotencyKey: 'idempotency-bootstrap-1',
};

/**
 * Una organización tal como `mixed_companies/search` la devolvió en RUN 1: con
 * identidad y sin UN SOLO campo clasificatorio. Es la premisa del hito.
 */
function unclassifiedResult(options: {
  id: string;
  name: string;
  domain: string;
  rank: number;
}): WebSearchResult {
  return {
    title: options.name,
    url: `https://${options.domain}`,
    snippet: `Empresa: ${options.name} | País: Colombia | [Fuente: Apollo Organizations]`,
    source: 'apollo_organizations',
    rank: options.rank,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: options.id,
      domain: options.domain,
      linkedin_url: `https://www.linkedin.com/company/${options.id}`,
      country: 'Colombia',
      industry: null,
      industries: [],
      keywords: [],
      organization_keywords: [],
      short_description: null,
      seo_description: null,
      description: null,
      employee_count: null,
      apollo_profile: { primary_domain: options.domain },
    },
  } as unknown as WebSearchResult;
}

/**
 * Salida de búsqueda con las CUATRO precondiciones observadas.
 *
 * Es lo único que autoriza la adquisición, y viaja donde el provider real la
 * pone: en la metadata de la búsqueda emitida.
 */
function searchOutput(
  results: WebSearchResult[],
  options: { authorized?: boolean } = {},
): WebSearchOutput {
  const authorized = options.authorized ?? true;
  return {
    provider: 'apollo_organizations',
    query: 'salud',
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: {
      usage: { credits_used: results.length },
      [APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY]: {
        provider_search_executed: true,
        query_coverage_complete: authorized,
        catalog_version_coherent: true,
        catalog_terms_resolved: true,
      },
    },
  } as unknown as WebSearchOutput;
}

/** El perfil que `organization_enrichment` habría devuelto para un dominio. */
type EnrichedProfile = { industry: string | null; keywords: string[] };

function withEnrichedProfile(result: WebSearchResult, profile: EnrichedProfile): WebSearchResult {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  return {
    ...result,
    metadata: {
      ...meta,
      industry: profile.industry,
      keywords: profile.keywords,
      apollo_profile: {
        ...((meta['apollo_profile'] as Record<string, unknown>) ?? {}),
        industry: profile.industry,
        industries: profile.industry === null ? [] : [profile.industry],
        keywords: profile.keywords,
      },
      apollo_enrichment_fields_added: ['industry', 'keywords'],
    },
  } as unknown as WebSearchResult;
}

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
  return {
    name: result.title,
    website: result.url,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: RUN1_SALUD_REQUEST.industry,
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
    scoring: { qualityLabel: 'high_quality_new' } as ProspectingPipelineCandidate['scoring'],
  };
}

type Recorder = {
  enrichCalls: string[];
  /** Lo que el writer recibió. Con 0 candidatos sigue escribiendo la metadata. */
  persistedCandidateNames: string[] | null;
  writerBatchMetadata: Record<string, unknown> | null;
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
};

function buildDeps(options: {
  rounds: WebSearchOutput[];
  /** Perfil que el enrichment devuelve por dominio. Ausente ⇒ no aporta nada. */
  enrichedProfiles?: Record<string, EnrichedProfile>;
}): { deps: Partial<ApolloTwoRoundProductionDeps>; recorder: Recorder } {
  const recorder: Recorder = {
    enrichCalls: [],
    persistedCandidateNames: null,
    writerBatchMetadata: null,
    savedCheckpoints: [],
  };
  let searchCalls = 0;

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async () => {
      const output = options.rounds[searchCalls] ?? searchOutput([]);
      searchCalls++;
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async (results: WebSearchResult[]) => {
      const result = results[0]!;
      const domain = (result.metadata?.['domain'] as string) ?? '';
      recorder.enrichCalls.push(domain);
      const profile = options.enrichedProfiles?.[domain] ?? null;
      return {
        results: [profile === null ? result : withEnrichedProfile(result, profile)],
        meta: {
          enabled: true,
          cascade_version: 'test',
          entries: [{ domain, enriched: true, fields_added: ['industry', 'keywords'] }],
        },
      };
    }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
      extraBatchMetadata?: Record<string, unknown> | null;
    }) => {
      recorder.persistedCandidateNames = writerInput.pipelineOutput.candidates.map((c) => c.name);
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
      excludedDomains: new Set<string>(),
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
    loadEnrichmentUnitCostUsd: async () => 0.02,
    // `data` presente ⇒ el desenlace del cobro es `charged`, que es el caso que
    // hay que auditar: el crédito se gastó y la evidencia llegó.
    enrichOrganization: (async () => ({ success: true, data: {} })) as never,
    logEnrichmentUsage: (async () => ({ kind: 'logged' as const })) as never,
    resolveConfig: () => ({
      ...defaultApolloTwoRoundConfig(),
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    }),
  };

  return { deps, recorder };
}

function runInput(
  overrides: Partial<ApolloTwoRoundWizardRunInput> = {},
): ApolloTwoRoundWizardRunInput {
  return {
    country: RUN1_SALUD_REQUEST.country,
    countryCode: RUN1_SALUD_REQUEST.countryCode,
    industry: RUN1_SALUD_REQUEST.industry,
    subindustries: [...RUN1_SALUD_REQUEST.subindustries],
    // Sin términos resueltos del catálogo publicado, el gate de cobertura bloquea
    // la búsqueda antes de emitirla y la corrida no llega ni a plantearse el
    // bootstrap. Es la misma resolución que hace el wizard en su frontera.
    subindustryCatalogTerms: buildPublishedCatalogTermsResolution(),
    selectionCatalogVersion: CATALOG_VERSION,
    additionalCriteria: null,
    reservedBatchId: CORRELATION.batchId,
    triggeredByUserId: 'user-1',
    ownerId: 'user-1',
    correlation: CORRELATION,
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: 25,
    ...overrides,
  };
}

// ─── Lectura del bloque durable ───────────────────────────────────────────────

type BootstrapBlock = {
  bootstrap_authorized: boolean;
  bootstrap_eligible_count: number;
  bootstrap_selected_for_enrichment_count: number;
  bootstrap_enrichment_executed_count: number;
  candidates: Record<string, unknown>[];
};

/**
 * Lee el bloque como lo leería una auditoría: desde la metadata que el writer
 * dejó en el lote, NO desde el objeto que el runner devolvió en memoria.
 */
function readBootstrapBlock(recorder: Recorder): BootstrapBlock {
  const metadata = recorder.writerBatchMetadata;
  assert.ok(metadata, 'el writer tiene que recibir metadata de lote aunque no persista nada');
  const block = metadata[APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY];
  assert.ok(block && typeof block === 'object', 'falta el bloque de bootstrap');
  return block as BootstrapBlock;
}

function candidateEntry(block: BootstrapBlock, domain: string): Record<string, unknown> {
  const entry = block.candidates.find((item) =>
    String(item['candidate_key']).includes(domain.replace(/\..*$/, '')),
  );
  assert.ok(entry, `sin registro durable para ${domain}`);
  return entry;
}

function precisionOf(entry: Record<string, unknown>): Record<string, unknown> {
  const precision = entry['post_enrichment_precision'];
  assert.ok(precision && typeof precision === 'object', 'sin precisión post-enrichment');
  return precision as Record<string, unknown>;
}

// ─── § 2 y § 3 · el candidato muere pre-writer y su evidencia sobrevive ───────

const HEALTH_ORGS = [
  { id: 'gruposaludco', name: 'Grupo Salud CO', domain: 'gruposaludco.com.co', rank: 1 },
  { id: 'laboratorioco', name: 'Laboratorio CO', domain: 'laboratorioco.com.co', rank: 2 },
  { id: 'epsco', name: 'EPS CO', domain: 'epsco.com.co', rank: 3 },
];

const HEALTH_PROFILES: Record<string, EnrichedProfile> = {
  'gruposaludco.com.co': {
    industry: 'hospital & health care',
    keywords: ['red hospitalaria', 'grupo hospitalario'],
  },
  'laboratorioco.com.co': {
    industry: 'hospital & health care',
    keywords: ['laboratorio clinico', 'diagnostico clinico'],
  },
  'epsco.com.co': {
    industry: 'hospital & health care',
    keywords: ['entidad promotora de salud', 'medicina prepagada'],
  },
};

async function runHealthScenario(
  profiles: Record<string, EnrichedProfile> = HEALTH_PROFILES,
): Promise<Recorder> {
  const results = HEALTH_ORGS.map((org) => unclassifiedResult(org));
  const { deps, recorder } = buildDeps({
    rounds: [searchOutput(results)],
    enrichedProfiles: profiles,
  });
  await runApolloTwoRoundWizardDiscovery(runInput(), deps);
  return recorder;
}

describe('§ 2 · el candidato bootstrap-enriched no persiste, y su evidencia sí', () => {
  it('el writer no recibe ni un candidato, y aun así recibe la traza', async () => {
    const recorder = await runHealthScenario();

    // La premisa que hay que sostener: NO hay fila de `prospect_candidates`.
    assert.deepEqual(recorder.persistedCandidateNames, []);

    const block = readBootstrapBlock(recorder);
    assert.equal(block.bootstrap_authorized, true);
    assert.equal(block.bootstrap_eligible_count, HEALTH_ORGS.length);
    assert.equal(block.bootstrap_enrichment_executed_count, HEALTH_ORGS.length);
  });

  it('la evidencia enriquecida se reconstruye entera desde el lote', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);
    const entry = candidateEntry(block, 'gruposaludco.com.co');

    // Identidad, motivo y puesto.
    assert.equal(entry['bootstrap_reason'], 'provider_classification_missing');
    assert.equal(entry['selected_for_enrichment'], true);
    assert.equal(typeof entry['selection_rank'], 'number');

    // Enrichment ejecutado y clasificación COMPRADA.
    assert.equal(entry['enrichment_executed'], true);
    const classification = entry['enriched_classification'] as Record<string, unknown>;
    assert.equal(classification['industry'], 'hospital & health care');
    assert.deepEqual(classification['keywords'], ['red hospitalaria', 'grupo hospitalario']);
    assert.equal(classification['provider_classification_resolved'], true);

    // Precisión posterior al enrichment, con la subindustria que casó y por qué.
    const precision = precisionOf(entry);
    assert.equal(precision['matched_requested_subindustry'], 'Redes Hospitalarias y Clínicas');
    const evaluations = precision['per_requested_subindustry_evaluations'] as Record<
      string,
      unknown
    >[];
    assert.equal(evaluations.length, RUN1_SALUD_REQUEST.subindustries.length);
    const evidence = precision['subindustry_evidence'] as Record<string, unknown>[];
    assert.ok(evidence.length > 0, 'la evidencia term/field/source tiene que viajar');
    for (const item of evidence) {
      assert.equal(typeof item['term'], 'string');
      assert.equal(typeof item['field'], 'string');
      assert.equal(typeof item['source'], 'string');
    }

    // Desenlace: el sector sigue sin política y el candidato muere con causa.
    assert.equal(entry['post_enrichment_sector_state'], 'sector_not_mapped');
    assert.equal(entry['terminal_disposition'], 'sector_subindustry_rejected_final');
    assert.equal(entry['terminal_reason'], 'sector_not_mapped');
  });

  it('el estado de bootstrap es INTERMEDIO: no sobrevive como estado final', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);
    for (const entry of block.candidates) {
      assert.notEqual(
        entry['post_enrichment_sector_state'],
        'sector_evidence_missing_bootstrap_eligible',
      );
    }
  });
});

// ─── § 3 · el benchmark no depende de `prospect_candidates` ───────────────────

describe('§ 3 · ruta de recuperación sin una sola fila de candidato', () => {
  it('con 0 candidatos persistidos, el pack de revisión manual se arma igual', async () => {
    const recorder = await runHealthScenario();
    assert.deepEqual(recorder.persistedCandidateNames, []);

    const block = readBootstrapBlock(recorder);
    // La ruta exacta: `prospect_batches.metadata.apollo_sector_evidence_bootstrap`
    // para el juicio, y `…apollo_two_round_checkpoint.candidate_snapshots` para
    // nombre y dominio. Ninguna de las dos es `prospect_candidates`.
    const checkpoint = recorder.savedCheckpoints.at(-1);
    assert.ok(checkpoint, 'la corrida tiene que dejar checkpoint');

    const audit = block.candidates.map(
      (entry) =>
        ({
          candidateKey: String(entry['candidate_key']),
          bootstrapReason: 'provider_classification_missing',
          selectedForEnrichment: entry['selected_for_enrichment'] === true,
          selectionRank: (entry['selection_rank'] as number | null) ?? null,
          enrichmentStatus: 'executed',
          enrichmentExecuted: entry['enrichment_executed'] === true,
          enrichedClassification: null,
          postEnrichmentPrecision: null,
          postEnrichmentSectorState: 'sector_not_mapped',
          terminalDisposition: 'sector_subindustry_rejected_final',
          terminalReason: 'sector_not_mapped',
        }) satisfies ApolloSectorEvidenceBootstrapCandidateAudit,
    );

    const rows = toApolloSectorEvidenceBootstrapManualReviewRows({
      audit,
      candidateSnapshots: checkpoint.candidate_snapshots,
    });
    assert.equal(rows.length, HEALTH_ORGS.length);
    for (const row of rows) {
      assert.ok(row.company, 'el nombre sale del checkpoint, no del candidato persistido');
      assert.ok(row.domain, 'el dominio sale del checkpoint');
      assert.equal(row.persisted, false);
      assert.equal(row.manualDecision, null);
    }
  });

  it('el checkpoint conserva la evidencia YA ENRIQUECIDA de un rechazado', async () => {
    const recorder = await runHealthScenario();
    const checkpoint = recorder.savedCheckpoints.at(-1)!;
    const snapshot = checkpoint.candidate_snapshots.find((item) =>
      item.candidate_key.includes('gruposaludco'),
    );
    assert.ok(snapshot?.evidence, 'sin evidencia en el snapshot no hay nada que reconstruir');
    assert.equal(snapshot.evidence.industry, 'hospital & health care');
    assert.deepEqual(snapshot.evidence.keywords, ['red hospitalaria', 'grupo hospitalario']);
  });
});

// ─── § 6 · los tres casos de Salud, auditables uno a uno ──────────────────────

describe('§ 6 · red hospitalaria, laboratorio y EPS', () => {
  const EXPECTED: Record<string, string> = {
    'gruposaludco.com.co': 'Redes Hospitalarias y Clínicas',
    'laboratorioco.com.co': 'Laboratorios Clínicos y Diagnóstico',
    'epsco.com.co': 'Medicina Prepagada y EPS',
  };

  it('cada uno confirma SU subindustria y ninguna de las otras dos', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);

    for (const [domain, expected] of Object.entries(EXPECTED)) {
      const entry = candidateEntry(block, domain);
      const precision = precisionOf(entry);
      assert.equal(precision['matched_requested_subindustry'], expected, domain);

      const evaluations = precision['per_requested_subindustry_evaluations'] as Record<
        string,
        unknown
      >[];
      const confirmed = evaluations
        .filter((evaluation) => evaluation['subindustry_match'] === 'confirmed')
        .map((evaluation) => evaluation['requested_subindustry']);
      assert.deepEqual(confirmed, [expected], `${domain} confirma exactamente una`);
    }
  });

  it('los tres murieron pre-writer y los tres siguen siendo auditables', async () => {
    const recorder = await runHealthScenario();
    assert.deepEqual(recorder.persistedCandidateNames, []);
    const block = readBootstrapBlock(recorder);
    assert.equal(block.candidates.length, 3);
    for (const entry of block.candidates) {
      assert.equal(entry['enrichment_executed'], true);
      assert.ok(entry['post_enrichment_precision'], 'sin precisión no hay calibración');
      assert.equal(entry['terminal_reason'], 'sector_not_mapped');
    }
  });
});

// ─── § 7 · sólo la industria PADRE ────────────────────────────────────────────

describe('§ 7 · el perfil comprado trae la industria padre y nada más', () => {
  const PARENT_ONLY: Record<string, EnrichedProfile> = {
    'gruposaludco.com.co': { industry: 'hospital & health care', keywords: [] },
    'laboratorioco.com.co': { industry: 'hospital & health care', keywords: [] },
    'epsco.com.co': { industry: 'hospital & health care', keywords: [] },
  };

  it('ninguna de las tres subindustrias confirma, y el audit lo demuestra', async () => {
    const recorder = await runHealthScenario(PARENT_ONLY);
    const block = readBootstrapBlock(recorder);
    assert.equal(block.candidates.length, 3);

    for (const entry of block.candidates) {
      const precision = precisionOf(entry);
      assert.equal(precision['matched_requested_subindustry'], null);
      const evaluations = precision['per_requested_subindustry_evaluations'] as Record<
        string,
        unknown
      >[];
      assert.equal(evaluations.length, RUN1_SALUD_REQUEST.subindustries.length);
      for (const evaluation of evaluations) {
        assert.notEqual(evaluation['subindustry_match'], 'confirmed');
      }
    }
  });

  it('la industria padre SÍ se registra como clasificación resuelta', async () => {
    // La distinción que la calibración necesita: el crédito resolvió la ausencia
    // (Apollo devolvió una industria) aunque no confirmara ninguna subindustria.
    const recorder = await runHealthScenario(PARENT_ONLY);
    const block = readBootstrapBlock(recorder);
    for (const entry of block.candidates) {
      const classification = entry['enriched_classification'] as Record<string, unknown>;
      assert.equal(classification['industry'], 'hospital & health care');
      assert.equal(classification['provider_classification_resolved'], true);
    }
  });

  it('un enrichment que tampoco trae nada se distingue del que sí trajo', async () => {
    const recorder = await runHealthScenario({});
    const block = readBootstrapBlock(recorder);
    for (const entry of block.candidates) {
      const classification = entry['enriched_classification'] as Record<string, unknown>;
      assert.equal(classification['industry'], null);
      assert.equal(classification['provider_classification_resolved'], false);
    }
  });
});

// ─── § 8 · reconciliación terminal ────────────────────────────────────────────

describe('§ 8 · un candidato termina exactamente una vez', () => {
  it('bootstrap no es una disposición terminal: la terminal es el rechazo', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);
    for (const entry of block.candidates) {
      assert.equal(entry['terminal_disposition'], 'sector_subindustry_rejected_final');
      assert.ok(entry['terminal_reason'], 'la disposición terminal lleva motivo');
    }
  });

  it('ninguna clave aparece dos veces en el bloque', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);
    const keys = block.candidates.map((entry) => String(entry['candidate_key']));
    assert.equal(new Set(keys).size, keys.length);
  });

  it('el desglose agregado de disposiciones cuenta a los tres una sola vez', async () => {
    const recorder = await runHealthScenario();
    const metadata = recorder.writerBatchMetadata!;
    const observability = metadata[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] as
      | Record<string, unknown>
      | undefined;
    const dispositions = observability?.['candidate_final_dispositions'] as
      | { total_unique_results: number; unclassified_count: number; breakdown: Record<string, number> }
      | undefined;
    assert.ok(dispositions, 'la corrida publica el desglose canónico');
    assert.equal(dispositions.unclassified_count, 0);
    assert.equal(dispositions.breakdown['sector_subindustry_rejected_final'], 3);
    assert.equal(dispositions.total_unique_results, 3);
  });
});

// ─── § 12 · replay offline de RUN 1 ───────────────────────────────────────────

describe('§ 12 · los 20 snapshots reales de `f4c8a60f`, sin llamar a Apollo', () => {
  /** Los 20 reales, reconstruidos desde la evidencia mínima del checkpoint live. */
  const RUN1_RESULTS: WebSearchResult[] = RUN1_SALUD_SNAPSHOTS.map((snapshot) =>
    fromCandidateEvidenceSnapshot(snapshot.evidence),
  );

  /**
   * Enrichment simulado uniforme: todos devuelven la industria padre.
   *
   * Deliberadamente NO se le da a cada uno la clasificación que lo confirmaría:
   * lo que este § tiene que demostrar es la RECUPERABILIDAD del gasto, y un
   * escenario donde todos confirman haría que unos cuantos persistieran y dejaría
   * sin probar el caso que importa.
   */
  const SIMULATED: Record<string, EnrichedProfile> = Object.fromEntries(
    RUN1_SALUD_SNAPSHOTS.map((snapshot) => [
      snapshot.evidence.domain ?? '',
      { industry: 'hospital & health care', keywords: [] },
    ]),
  );

  async function replay(): Promise<Recorder> {
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput(RUN1_RESULTS)],
      enrichedProfiles: SIMULATED,
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    return recorder;
  }

  it('se seleccionan como mucho 5 y se enriquecen exactamente esos', async () => {
    const recorder = await replay();
    assert.equal(recorder.enrichCalls.length, 5);
    const block = readBootstrapBlock(recorder);
    assert.equal(block.bootstrap_selected_for_enrichment_count, 5);
    assert.equal(block.bootstrap_enrichment_executed_count, 5);
    assert.ok(block.bootstrap_eligible_count > 5, 'compiten más de los que caben');
  });

  it('los 5 quedan auditables aunque `prospect_candidates` sea 0', async () => {
    const recorder = await replay();
    assert.deepEqual(recorder.persistedCandidateNames, []);

    const block = readBootstrapBlock(recorder);
    const enriched = block.candidates.filter((entry) => entry['enrichment_executed'] === true);
    assert.equal(enriched.length, 5);
    for (const entry of enriched) {
      assert.ok(entry['enriched_classification'], 'la clasificación comprada viaja');
      assert.ok(entry['post_enrichment_precision'], 'el veredicto de precisión viaja');
      assert.equal(entry['post_enrichment_sector_state'], 'sector_not_mapped');
      assert.equal(entry['terminal_reason'], 'sector_not_mapped');
    }
  });

  it('el que NO compitió lleva registro ligero, sin clasificación inventada', async () => {
    const recorder = await replay();
    const block = readBootstrapBlock(recorder);
    const notSelected = block.candidates.filter(
      (entry) => entry['selected_for_enrichment'] !== true,
    );
    assert.ok(notSelected.length > 0);
    for (const entry of notSelected) {
      assert.equal(entry['selection_rank'], null);
      assert.equal(entry['enrichment_executed'], false);
      assert.equal(entry['enriched_classification'], null);
      assert.equal(entry['post_enrichment_precision'], null);
      assert.ok(entry['terminal_disposition'], 'sigue teniendo desenlace nombrado');
    }
  });

  it('el orden del bloque es determinístico: seleccionados por puesto, 1..5', async () => {
    const recorder = await replay();
    const block = readBootstrapBlock(recorder);
    const ranks = block.candidates
      .map((entry) => entry['selection_rank'])
      .filter((rank): rank is number => typeof rank === 'number');
    assert.deepEqual(ranks, [1, 2, 3, 4, 5]);
  });
});

// ─── § 10 · el contrato mínimo, campo por campo ───────────────────────────────

describe('§ 10 · contrato de observabilidad del candidato bootstrap-enriched', () => {
  const REQUIRED_KEYS = [
    'candidate_key',
    'bootstrap_reason',
    'selection_rank',
    'enrichment_executed',
    'enriched_classification',
    'post_enrichment_precision',
    'post_enrichment_sector_state',
    'terminal_disposition',
    'terminal_reason',
  ];

  it('las nueve claves están presentes en todo candidato enriquecido', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);
    for (const entry of block.candidates) {
      for (const key of REQUIRED_KEYS) {
        assert.ok(key in entry, `falta \`${key}\``);
      }
    }
  });

  it('sin autorización no hay bloque de candidatos: el hito no deriva nada', async () => {
    const results = HEALTH_ORGS.map((org) => unclassifiedResult(org));
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput(results, { authorized: false })],
      enrichedProfiles: HEALTH_PROFILES,
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const block = readBootstrapBlock(recorder);
    assert.equal(block.bootstrap_authorized, false);
    assert.equal(block.bootstrap_eligible_count, 0);
    assert.deepEqual(block.candidates, []);
    // Y, sobre todo: no se gastó un solo enrichment.
    assert.deepEqual(recorder.enrichCalls, []);
  });

  it('el bloque no publica nombres de empresa: la identidad es la clave', async () => {
    const recorder = await runHealthScenario();
    const block = readBootstrapBlock(recorder);
    const serialized = JSON.stringify(block);
    for (const org of HEALTH_ORGS) {
      assert.ok(!serialized.includes(org.name), `el bloque no debe nombrar a ${org.name}`);
    }
  });
});

// ─── Pack de revisión manual ──────────────────────────────────────────────────

describe('Pack de revisión manual — las columnas del benchmark', () => {
  const SNAPSHOT: ApolloTwoRoundCandidateSnapshot = {
    candidate_key: 'apollo:org-1',
    round_number: 1,
    provider_rank: 1,
    provider_organization_id: 'org-1',
    normalized_name: 'grupo salud co',
    normalized_domain: 'gruposaludco.com.co',
    normalized_linkedin_url: null,
    sector_evidence_state: 'sector_not_mapped',
    rejection_reason: null,
    eligible: false,
    became_eligible_after_enrichment: false,
    finally_rejected_or_duplicated: true,
    no_prior_suggestion: true,
    enrichment_status: 'executed',
    ranking_signals: {
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 0,
      novel: true,
      hasCompanySizeSignal: false,
      hasLocationSignal: true,
      hasLinkedInUrl: false,
      freeOfContradictoryEvidence: true,
      knownDuplicate: false,
      cooldownActive: false,
    },
    evidence: null,
  };

  const AUDIT: ApolloSectorEvidenceBootstrapCandidateAudit = {
    candidateKey: 'apollo:org-1',
    bootstrapReason: 'provider_classification_missing',
    selectedForEnrichment: true,
    selectionRank: 1,
    enrichmentStatus: 'executed',
    enrichmentExecuted: true,
    enrichedClassification: {
      industry: 'hospital & health care',
      industries: ['hospital & health care'],
      keywords: ['red hospitalaria'],
      organizationKeywords: [],
      hasShortDescription: false,
      hasSeoDescription: false,
      hasDescription: false,
      employeeCount: null,
    },
    postEnrichmentPrecision: null,
    postEnrichmentSectorState: 'sector_not_mapped',
    terminalDisposition: 'sector_subindustry_rejected_final',
    terminalReason: 'sector_not_mapped',
  };

  it('sin evaluaciones produce UNA fila y no inventa subindustria', () => {
    const rows = toApolloSectorEvidenceBootstrapManualReviewRows({
      audit: [AUDIT],
      candidateSnapshots: [SNAPSHOT],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.requestedSubindustry, null);
    assert.equal(rows[0]!.diagnosticVerdict, null);
  });

  it('sin snapshot de checkpoint, la fila existe pero declara el hueco', () => {
    const rows = toApolloSectorEvidenceBootstrapManualReviewRows({
      audit: [AUDIT],
      candidateSnapshots: [],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.company, null);
    assert.equal(rows[0]!.domain, null);
    assert.equal(rows[0]!.providerIndustry, 'hospital & health care');
  });

  it('`persisted` se DERIVA de la disposición, nunca se supone', () => {
    const persisted = toApolloSectorEvidenceBootstrapManualReviewRows({
      audit: [
        { ...AUDIT, terminalDisposition: 'provisionally_persisted_pending_writer_final' },
        { ...AUDIT, candidateKey: 'apollo:org-2', terminalDisposition: 'persisted_review_only_final' },
        { ...AUDIT, candidateKey: 'apollo:org-3', terminalDisposition: null },
      ],
      candidateSnapshots: [SNAPSHOT],
    }).map((row) => row.persisted);
    assert.deepEqual(persisted, [true, true, false]);
  });
});
