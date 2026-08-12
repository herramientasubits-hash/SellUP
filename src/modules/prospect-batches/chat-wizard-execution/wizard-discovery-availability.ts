/**
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — ¿es aplicable un proveedor externo de
 * discovery a ESTA búsqueda?
 *
 * Módulo PURO: sin env, sin I/O, sin DOM, sin catálogos hardcodeados. Es la única
 * respuesta a la pregunta «¿se puede OFRECER una búsqueda de empresas con un
 * proveedor externo (Tavily / Apollo) para esta forma de búsqueda?».
 *
 * ── El hueco que cierra ──────────────────────────────────────────────────────
 * Hasta este hito no existía tal pregunta. La UI del wizard derivaba la
 * disponibilidad del proveedor de discovery de la ruta del proveedor OCULTO Lusha:
 * cuando los criterios eran Lusha-elegibles y `ENABLE_LUSHA_PREVIEW` estaba
 * apagado, la pantalla final mostraba «Proveedor de búsqueda: no disponible» y
 * retiraba tanto el selector de proveedor como «Generar prospectos». El resultado
 * observado en QA: país=Colombia + industria=Salud + tres subindustrias quedaba sin
 * ninguna forma de ejecutar, aunque Apollo y Tavily estaban desplegados,
 * configurados y con presupuesto. Como el catálogo de países soportados por el
 * wizard y el de países soportados por Lusha son HOY el mismo conjunto de 20, el
 * bloqueo alcanzaba a los 20 países para toda industria que mapeara a un sector
 * Lusha (salud, educación, tecnología) — y también a cualquier otra industria si el
 * NOMBRE de una subindustria seleccionada contenía uno de esos alias.
 *
 * ── La frontera que este módulo fija ─────────────────────────────────────────
 * DISPONIBILIDAD ≠ SEGURIDAD DE EJECUCIÓN. Este módulo decide únicamente si la
 * forma de la búsqueda admite un proveedor externo. NO decide, y deliberadamente no
 * puede decidir:
 *   - si el flag de Apollo está encendido,
 *   - si hay credencial,
 *   - si hay presupuesto,
 *   - si el rol puede pedir Apollo,
 *   - si la base puede guardar,
 *   - si la cobertura de subindustrias alcanza el objetivo.
 * Todo eso lo siguen resolviendo, fail-closed y ANTES de gastar, las capas que ya
 * existen (`evaluateWizardApolloAvailability` server-side, el spend gate, el
 * preflight de persistencia y la reserva de presupuesto). Un `available: true` de
 * aquí no autoriza nada: sólo permite ofrecer el control.
 *
 * Y una regla más, que es la que se rompió: `default` y `recomendado` NO son
 * `disponible`. Apollo puede estar disponible, no ser el predeterminado global y no
 * estar recomendado a la vez; son tres hechos distintos.
 */

import type { WizardApolloSkipReason } from './wizard-apollo-availability';
import type { WizardExecutionFailureCode } from './wizard-execution-types';

// ─── Modos de búsqueda a los que aplica un proveedor externo ──────────────────

/**
 * Modos cuyo propósito es DESCUBRIR empresas por criterios y que por tanto se
 * ejecutan contra un proveedor externo.
 *
 * `exploratory` es el token del wizard conversacional para «Empresas por
 * criterios»; `companies_by_criteria` es el nombre de la misma forma en el
 * contrato de routing, y se acepta para que un llamador pueda usar cualquiera de
 * los dos sin que el resultado cambie.
 *
 * Los modos que NO son discovery por criterios quedan fuera a propósito: ofrecer
 * un proveedor en una importación o en una carga manual sería ofrecer un botón que
 * sólo puede fallar. Un modo nuevo del wizard entra aquí sólo si su propósito es
 * discovery.
 */
export const PROVIDER_APPLICABLE_SEARCH_MODES: ReadonlySet<string> = new Set([
  'exploratory',
  'companies_by_criteria',
]);

export function isProviderApplicableSearchMode(mode: string | null | undefined): boolean {
  return PROVIDER_APPLICABLE_SEARCH_MODES.has(mode?.trim() ?? '');
}

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Motivos por los que un proveedor externo NO es ofrecible para esta búsqueda.
 *
 * Todos describen la FORMA de la búsqueda, nunca el estado del proveedor: no hay
 * —ni puede haber— un motivo «flag apagado», «sin credencial» o «sin presupuesto»
 * en esta lista. Ésa es la separación que exige el modelo de razones (§ 16): la UI
 * debe poder decir la causa correcta, y «el proveedor todavía no está habilitado»
 * es falso cuando el bloqueo real está en otra capa.
 */
export type WizardDiscoveryUnavailableReason =
  | 'search_mode_not_provider_applicable'
  | 'country_not_selected'
  | 'country_not_supported'
  | 'industry_not_selected';

export type WizardDiscoveryAvailability =
  | { available: true }
  | { available: false; reason: WizardDiscoveryUnavailableReason };

export type WizardDiscoveryAvailabilityInput = {
  /** Modo de búsqueda del wizard (`state.searchMode`). */
  searchMode: string | null;
  /** ISO2 seleccionado. Se comprueba presencia y pertenencia al catálogo soportado. */
  countryCode: string | null;
  /** Industria seleccionada. Sólo se comprueba PRESENCIA; su identidad es indiferente. */
  industryId: string | null;
  /**
   * Países soportados por el wizard, inyectados desde su propia fuente de verdad
   * (`VALID_COUNTRY_CODES`, derivada de `LATAM_COUNTRIES`).
   *
   * Se inyecta —en vez de importarse— para que este módulo no pueda tener una
   * lista propia que se desincronice de la del wizard, y para que el test de
   * matriz pueda barrer EXACTAMENTE los países que la UI ofrece.
   */
  supportedCountryCodes: ReadonlySet<string>;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

/**
 * Decide si esta búsqueda admite un proveedor externo de discovery.
 *
 * Lo que la decisión NO mira, y no debe mirar nunca:
 *   - qué industria es (ninguna industria hace a un proveedor indisponible),
 *   - cuántas subindustrias hay (0, 1 o varias dan el mismo resultado),
 *   - si hay criterio adicional libre,
 *   - qué país concreto es, más allá de pertenecer al catálogo soportado,
 *   - la ruta del proveedor OCULTO Lusha,
 *   - el proveedor predeterminado global ni el recomendado.
 *
 * Por eso la firma no recibe subindustrias ni criterio adicional: no es que se
 * ignoren, es que no pueden llegar. Un cambio futuro que quisiera condicionar la
 * disponibilidad al contenido de los criterios tendría que ampliar la firma, y eso
 * se ve en revisión.
 */
export function resolveWizardDiscoveryAvailability(
  input: WizardDiscoveryAvailabilityInput,
): WizardDiscoveryAvailability {
  if (!isProviderApplicableSearchMode(input.searchMode)) {
    return { available: false, reason: 'search_mode_not_provider_applicable' };
  }

  const countryCode = input.countryCode?.trim() ?? '';
  if (countryCode.length === 0) {
    return { available: false, reason: 'country_not_selected' };
  }
  if (!input.supportedCountryCodes.has(countryCode)) {
    return { available: false, reason: 'country_not_supported' };
  }

  if ((input.industryId?.trim() ?? '').length === 0) {
    return { available: false, reason: 'industry_not_selected' };
  }

  return { available: true };
}

// ─── Modelo de razones (§ 16) ─────────────────────────────────────────────────

/**
 * Familias de causa que la UI debe poder distinguir.
 *
 * Existen porque el defecto que este hito corrige fue exactamente una confusión de
 * familias: un bloqueo de FEATURE de un proveedor oculto se presentó como si el
 * proveedor de la búsqueda no estuviera habilitado. Con las familias separadas, un
 * texto sólo puede afirmar la causa que su código declara.
 */
export type WizardUnavailableReasonKind =
  /** La forma de la búsqueda no admite proveedor externo. */
  | 'provider_unsupported'
  /** Los criterios recogidos no son válidos o están incompletos. */
  | 'invalid_criteria'
  /** Una capacidad está apagada por configuración. */
  | 'feature_disabled'
  /** Falta credencial o conexión del proveedor. */
  | 'missing_credentials'
  /** No hay presupuesto o cupo. */
  | 'budget_exhausted'
  /** El almacenamiento no puede recibir los candidatos. */
  | 'persistence_not_ready'
  /** El catálogo cambió o su cobertura no alcanza. */
  | 'catalog_coverage_failed'
  /** Autorización del solicitante. */
  | 'not_permitted'
  /** Fallo recuperable, sin causa estable. */
  | 'transient';

/** Familia de cada motivo de disponibilidad. */
export const DISCOVERY_UNAVAILABLE_REASON_KINDS: Readonly<
  Record<WizardDiscoveryUnavailableReason, WizardUnavailableReasonKind>
> = {
  search_mode_not_provider_applicable: 'provider_unsupported',
  country_not_selected: 'invalid_criteria',
  country_not_supported: 'invalid_criteria',
  industry_not_selected: 'invalid_criteria',
};

/**
 * Familia de cada motivo del preflight server-side de Apollo.
 *
 * Ninguno es `provider_unsupported`: el preflight sólo corre para una búsqueda que
 * YA admite proveedor, así que un fallo suyo nunca significa «este proveedor no
 * sirve para esta búsqueda».
 */
export const APOLLO_SKIP_REASON_KINDS: Readonly<
  Record<WizardApolloSkipReason, WizardUnavailableReasonKind>
> = {
  feature_disabled: 'feature_disabled',
  capability_unavailable: 'transient',
  role_not_permitted: 'not_permitted',
  budget_unavailable: 'budget_exhausted',
  provider_not_configured: 'missing_credentials',
  credential_unavailable: 'missing_credentials',
  availability_check_failed: 'transient',
};

/** Familia de cada código de fallo de ejecución. */
export const EXECUTION_FAILURE_REASON_KINDS: Readonly<
  Record<WizardExecutionFailureCode, WizardUnavailableReasonKind>
> = {
  EXECUTION_DISABLED: 'feature_disabled',
  UNAUTHENTICATED: 'not_permitted',
  INACTIVE_USER: 'not_permitted',
  IDEMPOTENCY_CONFLICT: 'invalid_criteria',
  PILOT_PAUSED: 'feature_disabled',
  NOT_IN_PILOT: 'not_permitted',
  BUDGET_PERIOD_NOT_CONFIGURED: 'budget_exhausted',
  BUDGET_PERIOD_CLOSED: 'budget_exhausted',
  EXECUTION_CREDIT_LIMIT_EXCEEDED: 'budget_exhausted',
  BUDGET_EXCEEDED: 'budget_exhausted',
  CONCURRENT_EXECUTION_ACTIVE: 'transient',
  BUDGET_RESERVATION_FAILED: 'budget_exhausted',
  PROVIDER_UNAVAILABLE: 'transient',
  CATALOG_CHANGED: 'catalog_coverage_failed',
  INVALID_REQUEST: 'invalid_criteria',
  GENERATION_FAILED: 'transient',
  PERSISTENCE_NOT_READY: 'persistence_not_ready',
};
