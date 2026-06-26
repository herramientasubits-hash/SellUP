// Agente 2A — Apollo People Adapter
// Hito 17A.3A — Busca personas reales en Apollo asociadas a una empresa,
// priorizando perfiles de RR. HH. / People / Talento / Learning / Cultura.
//
// Reglas:
//  - Usa el cliente Apollo existente (no duplica lógica de red).
//  - Usa dominio cuando exista; nombre + país como fallback.
//  - Si Apollo no está conectado → status 'error' (controlado, no rompe la app).
//  - Si faltan datos mínimos (sin dominio y sin nombre) → status 'skipped'.
//  - Limita resultados para controlar costo.
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

export interface ApolloPeopleAdapterResult {
  status: 'success' | 'skipped' | 'error';
  people: ApolloPerson[];
  providerUsage?: ApolloProviderUsage;
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

/**
 * Consulta Apollo para encontrar personas de RR. HH. asociadas a la empresa.
 * Devuelve hasta `maxCandidates` resultados crudos. La normalización y la
 * deduplicación ocurren después, en el runner.
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
      reason: 'Datos insuficientes para Apollo: falta dominio y nombre de empresa',
    };
  }

  // 2. Conexión disponible.
  const connected = await isConnected();
  if (!connected) {
    return {
      status: 'error',
      people: [],
      reason: 'Apollo no está conectado o no tiene credenciales disponibles',
    };
  }

  const maxCandidates = Math.max(
    1,
    Math.min(input.maxCandidates ?? DEFAULT_MAX_CANDIDATES, HARD_RAW_FETCH_CAP),
  );

  const domain = input.companyDomain?.trim();
  const params: SearchPeopleParams = {
    q_organization_name: input.companyName.trim(),
    person_titles: HR_PERSON_TITLES,
    person_seniorities: TARGET_SENIORITIES,
    person_department_or_subdepartments: HR_DEPARTMENTS,
    page: 1,
    per_page: maxCandidates,
    ...(domain ? { q_organization_domains: [domain] } : {}),
  };

  const result = await searchPeople(params);

  if (!result.success) {
    return {
      status: 'error',
      people: [],
      reason: result.error?.message ?? 'Error consultando Apollo people search',
    };
  }

  const people = (result.data ?? []).slice(0, maxCandidates);

  return {
    status: 'success',
    people,
    providerUsage: {
      provider: 'apollo',
      operation: 'people_search',
      creditsUsed: people.length, // 1 crédito por resultado
      rawResultsCount: people.length,
    },
  };
}
