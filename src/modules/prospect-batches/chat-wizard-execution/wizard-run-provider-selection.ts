/**
 * wizard-run-provider-selection.ts — Selección de proveedor POR CORRIDA.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 1.
 *
 * El hueco que cierra: hoy el routing se decide con variables globales
 * (`AGENT1_WIZARD_DISCOVERY_PROVIDER` + `ENABLE_APOLLO_COMPANY_SEARCH`), así que
 * cambiar de proveedor para UNA prueba cambia el proveedor de TODOS los usuarios
 * de Producción durante esa ventana. Este módulo permite fijar el proveedor de
 * una corrida concreta sin tocar el global.
 *
 * Orden de resolución (§ 1), estrictamente:
 *
 *   1. kill switch global      — un proveedor apagado NUNCA corre, lo pida quien
 *                                lo pida. Apollo no se ejecuta jamás con
 *                                ENABLE_APOLLO_COMPANY_SEARCH=false.
 *   2. autorización del        — sólo admin o un contrato interno autorizado
 *      proveedor solicitado      pueden pedir un proveedor concreto.
 *   3. proveedor por corrida   — la petición autorizada gana para ESTA corrida.
 *   4. proveedor global        — el predeterminado del entorno.
 *   5. Tavily fail-closed      — cualquier ambigüedad termina en Tavily.
 *
 * Idempotencia: un reintento conserva el proveedor de la corrida original. La
 * ÚNICA excepción es el kill switch — si el proveedor se apagó entre intentos, el
 * reintento no puede resucitarlo. Un candado de seguridad que un reintento puede
 * saltarse no es un candado.
 *
 * Puro: no lee `process.env`, no toca Supabase, no llama a ningún proveedor. El
 * llamador resuelve el entorno server-side y lo pasa por parámetro.
 */

// ─── Vocabulario ──────────────────────────────────────────────────────────────

/** Proveedores de discovery de EMPRESAS. Nunca de teléfono ni de contactos. */
export type WizardDiscoveryProvider =
  | 'tavily'
  | 'apollo_organizations'
  | 'lusha_companies';

export const WIZARD_DISCOVERY_PROVIDERS: readonly WizardDiscoveryProvider[] = [
  'tavily',
  'apollo_organizations',
  'lusha_companies',
] as const;

/** El predeterminado del producto. Sigue siendo Tavily y no cambia en este hito. */
export const DEFAULT_DISCOVERY_PROVIDER: WizardDiscoveryProvider = 'tavily';

export function isWizardDiscoveryProvider(
  value: unknown,
): value is WizardDiscoveryProvider {
  return (
    typeof value === 'string' &&
    (WIZARD_DISCOVERY_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Por qué se resolvió el proveedor que se resolvió. Códigos estáticos. */
export type ProviderResolutionReason =
  /** Se pidió un proveedor apagado por el kill switch global. */
  | 'requested_provider_disabled_by_kill_switch'
  /** El solicitante no está autorizado a elegir proveedor. */
  | 'requested_provider_not_authorized'
  /** El valor pedido no es un proveedor conocido. */
  | 'requested_provider_unknown'
  /** Llegó una petición por corrida pero la capacidad está apagada. */
  | 'run_override_capability_disabled'
  /** Petición válida, autorizada y habilitada: gana para esta corrida. */
  | 'run_level_override_authorized'
  /** Sin petición: manda el predeterminado global. */
  | 'global_default_provider'
  /** El predeterminado global está apagado o es inválido. */
  | 'global_default_disabled_fail_closed'
  /** Se conservó la elección de un intento anterior de la misma corrida. */
  | 'preserved_from_previous_attempt'
  /** La elección previa apuntaba a un proveedor ya apagado. */
  | 'previous_attempt_provider_disabled_fail_closed';

/** Quién puede pedir un proveedor concreto. Ambas vías son de servicio o admin. */
export type ProviderSelectionAuthority = 'admin' | 'internal_authorized_contract';

export type WizardRunProviderSelectionInput = {
  /**
   * Proveedor solicitado para ESTA corrida. Llega como `unknown` a propósito: es
   * un valor de entrada que no se puede confiar hasta validarlo.
   */
  requestedProvider?: unknown;
  /**
   * Autoridad del solicitante. `null` = sin autoridad: puede ejecutar el wizard,
   * pero no elegir proveedor.
   */
  authority: ProviderSelectionAuthority | null;
  /**
   * Si la capacidad de elegir proveedor por corrida está habilitada
   * (`ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE`, leído server-side).
   *
   * Ausente ⇒ apagada. Con la capacidad apagada, una petición por corrida se
   * ignora y manda el predeterminado global — el comportamiento previo al hito.
   */
  runOverrideEnabled?: boolean;
  /** Predeterminado global ya resuelto server-side. */
  globalDefaultProvider: WizardDiscoveryProvider;
  /**
   * Estado on/off resuelto de cada proveedor (de los flags, leídos server-side).
   * Un proveedor ausente se trata como APAGADO — fail-closed.
   */
  enabledProviders: Readonly<Partial<Record<WizardDiscoveryProvider, boolean>>>;
  /**
   * Elección registrada por un intento anterior de la MISMA corrida. Presente
   * sólo en reintentos.
   */
  previousAttemptProvider?: WizardDiscoveryProvider | null;
};

/** Los tres campos que el § 1 exige conservar en cada batch o ejecución. */
export type WizardRunProviderSelection = {
  /** Lo que se pidió, si se pidió algo válido. null cuando no hubo petición. */
  requestedDiscoveryProvider: WizardDiscoveryProvider | null;
  /** El que realmente va a correr. */
  resolvedDiscoveryProvider: WizardDiscoveryProvider;
  providerResolutionReason: ProviderResolutionReason;
  /** True cuando la corrida se apartó del predeterminado global. */
  isRunLevelOverride: boolean;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

function isEnabled(
  provider: WizardDiscoveryProvider,
  enabled: WizardRunProviderSelectionInput['enabledProviders'],
): boolean {
  // Ausente ⇒ apagado. Un proveedor que nadie declaró encendido no lo está.
  return enabled[provider] === true;
}

/**
 * Resuelve el proveedor de una corrida.
 *
 * Nunca lanza: cualquier entrada inesperada termina en Tavily con un motivo
 * explícito, que es la única degradación segura — Tavily no gasta créditos de
 * Apollo ni de Lusha.
 */
export function resolveWizardRunProvider(
  input: WizardRunProviderSelectionInput,
): WizardRunProviderSelection {
  const { enabledProviders, globalDefaultProvider } = input;

  const failClosed = (
    reason: ProviderResolutionReason,
    requested: WizardDiscoveryProvider | null,
  ): WizardRunProviderSelection => ({
    requestedDiscoveryProvider: requested,
    resolvedDiscoveryProvider: DEFAULT_DISCOVERY_PROVIDER,
    providerResolutionReason: reason,
    isRunLevelOverride: false,
  });

  // ── Reintento: se conserva la elección original ───────────────────────────
  // Se evalúa antes que la petición nueva: un reintento de la misma corrida no
  // puede cambiar de proveedor a mitad, o la reserva pagaría por un proveedor y
  // correría otro. El kill switch sigue mandando por encima.
  if (input.previousAttemptProvider) {
    const previous = input.previousAttemptProvider;
    if (!isEnabled(previous, enabledProviders)) {
      return failClosed('previous_attempt_provider_disabled_fail_closed', previous);
    }
    return {
      requestedDiscoveryProvider: previous,
      resolvedDiscoveryProvider: previous,
      providerResolutionReason: 'preserved_from_previous_attempt',
      isRunLevelOverride: previous !== globalDefaultProvider,
    };
  }

  // ── Petición explícita para esta corrida ──────────────────────────────────
  const hasRequest =
    input.requestedProvider !== undefined &&
    input.requestedProvider !== null &&
    input.requestedProvider !== '';

  if (hasRequest) {
    if (!isWizardDiscoveryProvider(input.requestedProvider)) {
      return failClosed('requested_provider_unknown', null);
    }
    const requested = input.requestedProvider;

    // 0. Capacidad apagada ⇒ la petición se ignora y decide el global. No es un
    //    fallo: es el estado por defecto del hito, en el que nada cambia.
    if (input.runOverrideEnabled !== true) {
      return {
        requestedDiscoveryProvider: requested,
        resolvedDiscoveryProvider: isEnabled(globalDefaultProvider, enabledProviders)
          ? globalDefaultProvider
          : DEFAULT_DISCOVERY_PROVIDER,
        providerResolutionReason: 'run_override_capability_disabled',
        isRunLevelOverride: false,
      };
    }

    // 1. Kill switch global — PRIMERO. Un proveedor apagado no corre aunque la
    //    corrida lo pida y quien lo pida sea admin.
    if (!isEnabled(requested, enabledProviders)) {
      return failClosed('requested_provider_disabled_by_kill_switch', requested);
    }

    // 2. Autorización. Un usuario sin autoridad no puede enviar
    //    `apollo_organizations` de forma arbitraria.
    if (input.authority === null) {
      return failClosed('requested_provider_not_authorized', requested);
    }

    // 3. Proveedor por corrida.
    return {
      requestedDiscoveryProvider: requested,
      resolvedDiscoveryProvider: requested,
      providerResolutionReason: 'run_level_override_authorized',
      isRunLevelOverride: requested !== globalDefaultProvider,
    };
  }

  // ── 4. Predeterminado global ──────────────────────────────────────────────
  if (isEnabled(globalDefaultProvider, enabledProviders)) {
    return {
      requestedDiscoveryProvider: null,
      resolvedDiscoveryProvider: globalDefaultProvider,
      providerResolutionReason: 'global_default_provider',
      isRunLevelOverride: false,
    };
  }

  // ── 5. Tavily fail-closed ─────────────────────────────────────────────────
  return failClosed('global_default_disabled_fail_closed', null);
}

// ─── Persistencia y correlación ───────────────────────────────────────────────

/** Clave bajo la que la selección aterriza en el metadata del batch. */
export const RUN_PROVIDER_SELECTION_METADATA_KEY = 'run_provider_selection' as const;

export type WizardRunProviderSelectionMetadata = {
  requested_discovery_provider: string | null;
  resolved_discovery_provider: string;
  provider_resolution_reason: string;
  is_run_level_override: boolean;
};

export function toRunProviderSelectionMetadata(
  selection: WizardRunProviderSelection,
): WizardRunProviderSelectionMetadata {
  return {
    requested_discovery_provider: selection.requestedDiscoveryProvider,
    resolved_discovery_provider: selection.resolvedDiscoveryProvider,
    provider_resolution_reason: selection.providerResolutionReason,
    is_run_level_override: selection.isRunLevelOverride,
  };
}

/**
 * Fragmento de firma de petición que fija el proveedor de la corrida.
 *
 * Se incorpora a `requestSignature` ANTES de reservar presupuesto, de modo que
 * la reserva quede atada al proveedor que la justifica: dos intentos del mismo
 * `clientRequestId` con proveedores distintos producen huellas distintas y la
 * discrepancia es detectable en vez de silenciosa.
 */
export function buildProviderSelectionSignature(
  selection: WizardRunProviderSelection,
): string {
  return [
    'provider',
    selection.resolvedDiscoveryProvider,
    selection.requestedDiscoveryProvider ?? 'none',
    selection.providerResolutionReason,
  ].join(':');
}

/**
 * Traduce la selección al vocabulario de proveedores que el pipeline del wizard
 * ejecuta hoy.
 *
 * `lusha_companies` forma parte del CONTRATO de routing (§ 1 lo nombra) pero no
 * tiene ruta de ejecución en el wizard de empresas en este hito. Devolver null
 * en vez de degradar a Tavily en silencio obliga al llamador a decidir de forma
 * explícita, que es lo que evita que un proveedor sin ruta corra "por accidente"
 * como otro.
 */
export function toExecutableDiscoveryProvider(
  selection: WizardRunProviderSelection,
): 'tavily' | 'apollo_organizations' | null {
  switch (selection.resolvedDiscoveryProvider) {
    case 'tavily':
      return 'tavily';
    case 'apollo_organizations':
      return 'apollo_organizations';
    case 'lusha_companies':
      return null;
  }
}
