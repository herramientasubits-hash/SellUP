// Agente 2A — Apollo Contact Diagnostics
// Diagnóstico interno seguro (NO es feature de producto, NO crea candidatos).
//
// Objetivo: entender por qué el people search de Apollo devuelve 0 resultados
// incluso en el intento amplio (caso Bancolombia), aislando:
//   - resolución de organización por dominio,
//   - people search por dominio sin filtros,
//   - people search por organization_id sin filtros,
//   - people search por organization_id + filtros HR/seniority.
//
// Reglas de costo y seguridad:
//   - Máximo 4 llamadas a Apollo por ejecución.
//   - per_page tope 3 (control de costo).
//   - NUNCA retorna emails, teléfonos, payload crudo completo ni API keys.
//     Solo metadata segura: conteos, totales, ids/nombre de organización y
//     una muestra de hasta 3 títulos (los títulos no son PII).
//   - No inserta candidatos ni toca runs reales.

import {
  searchApolloOrganizations,
  searchApolloPeople,
  type ApolloOrganization,
  type ApolloPerson,
  type ApolloSearchResult,
  type SearchOrganizationsParams,
  type SearchPeopleParams,
} from '@/server/integrations/apollo-client';
import { hasApolloApiKey } from '@/server/services/apollo-connection';
import { HR_DEPARTMENTS, TARGET_SENIORITIES } from './apollo-people-adapter';

/** Tope duro de per_page en diagnóstico (control de costo). */
const DIAGNOSTIC_PER_PAGE_CAP = 3;

/** Tope duro de llamadas a Apollo por ejecución (control de costo). */
export const MAX_DIAGNOSTIC_APOLLO_CALLS = 4;

/** Cantidad máxima de títulos de muestra (no PII) que exponemos. */
const SAMPLE_TITLES_CAP = 3;

/** Longitud máxima de un mensaje de error de proveedor reportado. */
const ERROR_MESSAGE_CAP = 160;

// ── Tipos de salida (solo metadata segura) ─────────────────────

export interface OrgSearchDiagnostic {
  ran: boolean;
  found: boolean;
  organizationsCount: number;
  firstOrganizationId?: string;
  firstOrganizationName?: string;
  firstOrganizationDomain?: string;
  httpError?: string;
}

export interface PeopleSearchDiagnostic {
  ran: boolean;
  rawResultsCount: number;
  totalEntries?: number;
  /** Hasta 3 títulos/headlines de muestra. NUNCA nombres, emails ni teléfonos. */
  sampleTitles?: string[];
  skippedReason?: string;
  httpError?: string;
}

export interface ApolloContactDiagnosticsResult {
  status: 'completed' | 'error';
  apolloCallsUsed: number;
  test1OrgByDomain: OrgSearchDiagnostic;
  /**
   * Organization search por nombre. Corre cuando el dominio no resolvió
   * organización y queda presupuesto. Determina si se puede obtener un
   * organization_id por nombre (para un fix basado en organization_ids).
   */
  test1bOrgByName: OrgSearchDiagnostic;
  test2PeopleByDomain: PeopleSearchDiagnostic;
  test3PeopleByOrgId: PeopleSearchDiagnostic;
  test4PeopleByOrgIdWithHrFilters: PeopleSearchDiagnostic;
  /**
   * Sonda decisiva dominio-vs-nombre: people search por q_organization_name.
   * Solo corre cuando el dominio no resolvió organización y queda presupuesto.
   * Si trae personas mientras el dominio devuelve 0, el culpable es el filtro
   * por dominio (contrato), no la cobertura/permisos del plan.
   */
  test5PeopleByName: PeopleSearchDiagnostic;
  probableRootCause: string;
  recommendation: string;
  reason?: string;
}

export interface ApolloContactDiagnosticsInput {
  companyDomain: string;
  companyName?: string;
  /** per_page solicitado; se capa a 3. */
  perPage?: number;
}

export interface ApolloContactDiagnosticsDeps {
  isConnected?: () => Promise<boolean>;
  searchOrganizations?: (
    params: SearchOrganizationsParams,
  ) => Promise<ApolloSearchResult<ApolloOrganization>>;
  searchPeople?: (params: SearchPeopleParams) => Promise<ApolloSearchResult<ApolloPerson>>;
}

// ── Helpers de extracción segura ───────────────────────────────

function truncateError(error?: { error: string; message: string }): string | undefined {
  if (!error) return undefined;
  const msg = `${error.error}: ${error.message ?? ''}`.trim();
  return msg.length > ERROR_MESSAGE_CAP ? `${msg.slice(0, ERROR_MESSAGE_CAP)}…` : msg;
}

/** Extrae solo títulos/headlines (no PII) de los resultados de people search. */
function safeSampleTitles(people: ApolloPerson[]): string[] {
  return people
    .slice(0, SAMPLE_TITLES_CAP)
    .map((p) => p.title?.trim() || p.headline?.trim() || '')
    .filter((t) => t.length > 0);
}

function toOrgDiagnostic(result: ApolloSearchResult<ApolloOrganization>): OrgSearchDiagnostic {
  if (!result.success) {
    return {
      ran: true,
      found: false,
      organizationsCount: 0,
      httpError: truncateError(result.error),
    };
  }
  const data = result.data ?? [];
  const first = data[0];
  return {
    ran: true,
    found: data.length > 0,
    organizationsCount: data.length,
    firstOrganizationId: first?.id,
    firstOrganizationName: first?.name ?? undefined,
    firstOrganizationDomain: first?.website_url ?? undefined,
  };
}

function notRunOrg(): OrgSearchDiagnostic {
  return { ran: false, found: false, organizationsCount: 0 };
}

function toPeopleDiagnostic(result: ApolloSearchResult<ApolloPerson>): PeopleSearchDiagnostic {
  if (!result.success) {
    return { ran: true, rawResultsCount: 0, httpError: truncateError(result.error) };
  }
  const data = result.data ?? [];
  return {
    ran: true,
    rawResultsCount: data.length,
    totalEntries: result.total,
    sampleTitles: safeSampleTitles(data),
  };
}

function notRunPeople(reason: string): PeopleSearchDiagnostic {
  return { ran: false, rawResultsCount: 0, skippedReason: reason };
}

// ── Análisis de causa raíz ─────────────────────────────────────

interface RootCause {
  probableRootCause: string;
  recommendation: string;
}

function analyzeRootCause(
  orgByDomain: OrgSearchDiagnostic,
  orgByName: OrgSearchDiagnostic,
  byDomain: PeopleSearchDiagnostic,
  byOrgId: PeopleSearchDiagnostic,
  byOrgIdHr: PeopleSearchDiagnostic,
  byName: PeopleSearchDiagnostic,
): RootCause {
  const orgIdTried = byOrgId.ran;
  const orgIdWorks = byOrgId.ran && byOrgId.rawResultsCount > 0;
  const domainWorks = byDomain.ran && byDomain.rawResultsCount > 0;
  const nameWorks = byName.ran && byName.rawResultsCount > 0;
  const orgResolvedByName = orgByName.found;
  const hrZeroed = byOrgIdHr.ran && byOrgIdHr.rawResultsCount === 0;
  const anyHttpError =
    [byDomain, byOrgId, byOrgIdHr, byName].some((t) => t.httpError) ||
    orgByDomain.httpError ||
    orgByName.httpError;

  if (anyHttpError) {
    return {
      probableRootCause:
        'Apollo respondió con error HTTP en al menos una llamada (posible permisos/Master Key/cobertura del plan).',
      recommendation:
        'Revisar permisos de la API key (People Search puede requerir Master Key) antes de seguir ajustando filtros.',
    };
  }

  if (domainWorks && hrZeroed) {
    return {
      probableRootCause:
        'People search por dominio devuelve personas, pero los filtros HR/seniority las dejan en 0.',
      recommendation:
        'Relajar el intento amplio a org-only (sin seniority/title/department) y clasificar relevancia en el normalizer.',
    };
  }

  // Caso confirmado (Bancolombia): la organización existe (resuelta por nombre),
  // pero ni el dominio ni organization_ids traen personas en mixed_people/api_search.
  // El único filtro de organización que funciona es q_organization_name.
  if (nameWorks && !domainWorks && !orgIdWorks) {
    const orgIdNote = orgIdTried
      ? ' organization_ids tampoco trae personas (api_search no lo honra en este plan).'
      : '';
    return {
      probableRootCause:
        `People search por q_organization_name SÍ trae personas, pero por dominio (q_organization_domains) devuelve 0.${orgIdNote} El culpable es el filtro de organización, no la cobertura/permisos.`,
      recommendation:
        'Usar q_organization_name como filtro de organización principal/fallback en people search; el dominio y organization_ids no son fiables en este plan. Hay cobertura y permisos.',
    };
  }

  if (orgIdWorks && !domainWorks) {
    return {
      probableRootCause:
        'El filtro por dominio (q_organization_domains) no matchea la organización, pero organization_ids sí trae personas.',
      recommendation:
        'Resolver primero la organización y usar organization_ids como filtro principal; dominio solo como fallback.',
    };
  }

  // La organización existe por nombre pero ni dominio ni organization_ids traen
  // personas, y no se pudo confirmar el camino por nombre (presupuesto). Aun así,
  // hay cobertura: el siguiente paso es probar q_organization_name.
  if (orgResolvedByName && !domainWorks && orgIdTried && !orgIdWorks && !byName.ran) {
    return {
      probableRootCause:
        'La organización existe (resuelta por nombre) pero ni q_organization_domains ni organization_ids traen personas en api_search.',
      recommendation:
        'Probar q_organization_name como filtro de organización: hay cobertura (la org existe), el problema es el filtro estructurado por dominio/id.',
    };
  }

  if (!orgByDomain.found && !orgResolvedByName && !domainWorks && !nameWorks) {
    return {
      probableRootCause:
        'Apollo no resuelve la organización (ni por dominio ni por nombre) y people search no devuelve personas por ningún método.',
      recommendation:
        'Parece limitación de cobertura/permisos/configuración de Apollo. No seguir gastando llamadas hasta verificar el plan.',
    };
  }

  if (!domainWorks && !orgIdWorks && !nameWorks) {
    return {
      probableRootCause:
        'Ningún método (dominio, organization_id ni nombre) devuelve personas.',
      recommendation:
        'Parece limitación de cobertura/permisos/configuración de Apollo. No seguir gastando llamadas hasta verificar el plan.',
    };
  }

  return {
    probableRootCause: 'People search funciona; los filtros actuales son razonables.',
    recommendation: 'No se requiere ajuste del adapter según el diagnóstico.',
  };
}

// ── Diagnóstico principal ──────────────────────────────────────

/**
 * Ejecuta el diagnóstico controlado de Apollo people search.
 * Máximo 4 llamadas a Apollo, per_page tope 3, sin exponer PII.
 */
export async function runApolloContactDiagnostics(
  input: ApolloContactDiagnosticsInput,
  deps: ApolloContactDiagnosticsDeps = {},
): Promise<ApolloContactDiagnosticsResult> {
  const {
    isConnected = hasApolloApiKey,
    searchOrganizations = searchApolloOrganizations,
    searchPeople = searchApolloPeople,
  } = deps;

  const domain = input.companyDomain?.trim();
  const perPage = Math.max(1, Math.min(input.perPage ?? DIAGNOSTIC_PER_PAGE_CAP, DIAGNOSTIC_PER_PAGE_CAP));

  const empty: ApolloContactDiagnosticsResult = {
    status: 'error',
    apolloCallsUsed: 0,
    test1OrgByDomain: notRunOrg(),
    test1bOrgByName: notRunOrg(),
    test2PeopleByDomain: notRunPeople('no ejecutado'),
    test3PeopleByOrgId: notRunPeople('no ejecutado'),
    test4PeopleByOrgIdWithHrFilters: notRunPeople('no ejecutado'),
    test5PeopleByName: notRunPeople('no ejecutado'),
    probableRootCause: '',
    recommendation: '',
  };

  if (!domain) {
    return { ...empty, reason: 'Falta companyDomain para ejecutar el diagnóstico' };
  }

  const connected = await isConnected();
  if (!connected) {
    return { ...empty, reason: 'Apollo no está conectado o no tiene credenciales disponibles' };
  }

  let calls = 0;

  // ── Test 1 — Organization search por dominio ──────────────────
  const test1 = toOrgDiagnostic(
    await searchOrganizations({ q_organization_domains: [domain], per_page: perPage }),
  );
  calls += 1;

  // ── Test 2 — People search por dominio, sin filtros ───────────
  const test2 = toPeopleDiagnostic(
    await searchPeople({ q_organization_domains: [domain], per_page: perPage }),
  );
  calls += 1;

  // ── Test 1b — Organization search por nombre (si el dominio no resolvió) ──
  // Determina si se puede obtener un organization_id por nombre, lo que habilita
  // un fix basado en organization_ids (filtro de org más fiable que el dominio).
  let test1b: OrgSearchDiagnostic;
  const nameForOrg = input.companyName?.trim();
  if (nameForOrg && !test1.found && calls < MAX_DIAGNOSTIC_APOLLO_CALLS) {
    test1b = toOrgDiagnostic(
      await searchOrganizations({ q_organization_name: nameForOrg, per_page: perPage }),
    );
    calls += 1;
  } else {
    test1b = notRunOrg();
  }

  // ── Test 3 — People search por organization_id, sin filtros ───
  // Usa el organization_id resuelto por dominio o, en su defecto, por nombre.
  let test3: PeopleSearchDiagnostic;
  const orgId = test1.firstOrganizationId ?? test1b.firstOrganizationId;
  if (orgId && calls < MAX_DIAGNOSTIC_APOLLO_CALLS) {
    test3 = toPeopleDiagnostic(await searchPeople({ organization_ids: [orgId], per_page: perPage }));
    calls += 1;
  } else {
    test3 = notRunPeople(
      orgId ? 'presupuesto de llamadas agotado' : 'no se resolvió organization_id (ni dominio ni nombre)',
    );
  }

  // ── Test 4 — People search por organization_id + HR/seniority ──
  // Solo si Test 3 trajo personas (y queda presupuesto). Aplica los filtros
  // estrictos de producción (department HR + seniorities) para ver si son la
  // causa de los 0 resultados.
  let test4: PeopleSearchDiagnostic;
  if (orgId && test3.ran && test3.rawResultsCount > 0 && calls < MAX_DIAGNOSTIC_APOLLO_CALLS) {
    test4 = toPeopleDiagnostic(
      await searchPeople({
        organization_ids: [orgId],
        person_department_or_subdepartments: HR_DEPARTMENTS,
        person_seniorities: TARGET_SENIORITIES,
        per_page: perPage,
      }),
    );
    calls += 1;
  } else if (!orgId) {
    test4 = notRunPeople('Test 1 no resolvió organization_id');
  } else if (!test3.ran || test3.rawResultsCount === 0) {
    test4 = notRunPeople('Test 3 no trajo personas');
  } else {
    test4 = notRunPeople('presupuesto de llamadas agotado');
  }

  // ── Test 5 — People search por q_organization_name (sonda dominio-vs-nombre) ──
  // Decisiva cuando el dominio no resolvió organización: si el nombre SÍ trae
  // personas, el problema es el filtro por dominio, no la cobertura/permisos.
  // Solo corre si hay nombre, no se gastó el presupuesto en el camino org_id, y
  // queda cupo.
  let test5: PeopleSearchDiagnostic;
  const name = input.companyName?.trim();
  if (name && calls < MAX_DIAGNOSTIC_APOLLO_CALLS) {
    test5 = toPeopleDiagnostic(
      await searchPeople({ q_organization_name: name, per_page: perPage }),
    );
    calls += 1;
  } else if (!name) {
    test5 = notRunPeople('sin companyName para sondear por nombre');
  } else {
    test5 = notRunPeople('presupuesto de llamadas agotado');
  }

  const { probableRootCause, recommendation } = analyzeRootCause(
    test1,
    test1b,
    test2,
    test3,
    test4,
    test5,
  );

  return {
    status: 'completed',
    apolloCallsUsed: calls,
    test1OrgByDomain: test1,
    test1bOrgByName: test1b,
    test2PeopleByDomain: test2,
    test3PeopleByOrgId: test3,
    test4PeopleByOrgIdWithHrFilters: test4,
    test5PeopleByName: test5,
    probableRootCause,
    recommendation,
  };
}
