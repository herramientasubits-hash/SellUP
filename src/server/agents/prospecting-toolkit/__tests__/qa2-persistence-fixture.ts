/**
 * qa2-persistence-fixture.ts — reproducción OFFLINE de la corrida LIVE-QA-2.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 10.
 *
 * Reproduce el lote `62fdf47b-5aab-4187-8751-8b319dd47312` con las cifras REALES
 * leídas de Producción (sólo lectura, sin modificar ni archivar el lote):
 *
 *   ronda 1 → 5 resultados crudos
 *             Grupo Éxito                   → elegible
 *             Cencosud   / Rappi / Colombina → duplicate_in_hubspot (3)
 *             Alpina                        → no elegible
 *   ronda 2 → 5 resultados, todos vistos en la ronda 1 (seen_duplicates = 5)
 *
 *   eligible_companies_found = 1
 *   skipped_recent_count     = 0    ← el campo legacy que la UI leía
 *   known_company_duplicates = [3, 0]
 *   seen_duplicates          = [0, 5]
 *   country/sector/ownership rejected = 0
 *
 * Esa combinación es la que produjo el copy engañoso: `recentlySuggestedCount`
 * suma 8 desde la observabilidad por ronda, así que el resolutor de
 * QUERY-QUALITY-2 elegía «Todos los resultados ya habían sido sugeridos
 * recientemente» — con toda corrección para su contrato, y sin embargo falso
 * como explicación de la corrida.
 *
 * Sin red, sin Supabase, sin Apollo, sin créditos. Nombres de empresa públicos;
 * ningún dato personal.
 */

import type {
  CatalogContextResult,
  ProspectingPipelineCandidate,
  ProspectingPipelineOutput,
} from '../types';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../apollo-two-round';
import type { NoNewCandidatesBreakdown } from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';

/** Lote real de la ventana LIVE-QA-2. Se usa como etiqueta, nunca se escribe. */
export const QA2_BATCH_ID = '62fdf47b-5aab-4187-8751-8b319dd47312';
/** Usuario sintético del fixture. NO es el de la corrida real. */
export const QA2_USER_ID = 'aaaaaaaa-0000-0000-0000-000000000002';

const QA2_CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail',
  searchDepth: 'standard',
  fiscalIdentifierLabel: 'NIT',
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

/** La ÚNICA empresa que llegó elegible al writer. */
export const QA2_ELIGIBLE_COMPANY = {
  name: 'Grupo Éxito',
  domain: 'grupoexito.com.co',
  website: 'https://www.grupoexito.com.co',
} as const;

/** Resultados crudos de la ronda 1, con el veredicto que cada uno recibió. */
export const QA2_ROUND_1_RAW = [
  { name: 'Grupo Éxito', verdict: 'eligible' },
  { name: 'Cencosud', verdict: 'duplicate_in_hubspot' },
  { name: 'Rappi', verdict: 'duplicate_in_hubspot' },
  { name: 'Colombina', verdict: 'duplicate_in_hubspot' },
  { name: 'Alpina', verdict: 'not_eligible' },
] as const;

/** Ronda 2: cinco resultados, todos ya vistos en la ronda 1. */
export const QA2_ROUND_2_SEEN_COUNT = 5;

function buildQa2Candidate(): ProspectingPipelineCandidate {
  return {
    name: QA2_ELIGIBLE_COMPANY.name,
    website: QA2_ELIGIBLE_COMPANY.website,
    domain: QA2_ELIGIBLE_COMPANY.domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail',
    sourceUrl: 'https://www.grupoexito.com.co/es/',
    sourceTitle: 'Grupo Éxito — Comercio al detal en Colombia',
    sourceSnippet:
      'Grupo Éxito opera cadenas de supermercados y almacenes en Colombia con miles de empleados.',
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 1,
      input: {
        name: QA2_ELIGIBLE_COMPANY.name,
        website: QA2_ELIGIBLE_COMPANY.website,
        domain: QA2_ELIGIBLE_COMPANY.domain,
      },
      checkedSources: ['sellup'],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.9,
      fitScore: 0.88,
      dataCompletenessScore: 0.82,
      recommendedAction: 'approve_for_review',
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: ['sector_evidence_confirmed'],
      warnings: [],
      blockers: [],
    },
  } as unknown as ProspectingPipelineCandidate;
}

/**
 * Observabilidad de dos rondas EXACTA de LIVE-QA-2.
 *
 * Es la entrada que alimenta `buildNoNewCandidatesBreakdown`, así que es la que
 * demuestra que el copy de historial ya no puede ganar: los 8 descartes de
 * historial siguen aquí y el resolutor tiene que ignorarlos igualmente.
 */
export function buildQa2TwoRoundObservability(): Record<string, unknown> {
  return {
    [APOLLO_TWO_ROUND_OBSERVABILITY_KEY]: {
      modality: 'two_round_adaptive',
      result_status: 'partial_target_not_reached',
      target_eligible_companies: 5,
      eligible_companies_found: 1,
      rounds_executed: 2,
      target_reached: false,
      candidates_persisted: false,
      rounds: [
        {
          round_number: 1,
          raw_results: 5,
          known_company_duplicates: 3,
          seen_duplicates: 0,
          country_rejected: 0,
          sector_rejected: 0,
          ownership_rejected: 0,
        },
        {
          round_number: 2,
          raw_results: 5,
          known_company_duplicates: 0,
          seen_duplicates: QA2_ROUND_2_SEEN_COUNT,
          country_rejected: 0,
          sector_rejected: 0,
          ownership_rejected: 0,
        },
      ],
    },
    // El campo legacy que la UI leía primero: CERO. Ninguna empresa de esta
    // corrida había sido sugerida antes.
    skipped_recent_count: 0,
  };
}

/**
 * Distribución de descartes tal como la UI la recibió en LIVE-QA-2.
 *
 * `recentlySuggestedCount = 8` a propósito: es el número real, y la corrección de
 * este hito NO consiste en bajarlo, sino en que deje de ser la causa que se
 * anuncia cuando la escritura falló.
 */
export function buildQa2NoNewCandidatesBreakdown(): NoNewCandidatesBreakdown {
  return {
    recentlySuggestedCount: 8,
    qualityRejectedCount: 0,
    noveltyExhausted: false,
    secondRoundSkippedReason: null,
  };
}

/** Salida de pipeline que el writer recibe: una sola empresa elegible. */
export function buildQa2PipelineOutput(): ProspectingPipelineOutput {
  const candidates = [buildQa2Candidate()];
  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail',
      webSearchProvider: 'apollo_organizations',
      mode: 'multi_query',
      targetCount: 5,
      maxResultsPerQuery: 5,
      subindustries: ['Supermercados'],
    },
    catalogContext: QA2_CATALOG_CONTEXT,
    searchQuery: 'supermercados Colombia',
    webSearch: {
      provider: 'apollo_organizations',
      query: 'supermercados Colombia',
      results: [],
      resultsCount: 10,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: 5,
      searched: 10,
      returned: 1,
      highQualityNew: 1,
      needsReview: 0,
      duplicates: 3,
      insufficientData: 0,
      discarded: 1,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'apollo_organizations',
      pipelineVersion: 'apollo-two-round-1',
      search_mode: 'apollo_two_round_adaptive',
      ...buildQa2TwoRoundObservability(),
    },
  } as unknown as ProspectingPipelineOutput;
}

/**
 * Error EXACTO que PostgREST devolvió en LIVE-QA-2 cuando el writer intentó
 * insertar el candidato.
 */
export const QA2_IDENTITY_KEY_POSTGREST_ERROR = {
  code: 'PGRST204',
  message:
    "Could not find the 'identity_key' column of 'prospect_candidates' in the schema cache",
} as const;
