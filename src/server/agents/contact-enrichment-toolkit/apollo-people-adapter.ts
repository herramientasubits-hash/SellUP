// Agente 2A — Apollo People Adapter
// Hito 17A.3A — Busca personas reales en Apollo asociadas a una empresa,
// priorizando perfiles de RR. HH. / People / Talento / Learning / Cultura.
//
// Reglas:
//  - Usa el cliente Apollo existente (no duplica lógica de red).
//  - Prioriza el dominio como filtro de organización (señal autoritativa).
//    Cuando hay dominio NO se envía q_organization_name: combinar un nombre
//    libre (a veces de prueba o con sufijos) con el dominio vía AND puede
//    excluir empresas grandes y devolver 0 (caso Bancolombia). Sin dominio,
//    se usa el nombre como filtro.
//  - Búsqueda por capas / fallback controlado: empieza estricto y relaja
//    progresivamente solo si el intento previo no trae resultados normalizables.
//  - Si Apollo no está conectado → status 'error' (controlado, no rompe la app).
//  - Si faltan datos mínimos (sin dominio y sin nombre) → status 'skipped'.
//  - Limita resultados y número de intentos para controlar costo.
//  - NO usa people/match ni reveal de teléfonos async en este hito.

import {
  searchApolloPeople,
  type ApolloPerson,
  type SearchPeopleParams,
  type ApolloSearchResult,
} from '@/server/integrations/apollo-client';
import { hasApolloApiKey } from '@/server/services/apollo-connection';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import { normalizeApolloPerson } from './contact-normalizer';
import { classifyNormalizedContact } from './contact-relevance-classifier';
import {
  resolveApolloOrganization,
  type ApolloOrgResolutionResult,
} from './apollo-organization-resolver';

/**
 * Sentinel reason for the "no real Apollo call was made" branch (missing
 * credentials/connection). Shared with the runner so it can distinguish this
 * pre-flight failure from an error that occurred after a real provider
 * attempt (17B.4X.7C.3F — providers_used trace consistency).
 */
export const APOLLO_NOT_CONNECTED_REASON =
  'Apollo no está conectado o no tiene credenciales disponibles';

// ── Country code → Apollo location mapping (Hito 17A.9B.2) ───────

/**
 * Mapeo de ISO-3166-1 alpha-2 → nombre de país tal como lo entiende Apollo
 * en el parámetro `person_locations`.
 *
 * Solo se incluyen países del mercado primario de SellUp. Si el código no está
 * aquí devolvemos null (sin filtro), nunca bloqueamos la búsqueda.
 */
const COUNTRY_CODE_TO_APOLLO_LOCATION: Record<string, string> = {
  AR: 'Argentina',
  BO: 'Bolivia',
  BR: 'Brazil',
  CL: 'Chile',
  CO: 'Colombia',
  CR: 'Costa Rica',
  EC: 'Ecuador',
  ES: 'Spain',
  GT: 'Guatemala',
  HN: 'Honduras',
  MX: 'Mexico',
  PA: 'Panama',
  PE: 'Peru',
  PY: 'Paraguay',
  SV: 'El Salvador',
  UY: 'Uruguay',
  US: 'United States',
  VE: 'Venezuela',
};

/**
 * Convierte un código ISO alpha-2 al nombre de país que Apollo acepta en
 * `person_locations`. Devuelve `null` si el código es falsy o no está mapeado.
 * No arroja excepción — los códigos no soportados simplemente no filtran.
 */
export function mapCountryCodeToApolloLocation(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_CODE_TO_APOLLO_LOCATION[code.toUpperCase()] ?? null;
}

// ── Filtros HR / seniority ─────────────────────────────────────

/** Títulos objetivo (ES + EN) para perfiles de RR. HH. / People / Talento. */
export const HR_PERSON_TITLES: string[] = [
  'Recursos Humanos',
  'Human Resources',
  'People',
  'People Operations',
  'Talent',
  'Talento',
  'Talent Acquisition',
  'Capital Humano',
  'Learning',
  'Learning and Development',
  'Learning & Development',
  'L&D',
  'Cultura',
  'Culture',
  'Organizational Development',
  'Desarrollo Organizacional',
  'Gestión Humana',
];

/** Seniorities objetivo según vocabulario de Apollo. */
export const TARGET_SENIORITIES: string[] = [
  'owner',
  'founder',
  'c_suite',
  'partner',
  'vp',
  'head',
  'director',
  'manager',
  'senior',
];

/** Departamentos de Apollo relevantes para RR. HH. */
export const HR_DEPARTMENTS: string[] = ['master_human_resources'];

/** Límite de resultados por intento (per_page). Deriva del guardrail compartido. */
export const DEFAULT_MAX_CANDIDATES = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxResultsPerSearchAttempt;

/** Tope duro de intentos por run. Deriva del guardrail compartido. */
const MAX_SEARCH_ATTEMPTS = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxSearchAttempts;

/** Tope duro de resultados crudos acumulados por run (todos los intentos). */
const MAX_SEARCH_RESULTS_PER_RUN = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxSearchResultsPerRun;

/** Contactos revisables que bastan para detener la búsqueda anticipadamente. */
const TARGET_REVIEWABLE_CONTACTS = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.targetReviewableContacts;

// ── Tipos ──────────────────────────────────────────────────────

export interface ApolloPeopleAdapterInput {
  runId: string;
  companyName: string;
  companyDomain?: string | null;
  companyCountryCode?: string | null;
  maxCandidates?: number;
}

export interface ApolloProviderUsage {
  provider: 'apollo';
  operation: 'people_search';
  creditsUsed: number;
  rawResultsCount: number;
}

/** Metadata resumida de un intento de búsqueda (para summary, sin payload crudo). */
export interface ApolloSearchAttemptMeta {
  attempt: string;
  /** Filtros usados de forma resumida (sin volcar el payload completo). */
  filters: string;
  rawResultsCount: number;
}

export interface SearchGuardrailMeta {
  max_search_attempts: number;
  max_results_per_attempt: number;
  max_results_per_run: number;
  estimated_search_credits: number;
  blocked_by_search_budget: boolean;
  stopped_early_reason: 'target_reviewable_reached' | 'search_budget_reached' | 'all_attempts_exhausted' | null;
}

export interface ApolloOrgResolutionMeta {
  status: ApolloOrgResolutionResult['resolutionStatus'];
  organization_id: string | null;
  organization_name: string | null;
  organization_domain: string | null;
  resolution_method: 'domain' | 'name' | null;
  domain_query_results: number;
  name_query_results: number;
  error?: string;
}

/** Diagnóstico del filtro de país aplicado a people_search (Hito 17A.9B.2). */
export interface CountryFilterMeta {
  country_code_received: string | null;
  apollo_person_location_sent: string | null;
  country_filter_applied: boolean;
  country_filter_reason: string;
}

export interface ApolloPeopleAdapterResult {
  status: 'success' | 'skipped' | 'error';
  people: ApolloPerson[];
  providerUsage?: ApolloProviderUsage;
  /** Metadata de los intentos ejecutados (capas de fallback). */
  attempts: ApolloSearchAttemptMeta[];
  /** Nombre del intento del que provienen `people` (para trazabilidad). */
  chosenAttempt?: string | null;
  /** Guardrail de presupuesto de búsqueda (Hito 17A.6D). Siempre presente en runtime. */
  searchGuardrail?: SearchGuardrailMeta;
  /** Resolución de organización Apollo (Hito 17A.8A). Presente cuando se ejecutó el resolver. */
  organizationResolution?: ApolloOrgResolutionMeta;
  /** Diagnóstico del filtro de país (Hito 17A.9B.2). Siempre presente en runtime. */
  countryFilter?: CountryFilterMeta;
  reason?: string;
}

// ── Dependency injection (para tests) ──────────────────────────

export interface ApolloPeopleAdapterDeps {
  isConnected?: () => Promise<boolean>;
  searchPeople?: (params: SearchPeopleParams) => Promise<ApolloSearchResult<ApolloPerson>>;
  /**
   * Resuelve el organization_id de Apollo para la empresa antes de buscar personas.
   * Hito 17A.8A. Inyectable para tests. Default: implementación real.
   * Pasar `async () => null` en tests que NO quieren probar la resolución de org.
   */
  resolveOrganization?: (
    domain: string | null | undefined,
    name: string,
  ) => Promise<ApolloOrgResolutionResult | null>;
}

function hasMinimumData(input: ApolloPeopleAdapterInput): boolean {
  const hasDomain = !!input.companyDomain && input.companyDomain.trim().length > 0;
  const hasName = !!input.companyName && input.companyName.trim().length > 0;
  return hasDomain || hasName;
}

/** Una persona es normalizable si tiene un nombre utilizable (regla del normalizer). */
function isNormalizablePerson(person: ApolloPerson): boolean {
  return !!(
    person.first_name?.trim() ||
    person.last_name?.trim() ||
    person.headline?.trim()
  );
}

/**
 * Cuenta cuántas personas del intento serían revisables: normalizables Y
 * clasificadas como insertables por el clasificador de relevancia/calidad.
 * Es la señal que gobierna el stop-early: no nos detenemos en ruido (p. ej.
 * un Software Engineer de un fallback amplio), solo en candidatos útiles.
 */
function countReviewablePeople(people: ApolloPerson[]): number {
  let count = 0;
  for (const person of people) {
    const normalized = normalizeApolloPerson(person);
    if (!normalized) continue;
    if (classifyNormalizedContact(normalized).shouldInsertForReview) count += 1;
  }
  return count;
}

// ── Definición de capas de búsqueda ────────────────────────────

type OrgFilter = Pick<SearchPeopleParams, 'q_organization_domains' | 'q_organization_name'>;

/**
 * Construye el filtro de organización priorizando el dominio.
 * Con dominio: solo dominio (no se mezcla nombre libre vía AND).
 * Sin dominio: nombre de empresa como fallback.
 */
function buildOrgFilter(input: ApolloPeopleAdapterInput): { filter: OrgFilter; desc: string } {
  const domain = input.companyDomain?.trim();
  if (domain) {
    return { filter: { q_organization_domains: [domain] }, desc: `dominio=${domain}` };
  }
  return {
    filter: { q_organization_name: input.companyName.trim() },
    desc: `nombre=${input.companyName.trim()}`,
  };
}

interface AttemptPlan {
  name: string;
  filters: string;
  params: SearchPeopleParams;
}

/**
 * Construye planes de intento cuando se resolvió un organization_id de Apollo.
 * Hito 17A.8A: organization_ids es el filtro más fiable en mixed_people/api_search.
 * Hito 17A.9B.2: inyecta person_locations cuando hay countryCode mapeado.
 *
 * Estrategia:
 *  Intento 1: org_id + department HR + seniorities (el más preciso)
 *  Intento 2: org_id + títulos HR + seniorities
 *  Intento 3: q_organization_name (fallback por nombre, señal diferente)
 */
function buildAttemptPlansWithOrgId(
  input: ApolloPeopleAdapterInput,
  perPage: number,
  organizationId: string,
  personLocations?: string[],
): AttemptPlan[] {
  const name = input.companyName?.trim() ?? '';
  const orgDesc = `org_id=${organizationId}`;
  const locationSuffix = personLocations ? `; location=${personLocations[0]}` : '';
  const locationParams = personLocations ? { person_locations: personLocations } : {};
  const byOrgId: SearchPeopleParams = {
    organization_ids: [organizationId],
    page: 1,
    per_page: perPage,
    ...locationParams,
  };
  const byName: SearchPeopleParams = {
    q_organization_name: name,
    page: 1,
    per_page: perPage,
    ...locationParams,
  };

  const plans: AttemptPlan[] = [
    {
      name: 'org_id_hr_department',
      filters: `org(${orgDesc}); department=HR; seniorities; sin titles${locationSuffix}`,
      params: {
        ...byOrgId,
        person_seniorities: TARGET_SENIORITIES,
        person_department_or_subdepartments: HR_DEPARTMENTS,
      },
    },
    {
      name: 'org_id_hr_titles',
      filters: `org(${orgDesc}); titles=HR; seniorities; sin department${locationSuffix}`,
      params: {
        ...byOrgId,
        person_titles: HR_PERSON_TITLES,
        person_seniorities: TARGET_SENIORITIES,
      },
    },
  ];

  // Tercer intento: nombre como señal complementaria (captura perfiles que
  // Apollo no devuelve por organization_id pero sí por nombre).
  if (name) {
    plans.push({
      name: 'org_name_hr_titles_fallback',
      filters: `org(nombre=${name}); titles=HR; seniorities; sin department${locationSuffix}`,
      params: {
        ...byName,
        person_titles: HR_PERSON_TITLES,
        person_seniorities: TARGET_SENIORITIES,
      },
    });
  }

  return plans.slice(0, MAX_SEARCH_ATTEMPTS);
}

/**
 * Construye los planes de intento cuando NO se resolvió organization_id.
 * Comportamiento original (Hito 17A.3A/17A.3B): prioriza dominio, fallback a nombre.
 * Hito 17A.9B.2: inyecta person_locations cuando hay countryCode mapeado.
 *
 * Las capas 1-3 usan el filtro de organización preferente (dominio si existe).
 * La capa 4+ usa q_organization_name (caso Bancolombia: mixed_people/api_search
 * puede ignorar q_organization_domains para empresas grandes).
 */
function buildAttemptPlansLegacy(input: ApolloPeopleAdapterInput, perPage: number, personLocations?: string[]): AttemptPlan[] {
  const { filter, desc } = buildOrgFilter(input);
  const locationSuffix = personLocations ? `; location=${personLocations[0]}` : '';
  const locationParams = personLocations ? { person_locations: personLocations } : {};
  const base: SearchPeopleParams = { ...filter, page: 1, per_page: perPage, ...locationParams };

  const plans: AttemptPlan[] = [
    {
      name: 'strict_hr_department',
      filters: `org(${desc}); department=HR; seniorities; sin titles${locationSuffix}`,
      params: {
        ...base,
        person_seniorities: TARGET_SENIORITIES,
        person_department_or_subdepartments: HR_DEPARTMENTS,
      },
    },
    {
      name: 'hr_titles_without_department',
      filters: `org(${desc}); titles=HR; seniorities; sin department${locationSuffix}`,
      params: {
        ...base,
        person_titles: HR_PERSON_TITLES,
        person_seniorities: TARGET_SENIORITIES,
      },
    },
    {
      name: 'broad_seniorities_only',
      filters: `org(${desc}); seniorities; sin department; sin titles${locationSuffix}`,
      params: {
        ...base,
        person_seniorities: TARGET_SENIORITIES,
      },
    },
  ];

  // Capas por nombre (solo cuando las previas usaron dominio).
  const name = input.companyName?.trim();
  const usedDomain = !!input.companyDomain?.trim();
  if (name && usedDomain) {
    const byName: SearchPeopleParams = { q_organization_name: name, page: 1, per_page: perPage, ...locationParams };
    plans.push(
      {
        name: 'org_name_hr_department',
        filters: `org(nombre=${name}); department=HR; seniorities; sin titles${locationSuffix}`,
        params: {
          ...byName,
          person_seniorities: TARGET_SENIORITIES,
          person_department_or_subdepartments: HR_DEPARTMENTS,
        },
      },
      {
        name: 'org_name_hr_titles',
        filters: `org(nombre=${name}); titles=HR; seniorities; sin department${locationSuffix}`,
        params: {
          ...byName,
          person_titles: HR_PERSON_TITLES,
          person_seniorities: TARGET_SENIORITIES,
        },
      },
      {
        name: 'org_name_hr_titles_no_seniority',
        filters: `org(nombre=${name}); titles=HR; sin seniorities; sin department${locationSuffix}`,
        params: {
          ...byName,
          person_titles: HR_PERSON_TITLES,
        },
      },
      {
        name: 'broad_org_name_only',
        filters: `org(nombre=${name}); sin seniorities; sin titles; sin department${locationSuffix}`,
        params: { ...byName },
      },
    );
  }

  return plans.slice(0, MAX_SEARCH_ATTEMPTS);
}

function buildAttemptPlans(
  input: ApolloPeopleAdapterInput,
  perPage: number,
  organizationId?: string | null,
  personLocations?: string[],
): AttemptPlan[] {
  if (organizationId) {
    return buildAttemptPlansWithOrgId(input, perPage, organizationId, personLocations);
  }
  return buildAttemptPlansLegacy(input, perPage, personLocations);
}

/**
 * Consulta Apollo por capas para encontrar personas asociadas a la empresa.
 * Ejecuta hasta 3 intentos, de más estricto a más amplio, deteniéndose en
 * cuanto un intento trae resultados normalizables (stop early → menos costo).
 * La normalización y la deduplicación ocurren después, en el runner.
 */
export async function searchApolloPeopleForCompany(
  input: ApolloPeopleAdapterInput,
  deps: ApolloPeopleAdapterDeps = {},
): Promise<ApolloPeopleAdapterResult> {
  const {
    isConnected = hasApolloApiKey,
    searchPeople = searchApolloPeople,
    resolveOrganization = resolveApolloOrganization,
  } = deps;

  const baseSearchGuardrail: SearchGuardrailMeta = {
    max_search_attempts: MAX_SEARCH_ATTEMPTS,
    max_results_per_attempt: DEFAULT_MAX_CANDIDATES,
    max_results_per_run: MAX_SEARCH_RESULTS_PER_RUN,
    estimated_search_credits: 0,
    blocked_by_search_budget: false,
    stopped_early_reason: null,
  };

  // 1. Datos mínimos suficientes.
  if (!hasMinimumData(input)) {
    return {
      status: 'skipped',
      people: [],
      attempts: [],
      searchGuardrail: { ...baseSearchGuardrail, stopped_early_reason: null },
      reason: 'Datos insuficientes para Apollo: falta dominio y nombre de empresa',
    };
  }

  // 2. Conexión disponible.
  const connected = await isConnected();
  if (!connected) {
    return {
      status: 'error',
      people: [],
      attempts: [],
      searchGuardrail: { ...baseSearchGuardrail, stopped_early_reason: null },
      reason: APOLLO_NOT_CONNECTED_REASON,
    };
  }

  // 3. Resolución de organización Apollo (Hito 17A.8A).
  //    Non-blocking: si falla o no encuentra, continúa con el flujo legacy por dominio/nombre.
  //    El organization_id (cuando existe) es más fiable que q_organization_domains en
  //    mixed_people/api_search para empresas grandes (Siesa, Bancolombia, etc.).
  let orgResolution: ApolloOrgResolutionResult | null = null;
  try {
    orgResolution = await resolveOrganization(input.companyDomain, input.companyName);
  } catch {
    // La resolución de org es best-effort. No bloquea el flujo.
  }

  const orgResolutionMeta: ApolloOrgResolutionMeta | undefined = orgResolution
    ? {
        status: orgResolution.resolutionStatus,
        organization_id: orgResolution.organizationId,
        organization_name: orgResolution.organizationName,
        organization_domain: orgResolution.organizationDomain,
        resolution_method: orgResolution.resolutionMethod,
        domain_query_results: orgResolution.diagnostics.domain_query_results,
        name_query_results: orgResolution.diagnostics.name_query_results,
        error: orgResolution.error,
      }
    : undefined;

  const resolvedOrgId = orgResolution?.organizationId ?? null;

  // 4. Filtro de país (Hito 17A.9B.2).
  //    Non-blocking: si el código no está mapeado, la búsqueda continúa sin filtro.
  const apolloLocation = mapCountryCodeToApolloLocation(input.companyCountryCode);
  const personLocations = apolloLocation ? [apolloLocation] : undefined;
  const countryFilterMeta: CountryFilterMeta = apolloLocation
    ? {
        country_code_received: input.companyCountryCode ?? null,
        apollo_person_location_sent: apolloLocation,
        country_filter_applied: true,
        country_filter_reason: `countryCode '${input.companyCountryCode}' mapeado a '${apolloLocation}'`,
      }
    : input.companyCountryCode
      ? {
          country_code_received: input.companyCountryCode,
          apollo_person_location_sent: null,
          country_filter_applied: false,
          country_filter_reason: `countryCode '${input.companyCountryCode}' no está en el mapping soportado`,
        }
      : {
          country_code_received: null,
          apollo_person_location_sent: null,
          country_filter_applied: false,
          country_filter_reason: 'No se recibió countryCode',
        };

  const perPage = DEFAULT_MAX_CANDIDATES;
  const plans = buildAttemptPlans(input, perPage, resolvedOrgId, personLocations);

  const attempts: ApolloSearchAttemptMeta[] = [];
  let totalRaw = 0;
  let chosen: ApolloPerson[] = [];
  let chosenAttempt: string | null = null;
  let stoppedEarlyReason: SearchGuardrailMeta['stopped_early_reason'] = null;
  let blockedBySearchBudget = false;

  // Mejor intento por cantidad de normalizables: usado solo si ningún intento
  // trae candidatos revisables, para que el runner pueda evaluarlos y
  // reportarlos como filtrados (honestidad en los conteos del summary).
  let bestData: ApolloPerson[] = [];
  let bestUsable = 0;
  let bestAttempt: string | null = null;

  let totalReviewable = 0;

  for (const plan of plans) {
    // Guardrail de presupuesto: si ya alcanzamos el máximo de resultados crudos,
    // no hacemos más llamadas a Apollo aunque queden planes por ejecutar.
    if (totalRaw >= MAX_SEARCH_RESULTS_PER_RUN) {
      blockedBySearchBudget = true;
      stoppedEarlyReason = 'search_budget_reached';
      break;
    }

    let result: Awaited<ReturnType<typeof searchPeople>>;
    try {
      result = await searchPeople(plan.params);
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return {
        status: 'error',
        people: [],
        attempts,
        searchGuardrail: {
          ...baseSearchGuardrail,
          estimated_search_credits: totalRaw,
          blocked_by_search_budget: false,
          stopped_early_reason: null,
        },
        countryFilter: countryFilterMeta,
        reason: `Error de red consultando Apollo: ${msg}`,
      };
    }

    // Error de proveedor → corta y reporta con los intentos hechos hasta ahora.
    if (!result.success) {
      return {
        status: 'error',
        people: [],
        attempts,
        searchGuardrail: {
          ...baseSearchGuardrail,
          estimated_search_credits: totalRaw,
          blocked_by_search_budget: false,
          stopped_early_reason: null,
        },
        countryFilter: countryFilterMeta,
        reason: result.error?.message ?? 'Error consultando Apollo people search',
      };
    }

    const data = result.data ?? [];
    // Respeta el cap de resultados por run: nunca acumulamos más de lo permitido.
    const remaining = MAX_SEARCH_RESULTS_PER_RUN - totalRaw;
    const capped = data.slice(0, remaining);
    totalRaw += capped.length;

    attempts.push({
      attempt: plan.name,
      filters: plan.filters,
      rawResultsCount: capped.length,
    });

    // Stop early por revisables: detenemos si ya tenemos suficientes candidatos
    // de calidad. Usa TARGET_REVIEWABLE_CONTACTS (no >0) para evitar parar
    // en un único perfil marginal cuando podría haber mejores en el siguiente intento.
    const reviewable = countReviewablePeople(capped);
    totalReviewable += reviewable;
    if (totalReviewable >= TARGET_REVIEWABLE_CONTACTS) {
      chosen = capped.slice(0, perPage);
      chosenAttempt = plan.name;
      stoppedEarlyReason = 'target_reviewable_reached';
      break;
    }

    // Sin suficientes revisables aún: recuerda el intento con más normalizables.
    const usable = capped.filter(isNormalizablePerson).length;
    if (usable > bestUsable) {
      bestUsable = usable;
      bestData = capped;
      bestAttempt = plan.name;
    }

    // Si este intento aportó algún revisable, registra los datos como candidato
    // aunque no llegamos al target (puede ser el único intento exitoso).
    if (reviewable > 0 && chosenAttempt === null) {
      chosen = capped.slice(0, perPage);
      chosenAttempt = plan.name;
    }
  }

  if (stoppedEarlyReason === null) {
    stoppedEarlyReason = 'all_attempts_exhausted';
  }

  // Ningún intento trajo revisables: devuelve el mejor por normalizables para
  // que el runner los clasifique y cuente como filtrados (o [] si todos vacíos).
  if (chosenAttempt === null && bestData.length > 0) {
    chosen = bestData.slice(0, perPage);
    chosenAttempt = bestAttempt;
  }

  return {
    status: 'success',
    people: chosen,
    attempts,
    chosenAttempt,
    searchGuardrail: {
      max_search_attempts: MAX_SEARCH_ATTEMPTS,
      max_results_per_attempt: perPage,
      max_results_per_run: MAX_SEARCH_RESULTS_PER_RUN,
      estimated_search_credits: totalRaw,
      blocked_by_search_budget: blockedBySearchBudget,
      stopped_early_reason: stoppedEarlyReason,
    },
    organizationResolution: orgResolutionMeta,
    countryFilter: countryFilterMeta,
    providerUsage: {
      provider: 'apollo',
      operation: 'people_search',
      // 1 crédito por resultado devuelto (suma de todos los intentos ejecutados).
      creditsUsed: totalRaw,
      rawResultsCount: totalRaw,
    },
  };
}
