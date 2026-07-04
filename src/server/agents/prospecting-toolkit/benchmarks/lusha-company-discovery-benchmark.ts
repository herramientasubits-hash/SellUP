/**
 * Lusha Company Discovery — Microbenchmark Dry-Run (Q3F-5B)
 *
 * ESTADO: EXPERIMENTAL · AISLADO · SIN PRODUCCIÓN
 *
 * Este módulo prepara la infraestructura para evaluar en seco si
 * Lusha Company Discovery puede servir como fuente de prospección.
 * No valida todavía que Lusha sirva como discovery productivo.
 * Solo prepara el camino para una futura prueba real controlada.
 *
 * La prueba real requiere confirmar:
 *   - Contrato API / documentación oficial del endpoint
 *   - Pricing por llamada al endpoint /prospecting/search/companies
 *   - Disponibilidad en el plan de Lusha contratado
 *
 * Lusha sigue excluida de discovery productivo (classification: validation_only).
 * source-catalog NO se modifica en este hito.
 *
 * Garantías de este módulo:
 *   ✅ No hace llamadas reales a Lusha
 *   ✅ No hace llamadas a Apollo
 *   ✅ No escribe en prospect_candidates
 *   ✅ No escribe en accounts
 *   ✅ No escribe en provider_usage_logs
 *   ✅ No invoca writer ni duplicate-checker productivo
 *   ✅ No activa ningún provider real
 *   ✅ No cambia source-catalog
 *   ✅ No consume créditos
 *   ✅ credits_used = 0 / estimated_cost_usd = 0
 */

// ============================================================
// Tipos de input
// ============================================================

export type LushaCompanyDiscoveryBenchmarkScenario =
  | 'useful_results'
  | 'empty_result'
  | 'plan_not_authorized'   // HTTP 402
  | 'forbidden'             // HTTP 403
  | 'invalid_filter'        // filtros country/industry no aceptados
  | 'provider_error';

export interface LushaCompanyDiscoveryBenchmarkInput {
  country: string;
  industry: string;
  subindustry?: string;
  limit: number;
  scenario: LushaCompanyDiscoveryBenchmarkScenario;
  /** Debe ser true. Rechazado si false. */
  benchmark: true;
}

// ============================================================
// Tipos de output
// ============================================================

export type LushaCompanyDiscoveryBenchmarkOutcome =
  | 'success_candidate_pool'
  | 'empty_result'
  | 'plan_not_authorized'
  | 'forbidden'
  | 'invalid_filter'
  | 'failed';

export interface LushaCompanyDiscoveryBenchmarkMetrics {
  raw_returned: number;
  has_domain_count: number;
  country_match_count: number;
  industry_plausible_count: number;
  /** Simulado — no usa gates reales en Q3F-5B */
  post_gate_candidate_count: number;
  false_positive_rate: number | null;
  fields_completeness: number | null;
  outcome: LushaCompanyDiscoveryBenchmarkOutcome;
}

export interface LushaCompanyDiscoveryBenchmarkResult {
  // Metadata obligatoria de trazabilidad
  provider_key: 'lusha';
  operation_key: 'company_discovery_benchmark_dry_run';
  provider_role: 'lusha_company_discovery_experimental';
  benchmark: true;
  dry_run: true;
  writes_disabled: true;
  source_catalog_unchanged: true;
  credits_used: 0;
  estimated_cost_usd: 0;
  /** Mínimo de pagination.size observado en smoke test real Q3F-5E. */
  smoke_test_minimum_page_size_observed: 10;
  /**
   * Q3F-5F confirmó que filters debe ser objeto, no array.
   * Enviar array produce HTTP 400: "filters must be an object".
   */
  filters_shape_observed: 'object';
  /** Clave observada en cada entrada de GET /v3/companies/prospecting/filters. */
  filter_type_key_observed: 'filterType';
  /** Q3F-5H: filters:{} produce HTTP 400 "filters.Company filters cannot be empty". */
  empty_filters_rejected_observed: true;
  /** Q3F-5H: La API exige al menos un filterType con valores. */
  minimum_required_filter_observed: true;
  /** filterType candidato observado en Q3F-5F. Valores exactos sin confirmar (pendiente Q3F-5K). */
  next_filter_candidate: 'locations';
  /** Los valores válidos para next_filter_candidate no han sido confirmados en live test. */
  filter_values_unconfirmed: true;
  /** Q3F-5I: GET /filters/locations sin query → HTTP 400. locations requiere query string. */
  locations_requires_query_observed: true;
  /** Q3F-5I: Observado en shape GET /filters: names.requiresQuery=true. Mismo patrón que locations. */
  names_requires_query_observed: true;
  /** Q3F-5J: El client soporta ?query=... en getLushaCompanyProspectingFilterValues. */
  filter_values_query_param_supported: true;
  /** Candidato de query para el próximo live test (Q3F-5K). */
  next_location_query_candidate: 'Colombia';
  /** El id de location para "Colombia" no ha sido confirmado en live test. */
  location_value_id_unconfirmed: true;
  // ---- Q3F-5O metadata (schema anidado oficial confirmado Q3F-5N) ----
  /** Q3F-5N confirmó el schema anidado vía OpenAPI oficial de Lusha V3. */
  official_openapi_schema_confirmed: true;
  /** Nesting observado en OpenAPI: locations/sizes van dentro de filters.companies.include. */
  filters_nesting_observed: 'filters.companies.include';
  /** pagination.page es base 0 según OpenAPI oficial (no base 1). */
  pagination_page_base: 'zero_based';
  /** options.includePartialProfiles=false es el default a enviar siempre. */
  options_include_partial_profiles_default: false;
  /** locations usa objeto reducido { country } en el POST, no string ni country_grouping. */
  locations_post_value_shape: 'country_object';
  /** sizes usa rangos numéricos { min, max } en el POST, no strings. */
  sizes_post_value_shape: 'numeric_range_object';

  // Resultado del escenario
  scenario: LushaCompanyDiscoveryBenchmarkScenario;
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>;
  metrics: LushaCompanyDiscoveryBenchmarkMetrics;

  /** Notas sobre filtros si el escenario es invalid_filter */
  filter_notes?: string;
  /** Mensaje de error si el escenario requiere detener evaluación futura */
  stop_reason?: string;
}

// ============================================================
// Mock de empresa Lusha (solo para simulación interna)
// ============================================================

interface MockLushaCompany {
  name: string;
  domain: string | null;
  country: string | null;
  industry: string | null;
  employeeCount: number | null;
}

// ============================================================
// Función principal
// ============================================================

/**
 * Ejecuta un benchmark DRY-RUN de Lusha Company Discovery.
 *
 * No realiza ninguna llamada HTTP real.
 * No escribe en ninguna base de datos.
 * No consume créditos.
 *
 * El comportamiento depende de `input.scenario`, que simula
 * distintas respuestas posibles de la API de Lusha.
 */
export function runLushaCompanyDiscoveryBenchmarkDryRun(
  input: LushaCompanyDiscoveryBenchmarkInput
): LushaCompanyDiscoveryBenchmarkResult {
  const baseMetadata = {
    provider_key: 'lusha' as const,
    operation_key: 'company_discovery_benchmark_dry_run' as const,
    provider_role: 'lusha_company_discovery_experimental' as const,
    benchmark: true as const,
    dry_run: true as const,
    writes_disabled: true as const,
    source_catalog_unchanged: true as const,
    credits_used: 0 as const,
    estimated_cost_usd: 0 as const,
    smoke_test_minimum_page_size_observed: 10 as const,
    filters_shape_observed: 'object' as const,
    filter_type_key_observed: 'filterType' as const,
    empty_filters_rejected_observed: true as const,
    minimum_required_filter_observed: true as const,
    next_filter_candidate: 'locations' as const,
    filter_values_unconfirmed: true as const,
    locations_requires_query_observed: true as const,
    names_requires_query_observed: true as const,
    filter_values_query_param_supported: true as const,
    next_location_query_candidate: 'Colombia' as const,
    location_value_id_unconfirmed: true as const,
    official_openapi_schema_confirmed: true as const,
    filters_nesting_observed: 'filters.companies.include' as const,
    pagination_page_base: 'zero_based' as const,
    options_include_partial_profiles_default: false as const,
    locations_post_value_shape: 'country_object' as const,
    sizes_post_value_shape: 'numeric_range_object' as const,
  };

  const safeInput: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'> = {
    country: input.country,
    industry: input.industry,
    subindustry: input.subindustry,
    limit: input.limit,
    scenario: input.scenario,
  };

  switch (input.scenario) {
    case 'useful_results':
      return handleUsefulResults(baseMetadata, safeInput);

    case 'empty_result':
      return handleEmptyResult(baseMetadata, safeInput);

    case 'plan_not_authorized':
      return handlePlanNotAuthorized(baseMetadata, safeInput);

    case 'forbidden':
      return handleForbidden(baseMetadata, safeInput);

    case 'invalid_filter':
      return handleInvalidFilter(baseMetadata, safeInput);

    case 'provider_error':
      return handleProviderError(baseMetadata, safeInput);
  }
}

// ============================================================
// Handlers por escenario
// ============================================================

function handleUsefulResults(
  base: ReturnType<typeof buildBase>,
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>
): LushaCompanyDiscoveryBenchmarkResult {
  const mockCompanies: MockLushaCompany[] = [
    { name: 'Empresa Alpha SAS', domain: 'empresaalpha.com', country: input.country, industry: input.industry, employeeCount: 120 },
    { name: 'Beta Corp', domain: 'betacorp.co', country: input.country, industry: input.industry, employeeCount: 45 },
    { name: 'Gamma Ltd', domain: null, country: input.country, industry: 'Other', employeeCount: 300 },
    { name: 'Delta Inc', domain: 'deltainc.com', country: 'US', industry: input.industry, employeeCount: null },
  ];

  const limited = mockCompanies.slice(0, input.limit);
  const metrics = computeMetrics(limited, input.country, input.industry, 'success_candidate_pool');

  return { ...base, scenario: input.scenario, input, metrics };
}

function handleEmptyResult(
  base: ReturnType<typeof buildBase>,
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>
): LushaCompanyDiscoveryBenchmarkResult {
  return {
    ...base,
    scenario: input.scenario,
    input,
    metrics: zeroMetrics('empty_result'),
  };
}

function handlePlanNotAuthorized(
  base: ReturnType<typeof buildBase>,
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>
): LushaCompanyDiscoveryBenchmarkResult {
  return {
    ...base,
    scenario: input.scenario,
    input,
    metrics: zeroMetrics('plan_not_authorized'),
    stop_reason: 'HTTP 402: endpoint /v3/companies/prospecting no incluido en el plan de Lusha (créditos insuficientes o feature no habilitada). Detener evaluación de discovery hasta confirmar contrato.',
  };
}

function handleForbidden(
  base: ReturnType<typeof buildBase>,
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>
): LushaCompanyDiscoveryBenchmarkResult {
  return {
    ...base,
    scenario: input.scenario,
    input,
    metrics: zeroMetrics('forbidden'),
    stop_reason: 'HTTP 403: acceso prohibido al endpoint de Lusha Company Discovery. Detener evaluación hasta aclarar permisos.',
  };
}

function handleInvalidFilter(
  base: ReturnType<typeof buildBase>,
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>
): LushaCompanyDiscoveryBenchmarkResult {
  return {
    ...base,
    scenario: input.scenario,
    input,
    metrics: zeroMetrics('invalid_filter'),
    filter_notes: `Los filtros country="${input.country}" e industry="${input.industry}" no fueron aceptados o produjeron error. No se realiza normalización especulativa. Requiere verificar valores aceptados en documentación oficial de Lusha.`,
  };
}

function handleProviderError(
  base: ReturnType<typeof buildBase>,
  input: Omit<LushaCompanyDiscoveryBenchmarkInput, 'benchmark'>
): LushaCompanyDiscoveryBenchmarkResult {
  return {
    ...base,
    scenario: input.scenario,
    input,
    metrics: zeroMetrics('failed'),
    stop_reason: 'Error de proveedor simulado. Requiere diagnóstico antes de continuar.',
  };
}

// ============================================================
// Utilidades de métricas
// ============================================================

function computeMetrics(
  companies: MockLushaCompany[],
  targetCountry: string,
  targetIndustry: string,
  outcome: LushaCompanyDiscoveryBenchmarkOutcome
): LushaCompanyDiscoveryBenchmarkMetrics {
  const raw_returned = companies.length;
  const has_domain_count = companies.filter((c) => c.domain !== null && c.domain.length > 0).length;
  const country_match_count = companies.filter((c) => c.country === targetCountry).length;
  const industry_plausible_count = companies.filter((c) => c.industry === targetIndustry).length;
  // post_gate simulado conservador: requiere domain + country match
  const post_gate_candidate_count = companies.filter(
    (c) => c.domain !== null && c.country === targetCountry
  ).length;

  const false_positive_rate = raw_returned > 0
    ? parseFloat(((raw_returned - post_gate_candidate_count) / raw_returned).toFixed(4))
    : null;

  // Completitud de campos: name + domain + country + industry + employeeCount
  const totalFields = raw_returned * 5;
  const presentFields = companies.reduce((acc, c) => {
    return acc
      + 1 // name always present
      + (c.domain !== null ? 1 : 0)
      + (c.country !== null ? 1 : 0)
      + (c.industry !== null ? 1 : 0)
      + (c.employeeCount !== null ? 1 : 0);
  }, 0);
  const fields_completeness = totalFields > 0
    ? parseFloat((presentFields / totalFields).toFixed(4))
    : null;

  return {
    raw_returned,
    has_domain_count,
    country_match_count,
    industry_plausible_count,
    post_gate_candidate_count,
    false_positive_rate,
    fields_completeness,
    outcome,
  };
}

function zeroMetrics(outcome: LushaCompanyDiscoveryBenchmarkOutcome): LushaCompanyDiscoveryBenchmarkMetrics {
  return {
    raw_returned: 0,
    has_domain_count: 0,
    country_match_count: 0,
    industry_plausible_count: 0,
    post_gate_candidate_count: 0,
    false_positive_rate: null,
    fields_completeness: null,
    outcome,
  };
}

// Tipo helper para inferir base desde el objeto literal
type BaseMetadata = {
  provider_key: 'lusha';
  operation_key: 'company_discovery_benchmark_dry_run';
  provider_role: 'lusha_company_discovery_experimental';
  benchmark: true;
  dry_run: true;
  writes_disabled: true;
  source_catalog_unchanged: true;
  credits_used: 0;
  estimated_cost_usd: 0;
  smoke_test_minimum_page_size_observed: 10;
  filters_shape_observed: 'object';
  filter_type_key_observed: 'filterType';
  empty_filters_rejected_observed: true;
  minimum_required_filter_observed: true;
  next_filter_candidate: 'locations';
  filter_values_unconfirmed: true;
  locations_requires_query_observed: true;
  names_requires_query_observed: true;
  filter_values_query_param_supported: true;
  next_location_query_candidate: 'Colombia';
  location_value_id_unconfirmed: true;
  official_openapi_schema_confirmed: true;
  filters_nesting_observed: 'filters.companies.include';
  pagination_page_base: 'zero_based';
  options_include_partial_profiles_default: false;
  locations_post_value_shape: 'country_object';
  sizes_post_value_shape: 'numeric_range_object';
};

function buildBase(meta: BaseMetadata): BaseMetadata {
  return meta;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void buildBase; // asegura que el helper no sea eliminado por tree-shaking
