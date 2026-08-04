/**
 * apollo-organizations-effective-request.ts — El request que REALMENTE sale hacia
 * Apollo, construido sin ejecutarlo.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2-FIX · § 1 y § 2.
 *
 * El defecto que cierra: la modalidad de dos rondas decidía si la ronda 2 valía
 * un crédito comparando la HIPÓTESIS —los términos antes de priorizarlos,
 * deduplicarlos y truncarlos a `MAX_KEYWORDS`— cuando lo que Apollo recibe es el
 * body de después. Dos hipótesis distintas pueden colapsar al mismo body, y la
 * corrida QA `edb6f40c` pagó exactamente esa segunda búsqueda: mismo
 * `request_fingerprint` de Apollo, sólo cambiaba el texto humano.
 *
 * Contrato, en este orden y sin atajos:
 *
 *   hipótesis de consulta
 *     → límite efectivo (`resolveApolloResultLimit`)
 *       → prioridad y dedupe de términos (`buildApolloOrganizationsSearchParams`)
 *         → truncamiento a MAX_KEYWORDS
 *           → location, employee ranges, page y per_page
 *             → body del contrato (`buildApolloOrganizationsRequestContract`)
 *               → `effectiveRequestFingerprint`
 *
 * `buildApolloOrganizationsEffectiveRequest` es la ÚNICA función que produce esa
 * huella. El provider la usa para ejecutar y el orquestador para decidir: no hay
 * un segundo mapper en paralelo que pueda divergir del que gobierna la llamada.
 *
 * Puro: sin env, sin fetch, sin Supabase, sin reloj. El único valor de entorno que
 * la resolución del límite necesita —la variable legacy— entra como parámetro.
 */

import type { SearchOrganizationsParams } from '@/server/integrations/apollo-client';
import type { WebSearchInput } from './types';
import {
  buildApolloOrganizationsSearchParams,
  type ApolloQueryMappingMeta,
} from './apollo-organizations-query-mapping';
import {
  buildApolloOrganizationsRequestContract,
  type ApolloOrganizationsRequestBody,
  type ApolloOrganizationsRequestInput,
} from './apollo-organizations-request-contract';

// ─── Tope duro del proveedor ──────────────────────────────────────────────────

/**
 * Máximo de organizaciones que una invocación puede pedir. Ninguna modalidad lo
 * supera: es el techo de gasto por llamada, no una preferencia.
 */
export const APOLLO_ORGANIZATIONS_ABSOLUTE_MAX_RESULTS = 10;

// ─── Límite efectivo por llamada ──────────────────────────────────────────────

/**
 * § 5 — qué límite gobierna `per_page`.
 *
 * `legacy` es el comportamiento histórico y el de todos los llamadores previos:
 * `AGENT1_APOLLO_MAX_RESULTS_PER_QUERY` recorta la petición.
 * `two_round` usa el límite propio de la modalidad
 * (`AGENT1_APOLLO_MAX_RESULTS_PER_ROUND`, ya resuelto en su config), porque una
 * variable de la ruta legacy no puede reducir en silencio el modo nuevo.
 */
export type ApolloResultLimitMode = 'legacy' | 'two_round';

export type ApolloResultLimitResolution = {
  cap: number;
  wasCapped: boolean;
  maxResultsCapSource: string;
  /** Límite de la ruta legacy, resuelto. Diagnóstico, no necesariamente aplicado. */
  legacyMaxResultsPerQuery: number;
  /** Límite por ronda de la modalidad de dos rondas. Null fuera de ella. */
  twoRoundMaxResultsPerRound: number | null;
  limitMode: ApolloResultLimitMode;
};

/**
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 5 — frontera entre el límite legacy y el
 * de dos rondas.
 *
 * El defecto observado: la modalidad de dos rondas pide 5 por ronda, pero
 * `AGENT1_APOLLO_MAX_RESULTS_PER_QUERY=3` —una variable de la ruta legacy— la
 * recortaba a 3 sin decirlo, y el objetivo de cinco empresas quedaba
 * estructuralmente inalcanzable.
 *
 * Reglas:
 *   - `legacy`:    min(pedido, AGENT1_APOLLO_MAX_RESULTS_PER_QUERY, tope duro).
 *   - `two_round`: min(maxResultsPerRound de la config de dos rondas, tope duro).
 *     La variable legacy NO participa. Bajar el límite de dos rondas exige su
 *     propia variable (`AGENT1_APOLLO_MAX_RESULTS_PER_ROUND`), que la config ya
 *     resolvió antes de llegar aquí.
 *
 * Puro: la variable legacy entra como parámetro.
 */
export function resolveApolloResultLimit(input: {
  requested: number;
  mode?: ApolloResultLimitMode;
  twoRoundMaxResultsPerRound?: number | null;
  legacyMaxResultsPerQuery: number;
}): ApolloResultLimitResolution {
  const legacy = input.legacyMaxResultsPerQuery;
  const mode: ApolloResultLimitMode = input.mode ?? 'legacy';

  if (mode === 'two_round') {
    const perRound =
      typeof input.twoRoundMaxResultsPerRound === 'number' &&
      Number.isFinite(input.twoRoundMaxResultsPerRound) &&
      input.twoRoundMaxResultsPerRound > 0
        ? Math.floor(input.twoRoundMaxResultsPerRound)
        : input.requested;
    const cap = Math.max(1, Math.min(perRound, APOLLO_ORGANIZATIONS_ABSOLUTE_MAX_RESULTS));
    return {
      cap,
      wasCapped: cap < input.requested,
      maxResultsCapSource:
        cap < input.requested ? 'agent1_apollo_two_round_max_results_per_round' : 'none',
      legacyMaxResultsPerQuery: legacy,
      twoRoundMaxResultsPerRound: perRound,
      limitMode: mode,
    };
  }

  // Two-layer cap: env-configurable QA guardrail first, then hard provider limit.
  const cap = Math.min(input.requested, legacy, APOLLO_ORGANIZATIONS_ABSOLUTE_MAX_RESULTS);
  return {
    cap,
    wasCapped: cap < input.requested,
    maxResultsCapSource: cap < input.requested ? 'agent1_apollo_cost_guardrail' : 'none',
    legacyMaxResultsPerQuery: legacy,
    twoRoundMaxResultsPerRound: null,
    limitMode: mode,
  };
}

// ─── Request efectivo ─────────────────────────────────────────────────────────

export type ApolloEffectiveRequestBuildInput = {
  input: WebSearchInput;
  /** Resultados que el llamador pide, ANTES de aplicar cualquier límite. */
  requestedMaxResults: number;
  /** Ausente ⇒ `legacy`. */
  resultLimitMode?: ApolloResultLimitMode;
  /** Límite por ronda ya resuelto por la config de dos rondas. Sólo en `two_round`. */
  twoRoundMaxResultsPerRound?: number | null;
  /** Página a pedir. Ausente o < 1 ⇒ 1. */
  startPage?: number | null;
  /** Valor vigente de `AGENT1_APOLLO_MAX_RESULTS_PER_QUERY`. Se inyecta. */
  legacyMaxResultsPerQuery: number;
  /** L2.10 — pack de búsqueda a seleccionar. Ausente ⇒ 0. */
  packIndex?: number;
  /** L2.10 — cap de queries, sólo para diagnóstico del pack. Ausente ⇒ 1. */
  maxQueries?: number;
};

export type ApolloEffectiveRequest = {
  /** Body EXACTO que el contrato enviará, `page` y `per_page` incluidas. */
  body: ApolloOrganizationsRequestBody;
  /** § 1 — huella del body efectivo, página incluida. La decisión usa ESTA. */
  effectiveRequestFingerprint: string;
  /** Huella sin página: ancla idempotente de la búsqueda paginada. */
  filtersFingerprint: string;
  page: number;
  perPage: number;
  /** Términos que efectivamente viajan, tras prioridad, dedupe y truncamiento. */
  effectiveKeywordTags: string[];
  effectiveLocations: string[];
  effectiveEmployeeRanges: string[];
  limit: ApolloResultLimitResolution;
  /** Params en el vocabulario del mapper. Lo que el provider ya consumía. */
  params: SearchOrganizationsParams;
  mappingMeta: ApolloQueryMappingMeta;
};

/**
 * § 2 — filtros del contrato derivados de los params del mapper.
 *
 * Único traductor entre los dos vocabularios. El provider lo consumía con una
 * copia local; ahora hay una sola, para que la huella que se compara y el body
 * que se envía no puedan salir de dos traducciones distintas.
 */
export function toApolloContractFilters(
  params: SearchOrganizationsParams,
): Omit<ApolloOrganizationsRequestInput, 'page' | 'perPage'> {
  return {
    locations: params.organization_locations ?? null,
    employeeRanges: params.organization_num_employees_ranges ?? null,
    keywordTags: params.q_organization_keyword_tags ?? null,
    organizationName: params.q_organization_name ?? null,
    domainsList: params.q_organization_domains ?? null,
  };
}

function normalizeStartPage(startPage: number | null | undefined): number {
  if (typeof startPage !== 'number' || !Number.isFinite(startPage)) return 1;
  return Math.max(1, Math.floor(startPage));
}

/**
 * Construye el request efectivo SIN ejecutarlo.
 *
 * Es la separación que el § 2 exige: el orquestador puede construir y comparar
 * los bodies de la ronda 1 y de la ronda 2 sin emitir una sola llamada ni gastar
 * un solo crédito. Ejecutar es otra función (`runApolloOrganizationsSearch`), y
 * consume ESTE resultado en vez de reconstruirlo.
 */
export function buildApolloOrganizationsEffectiveRequest(
  input: ApolloEffectiveRequestBuildInput,
): ApolloEffectiveRequest {
  const limit = resolveApolloResultLimit({
    requested: input.requestedMaxResults,
    mode: input.resultLimitMode,
    twoRoundMaxResultsPerRound: input.twoRoundMaxResultsPerRound ?? null,
    legacyMaxResultsPerQuery: input.legacyMaxResultsPerQuery,
  });

  const { params, meta } = buildApolloOrganizationsSearchParams(input.input, limit.cap, {
    packIndex: input.packIndex,
    maxQueries: input.maxQueries,
  });

  const page = normalizeStartPage(input.startPage);
  const contract = buildApolloOrganizationsRequestContract({
    ...toApolloContractFilters(params),
    page,
    perPage: limit.cap,
  });

  return {
    body: contract.body,
    effectiveRequestFingerprint: contract.effectiveRequestFingerprint,
    filtersFingerprint: contract.filtersFingerprint,
    page: contract.body.page,
    perPage: contract.body.per_page,
    effectiveKeywordTags: [...(contract.body.q_organization_keyword_tags ?? [])],
    effectiveLocations: [...(contract.body.organization_locations ?? [])],
    effectiveEmployeeRanges: [...(contract.body.organization_num_employees_ranges ?? [])],
    limit,
    // El `page` del mapper es siempre 1; el efectivo lo fija la paginación.
    params: { ...params, page },
    mappingMeta: meta,
  };
}

/** Metadata sanitizada del request efectivo. Sin secretos, sin PII. */
export function toApolloEffectiveRequestMetadata(
  effective: ApolloEffectiveRequest,
): Record<string, unknown> {
  return {
    apollo_effective_request_fingerprint: effective.effectiveRequestFingerprint,
    apollo_filters_fingerprint: effective.filtersFingerprint,
    apollo_effective_keywords_sent: effective.effectiveKeywordTags,
    apollo_effective_locations_sent: effective.effectiveLocations,
    apollo_effective_employee_ranges_sent: effective.effectiveEmployeeRanges,
    apollo_page_sent: effective.page,
    apollo_per_page_sent: effective.perPage,
    apollo_result_limit_mode: effective.limit.limitMode,
    apollo_max_results_per_query_resolved: effective.limit.legacyMaxResultsPerQuery,
    apollo_max_results_per_round_resolved: effective.limit.twoRoundMaxResultsPerRound,
  };
}
