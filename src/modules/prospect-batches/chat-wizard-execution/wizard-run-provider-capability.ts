/**
 * wizard-run-provider-capability.ts — ¿puede ESTE usuario elegir el proveedor de
 * UNA corrida, y entre cuáles?
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 2 y § 4.
 *
 * El hueco que cierra: `resolveWizardRunProvider` ya sabe resolver una petición
 * por corrida, pero ninguna superficie sabía si debía ofrecerla. Sin esta capa la
 * única forma de probar Apollo era mover `AGENT1_WIZARD_DISCOVERY_PROVIDER` en
 * Producción, que cambia el proveedor de TODOS los usuarios.
 *
 * Lo que este módulo produce es una CAPACIDAD SANITIZADA: dos campos que la UI
 * puede leer sin conocer flags, variables, roles ni credenciales. No es una
 * autorización — el servidor vuelve a derivar autoridad y flags al ejecutar
 * (§ 7). Una capacidad `canSelectDiscoveryProvider: true` que llegue manipulada
 * al cliente no consigue Apollo: `resolveWizardRunProvider` decide de nuevo.
 *
 * Puro: no lee `process.env`, no toca Supabase, no conoce el DOM. El llamador
 * resuelve sesión, rol y flags server-side y los pasa por parámetro.
 */

import type { WizardDiscoveryProvider } from './wizard-run-provider-selection';

// ─── Vocabulario ──────────────────────────────────────────────────────────────

/**
 * Proveedores que la superficie administrativa puede ofrecer.
 *
 * Subconjunto ESTRICTO de `WizardDiscoveryProvider`: `lusha_companies` forma
 * parte del contrato de routing pero no tiene ruta de ejecución en el wizard de
 * empresas, así que ofrecerlo sería ofrecer un botón que sólo puede fallar.
 */
export type WizardRunSelectableProvider = Extract<
  WizardDiscoveryProvider,
  'tavily' | 'apollo_organizations'
>;

export const WIZARD_RUN_SELECTABLE_PROVIDERS: readonly WizardRunSelectableProvider[] = [
  'tavily',
  'apollo_organizations',
] as const;

export function isWizardRunSelectableProvider(
  value: unknown,
): value is WizardRunSelectableProvider {
  return (
    typeof value === 'string' &&
    (WIZARD_RUN_SELECTABLE_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Capacidad sanitizada que viaja del servidor a la UI.
 *
 * Deliberadamente NO lleva: nombres de variables de entorno, valores de flags,
 * el rol del usuario, ni el motivo por el que un proveedor quedó fuera. La UI
 * sólo necesita saber si mostrar el control y qué opciones habilitar.
 */
export type WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: boolean;
  allowedProviders: readonly WizardRunSelectableProvider[];
};

/** Capacidad de un usuario que no puede elegir. El default de todo el sistema. */
export const NO_PROVIDER_OVERRIDE_CAPABILITY: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: false,
  allowedProviders: [],
};

export type WizardProviderOverrideCapabilityInput = {
  /** Sesión válida. Ausente ⇒ sin capacidad, sin consultar nada más. */
  isAuthenticated: boolean;
  /** Rol admin CONFIRMADO por el servidor. Nunca un booleano del cliente. */
  isAdmin: boolean;
  /** `ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE` resuelto server-side. */
  runOverrideEnabled: boolean;
  /** `ENABLE_APOLLO_COMPANY_SEARCH` — el kill switch real de Apollo. */
  apolloCompanySearchEnabled: boolean;
  /** `ENABLE_APOLLO_TWO_ROUND_DISCOVERY` — la forma de ejecución ofrecida. */
  apolloTwoRoundDiscoveryEnabled: boolean;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

/**
 * Deriva la capacidad de la superficie administrativa.
 *
 * Reglas, todas conjuntivas y fail-closed:
 *
 *   canSelectDiscoveryProvider = sesión ∧ admin ∧ override
 *
 * Con el override apagado el control NO se muestra: la corrida usa el
 * predeterminado global igual que antes del hito, que es exactamente el estado
 * actual de Producción.
 *
 * Apollo se ofrece SÓLO si además están encendidos su kill switch y la modalidad
 * de dos rondas. Ofrecer «Apollo — dos rondas» con la modalidad apagada nombraría
 * una forma de ejecución que no va a correr; ofrecerlo con el kill switch apagado
 * prometería un proveedor que el servidor va a rechazar de todas formas.
 *
 * Tavily siempre acompaña a un control visible: un selector con una sola opción
 * no es una elección, y sin la opción explícita «Tavily» el administrador no
 * tendría forma de volver al predeterminado dentro de la misma pantalla.
 */
export function resolveWizardProviderOverrideCapability(
  input: WizardProviderOverrideCapabilityInput,
): WizardProviderOverrideCapability {
  const canSelect =
    input.isAuthenticated === true &&
    input.isAdmin === true &&
    input.runOverrideEnabled === true;

  if (!canSelect) return NO_PROVIDER_OVERRIDE_CAPABILITY;

  const apolloOffered =
    input.apolloCompanySearchEnabled === true &&
    input.apolloTwoRoundDiscoveryEnabled === true;

  return {
    canSelectDiscoveryProvider: true,
    allowedProviders: apolloOffered ? ['tavily', 'apollo_organizations'] : ['tavily'],
  };
}

/**
 * ¿Está esta opción habilitada para esta capacidad?
 *
 * Un proveedor ausente de `allowedProviders` se renderiza deshabilitado, no
 * oculto: un administrador que no ve la opción no puede distinguir «no existe»
 * de «no está disponible ahora», y esa ambigüedad es la que hace que alguien
 * mueva una variable global para averiguarlo.
 */
export function isProviderOptionEnabled(
  capability: WizardProviderOverrideCapability,
  provider: WizardRunSelectableProvider,
): boolean {
  return (
    capability.canSelectDiscoveryProvider &&
    capability.allowedProviders.includes(provider)
  );
}

// ─── Topes efectivos que la superficie anuncia (§ 5) ──────────────────────────

/**
 * Topes ya resueltos de la modalidad Apollo de dos rondas.
 *
 * Vive en la capa de módulos —no en la de componentes— porque lo produce el
 * servidor y lo consume la UI: al revés, el resolutor server-side tendría que
 * importar un tipo de un archivo `'use client'`.
 *
 * Todos los números salen de `resolveApolloTwoRoundConfigFromEnv` +
 * `estimateApolloTwoRoundBudget`, las MISMAS funciones que gobiernan la ejecución
 * y la reserva. Ninguno se escribe a mano.
 */
export type ApolloRunModeLimits = {
  targetEligibleCompanies: number;
  maxRounds: number;
  maxResultsPerRound: number;
  maxRawResultsPerRun: number;
  maxEnrichmentsPerRun: number;
  /** Techo interno registrable de la corrida (búsquedas + enrichment). */
  maxInternalCredits: number;
};

/**
 * § 12 — ¿la superficie de override está disponible en este runtime?
 *
 * Sólo refleja la capacidad RESUELTA del entorno (override ∧ kill switch ∧ dos
 * rondas). NO habla de los permisos de ningún usuario concreto, y por eso puede
 * publicarse en el diagnóstico admin-only sin revelar quién es admin.
 */
export function isRunProviderOverrideSurfaceAvailable(input: {
  runOverrideEnabled: boolean;
  apolloCompanySearchEnabled: boolean;
  apolloTwoRoundDiscoveryEnabled: boolean;
}): boolean {
  return (
    input.runOverrideEnabled === true &&
    input.apolloCompanySearchEnabled === true &&
    input.apolloTwoRoundDiscoveryEnabled === true
  );
}
