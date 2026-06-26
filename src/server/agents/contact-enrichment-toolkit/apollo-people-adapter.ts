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

/** Límite por defecto de candidatos por run (control de costo). */
export const DEFAULT_MAX_CANDIDATES = 10;

/** Tope duro para la cantidad de resultados crudos que pedimos a Apollo. */
const HARD_RAW_FETCH_CAP = 25;

/** Tope duro de intentos por run (control de costo). */
const MAX_SEARCH_ATTEMPTS = 3;

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

export interface ApolloPeopleAdapterResult {
  status: 'success' | 'skipped' | 'error';
  people: ApolloPerson[];
  providerUsage?: ApolloProviderUsage;
  /** Metadata de los intentos ejecutados (capas de fallback). */
  attempts: ApolloSearchAttemptMeta[];
  reason?: string;
}

// ── Dependency injection (para tests) ──────────────────────────

export interface ApolloPeopleAdapterDeps {
  isConnected?: () => Promise<boolean>;
  searchPeople?: (params: SearchPeopleParams) => Promise<ApolloSearchResult<ApolloPerson>>;
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

/** Construye los planes de intento, de más estricto a más amplio. */
function buildAttemptPlans(input: ApolloPeopleAdapterInput, perPage: number): AttemptPlan[] {
  const { filter, desc } = buildOrgFilter(input);
  const base: SearchPeopleParams = { ...filter, page: 1, per_page: perPage };

  return [
    {
      // Estricto pero no sobre-filtrado: department HR + seniorities, sin títulos.
      name: 'strict_hr_department',
      filters: `org(${desc}); department=HR; seniorities; sin titles`,
      params: {
        ...base,
        person_seniorities: TARGET_SENIORITIES,
        person_department_or_subdepartments: HR_DEPARTMENTS,
      },
    },
    {
      // Títulos HR sin department.
      name: 'hr_titles_without_department',
      filters: `org(${desc}); titles=HR; seniorities; sin department`,
      params: {
        ...base,
        person_titles: HR_PERSON_TITLES,
        person_seniorities: TARGET_SENIORITIES,
      },
    },
    {
      // Fallback amplio controlado: solo seniorities, sin department ni titles.
      name: 'broad_seniorities_only',
      filters: `org(${desc}); seniorities; sin department; sin titles`,
      params: {
        ...base,
        person_seniorities: TARGET_SENIORITIES,
      },
    },
  ].slice(0, MAX_SEARCH_ATTEMPTS);
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
  const { isConnected = hasApolloApiKey, searchPeople = searchApolloPeople } = deps;

  // 1. Datos mínimos suficientes.
  if (!hasMinimumData(input)) {
    return {
      status: 'skipped',
      people: [],
      attempts: [],
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
      reason: 'Apollo no está conectado o no tiene credenciales disponibles',
    };
  }

  const maxCandidates = Math.max(
    1,
    Math.min(input.maxCandidates ?? DEFAULT_MAX_CANDIDATES, HARD_RAW_FETCH_CAP),
  );

  const plans = buildAttemptPlans(input, maxCandidates);

  const attempts: ApolloSearchAttemptMeta[] = [];
  let totalRaw = 0;
  let chosen: ApolloPerson[] = [];

  for (const plan of plans) {
    const result = await searchPeople(plan.params);

    // Error de proveedor → corta y reporta con los intentos hechos hasta ahora.
    if (!result.success) {
      return {
        status: 'error',
        people: [],
        attempts,
        reason: result.error?.message ?? 'Error consultando Apollo people search',
      };
    }

    const data = result.data ?? [];
    totalRaw += data.length;
    attempts.push({
      attempt: plan.name,
      filters: plan.filters,
      rawResultsCount: data.length,
    });

    // Stop early: si el intento trae resultados normalizables, no seguimos.
    const usable = data.filter(isNormalizablePerson);
    if (usable.length > 0) {
      chosen = data.slice(0, maxCandidates);
      break;
    }
  }

  return {
    status: 'success',
    people: chosen,
    attempts,
    providerUsage: {
      provider: 'apollo',
      operation: 'people_search',
      // 1 crédito por resultado devuelto (suma de todos los intentos ejecutados).
      creditsUsed: totalRaw,
      rawResultsCount: totalRaw,
    },
  };
}
