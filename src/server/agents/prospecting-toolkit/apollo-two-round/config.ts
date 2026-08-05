/**
 * config.ts — Configuración central de la modalidad Apollo de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 2.
 *
 * Una sola fuente para los cinco números que gobiernan la modalidad. El resto de
 * los módulos del hito los reciben por parámetro y NUNCA los redeclaran: un
 * `5` repetido en tres archivos es la forma habitual de que el presupuesto y la
 * ejecución dejen de coincidir sin que nadie lo note.
 *
 * Puro: los parsers reciben el valor crudo por parámetro en vez de leer
 * `process.env` directamente, así que la suite corre sin tocar el entorno. El
 * único lector de env es `resolveApolloTwoRoundConfigFromEnv`, que se limita a
 * pasar los valores crudos al núcleo puro.
 *
 * Política de parseo (§ 2): trim → normalizar → entero → rechazar negativos y
 * cero → default seguro → tope absoluto → fallar conservador. "Conservador" aquí
 * significa hacia ABAJO: un valor ilegible nunca amplía el gasto autorizado.
 */

// ─── Defaults del contrato ────────────────────────────────────────────────────

/** Empresas únicas y elegibles que una ejecución intenta reunir. */
export const TARGET_ELIGIBLE_COMPANIES_DEFAULT = 5;
/** Rondas de búsqueda como máximo. El contrato del hito fija dos. */
export const MAX_SEARCH_ROUNDS_DEFAULT = 2;
/** Resultados solicitados al proveedor por ronda. */
export const MAX_RESULTS_PER_ROUND_DEFAULT = 5;
/** Resultados crudos acumulados como máximo en toda la ejecución. */
export const MAX_RAW_RESULTS_PER_RUN_DEFAULT = 10;
/** Organization Enrichment pagados como máximo en toda la ejecución. */
export const MAX_ENRICHMENTS_PER_RUN_DEFAULT = 2;

// ─── Topes absolutos ──────────────────────────────────────────────────────────
//
// Un override de entorno puede bajar cualquiera de estos números pero jamás
// subirlos por encima del tope: el techo del gasto autorizado vive en el código,
// no en una variable que se puede editar desde un panel.

export const TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX = 5;
export const MAX_SEARCH_ROUNDS_ABSOLUTE_MAX = 2;
export const MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX = 10;
export const MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX = 20;
export const MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX = 5;

// ─── Nombres de las variables de entorno ──────────────────────────────────────

export const APOLLO_TWO_ROUND_ENV_KEYS = {
  targetEligibleCompanies: 'AGENT1_APOLLO_TARGET_ELIGIBLE_COMPANIES',
  maxRounds: 'AGENT1_APOLLO_MAX_SEARCH_ROUNDS',
  maxResultsPerRound: 'AGENT1_APOLLO_MAX_RESULTS_PER_ROUND',
  maxRawResultsPerRun: 'AGENT1_APOLLO_MAX_RAW_RESULTS_PER_RUN',
  maxEnrichmentsPerRun: 'AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN_TWO_ROUND',
} as const;

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Configuración efectiva de una ejecución de dos rondas.
 *
 * Los tipos son `number` y no literales: el contrato del hito fija los DEFAULTS
 * en 5/2/5/10/2, y los topes absolutos garantizan que nunca se superen, pero un
 * operador puede bajarlos (p.ej. `maxEnrichmentsPerRun=0` para una corrida sin
 * enrichment). Congelar los literales en el tipo haría imposible expresar eso
 * sin un segundo tipo paralelo.
 */
export type ApolloTwoRoundDiscoveryConfig = {
  targetEligibleCompanies: number;
  maxRounds: number;
  maxResultsPerRound: number;
  maxRawResultsPerRun: number;
  maxEnrichmentsPerRun: number;
};

/** De dónde salió cada valor efectivo. Trazabilidad, no decoración. */
export type ApolloTwoRoundConfigSource =
  | 'default'
  | 'env_override'
  | 'env_clamped_to_absolute_max'
  | 'env_invalid_fallback_default';

export type ApolloTwoRoundConfigResolution = {
  config: ApolloTwoRoundDiscoveryConfig;
  sources: Record<keyof ApolloTwoRoundDiscoveryConfig, ApolloTwoRoundConfigSource>;
};

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Normaliza un valor crudo de entorno a entero acotado.
 *
 * `allowZero` existe porque cero es un valor legítimo para
 * `maxEnrichmentsPerRun` ("no pagues enrichment en esta corrida") pero no para
 * `maxRounds` ("no hagas ninguna ronda" no es una configuración, es un apagado,
 * y el apagado es el flag).
 */
export function parseApolloTwoRoundInt(
  raw: string | undefined | null,
  options: { fallback: number; absoluteMax: number; allowZero: boolean },
): { value: number; source: ApolloTwoRoundConfigSource } {
  const { fallback, absoluteMax, allowZero } = options;

  if (raw === undefined || raw === null) {
    return { value: fallback, source: 'default' };
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === '') {
    return { value: fallback, source: 'default' };
  }

  // Sólo dígitos. Un `5.9`, un `1e3` o un `+5` son entradas que alguien escribió
  // esperando otra cosa; interpretarlas a medias es peor que ignorarlas.
  if (!/^[0-9]+$/.test(normalized)) {
    return { value: fallback, source: 'env_invalid_fallback_default' };
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed)) {
    return { value: fallback, source: 'env_invalid_fallback_default' };
  }
  if (parsed === 0 && !allowZero) {
    return { value: fallback, source: 'env_invalid_fallback_default' };
  }
  if (parsed > absoluteMax) {
    return { value: absoluteMax, source: 'env_clamped_to_absolute_max' };
  }

  return { value: parsed, source: 'env_override' };
}

/** Valores crudos de entorno, inyectados para que el núcleo siga siendo puro. */
export type ApolloTwoRoundRawEnv = Partial<
  Record<keyof ApolloTwoRoundDiscoveryConfig, string | undefined>
>;

/**
 * Resuelve la configuración efectiva desde valores crudos.
 *
 * Invariante adicional: `maxRawResultsPerRun` no puede quedar por debajo de lo
 * que las rondas pueden traer legítimamente (`maxRounds × maxResultsPerRound`)
 * cuando eso cabe bajo el tope absoluto — un tope crudo demasiado bajo cortaría
 * la ronda 2 a mitad y haría irreproducible el conteo de resultados.
 */
export function resolveApolloTwoRoundConfig(
  raw: ApolloTwoRoundRawEnv = {},
): ApolloTwoRoundConfigResolution {
  const target = parseApolloTwoRoundInt(raw.targetEligibleCompanies, {
    fallback: TARGET_ELIGIBLE_COMPANIES_DEFAULT,
    absoluteMax: TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
    allowZero: false,
  });
  const rounds = parseApolloTwoRoundInt(raw.maxRounds, {
    fallback: MAX_SEARCH_ROUNDS_DEFAULT,
    absoluteMax: MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
    allowZero: false,
  });
  const perRound = parseApolloTwoRoundInt(raw.maxResultsPerRound, {
    fallback: MAX_RESULTS_PER_ROUND_DEFAULT,
    absoluteMax: MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX,
    allowZero: false,
  });
  const rawResults = parseApolloTwoRoundInt(raw.maxRawResultsPerRun, {
    fallback: MAX_RAW_RESULTS_PER_RUN_DEFAULT,
    absoluteMax: MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
    allowZero: false,
  });
  const enrichments = parseApolloTwoRoundInt(raw.maxEnrichmentsPerRun, {
    fallback: MAX_ENRICHMENTS_PER_RUN_DEFAULT,
    absoluteMax: MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
    allowZero: true,
  });

  const reachableRawResults = Math.min(
    rounds.value * perRound.value,
    MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  );

  return {
    config: {
      targetEligibleCompanies: target.value,
      maxRounds: rounds.value,
      maxResultsPerRound: perRound.value,
      maxRawResultsPerRun: Math.max(rawResults.value, reachableRawResults),
      maxEnrichmentsPerRun: enrichments.value,
    },
    sources: {
      targetEligibleCompanies: target.source,
      maxRounds: rounds.source,
      maxResultsPerRound: perRound.source,
      maxRawResultsPerRun: rawResults.source,
      maxEnrichmentsPerRun: enrichments.source,
    },
  };
}

/** Configuración con todos los defaults. Atajo para tests y para el preflight. */
export function defaultApolloTwoRoundConfig(): ApolloTwoRoundDiscoveryConfig {
  return resolveApolloTwoRoundConfig().config;
}

// ─── Diagnóstico sanitizado ───────────────────────────────────────────────────

/**
 * Forma que el runtime expone (§ 2). Sólo enteros resueltos y el origen de cada
 * uno: ni valores crudos de entorno, ni nombres de variables con su contenido.
 */
export type ApolloTwoRoundConfigDiagnostics = {
  apollo_target_eligible_companies_resolved: number;
  apollo_max_search_rounds_resolved: number;
  apollo_max_results_per_round_resolved: number;
  apollo_max_raw_results_per_run_resolved: number;
  apollo_max_enrichments_per_run_resolved: number;
  apollo_two_round_config_sources: Record<string, ApolloTwoRoundConfigSource>;
};

export function toApolloTwoRoundConfigDiagnostics(
  resolution: ApolloTwoRoundConfigResolution,
): ApolloTwoRoundConfigDiagnostics {
  return {
    apollo_target_eligible_companies_resolved: resolution.config.targetEligibleCompanies,
    apollo_max_search_rounds_resolved: resolution.config.maxRounds,
    apollo_max_results_per_round_resolved: resolution.config.maxResultsPerRound,
    apollo_max_raw_results_per_run_resolved: resolution.config.maxRawResultsPerRun,
    apollo_max_enrichments_per_run_resolved: resolution.config.maxEnrichmentsPerRun,
    apollo_two_round_config_sources: {
      target_eligible_companies: resolution.sources.targetEligibleCompanies,
      max_search_rounds: resolution.sources.maxRounds,
      max_results_per_round: resolution.sources.maxResultsPerRound,
      max_raw_results_per_run: resolution.sources.maxRawResultsPerRun,
      max_enrichments_per_run: resolution.sources.maxEnrichmentsPerRun,
    },
  };
}
