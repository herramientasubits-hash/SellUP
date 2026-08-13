/**
 * apollo-two-round-sector-post-enrichment-admission-1.test.ts —
 * De `bootstrap` a `admission` sin el falso `sector_not_mapped`, extremo a extremo.
 *
 * AGENT1-SECTOR-POST-ENRICHMENT-ADMISSION-1 · §§ 17, 21, 22.
 *
 * La cadena completa a través del runner de producción REAL:
 *
 *   search sin campos clasificatorios
 *   → bootstrap eligible
 *   → selected
 *   → organization_enrichment simulado
 *   → precisión de la hija PEDIDA = confirmed
 *   → admisión sectorial confirmada por la hija
 *   → sigue hacia los gates POSTERIORES.
 *
 * Y su contraparte: sólo-padre sigue sin admitir a nadie.
 *
 * § 22 — el replay usa la cohorte REAL del lote `f4c8a60f-43fe-411a-896e-4a19bd06505d`
 * exportada read-only en el fixture. Cero llamadas al proveedor, cero créditos,
 * cero escrituras. No se afirma cuántos candidatos reales de RUN 1 habrían pasado:
 * aquella corrida ejecutó CERO enrichments y sus perfiles no existen. Los perfiles
 * de este archivo son simulaciones controladas, y así se declaran.
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
import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY,
  toApolloSectorEvidenceBootstrapManualReviewRows,
  type ApolloSectorEvidenceBootstrapCandidateAudit,
} from '../../apollo-sector-evidence-bootstrap-audit';
import { APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY } from '../../apollo-sector-evidence-bootstrap';
import {
  RUN1_SALUD_LIVE_OUTCOME,
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

// ─── Arnés ────────────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'run-admission-1',
  clientRequestId: 'client-admission-1',
  batchId: 'batch-admission-1',
  reservationId: 'reservation-admission-1',
  requestFingerprint: 'fingerprint-admission-1',
  idempotencyKey: 'idempotency-admission-1',
};

type EnrichedProfile = { industry: string | null; keywords: string[] };

function searchOutput(results: WebSearchResult[]): WebSearchOutput {
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
        query_coverage_complete: true,
        catalog_version_coherent: true,
        catalog_terms_resolved: true,
      },
    },
  } as unknown as WebSearchOutput;
}

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
  persistedCandidateNames: string[] | null;
  writerBatchMetadata: Record<string, unknown> | null;
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
};

function buildDeps(options: {
  rounds: WebSearchOutput[];
  enrichedProfiles?: Record<string, EnrichedProfile>;
  /** Gate POSTERIOR al sectorial: ownership. Existe para el § 17. */
  ownershipBlockedDomains?: ReadonlySet<string>;
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

    buildCandidate: (async (result: WebSearchResult) => {
      const candidate = pipelineCandidate(result);
      const domain = candidate.domain ?? '';
      // Un nombre que no guarda relación con el dominio dispara el gate de
      // ownership, que corre DESPUÉS del sectorial.
      return {
        candidate: options.ownershipBlockedDomains?.has(domain)
          ? { ...candidate, name: 'Sociedad Anónima Sin Relación Alguna' }
          : candidate,
        nameQualityFiltered: false,
      };
    }) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

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

type BootstrapBlock = {
  bootstrap_authorized: boolean;
  bootstrap_eligible_count: number;
  bootstrap_selected_for_enrichment_count: number;
  bootstrap_enrichment_executed_count: number;
  sector_admitted_by_requested_subindustry_precision_count: number;
  candidates: Record<string, unknown>[];
};

function readBootstrapBlock(recorder: Recorder): BootstrapBlock {
  const metadata = recorder.writerBatchMetadata;
  assert.ok(metadata, 'el writer recibe metadata de lote aunque no persista nada');
  const block = metadata[APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY];
  assert.ok(block && typeof block === 'object', 'falta el bloque de bootstrap');
  return block as BootstrapBlock;
}

function entryFor(block: BootstrapBlock, domain: string): Record<string, unknown> {
  const entry = block.candidates.find((item) =>
    String(item['candidate_key']).includes(domain.replace(/\..*$/, '')),
  );
  assert.ok(entry, `sin registro durable para ${domain}`);
  return entry;
}

function admissionOf(entry: Record<string, unknown>): Record<string, unknown> {
  const admission = entry['sector_admission'];
  assert.ok(admission && typeof admission === 'object', 'falta el bloque de admisión');
  return admission as Record<string, unknown>;
}

// ─── § 17 · bootstrap → enrichment → admisión → gates posteriores ─────────────

const HEALTH_ORGS = [
  { id: 'gruposaludco', name: 'Grupo Salud CO', domain: 'gruposaludco.com.co', rank: 1 },
  { id: 'laboratorioco', name: 'Laboratorio CO', domain: 'laboratorioco.com.co', rank: 2 },
  { id: 'epsco', name: 'EPS CO', domain: 'epsco.com.co', rank: 3 },
];

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

/** Perfiles simulados que confirman, cada uno, UNA de las tres pedidas. */
const CONFIRMING_PROFILES: Record<string, EnrichedProfile> = {
  'gruposaludco.com.co': {
    industry: 'hospital & health care',
    keywords: ['red hospitalaria', 'grupo hospitalario'],
  },
  'laboratorioco.com.co': {
    industry: 'hospital & health care',
    keywords: ['laboratorio clinico'],
  },
  'epsco.com.co': {
    industry: 'hospital & health care',
    keywords: ['entidad promotora de salud'],
  },
};

/** El mismo enrichment trayendo SÓLO la industria padre. */
const PARENT_ONLY_PROFILES: Record<string, EnrichedProfile> = Object.fromEntries(
  HEALTH_ORGS.map((org) => [org.domain, { industry: 'hospital & health care', keywords: [] }]),
);

async function runHealth(
  profiles: Record<string, EnrichedProfile>,
  options: { ownershipBlockedDomains?: ReadonlySet<string> } = {},
): Promise<Recorder> {
  const { deps, recorder } = buildDeps({
    rounds: [searchOutput(HEALTH_ORGS.map((org) => unclassifiedResult(org)))],
    enrichedProfiles: profiles,
    ...(options.ownershipBlockedDomains
      ? { ownershipBlockedDomains: options.ownershipBlockedDomains }
      : {}),
  });
  await runApolloTwoRoundWizardDiscovery(runInput(), deps);
  return recorder;
}

describe('§ 17 · la cadena entera, sin el falso `sector_not_mapped`', () => {
  it('search sin clasificación → bootstrap → enrichment → hija confirmada → admisión', async () => {
    const recorder = await runHealth(CONFIRMING_PROFILES);
    const block = readBootstrapBlock(recorder);

    // La premisa: la búsqueda no traía nada y por eso compitieron.
    assert.equal(block.bootstrap_authorized, true);
    assert.equal(block.bootstrap_eligible_count, HEALTH_ORGS.length);
    assert.equal(block.bootstrap_enrichment_executed_count, HEALTH_ORGS.length);
    // El desenlace nuevo: los tres cruzan el gate sectorial por su hija PEDIDA.
    assert.equal(block.sector_admitted_by_requested_subindustry_precision_count, 3);

    for (const [domain, expected] of [
      ['gruposaludco.com.co', 'Redes Hospitalarias y Clínicas'],
      ['laboratorioco.com.co', 'Laboratorios Clínicos y Diagnóstico'],
      ['epsco.com.co', 'Medicina Prepagada y EPS'],
    ] as const) {
      const admission = admissionOf(entryFor(block, domain));
      assert.equal(admission['source'], 'confirmed_requested_subindustry_precision', domain);
      assert.equal(admission['matched_requested_subindustry'], expected, domain);
      // El estado que tenían ANTES de la admisión sigue registrado.
      assert.equal(admission['post_enrichment_sector_state'], 'sector_not_mapped', domain);
    }
  });

  it('sólo-padre: la misma cadena, sin admisión y con rechazo sectorial', async () => {
    const recorder = await runHealth(PARENT_ONLY_PROFILES);
    const block = readBootstrapBlock(recorder);

    assert.equal(block.bootstrap_enrichment_executed_count, HEALTH_ORGS.length);
    assert.equal(block.sector_admitted_by_requested_subindustry_precision_count, 0);
    assert.deepEqual(recorder.persistedCandidateNames, []);
    for (const entry of block.candidates) {
      const admission = admissionOf(entry);
      assert.equal(admission['admitted_by_requested_subindustry_precision'], false);
      assert.equal(admission['block_reason'], 'no_confirmed_requested_subindustry');
      assert.equal(entry['terminal_reason'], 'sector_not_mapped');
    }
  });

  it('admitir NO es persistir: un gate POSTERIOR sigue pudiendo rechazar', async () => {
    // Ownership corre DESPUÉS del veredicto sectorial. Un candidato admitido por su
    // hija confirmada y bloqueado por ownership no llega al writer, y su motivo
    // terminal es el gate REAL, no `sector_not_mapped` (§ 21).
    const recorder = await runHealth(CONFIRMING_PROFILES, {
      ownershipBlockedDomains: new Set(['gruposaludco.com.co']),
    });
    const block = readBootstrapBlock(recorder);
    const entry = entryFor(block, 'gruposaludco.com.co');

    assert.equal(admissionOf(entry)['admitted_by_requested_subindustry_precision'], true);
    assert.equal(entry['terminal_reason'], 'ownership_mismatch');
    assert.notEqual(entry['terminal_reason'], 'sector_not_mapped');
    assert.ok(
      !(recorder.persistedCandidateNames ?? []).includes('Grupo Salud CO'),
      'el rechazado por ownership no persiste',
    );
  });
});

// ─── § 20 · el pack de revisión manual nombra la causa ────────────────────────

describe('§ 20 · el pack de revisión manual dice POR QUÉ cruzó', () => {
  it('cada fila lleva la fuente de admisión y la hija que la produjo', async () => {
    const recorder = await runHealth(CONFIRMING_PROFILES);
    const block = readBootstrapBlock(recorder);
    const checkpoint = recorder.savedCheckpoints.at(-1);
    assert.ok(checkpoint, 'la corrida deja checkpoint');

    // El audit se rehidrata desde el bloque durable, igual que lo haría una
    // auditoría posterior a la request.
    const audit: ApolloSectorEvidenceBootstrapCandidateAudit[] = block.candidates.map((entry) => {
      const admission = admissionOf(entry);
      return {
        candidateKey: String(entry['candidate_key']),
        bootstrapReason: 'provider_classification_missing',
        selectedForEnrichment: entry['selected_for_enrichment'] === true,
        selectionRank: (entry['selection_rank'] as number | null) ?? null,
        enrichmentStatus: 'executed',
        enrichmentExecuted: entry['enrichment_executed'] === true,
        enrichedClassification: null,
        postEnrichmentPrecision: null,
        postEnrichmentSectorState: 'sector_evidence_confirmed',
        sectorAdmission: {
          sectorEvidenceState: 'sector_evidence_confirmed',
          admittedByRequestedSubindustryPrecision: true,
          admissionSource: 'confirmed_requested_subindustry_precision',
          matchedRequestedSubindustry: String(admission['matched_requested_subindustry']),
          operationalConfirmation: null,
          postEnrichmentSectorState: 'sector_not_mapped',
          blockReason: null,
        },
        purchase: null,
        terminalDisposition: 'provisionally_persisted_pending_writer_final',
        terminalReason: null,
      } satisfies ApolloSectorEvidenceBootstrapCandidateAudit;
    });

    const rows = toApolloSectorEvidenceBootstrapManualReviewRows({
      audit,
      candidateSnapshots: checkpoint.candidate_snapshots,
    });
    assert.equal(rows.length, HEALTH_ORGS.length);
    for (const row of rows) {
      assert.equal(row.sectorAdmissionSource, 'confirmed_requested_subindustry_precision');
      assert.ok(row.admittedByRequestedSubindustry, 'la hija que admitió tiene nombre');
      assert.equal(row.persisted, true);
    }
  });
});

// ─── § 21 · reconciliación terminal ───────────────────────────────────────────

describe('§ 21 · exactamente una disposición, y ninguna sin motivo', () => {
  for (const [why, profiles] of [
    ['hija confirmada', CONFIRMING_PROFILES],
    ['sólo padre', PARENT_ONLY_PROFILES],
  ] as const) {
    it(`${why}: unclassified 0, motivos no nulos, sin duplicados`, async () => {
      const recorder = await runHealth(profiles);
      const observability = recorder.writerBatchMetadata![APOLLO_TWO_ROUND_OBSERVABILITY_KEY] as
        | Record<string, unknown>
        | undefined;
      const dispositions = observability?.['candidate_final_dispositions'] as {
        total_unique_results: number;
        unclassified_count: number;
        breakdown: Record<string, number>;
      };
      assert.ok(dispositions);
      assert.equal(dispositions.unclassified_count, 0);
      assert.equal(dispositions.total_unique_results, HEALTH_ORGS.length);
      assert.equal(
        Object.values(dispositions.breakdown).reduce((sum, count) => sum + count, 0),
        HEALTH_ORGS.length,
      );

      const block = readBootstrapBlock(recorder);
      const keys = block.candidates.map((entry) => String(entry['candidate_key']));
      assert.equal(new Set(keys).size, keys.length);
      for (const entry of block.candidates) {
        assert.ok(entry['terminal_disposition'], 'toda disposición tiene nombre');
        // Un candidato que LLEGA al writer no lleva motivo de rechazo, y ése es el
        // punto del § 21: si murió, el motivo es el gate REAL; si no murió, no hay
        // motivo que dar. Lo prohibido es `sector_not_mapped` sobre un admitido.
        if (entry['terminal_disposition'] === 'provisionally_persisted_pending_writer_final') {
          assert.equal(entry['terminal_reason'], null);
        } else {
          assert.ok(entry['terminal_reason'], 'todo rechazo tiene motivo');
        }
      }
    });
  }
});

// ─── § 22 · replay offline de la cohorte real de RUN 1 ────────────────────────

describe('§ 22 · RUN 1 `f4c8a60f` con enrichment SIMULADO', () => {
  const RUN1_RESULTS: WebSearchResult[] = RUN1_SALUD_SNAPSHOTS.map((snapshot) =>
    fromCandidateEvidenceSnapshot(snapshot.evidence),
  );

  /**
   * Perfiles simulados por dominio.
   *
   * `confirming` decide si la simulación confirma la hija pedida. La cohorte, los
   * resultados de búsqueda y los gates baratos son los REALES; los perfiles no
   * pueden serlo porque aquella corrida ejecutó CERO enrichments.
   */
  function simulate(confirming: boolean): Record<string, EnrichedProfile> {
    return Object.fromEntries(
      RUN1_SALUD_SNAPSHOTS.map((snapshot) => [
        snapshot.evidence.domain ?? '',
        {
          industry: 'hospital & health care',
          keywords: confirming ? ['red hospitalaria'] : [],
        },
      ]),
    );
  }

  async function replay(confirming: boolean): Promise<Recorder> {
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput(RUN1_RESULTS)],
      enrichedProfiles: simulate(confirming),
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    return recorder;
  }

  it('la corrida REAL no ejecutó ni un enrichment: los perfiles son simulados', () => {
    assert.equal(RUN1_SALUD_LIVE_OUTCOME.enrichmentsExecuted, 0);
    assert.equal(RUN1_SALUD_LIVE_OUTCOME.candidatesPersisted, 0);
    assert.equal(RUN1_SALUD_SNAPSHOTS.length, 20);
    // Los veinte llegaron sin un solo campo clasificatorio: por eso la búsqueda no
    // podía admitir a nadie y por eso el enrichment era la única salida.
    for (const snapshot of RUN1_SALUD_SNAPSHOTS) {
      assert.equal(snapshot.evidence.industry, null);
      assert.deepEqual(snapshot.evidence.keywords, []);
      assert.equal(snapshot.sectorEvidenceState, 'sector_not_mapped');
    }
  });

  it('con hija confirmada, los 5 seleccionados dejan de terminar en `sector_not_mapped`', async () => {
    const recorder = await replay(true);
    const block = readBootstrapBlock(recorder);

    // El cupo no se mueve: siguen siendo 5 enrichments como máximo.
    assert.equal(recorder.enrichCalls.length, 5);
    assert.equal(block.bootstrap_enrichment_executed_count, 5);
    assert.equal(block.sector_admitted_by_requested_subindustry_precision_count, 5);

    const enriched = block.candidates.filter((entry) => entry['enrichment_executed'] === true);
    assert.equal(enriched.length, 5);
    for (const entry of enriched) {
      assert.equal(entry['post_enrichment_sector_state'], 'sector_evidence_confirmed');
      assert.notEqual(entry['terminal_reason'], 'sector_not_mapped');
      assert.equal(
        admissionOf(entry)['matched_requested_subindustry'],
        'Redes Hospitalarias y Clínicas',
      );
    }
  });

  it('sólo-padre: el replay reproduce el desenlace REAL de RUN 1', async () => {
    const recorder = await replay(false);
    const block = readBootstrapBlock(recorder);

    assert.equal(recorder.enrichCalls.length, 5);
    assert.equal(block.sector_admitted_by_requested_subindustry_precision_count, 0);
    assert.deepEqual(recorder.persistedCandidateNames, []);
    for (const entry of block.candidates.filter((item) => item['enrichment_executed'] === true)) {
      assert.equal(entry['post_enrichment_sector_state'], 'sector_not_mapped');
      assert.equal(entry['terminal_reason'], 'sector_not_mapped');
    }
  });

  it('los que NUNCA compitieron no cambian: sin enrichment no hay admisión', async () => {
    const recorder = await replay(true);
    const block = readBootstrapBlock(recorder);
    const notSelected = block.candidates.filter(
      (entry) => entry['selected_for_enrichment'] !== true,
    );
    assert.ok(notSelected.length > 0, 'compiten más de los que caben');
    for (const entry of notSelected) {
      assert.equal(entry['enrichment_executed'], false);
      assert.equal(entry['post_enrichment_precision'], null);
      // Nunca llegaron a la resolución de admisión: ausencia, no `legacy`.
      assert.equal(entry['sector_admission'], null);
    }
  });
});
