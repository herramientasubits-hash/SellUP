/**
 * Prospecting Toolkit — Pipeline Orquestador Mínimo (Hito 4)
 *
 * Conecta las tools del toolkit en un flujo mínimo server-side.
 * No escribe en base de datos. No llama APIs pagadas por defecto.
 * No crea prospect_candidates, prospect_batches ni accounts.
 * No llama Apollo, Lusha ni proveedor IA.
 * HubSpot: si no está conectado, el duplicate check retorna "unchecked"
 * y el scorer devuelve "needs_review" — nunca aprueba automáticamente.
 */

import type {
  ProspectingPipelineInput,
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
  ProspectingPipelineSummary,
  CandidateQualityLabel,
  CatalogContextResult,
  NameInferenceSource,
  SearchTrace,
  WebSearchProviderKey,
  WebSearchResult,
  CandidateRelationshipEvidence,
} from './types';
import { getCatalogContext } from './catalog-context-retriever';
import { runWebSearch, runMultiQueryWebSearch, buildCompanyDiscoveryQuery, getSourceGuidedQueryMeta, classifyQuery } from './web-search-tool';
import { verifyWebsite } from './website-verifier';
import { checkCompanyDuplicate } from './duplicate-checker';
import { scoreCandidate } from './candidate-scorer';
import { normalizeDomain } from './normalization';
// NULL-DOMAIN-IDENTITY § 2/§ 3 — lectores canónicos de identidad Apollo.
import {
  buildApolloProviderIdentityKey,
  isApolloOrganizationsResult,
  readApolloCandidateDomain,
  readApolloCandidateDomainAliases,
  readApolloCandidateName,
  readApolloCandidateWebsite,
  readApolloProviderOrganizationId,
} from './apollo-candidate-identity-readers';
import {
  SEO_GENERIC_KEYWORDS,
  stripDomainSuffix,
} from './company-name-normalizer';
import { isSentenceOrPhraseName } from './noise-filter';
import { stripEmployeeCountClaims } from './employee-size-text-parser';
import { readNationalPortalEntity } from './national-portal-entity';
import { buildSearchPlan, getExecutableQueriesFromSearchPlan } from './search-planner';
import { evaluateCountryEvidence } from './country-evidence-gate';
import { captureApolloCompanyFields } from './apollo-company-fields-mapping';
import type { CandidateSectorEvidenceState } from './apollo-two-round/enrichment-ranking';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_TARGET_COUNT = 10;
const MAX_TARGET_COUNT = 25;
const DEFAULT_PROVIDER = 'mock' as const;
const DEFAULT_SEARCH_DEPTH = 'standard' as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampTargetCount(requested: number | undefined): number {
  const n = requested ?? DEFAULT_TARGET_COUNT;
  return Math.min(Math.max(1, n), MAX_TARGET_COUNT);
}

// ─── Normalización determinística de nombre limpio (Hito 13F) ─────────────────
// Hito 16W.2: GENERIC_KEYWORDS movido a company-name-normalizer.ts como SEO_GENERIC_KEYWORDS.

/**
 * Marcas/vendors globales cuya presencia en un segmento de título indica
 * que el segmento describe una integración o partnership, no el nombre de la empresa.
 * Si el dominio no pertenece a la marca, el segmento se omite.
 * Hito 13H: evita que "Microsoft Dynamics Partner LATAM" sea el nombre inferido
 * cuando el dominio es de otra empresa (ej. kcpdynamics.com).
 */
const GLOBAL_VENDOR_NAMES = new Set([
  'microsoft', 'sap', 'ibm', 'oracle', 'salesforce',
  'google', 'aws', 'amazon', 'hubspot', 'adobe',
  'meta', 'cisco', 'dell', 'hp', 'apple',
  'zoom', 'slack', 'servicenow', 'workday', 'zendesk',
]);

// Sufijos legales colombianos / latinoamericanos
const LEGAL_SUFFIX_RE = /\b(S\.A\.S\.?|SAS|S\.A\.?|Ltda\.?|E\.U\.?|Corp\.?|Inc\.?|LLC|S\.R\.L\.?)\b/i;

// TLDs ordenados de más específico a más genérico (evita match parcial)

function normalizeForKeywords(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Determina si una parte del título es una frase genérica de SEO.
 * Retorna false (= no genérica) si contiene un sufijo legal.
 */
function isGenericPhrase(part: string): boolean {
  if (LEGAL_SUFFIX_RE.test(part)) return false;
  const words = normalizeForKeywords(part).split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  const genericCount = words.filter(w => SEO_GENERIC_KEYWORDS.has(w)).length;
  // Hito 13H: >= 0.5 (antes > 0.5) para capturar frases 50% genéricas como "Software a la medida"
  return genericCount / words.length >= 0.5;
}

/**
 * Retorna true si el segmento contiene una marca global vendor y el dominio
 * de la URL no corresponde a esa marca. Indica que el segmento describe una
 * integración o partnership, no el nombre real de la empresa.
 * Hito 13H: evita "Microsoft Dynamics Partner LATAM" cuando el dominio es kcpdynamics.com.
 */
function segmentContainsForeignBrand(segment: string, domain: string): boolean {
  const segLower = normalizeForKeywords(segment);
  for (const brand of GLOBAL_VENDOR_NAMES) {
    if (segLower.includes(brand) && !domain.includes(brand)) return true;
  }
  return false;
}

/**
 * Intenta extraer nombre limpio desde el título usando separadores fuertes.
 * Detecta también el patrón SIGLA, descriptor (ej. "TSI, Servicios de…").
 * Hito 13H: acepta dominio opcional para saltar segmentos con marcas globales ajenas.
 */
function inferNameFromTitle(title: string, domain?: string): string | null {
  // Patrón: SIGLA en mayúsculas antes de coma ("TSI, Servicios de…")
  const leadingAcronym = /^([A-Z]{2,6}),\s+/.exec(title);
  if (leadingAcronym) return leadingAcronym[1];

  // Separadores fuertes: |  —  –  :  ::  y guion con espacios
  const parts = title
    .split(/\s*[|—–]\s*|\s+-\s+|\s*::\s*|\s*:\s+/)
    .map(p => p.trim())
    .filter(p => p.length > 1);

  for (const part of parts) {
    // Hito 13H: saltar segmentos con marca global ajena al dominio
    if (domain && segmentContainsForeignBrand(part, domain)) continue;
    if (isGenericPhrase(part)) continue;
    // Hito 16AB.43.20: saltar segmentos que son frases/oraciones, no nombres de empresa
    if (isSentenceOrPhraseName(part)) continue;
    return part;
  }
  return null;
}

/**
 * Infiere nombre limpio desde el dominio de la URL.
 * Elimina TLD, detecta sufijo "colombia", acrónimos cortos y guiones.
 */
function inferNameFromDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    let host = parsed.hostname.replace(/^www\./, '');

    host = stripDomainSuffix(host);
    if (!host || host.length < 2) return null;

    // Guiones → palabras separadas
    if (host.includes('-')) {
      return host.split('-').map(toTitleCase).join(' ');
    }

    // Sufijo de país conocido ("solutekcolombia" → "Solutek Colombia")
    const countrySuffix = /^(.+?)(colombia|peru|mexico|argentina|chile|ecuador|venezuela)$/i.exec(host);
    if (countrySuffix) {
      const prefix = countrySuffix[1];
      const country = toTitleCase(countrySuffix[2]);
      const prefixName = prefix.length <= 4 ? prefix.toUpperCase() : toTitleCase(prefix);
      return `${prefixName} ${country}`;
    }

    // Dominio corto ≤ 4 chars → acrónimo en mayúsculas ("dyc" → "DYC")
    if (host.length <= 4) return host.toUpperCase();

    // Default: Title Case
    return toTitleCase(host);
  } catch {
    return null;
  }
}

/**
 * Infiere el nombre limpio de empresa desde título y URL de un resultado Tavily.
 * Prioridad: (1) prefijo no genérico del título, (2) dominio, (3) fallback al título.
 * Sin IA generativa. Sin llamadas externas.
 */
function inferCompanyNameFromSearchResult(
  title: string,
  url: string
): { name: string; source: NameInferenceSource } {
  const trimmed = title.trim();
  // Hito 13H: pasar dominio para que inferNameFromTitle omita segmentos con marcas globales
  const domainForBrand = (() => {
    try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  })();

  const fromTitle = inferNameFromTitle(trimmed, domainForBrand);
  if (fromTitle) return { name: fromTitle, source: 'title_prefix' };

  const fromDomain = inferNameFromDomain(url);
  if (fromDomain) return { name: fromDomain, source: 'domain' };

  return { name: trimmed || 'Unknown', source: 'title_fallback' };
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline de prospección mínimo.
 *
 * Flujo:
 *   1. getCatalogContext — fuentes relevantes por país/sector
 *   2. buildCompanyDiscoveryQuery — construye query de búsqueda
 *   3. runWebSearch — resultados web (mock por defecto)
 *   4. Por cada resultado: verifyWebsite → checkCompanyDuplicate → scoreCandidate
 *   5. Retorna output consolidado sin guardar en DB
 *
 * @example
 * const result = await runProspectingPipeline({
 *   country: 'Colombia',
 *   countryCode: 'CO',
 *   industry: 'Tecnología',
 *   targetCount: 5,
 *   webSearchProvider: 'mock',
 * });
 */
export async function runProspectingPipeline(
  input: ProspectingPipelineInput
): Promise<ProspectingPipelineOutput> {
  const warnings: string[] = [];

  const targetCount = clampTargetCount(input.targetCount);
  const provider = input.webSearchProvider ?? DEFAULT_PROVIDER;
  const searchDepth = input.searchDepth ?? DEFAULT_SEARCH_DEPTH;

  if (input.targetCount !== undefined && input.targetCount > MAX_TARGET_COUNT) {
    warnings.push(
      `targetCount=${input.targetCount} superó el límite de ${MAX_TARGET_COUNT}. Se usará ${MAX_TARGET_COUNT}.`
    );
  }

  // ── Paso 1: Contexto de catálogo ─────────────────────────────────────────────
  const catalogContext = getCatalogContext({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    searchDepth,
  });

  // ── Paso 1b: Search Plan v0 + Executable Queries v1 ─────────────────────────
  // buildSearchPlan produce el plan estructurado (determinístico).
  // getExecutableQueriesFromSearchPlan deriva queries ordenadas por prioridad del plan.
  const searchPlan = buildSearchPlan({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    subindustries: (input as { subindustries?: string[] }).subindustries ?? [],
    additionalCriteria: (input as { additionalCriteria?: string | null }).additionalCriteria ?? null,
    targetCount,
    searchDepth,
  });
  const executableQueries = getExecutableQueriesFromSearchPlan(searchPlan);
  let plannerQueriesUsed = false;
  let plannerFallbackReason = 'single_query_mode';

  // ── Paso 2: Query de búsqueda ─────────────────────────────────────────────────
  const searchQuery = buildCompanyDiscoveryQuery({
    industry: input.industry,
    country: input.country,
    countryCode: input.countryCode,
    intent: 'general',
  });

  // ── Paso 3: Web search ────────────────────────────────────────────────────────
  let multiQueryMeta: Record<string, unknown> | null = null;

  const useMultiQuery =
    input.mode === 'multi_query' || input.mode === 'tavily_llm_evaluator';

  const webSearch = useMultiQuery
    ? await (async () => {
        const hasQueryOverrides = !!(input.queryOverrides && input.queryOverrides.length > 0);
        const usesPlannerQueries = !hasQueryOverrides && executableQueries.length > 0;
        plannerQueriesUsed = usesPlannerQueries;
        if (!usesPlannerQueries) {
          plannerFallbackReason = hasQueryOverrides ? 'query_overrides_provided' : 'planner_produced_no_queries';
        }

        const queriesForSearch = hasQueryOverrides
          ? input.queryOverrides
          : usesPlannerQueries
            ? executableQueries.map(q => q.queryText)
            : undefined;

        const mq = await runMultiQueryWebSearch({
          country: input.country,
          countryCode: input.countryCode,
          industry: input.industry,
          provider,
          searchDepth,
          targetCount,
          maxResultsPerQuery: input.maxResultsPerQuery ?? 5,
          queries: queriesForSearch,
          usageContext: input.usageContext ?? null,
          // L2.7: propagar subindustrias y tokens al provider (Apollo los usa; Tavily los ignora)
          subindustries: input.subindustries,
          additionalCriteriaTokens: input.additionalCriteriaTokens,
          // CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 — términos ya resueltos de la
          // versión publicada. Se transportan; este módulo no los interpreta.
          subindustryCatalogTerms: input.subindustryCatalogTerms ?? null,
          selectionCatalogVersion: input.selectionCatalogVersion ?? null,
          // A1-APOLLO-EMPLOYEE-FILTER-200-1 § 3 — umbral de tamaño en tránsito.
          // Este módulo tampoco lo interpreta: lo transporta.
          targetEmployeeThreshold: input.targetEmployeeThreshold ?? null,
          // AGENT1-APOLLO-DEFAULT-PATH-NET-NEW-PAGINATION — transporte puro
          // hasta `dispatchToProvider`; este módulo no la interpreta.
          apolloSearchOptions: input.apolloSearchOptions ?? null,
          // AGENT1-TAVILY-V2-1 § 2 — transporte puro hasta el proveedor.
          excludeDomains: input.excludeDomains,
        });
        const sgMeta = hasQueryOverrides || usesPlannerQueries
          ? { enabled: false, sources_used: [] as string[] }
          : getSourceGuidedQueryMeta(input.country, input.industry, 1);
        multiQueryMeta = {
          search_mode: 'multi_query',
          query_version: hasQueryOverrides
            ? 'query_overrides'
            : usesPlannerQueries
              ? 'search_planner_v1'
              : 'multi_query_basic_es_v1',
          queries_source: hasQueryOverrides
            ? 'overrides'
            : usesPlannerQueries
              ? 'search_planner_v1'
              : sgMeta.enabled
                ? 'source_guided_mix'
                : 'standard',
          source_guided_queries_enabled: sgMeta.enabled,
          source_guided_sources_used: sgMeta.sources_used,
          queries_executed: mq.queryResults.map((q) => q.query),
          query_trace_summary: {
            enabled: true,
            queries_executed: mq.queryResults.map((q) => {
              const { queryType, querySourceKey } = classifyQuery(q.query, input.country, input.industry);
              return { query_text: q.query, query_type: queryType, query_source_key: querySourceKey };
            }),
          },
          raw_results_count: mq.rawResultsCount,
          deduped_results_count: mq.dedupedResultsCount,
          filtered_out_count: mq.filteredOutCount,
          kept_count: mq.keptCount,
          max_results_per_query: input.maxResultsPerQuery ?? 5,
        };
        return {
          provider,
          query: searchQuery,
          results: mq.results,
          resultsCount: mq.keptCount,
          skipped: false,
          skipReason: null,
          estimatedCostUsd: null as null,
          metadata: {
            // L2.9: spread full multi-query metadata so Apollo diagnostics
            // (apollo_raw_results_count, apollo_result_diagnostics, etc.) flow
            // through to incremental-search.ts → mergeApolloBatchDiagnostics.
            ...mq.metadata,
            raw_results_count: mq.rawResultsCount,
            deduped_results_count: mq.dedupedResultsCount,
            filtered_out_count: mq.filteredOutCount,
          },
        };
      })()
    : await runWebSearch({
        query: searchQuery,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        maxResults: targetCount,
        provider,
        searchDepth,
        intent: 'company_discovery',
      });

  if (webSearch.skipped) {
    warnings.push(`Web search fue omitida: ${webSearch.skipReason ?? 'razón desconocida'}`);
  }

  // ── Search Plan v1 metadata ───────────────────────────────────────────────────
  const searchPlanMeta = {
    version: 'search_planner_v1',
    queryFamilies: searchPlan.queryFamilies,
    executableQueries,
    usedForExecution: plannerQueriesUsed,
    fallbackUsed: !plannerQueriesUsed,
    executedQueryCount: plannerQueriesUsed ? executableQueries.length : 0,
    querySelectionReason: plannerQueriesUsed
      ? 'search_planner_v1_queries_available'
      : plannerFallbackReason,
  };

  // ── Paso 4: Enriquecer cada resultado ─────────────────────────────────────────

  // AUDIT-A1-WS7 — la rama «evaluador LLM» (Hito 16H) se eliminó: ningún llamador
  // la usaba, confiaba en el sitio/dominio/índice que devolvía el modelo sin
  // validarlos, no tenía timeout y descartaba .gov/.edu (clientes de UBITS). Si
  // alguien la pide, se niega (fail-closed) y corre la rama determinística.
  if (input.useLLMEvaluator === true || input.mode === 'tavily_llm_evaluator') {
    warnings.push('llm_evaluator_mode_removed: se usa la construcción determinística de candidatos');
  }

  // ── Standard branch (single_query / multi_query) ──────────────────────────
  const resultsToProcess = webSearch.results.slice(0, targetCount);

  // Hito 16AB.43.20: track names rejected for quality (sentence/phrase names)
  let nameQualityFilteredCount = 0;

  const candidates: ProspectingPipelineCandidate[] = await Promise.all(
    resultsToProcess.map(async (result): Promise<ProspectingPipelineCandidate> => {
      const built = await buildProspectingPipelineCandidate(result, {
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        catalogContext,
        provider,
        fallbackQueryText: searchQuery,
      });
      if (built.nameQualityFiltered) nameQualityFilteredCount++;
      return built.candidate;
    })
  );

  // ── Paso 5: Summary ───────────────────────────────────────────────────────────
  const summary = buildSummary(targetCount, webSearch.resultsCount, candidates);

  return {
    input,
    catalogContext,
    searchQuery,
    webSearch,
    candidates,
    summary,
    warnings,
    metadata: {
      pipelineVersion: '0.4.0',
      executedAt: new Date().toISOString(),
      provider,
      searchDepth,
      search_mode: input.mode ?? 'single_query',
      ...(multiQueryMeta ?? {}),
      name_quality_filtered_count: nameQualityFilteredCount,
      search_plan: searchPlanMeta,
    },
  };
}

// ─── Builder de candidato (extraído — A1-APOLLO-TWO-ROUND-QUALITY-1 § 1) ─────

/**
 * Contexto que la construcción de un candidato necesita y que no viene en el
 * resultado de búsqueda.
 */
export type ProspectingCandidateBuildContext = {
  country: string;
  countryCode: string;
  industry: string;
  catalogContext: CatalogContextResult;
  provider: WebSearchProviderKey;
  /** Query a la que se atribuye el candidato cuando el resultado no la trae. */
  fallbackQueryText: string;
  /**
   * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — instante de observación de los campos del
   * proveedor. Inyectable para que la procedencia sea determinista en tests.
   */
  observedAt?: string;
  /** Estado de evidencia sectorial cuando la modalidad lo conoce (Apollo dos rondas). */
  sectorEvidenceState?: CandidateSectorEvidenceState | null;
};

export type ProspectingCandidateBuildResult = {
  candidate: ProspectingPipelineCandidate;
  /** True cuando el nombre no era extraíble y el candidato quedó forzado a descarte. */
  nameQualityFiltered: boolean;
};

/**
 * Construye UN candidato a partir de UN resultado de búsqueda.
 *
 * Extraído literalmente del bucle de `runProspectingPipeline` (mismo orden,
 * mismas llamadas, mismos campos) para que la modalidad Apollo de dos rondas
 * reutilice la construcción real de candidatos — verificación de sitio,
 * deduplicación SellUp + HubSpot y scoring — en vez de reimplementarla. El bucle
 * original ahora llama a esta función: no hay una segunda ruta de construcción.
 *
 * Sin créditos de proveedor: `verifyWebsite` y `checkCompanyDuplicate` consultan
 * nuestra base y HubSpot; ninguna llama a Apollo ni a Lusha.
 */
/** `supplier_of` / `competitor_of` + `evidence_source_url` del resultado de Claude. */
export function readRelationshipEvidence(result: WebSearchResult): CandidateRelationshipEvidence | null {
  const metadata = result.metadata ?? {};
  // «Proveedores» (`supplier_of`) o «Competidores» (`competitor_of`).
  const supplierOf = metadata['supplier_of'];
  const competitorOf = metadata['competitor_of'];
  const kind: CandidateRelationshipEvidence['kind'] | null =
    typeof supplierOf === 'string' && supplierOf.trim()
      ? 'supplier_of'
      : typeof competitorOf === 'string' && competitorOf.trim()
        ? 'competitor_of'
        : null;
  if (kind === null) return null;
  const referenceCompanyName = (kind === 'supplier_of' ? supplierOf : competitorOf) as string;
  const evidenceUrl = metadata['evidence_source_url'];
  return {
    kind,
    referenceCompanyName: referenceCompanyName.trim(),
    evidenceUrl: typeof evidenceUrl === 'string' && evidenceUrl.trim() ? evidenceUrl.trim() : null,
    evidence: result.snippet?.trim() ? result.snippet.trim().slice(0, 300) : null,
  };
}

export async function buildProspectingPipelineCandidate(
  result: WebSearchResult,
  context: ProspectingCandidateBuildContext,
): Promise<ProspectingCandidateBuildResult> {
  // NULL-DOMAIN-IDENTITY § 4 (F4) — un resultado de Apollo Organization Search
  // sin dominio trae `url = https://apollo.io/companies/{id}`: una URL de PERFIL,
  // no el sitio de la empresa. Derivar de ella el website y el dominio escribía
  // `domain='apollo.io'` / `website='https://apollo.io/companies/{id}'` en
  // `prospect_candidates`, e `identity_key='domain:apollo.io'` — la identidad
  // COMPARTIDA por todas las organizaciones sin dominio. De ahí salían el
  // `duplicate_in_sellup` falso y el cooldown que borraba organizaciones válidas
  // de corridas posteriores. Para Apollo se lee lo DECLARADO; para Tavily y
  // Google CSE la URL sigue siendo el sitio real y nada cambia.
  const isApolloResult = isApolloOrganizationsResult(result);
  const declaredWebsite = isApolloResult ? readApolloCandidateWebsite(result) : result.url;
  // AGENT1-TAVILY-HOMEPAGE-2 — en Tavily la URL es la PÁGINA encontrada; el sitio
  // es su portada (Prod 02-10, BO 8c3b2db5: este constructor seguía guardando la
  // página interior). La página queda como `sourceUrl`. Apollo: lo declarado.
  // AGENT1-TAVILY-INSTITUTIONS-1 — un subportal de gobierno/educación es de su
  // institución: se usan su portada y su dominio.
  const institutionHost = isApolloResult || declaredWebsite === null ? null : institutionParentHost(normalizeDomain(declaredWebsite));
  // AUDIT-A1-WS7 — un ministerio que vive como ruta del portal nacional
  // (`gob.pe/minsa`) conserva esa ruta como sitio: la portada del portal no es él.
  const portalEntity = isApolloResult ? null : readNationalPortalEntity(declaredWebsite);
  const website = isApolloResult
    ? declaredWebsite
    : portalEntity
      ? portalEntity.website
      : institutionHost
        ? `https://${institutionHost}/`
        : toHomepageUrl(declaredWebsite);
  const domain = declaredWebsite === null ? null : (institutionHost ?? normalizeDomain(declaredWebsite));
  // Sin sitio declarado no hay URL de la que inferir un nombre: inferirlo del
  // perfil de Apollo produciría «Apollo» para cualquier organización sin dominio.
  const nameInferenceUrl = declaredWebsite ?? '';

  // 🔴 AGENT1-APOLLO-STRUCTURED-NAME-X6.11-B — un nombre ESTRUCTURADO no se
  // infiere: se transcribe.
  //
  // `inferCompanyNameFromSearchResult` está escrito para títulos de página web
  // de Tavily. Apollo no manda títulos: manda `org.name` de su base de datos.
  // Aplicarle las heurísticas de título rompía el nombre de dos maneras, las dos
  // medidas en Producción sobre 252 filas de 6 lotes (X6.11-A):
  //
  //   · TRUNCAMIENTO por separador — 12 casos.
  //     «rtvc - señalcolombia» → «rtvc», y el gate de ownership, que con el
  //     nombre entero acepta por la regla 3, rechazaba media entrada.
  //   · SUSTITUCIÓN POR EL DOMINIO — 12 casos.
  //     «BoP Consultoría» → «Cardonaprada». Además de cambiar una empresa por
  //     otra, vuelve CIRCULAR al ownership: el nombre sale del dominio que
  //     después se pretende acreditar, y la regla 1 lo confirma por
  //     construcción. Se observaron 8 nombres derivados así en un solo lote.
  //
  // El arreglo no toca ninguna regla de ownership ni de X6.9: devuelve al gate
  // la entrada que el proveedor había mandado.
  const structuredName = isApolloResult ? readApolloCandidateName(result) : null;

  let name: string;
  let inferredNameSource: NameInferenceSource;
  let nameQualityFiltered = false;

  if (isApolloResult) {
    if (structuredName === null) {
      // 🔴 Entrada inválida, y se declara como tal. NO se cae a derivar el
      // nombre del dominio: eso es exactamente la validación circular que este
      // corte elimina, y reintroducirla por la puerta del fallback la dejaría
      // viva justo donde menos se ve.
      //
      // Se usa el MISMO mecanismo que ya existía para un título sin nombre
      // extraíble (`nameQualityFiltered` + 'Unknown'): la candidata se descarta
      // sola y el lote sigue. Una fila mala no tumba una corrida pagada.
      //
      // El mapper del proveedor LANZA si `org.name` viene vacío, así que esta
      // rama sólo la alcanzan entradas históricas o malformadas —un checkpoint
      // antiguo con `title: ''`, o un resultado fabricado—. Defensiva, no
      // decorativa.
      nameQualityFiltered = true;
      name = 'Unknown';
      inferredNameSource = 'title_fallback';
    } else {
      name = structuredName;
      inferredNameSource = 'provider_structured';
    }
  } else {
    // Rutas NO Apollo (Tavily y demás): comportamiento intacto.
    const inferred = inferCompanyNameFromSearchResult(result.title, nameInferenceUrl);
    name = inferred.name;
    inferredNameSource = inferred.source;

    // Hito 16AB.43.20: if title_fallback returned a sentence, the title has no
    // extractable company name. Use domain inference as last resort, or if that
    // also fails, force the candidate to discard so it is never persisted.
    if (inferredNameSource === 'title_fallback' && isSentenceOrPhraseName(name)) {
      const fromDomain = inferNameFromDomain(nameInferenceUrl);
      if (fromDomain && !isSentenceOrPhraseName(fromDomain)) {
        name = fromDomain;
      } else {
        nameQualityFiltered = true;
        // Build a minimal discard candidate — no I/O, scoring will mark as discard
        name = 'Unknown';
      }
    }
  }

  // Trazabilidad query→candidato (Hito 16Z.2)
  const originQueryText = ('originQuery' in result && typeof result.originQuery === 'string')
    ? result.originQuery
    : context.fallbackQueryText;
  const { queryType, querySourceKey } = classifyQuery(originQueryText, context.country, context.industry);
  const searchTrace: SearchTrace = {
    query_text: originQueryText,
    query_type: queryType,
    query_source_key: querySourceKey,
    provider_rank: result.rank,
  };

  // Paso 4a: Verificar website
  const websiteVerification = await verifyWebsite({
    candidateName: name,
    websiteOrDomain: website,
    country: context.country,
    countryCode: context.countryCode,
  });
  if (!isApolloResult && !nameQualityFiltered) {
    const repairedName = repairInstitutionName({
      name,
      host: domain,
      pageTitle: websiteVerification.title ?? null,
      subportalCollapsed: institutionHost !== null,
    });
    if (repairedName) name = repairedName;
  }

  // Paso 4b: Deduplicación (SellUp + HubSpot si está conectado)
  const duplicateCheck = await checkCompanyDuplicate({
    name,
    website,
    domain,
    country: context.country,
    countryCode: context.countryCode,
  });

  // A1-APOLLO-LINKEDIN-EMPLOYEES-1 — el LinkedIn empresarial y el número de
  // empleados que el proveedor devolvió viajan CON el candidato. Antes se
  // quedaban en `result.metadata` y el writer, que nunca los veía, los reportaba
  // como ausencia del proveedor.
  //
  // CANDIDATE-OPERABILITY-VALIDATION-1 § D — y la captura ocurre AHORA, ANTES del
  // scoring. Estaba justo debajo, y por eso `scoreCandidate` nunca recibía
  // `linkedinCompanyUrl`: en la ruta Apollo la rama `else` de la señal de LinkedIn
  // era la única alcanzable, y toda empresa con LinkedIn confirmado se persistía
  // con la advertencia «LinkedIn no disponible». El dato existía y llegaba tarde.
  const providerCompanyFields = captureApolloCompanyFields(
    result,
    context.observedAt ?? new Date().toISOString(),
  );

  // Paso 4c: Scoring (determinístico, sin APIs externas)
  const scoring = scoreCandidate({
    name,
    country: context.country,
    countryCode: context.countryCode,
    industry: context.industry,
    website,
    domain,
    websiteVerification,
    duplicateCheck,
    catalogContext: context.catalogContext,
    // § D — la URL canónica que el proveedor ya entregó, sin re-normalizar: es
    // exactamente la misma que se persiste en la columna `linkedin_url`.
    linkedinCompanyUrl: providerCompanyFields.linkedin.companyLinkedInUrl,
    sourcePrimary: result.source ?? context.provider,
    sourcePriority:
      context.catalogContext.recommendedSources.length > 0
        ? context.catalogContext.recommendedSources[0].priority
        : null,
    sourceTitle: result.title,
    sourceSnippet: result.snippet ?? null,
    countryEvidenceLevel: evaluateCountryEvidence({
      // NULL-DOMAIN-IDENTITY § 4 (F4) — el sitio DECLARADO. El perfil de Apollo
      // no dice nada del país de la empresa; leerlo como su web era evidencia
      // fabricada.
      website: declaredWebsite ?? '',
      domain: domain ?? '',
      sourceSnippet: result.snippet ?? null,
      sourceTitle: result.title,
      queryText: originQueryText,
      targetCountryCode: context.countryCode,
    }).evidenceLevel,
  });

  return {
    nameQualityFiltered,
    candidate: {
      name,
      website,
      domain,
      country: context.country,
      countryCode: context.countryCode,
      industry: context.industry,
      // `sourceUrl` conserva la URL tal cual llegó — incluida la de perfil de
      // Apollo. Es TRAZABILIDAD: sirve para volver al origen del candidato y
      // NUNCA para fundar identidad. La guarda estática de
      // `agent1-apollo-null-domain-identity.test.ts` vigila esa frontera.
      sourceUrl: result.url,
      sourceTitle: result.title,
      // AUDIT-A1-WS7 — el «snippet» de Claude busca empresas es texto que escribió
      // el modelo: sus cifras de empleados no son fuente de tamaño (el perfil las
      // leía con regex y decidían el gate ICP). Se quitan sólo esas frases.
      sourceSnippet:
        result.source === 'claude_web_search'
          ? stripEmployeeCountClaims(result.snippet ?? null)
          : (result.snippet ?? null),
      // AGENT1-SUPPLIER-SEARCH-1 — la URL de Claude es la portada; la página que
      // prueba la relación viaja en la metadata del resultado y se conserva aquí.
      relationshipEvidence: readRelationshipEvidence(result),
      // § 7 — la identidad estable de una organización Apollo sin dominio.
      apolloOrganizationId: isApolloResult ? readApolloProviderOrganizationId(result) : null,
      inferredNameSource,
      websiteVerification,
      duplicateCheck,
      scoring,
      searchTrace,
      providerCompanyFields,
      companyLinkedInUrl: providerCompanyFields.linkedin.companyLinkedInUrl,
      // X6.10-B — los alias que el proveedor declaró, tal cual, sin completar ni
      // recortar: el tope ya lo aplicó el provider al estamparlos.
      providerDomainAliases: readApolloCandidateDomainAliases(result),
      // El resolver del ICP size gate ya leía `employeeCount`; lo que faltaba era
      // que alguien lo poblara. Sólo se expone un valor confirmado: un `invalid`
      // o un `not_returned` no puede convertirse en dato de tamaño.
      ...(providerCompanyFields.employeeCount.status === 'confirmed'
        ? { employeeCount: providerCompanyFields.employeeCount.employeeCount }
        : {}),
      ...(context.sectorEvidenceState !== undefined
        ? { sectorEvidenceState: context.sectorEvidenceState }
        : {}),
    },
  };
}

// ─── Builder de summary ───────────────────────────────────────────────────────

export function buildSummary(
  requested: number,
  searched: number,
  candidates: ProspectingPipelineCandidate[]
): ProspectingPipelineSummary {
  const labelCounts: Record<CandidateQualityLabel, number> = {
    high_quality_new: 0,
    needs_review: 0,
    duplicate: 0,
    insufficient_data: 0,
    discard: 0,
  };

  let unchecked = 0;

  for (const c of candidates) {
    labelCounts[c.scoring.qualityLabel]++;
    if (c.duplicateCheck?.status === 'unchecked') {
      unchecked++;
    }
  }

  return {
    requested,
    searched,
    returned: candidates.length,
    highQualityNew: labelCounts.high_quality_new,
    needsReview: labelCounts.needs_review,
    duplicates: labelCounts.duplicate,
    insufficientData: labelCounts.insufficient_data,
    discarded: labelCounts.discard,
    unchecked,
  };
}

/**
 * AGENT1-TAVILY-FIRST-5 — `https://host/` de una URL (la portada del sitio).
 * Sin protocolo se asume https; algo que no es URL se devuelve tal cual.
 */
export function toHomepageUrl(url: string | null): string | null {
  if (!url) return url;
  const trimmed = url.trim();
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!parsed.hostname.includes('.')) return trimmed;
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return trimmed;
  }
}

// ─── AGENT1-TAVILY-INSTITUTIONS-1 — sitios de gobierno y educación ───────────────
//
// Prod 07-10, Ecuador × Gobierno (b24a558b), filas de Tavily:
//   · el título de la página ERA la dirección («www.supercias.gob.ec», «ibarra.gob.»)
//     y quedó como nombre ⇒ sin RUC por nombre y sin cruce de duplicados;
//   · un SUBPORTAL se tomó como institución («Admisión», admision.educacion.gob.ec,
//     es del Ministerio de Educación).
// Sólo para resultados web (no Apollo) y sólo en dominios de gobierno o educación.

/**
 * `x.gob.ec`, `x.gov.co`, `x.gub.uy`, `x.go.cr`, `x.edu.ec`, `x.ac.cr`, `x.mil.ec`
 * (3 etiquetas) o `x.gov`, `x.edu` (2).
 *
 * AUDIT-A1-WS7 — `gub` (Uruguay) y `go` (Costa Rica) faltaban: sus sitios de
 * gobierno no se reconocían como institución. `ac` = académico (ucr.ac.cr), igual
 * que `edu`.
 */
function institutionHostLabels(host: string): number {
  if (/\.(gob|gov|gub|go|edu|ac|mil)\.[a-z]{2}$/.test(host)) return 3;
  if (/\.(gov|edu|mil)$/.test(host)) return 2;
  return 0;
}

/** ¿Es un sitio académico (`edu` / `ac`)? Sus subdominios son facultades o portales de la misma institución. */
function isAcademicHost(host: string): boolean {
  return /\.(edu|ac)\.[a-z]{2}$/.test(host) || /\.edu$/.test(host);
}

/**
 * AUDIT-A1-WS7 — primeras etiquetas que nombran un SUBPORTAL (un servicio de la
 * institución), no otra institución. En gobierno sólo éstas se colapsan: «dmv.ca.gov»
 * y «cdph.ca.gov» son agencias distintas (no «ca.gov»), «metro.cdmx.gob.mx» no es
 * «cdmx.gob.mx». Así los portales estatales (`<estado>.gov`, `<estado>.gob.mx`) se
 * comportan como sufijo público sin tener que listarlos.
 */
const INSTITUTION_SUBPORTAL_LABELS = new Set([
  'www', 'www1', 'www2', 'www3', 'web', 'web2', 'portal', 'portales', 'sitio', 'sitioweb', 'm', 'mobile',
  'admision', 'admisiones', 'inscripciones', 'tramites', 'tramite', 'tramitesenlinea', 'sede', 'sedeelectronica',
  'servicios', 'servicio', 'serviciosenlinea', 'enlinea', 'ventanilla', 'ventanillaunica', 'ventanillavirtual',
  'citas', 'turnos', 'consultas', 'pagos', 'pqrs', 'pqrsd', 'transparencia', 'contratacion', 'contrataciones',
  'convocatorias', 'empleo', 'empleos', 'intranet', 'extranet', 'campus', 'campusvirtual', 'aulavirtual',
  'virtual', 'moodle', 'biblioteca', 'blog', 'noticias', 'prensa', 'app', 'apps', 'login', 'sso', 'correo',
  'mail', 'webmail', 'static', 'cdn', 'files', 'archivos', 'repositorio', 'datos', 'estadisticas',
]);

/** ¿Es un sitio de gobierno o educación? */
export function isInstitutionHost(domain: string | null | undefined): boolean {
  return Boolean(domain) && institutionHostLabels(domain!.toLowerCase().replace(/^www\./, '')) > 0;
}

/**
 * La institución dueña de un SUBPORTAL de gobierno o educación:
 * «admision.educacion.gob.ec» → «educacion.gob.ec». `null` si ya es la institución
 * o no es un sitio de gobierno/educación.
 *
 * AUDIT-A1-WS7 — en GOBIERNO sólo se quitan las primeras etiquetas que son un
 * subportal conocido (`INSTITUTION_SUBPORTAL_LABELS`); cualquier otra etiqueta es
 * otra entidad y se conserva («dmv.ca.gov» se queda). En EDUCACIÓN se sigue
 * colapsando a la institución (facultades y portales de la misma universidad).
 */
export function institutionParentHost(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const host = domain.toLowerCase().replace(/^www\./, '');
  const keep = institutionHostLabels(host);
  if (keep === 0) return null;
  const labels = host.split('.');
  if (labels.length <= keep) return null;
  if (isAcademicHost(host)) return labels.slice(-keep).join('.');
  let start = 0;
  while (labels.length - start > keep && INSTITUTION_SUBPORTAL_LABELS.has(labels[start])) start++;
  return start === 0 ? null : labels.slice(start).join('.');
}

/** ¿El «nombre» es en realidad una dirección («www.supercias.gob.ec», «ibarra.gob.»)? */
export function looksLikeHostName(name: string | null | undefined): boolean {
  const value = (name ?? '').trim();
  // En minúsculas, sin espacios y con un punto entre letras: «S.A.» o «UEES» no lo son.
  return value === value.toLowerCase() && /^[a-z0-9.\-/:]+$/.test(value) && /[a-z0-9-]\.[a-z]/.test(value);
}

/**
 * Nombre de la institución desde el título de su PORTADA cuando el que se tenía es
 * una dirección o el de un subportal. `null` = se queda el nombre que había.
 */
export function repairInstitutionName(input: {
  name: string;
  host: string | null;
  pageTitle: string | null;
  subportalCollapsed: boolean;
}): string | null {
  if (!isInstitutionHost(input.host)) return null;
  const hostLike = looksLikeHostName(input.name);
  if (!hostLike && !input.subportalCollapsed) return null;
  const fromTitle = input.pageTitle ? inferNameFromTitle(input.pageTitle, input.host ?? undefined) : null;
  if (fromTitle && !looksLikeHostName(fromTitle)) return fromTitle;
  return hostLike ? inferNameFromDomain(input.host ?? '') : null;
}
