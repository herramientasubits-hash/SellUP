/**
 * A1-APOLLO-WIZARD-1 — Contrato de request de Apollo Organization Search.
 *
 * Endpoint único cubierto por este contrato:
 *   POST https://api.apollo.io/api/v1/mixed_companies/search
 *
 * Este módulo es la ÚNICA autoridad sobre qué parámetros salen hacia Apollo.
 * Es puro: sin env, sin fetch, sin Supabase, sin secretos. No conoce la API key
 * (la autenticación vive en apollo-client.ts, server-only) y nunca la recibe.
 *
 * Por qué existe:
 *   Antes de este hito, el body se construía por spread en el query mapper, así
 *   que cualquier campo que alguien añadiera al objeto viajaba a Apollo sin
 *   revisión. Apollo confirmó que `mixed_companies/search` NO soporta los
 *   filtros SIC/NAICS: enviarlos produce un filtrado silencioso o un 422. Un
 *   allowlist explícito convierte ese riesgo en un error visible y testeable.
 *
 * Reglas:
 *   - Allowlist estricto: un parámetro que no esté en APOLLO_ORGANIZATIONS_ALLOWED_PARAMS
 *     nunca se envía.
 *   - Los parámetros prohibidos se rechazan de forma explícita y nombrada, no
 *     se descartan en silencio.
 *   - Los desconocidos también se reportan — "no enviar parámetros desconocidos
 *     silenciosamente" es un requisito, no una cortesía.
 *   - No muta el input.
 */

// ─── Allowlist / denylist ─────────────────────────────────────────────────────

/**
 * Parámetros soportados actualmente por el wizard contra mixed_companies/search.
 * Ampliar esta lista requiere: documentación vigente de Apollo + caso real en el
 * wizard + tipado + tests. Ese es el criterio, no la conveniencia.
 */
export const APOLLO_ORGANIZATIONS_ALLOWED_PARAMS = [
  'organization_locations',
  'organization_not_locations',
  'organization_num_employees_ranges',
  'q_organization_keyword_tags',
  'q_organization_name',
  'q_organization_domains_list',
  'revenue_range',
  'currently_using_any_of_technology_uids',
  'page',
  'per_page',
] as const;

export type ApolloOrganizationsAllowedParam =
  (typeof APOLLO_ORGANIZATIONS_ALLOWED_PARAMS)[number];

/**
 * Parámetros que Apollo confirmó como NO soportados por mixed_companies/search.
 * Se rechazan por nombre para que un intento de reintroducirlos falle ruidoso.
 */
export const APOLLO_ORGANIZATIONS_FORBIDDEN_PARAMS = [
  'organization_sic_codes',
  'organization_naics_codes',
  'not_organization_sic_codes',
  'not_organization_naics_codes',
] as const;

export type ApolloOrganizationsForbiddenParam =
  (typeof APOLLO_ORGANIZATIONS_FORBIDDEN_PARAMS)[number];

// ─── Límites del contrato ─────────────────────────────────────────────────────

/** Apollo rechaza per_page > 100. Techo del contrato, no del presupuesto. */
export const APOLLO_MAX_PER_PAGE = 100;
/** Apollo pagina desde 1. */
export const APOLLO_MIN_PAGE = 1;
/** Tope defensivo por array de filtro — evita requests desmedidos por criterio libre. */
export const APOLLO_MAX_FILTER_VALUES = 25;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Rango de facturación. Ambos extremos opcionales; se emite solo lo presente. */
export type ApolloRevenueRange = {
  min?: number | null;
  max?: number | null;
};

/**
 * Entrada cruda del wizard, antes de limpieza. Todo opcional: el wizard no
 * siempre tiene tecnología, facturación ni nombre explícito.
 */
export type ApolloOrganizationsRequestInput = {
  locations?: readonly (string | null | undefined)[] | null;
  notLocations?: readonly (string | null | undefined)[] | null;
  employeeRanges?: readonly (string | null | undefined)[] | null;
  keywordTags?: readonly (string | null | undefined)[] | null;
  organizationName?: string | null;
  domainsList?: readonly (string | null | undefined)[] | null;
  revenueRange?: ApolloRevenueRange | null;
  technologyUids?: readonly (string | null | undefined)[] | null;
  page: number;
  perPage: number;
  /**
   * Parámetros adicionales propuestos por un caller. Se validan contra el
   * allowlist: los prohibidos y los desconocidos se reportan y NO se envían.
   */
  extraParams?: Readonly<Record<string, unknown>> | null;
};

/** Motivo por el que un filtro no viajó a Apollo. Códigos estáticos, seguros de loggear. */
export type ApolloOmittedFilterReason =
  | 'empty_after_cleanup'
  | 'not_provided'
  | 'forbidden_parameter'
  | 'unknown_parameter'
  | 'invalid_value'
  | 'truncated_to_limit';

export type ApolloOmittedFilter = {
  param: string;
  reason: ApolloOmittedFilterReason;
  /** Cuántos valores se descartaron, cuando aplica (dedup / truncado). */
  droppedCount?: number;
};

/** Body listo para `JSON.stringify` — sólo claves del allowlist. */
export type ApolloOrganizationsRequestBody = {
  organization_locations?: string[];
  organization_not_locations?: string[];
  organization_num_employees_ranges?: string[];
  q_organization_keyword_tags?: string[];
  q_organization_name?: string;
  q_organization_domains_list?: string[];
  revenue_range?: { min?: number; max?: number };
  currently_using_any_of_technology_uids?: string[];
  page: number;
  per_page: number;
};

export type ApolloOrganizationsRequestContract = {
  body: ApolloOrganizationsRequestBody;
  /** Filtros que el caller propuso y no viajaron, con motivo. Para trazabilidad. */
  omittedFilters: ApolloOmittedFilter[];
  /** Nombres de parámetros prohibidos que un caller intentó enviar. */
  rejectedForbiddenParams: string[];
  /** Nombres fuera del allowlist que un caller intentó enviar. */
  rejectedUnknownParams: string[];
  /** Claves realmente presentes en el body. Diagnóstico sin valores. */
  sentParamKeys: string[];
  /** Huella estable de los filtros — base de la clave idempotente por página. */
  filtersFingerprint: string;
  /**
   * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 1 — huella del request EFECTIVO,
   * `page` incluida.
   *
   * `filtersFingerprint` excluye la página a propósito: es el ancla idempotente
   * de una búsqueda paginada, y la página 2 de los mismos filtros debe compartir
   * ancla con la 1. Pero para decidir si una SEGUNDA ronda puede traer algo
   * nuevo, la página es justamente lo que puede cambiar la respuesta. Dos huellas
   * distintas para dos preguntas distintas, derivadas del MISMO body.
   */
  effectiveRequestFingerprint: string;
};

// ─── Helpers puros ────────────────────────────────────────────────────────────

/** Limpia, deduplica (case-insensitive) y trunca. Nunca muta el input. */
function cleanStringArray(
  values: readonly (string | null | undefined)[] | null | undefined,
): { cleaned: string[]; droppedCount: number } {
  if (!values) return { cleaned: [], droppedCount: 0 };

  const seen = new Set<string>();
  const cleaned: string[] = [];
  let droppedCount = 0;

  for (const raw of values) {
    if (typeof raw !== 'string') { droppedCount++; continue; }
    const trimmed = raw.trim();
    if (!trimmed) { droppedCount++; continue; }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) { droppedCount++; continue; }
    seen.add(key);
    if (cleaned.length >= APOLLO_MAX_FILTER_VALUES) { droppedCount++; continue; }
    cleaned.push(trimmed);
  }

  return { cleaned, droppedCount };
}

function clampPage(page: number): number {
  if (!Number.isFinite(page)) return APOLLO_MIN_PAGE;
  return Math.max(APOLLO_MIN_PAGE, Math.floor(page));
}

function clampPerPage(perPage: number): number {
  if (!Number.isFinite(perPage) || perPage < 1) return 1;
  return Math.min(APOLLO_MAX_PER_PAGE, Math.floor(perPage));
}

/** Solo números finitos y no negativos cuentan como extremo de facturación. */
function normalizeRevenueBound(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function isForbiddenParam(name: string): boolean {
  return (APOLLO_ORGANIZATIONS_FORBIDDEN_PARAMS as readonly string[]).includes(name);
}

function isAllowedParam(name: string): boolean {
  return (APOLLO_ORGANIZATIONS_ALLOWED_PARAMS as readonly string[]).includes(name);
}

/**
 * Huella determinista de los filtros efectivos (sin page). Dos ejecuciones con
 * los mismos filtros producen la misma huella, así que la clave idempotente por
 * página es estable entre reintentos.
 */
function buildFiltersFingerprint(body: ApolloOrganizationsRequestBody): string {
  return fingerprintBody(body, { includePage: false });
}

/**
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 1 — huella del body EFECTIVO, `page`
 * incluida.
 *
 * Única función que la decisión económica de la ronda 2 puede usar: se calcula
 * sobre el body ya construido por este contrato, es decir, después de la
 * prioridad de términos, de la deduplicación y del truncamiento. Comparar
 * hipótesis antes de todo eso declara distintas dos rondas que envían lo mismo.
 */
export function buildApolloEffectiveRequestFingerprint(
  body: ApolloOrganizationsRequestBody,
): string {
  return fingerprintBody(body, { includePage: true });
}

function fingerprintBody(
  body: ApolloOrganizationsRequestBody,
  options: { includePage: boolean },
): string {
  const entries = Object.entries(body)
    .filter(([key]) => options.includePage || key !== 'page')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}=${[...value].map((v) => String(v).toLowerCase()).sort().join(',')}`;
      }
      if (value !== null && typeof value === 'object') {
        return `${key}=${Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${String(v)}`)
          .join(',')}`;
      }
      return `${key}=${String(value).toLowerCase()}`;
    });
  return entries.join('|');
}

// ─── Constructor principal ────────────────────────────────────────────────────

/**
 * Construye el body de Apollo Organization Search desde criterios del wizard.
 *
 * Puro y sin mutación. Todo lo que no viaja queda reportado en `omittedFilters`,
 * `rejectedForbiddenParams` o `rejectedUnknownParams`, nunca descartado en
 * silencio.
 */
export function buildApolloOrganizationsRequestContract(
  input: ApolloOrganizationsRequestInput,
): ApolloOrganizationsRequestContract {
  const omittedFilters: ApolloOmittedFilter[] = [];
  const body: ApolloOrganizationsRequestBody = {
    page: clampPage(input.page),
    per_page: clampPerPage(input.perPage),
  };

  if (Number.isFinite(input.perPage) && input.perPage > APOLLO_MAX_PER_PAGE) {
    omittedFilters.push({ param: 'per_page', reason: 'truncated_to_limit' });
  }

  // ── Arrays de filtro ────────────────────────────────────────────────────────
  const arrayFilters: Array<{
    param: keyof ApolloOrganizationsRequestBody;
    values: readonly (string | null | undefined)[] | null | undefined;
  }> = [
    { param: 'organization_locations', values: input.locations },
    { param: 'organization_not_locations', values: input.notLocations },
    { param: 'organization_num_employees_ranges', values: input.employeeRanges },
    { param: 'q_organization_keyword_tags', values: input.keywordTags },
    { param: 'q_organization_domains_list', values: input.domainsList },
    { param: 'currently_using_any_of_technology_uids', values: input.technologyUids },
  ];

  for (const { param, values } of arrayFilters) {
    if (values === null || values === undefined) {
      omittedFilters.push({ param, reason: 'not_provided' });
      continue;
    }
    const { cleaned, droppedCount } = cleanStringArray(values);
    if (cleaned.length === 0) {
      omittedFilters.push({ param, reason: 'empty_after_cleanup', droppedCount });
      continue;
    }
    // El índice está acotado al allowlist por construcción de arrayFilters.
    (body as Record<string, unknown>)[param] = cleaned;
    if (droppedCount > 0) {
      omittedFilters.push({ param, reason: 'truncated_to_limit', droppedCount });
    }
  }

  // ── Nombre empresarial explícito ────────────────────────────────────────────
  const name = typeof input.organizationName === 'string' ? input.organizationName.trim() : '';
  if (name) {
    body.q_organization_name = name;
  } else {
    omittedFilters.push({
      param: 'q_organization_name',
      reason: input.organizationName == null ? 'not_provided' : 'empty_after_cleanup',
    });
  }

  // ── Rango de facturación ────────────────────────────────────────────────────
  const revenueMin = normalizeRevenueBound(input.revenueRange?.min);
  const revenueMax = normalizeRevenueBound(input.revenueRange?.max);
  if (revenueMin !== null || revenueMax !== null) {
    // Un rango invertido es un error de criterio, no algo que Apollo deba resolver.
    if (revenueMin !== null && revenueMax !== null && revenueMin > revenueMax) {
      omittedFilters.push({ param: 'revenue_range', reason: 'invalid_value' });
    } else {
      body.revenue_range = {
        ...(revenueMin !== null ? { min: revenueMin } : {}),
        ...(revenueMax !== null ? { max: revenueMax } : {}),
      };
    }
  } else {
    omittedFilters.push({ param: 'revenue_range', reason: 'not_provided' });
  }

  // ── Parámetros extra propuestos por el caller ───────────────────────────────
  const rejectedForbiddenParams: string[] = [];
  const rejectedUnknownParams: string[] = [];

  for (const [key, value] of Object.entries(input.extraParams ?? {})) {
    if (isForbiddenParam(key)) {
      rejectedForbiddenParams.push(key);
      omittedFilters.push({ param: key, reason: 'forbidden_parameter' });
      continue;
    }
    if (!isAllowedParam(key)) {
      rejectedUnknownParams.push(key);
      omittedFilters.push({ param: key, reason: 'unknown_parameter' });
      continue;
    }
    // Un extra permitido nunca pisa lo que ya resolvieron los campos tipados:
    // el criterio estructurado del wizard manda sobre el paso-a-través.
    if (key in body) continue;
    if (value === null || value === undefined) {
      omittedFilters.push({ param: key, reason: 'invalid_value' });
      continue;
    }
    (body as Record<string, unknown>)[key] = value;
  }

  return {
    body,
    omittedFilters,
    rejectedForbiddenParams,
    rejectedUnknownParams,
    sentParamKeys: Object.keys(body).sort(),
    filtersFingerprint: buildFiltersFingerprint(body),
    effectiveRequestFingerprint: buildApolloEffectiveRequestFingerprint(body),
  };
}

/**
 * Verifica que un body ya construido no contenga parámetros prohibidos ni
 * desconocidos. Defensa en profundidad para el borde de red: aunque el
 * constructor sea correcto hoy, esto impide que un objeto armado a mano llegue
 * a Apollo mañana.
 */
export function assertApolloOrganizationsBodySafe(body: Record<string, unknown>): void {
  const forbidden = Object.keys(body).filter(isForbiddenParam);
  if (forbidden.length > 0) {
    throw new Error(
      `apollo_organizations_forbidden_params: ${forbidden.sort().join(',')}`,
    );
  }
  const unknown = Object.keys(body).filter((key) => !isAllowedParam(key));
  if (unknown.length > 0) {
    throw new Error(
      `apollo_organizations_unknown_params: ${unknown.sort().join(',')}`,
    );
  }
}
