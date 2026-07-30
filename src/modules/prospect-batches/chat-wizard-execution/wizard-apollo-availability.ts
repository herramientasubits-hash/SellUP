/**
 * A1-APOLLO-WIZARD-1 — Preflight de disponibilidad de Apollo para el wizard.
 *
 * El núcleo es puro y por inyección de dependencias; el wrapper server-only
 * provee las implementaciones reales.
 *
 * El hueco que cierra:
 *   El wizard sólo comprobaba disponibilidad de Tavily. Con Apollo seleccionado
 *   y sin credencial, la ejecución seguía adelante: reservaba presupuesto,
 *   reservaba lote y sólo entonces el provider devolvía `skipped`. Como la
 *   reconciliación es conservadora (si no hay consumo registrado confirma lo
 *   reservado), una credencial ausente consumía cupo de presupuesto del piloto
 *   sin haber llamado nunca a Apollo. Ahora se decide antes de reservar nada.
 *
 * Defensa en profundidad — se comprueban todas, en orden de menor radio de daño:
 *   1. feature flag ENABLE_APOLLO_COMPANY_SEARCH
 *   2. disponibilidad del proveedor en el catálogo/capability
 *   3. rol admitido
 *   4. presupuesto disponible
 *   5. proveedor configurado
 *   6. credencial disponible
 *
 * Fail-closed: cualquier error al evaluar una comprobación se lee como
 * indisponible. Nunca hay fallback automático a Apollo legacy ni a otro
 * proveedor.
 */

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Motivos de omisión. Códigos estáticos, seguros de loggear y de testear. */
export type WizardApolloSkipReason =
  | 'feature_disabled'
  | 'capability_unavailable'
  | 'role_not_permitted'
  | 'budget_unavailable'
  | 'provider_not_configured'
  | 'credential_unavailable'
  | 'availability_check_failed';

export type WizardApolloAvailability =
  | { available: true }
  | { available: false; skipReason: WizardApolloSkipReason };

export type WizardApolloAvailabilityDeps = {
  /** ENABLE_APOLLO_COMPANY_SEARCH a través del parser canónico. */
  isFeatureEnabled: () => boolean;
  /** Disponibilidad del proveedor según catálogo/capability. Debe fallar cerrado. */
  isProviderCapabilityAvailable: () => Promise<boolean>;
  /** Rol del solicitante admitido para discovery con Apollo. */
  isRolePermitted: () => Promise<boolean>;
  /** Presupuesto disponible para la ejecución estimada. */
  hasBudgetAvailable: () => Promise<boolean>;
  /** Proveedor configurado server-side (conexión registrada). */
  isProviderConfigured: () => Promise<boolean>;
  /**
   * Credencial presente. Comprueba existencia, nunca hace una llamada real ni
   * gasta créditos, y jamás devuelve el valor de la clave.
   */
  hasCredential: () => Promise<boolean>;
  /** Sumidero de observabilidad sin PII: recibe sólo el código de motivo. */
  logSkip?: (reason: WizardApolloSkipReason) => void;
};

// ─── Núcleo puro ──────────────────────────────────────────────────────────────

/**
 * Evalúa la disponibilidad de Apollo. Ninguna rama negativa toca la base de
 * datos, ningún proveedor ni ninguna superficie de facturación.
 */
export async function evaluateWizardApolloAvailability(
  deps: WizardApolloAvailabilityDeps,
): Promise<WizardApolloAvailability> {
  const skip = (reason: WizardApolloSkipReason): WizardApolloAvailability => {
    deps.logSkip?.(reason);
    return { available: false, skipReason: reason };
  };

  // Una comprobación que lanza es una comprobación que no pasó.
  const safely = async (check: () => Promise<boolean>): Promise<boolean | 'failed'> => {
    try {
      return await check();
    } catch {
      return 'failed';
    }
  };

  try {
    if (!deps.isFeatureEnabled()) return skip('feature_disabled');
  } catch {
    return skip('availability_check_failed');
  }

  const ordered: Array<{ check: () => Promise<boolean>; reason: WizardApolloSkipReason }> = [
    { check: deps.isProviderCapabilityAvailable, reason: 'capability_unavailable' },
    { check: deps.isRolePermitted, reason: 'role_not_permitted' },
    { check: deps.hasBudgetAvailable, reason: 'budget_unavailable' },
    { check: deps.isProviderConfigured, reason: 'provider_not_configured' },
    { check: deps.hasCredential, reason: 'credential_unavailable' },
  ];

  for (const { check, reason } of ordered) {
    const result = await safely(check);
    if (result === 'failed') return skip('availability_check_failed');
    if (!result) return skip(reason);
  }

  return { available: true };
}

// ─── Presentación ─────────────────────────────────────────────────────────────

/**
 * Mensajes para el usuario final.
 *
 * Deliberadamente no revelan qué flag, rol o credencial desbloquearía la ruta:
 * un estado bloqueado debe ser indistinguible de cualquier otro no disponible.
 */
const SKIP_MESSAGES: Record<WizardApolloSkipReason, string> = {
  feature_disabled: 'La búsqueda de empresas con este proveedor no está habilitada.',
  capability_unavailable: 'El proveedor de búsqueda no está disponible en este momento.',
  role_not_permitted: 'La búsqueda de empresas con este proveedor no está disponible.',
  budget_unavailable: 'No hay presupuesto disponible para ejecutar esta búsqueda.',
  provider_not_configured: 'El proveedor de búsqueda no está disponible en este momento.',
  credential_unavailable: 'El proveedor de búsqueda no está disponible en este momento.',
  availability_check_failed: 'No se pudo verificar la disponibilidad del proveedor de búsqueda.',
};

/**
 * Resultado estructurado de "proveedor omitido / no disponible" para la UI.
 *
 * No lleva lote, ni candidatos, ni coste: un proveedor omitido no produjo nada y
 * no gastó nada, y la UI no debe poder confundirlo con una ejecución vacía.
 */
export type WizardProviderSkippedResult = {
  provider: 'apollo_organizations';
  skipped: true;
  skipReason: WizardApolloSkipReason;
  message: string;
  creditsUsed: 0;
  pagesProcessed: 0;
  resultsFound: 0;
};

export function buildWizardApolloSkippedResult(
  skipReason: WizardApolloSkipReason,
): WizardProviderSkippedResult {
  return {
    provider: 'apollo_organizations',
    skipped: true,
    skipReason,
    message: SKIP_MESSAGES[skipReason],
    creditsUsed: 0,
    pagesProcessed: 0,
    resultsFound: 0,
  };
}

/** Log sin PII: nombre de evento estático + código de motivo estático. */
export function logWizardApolloSkipped(reason: WizardApolloSkipReason): void {
  console.warn(
    `[wizard-apollo] event=provider_skipped provider=apollo_organizations reason=${reason}`,
  );
}
