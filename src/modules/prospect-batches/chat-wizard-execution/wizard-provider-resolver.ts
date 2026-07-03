/**
 * wizard-provider-resolver.ts — Resuelve el provider de discovery para el wizard.
 *
 * Reglas de resolución (doble gate):
 *   - Sin env AGENT1_WIZARD_DISCOVERY_PROVIDER  → tavily (default)
 *   - AGENT1_WIZARD_DISCOVERY_PROVIDER=tavily   → tavily (explícito)
 *   - AGENT1_WIZARD_DISCOVERY_PROVIDER=apollo_organizations
 *       + ENABLE_APOLLO_COMPANY_SEARCH=false     → tavily (flag apagado)
 *       + ENABLE_APOLLO_COMPANY_SEARCH=true      → apollo_organizations
 *
 * Tavily es y seguirá siendo el default. Apollo solo se activa con AMBAS env vars
 * configuradas explícitamente server-side. No hay selector en UI.
 *
 * Decisión estratégica Q3F-3:
 *   Apollo Organizations NO es el discovery principal recomendado para lotes masivos.
 *   Roles asignados:
 *     - organization_search_role = "discovery_fallback_experimental"
 *       (disponible solo con doble gate explícito; no recomendado como default masivo)
 *     - organization_enrichment_role = "enrichment"
 *       (validado técnicamente; complementa datos de empresas ya identificadas)
 *
 * Hito v1.16K-Y / Q3F-3.
 */

export type WizardDiscoveryProviderKey = 'tavily' | 'apollo_organizations';

/**
 * Roles de Apollo Organizations dentro del Agente 1 (Q3F-3).
 * Expuesto para diagnósticos, tests y documentación interna.
 * No modifica el flujo de ejecución.
 */
export const APOLLO_ORGANIZATION_ROLES = {
  /** Discovery disponible solo con doble gate explícito; no recomendado como default masivo. */
  search: 'discovery_fallback_experimental',
  /** Validado técnicamente; complementa datos de empresas ya identificadas con dominio/identidad. */
  enrichment: 'enrichment',
} as const;

export type ApolloOrganizationSearchRole = typeof APOLLO_ORGANIZATION_ROLES.search;
export type ApolloOrganizationEnrichmentRole = typeof APOLLO_ORGANIZATION_ROLES.enrichment;

export type WizardDiscoveryProviderResolution =
  | { provider: 'tavily'; reason: 'default' | 'explicit_tavily' | 'apollo_flag_off' }
  | { provider: 'apollo_organizations'; reason: 'apollo_both_gates_on' };

/**
 * Resuelve el provider de discovery con razón explícita.
 * Usar para tests y logging interno.
 */
export function resolveWizardDiscoveryProviderVerbose(): WizardDiscoveryProviderResolution {
  const override = process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;

  if (override === 'apollo_organizations') {
    if (process.env.ENABLE_APOLLO_COMPANY_SEARCH !== 'true') {
      return { provider: 'tavily', reason: 'apollo_flag_off' };
    }
    return { provider: 'apollo_organizations', reason: 'apollo_both_gates_on' };
  }

  if (override === 'tavily') {
    return { provider: 'tavily', reason: 'explicit_tavily' };
  }

  return { provider: 'tavily', reason: 'default' };
}

/**
 * Resuelve el provider de discovery para uso en el wizard.
 * Tavily es el default. Apollo requiere doble gate.
 */
export function resolveWizardDiscoveryProvider(): WizardDiscoveryProviderKey {
  return resolveWizardDiscoveryProviderVerbose().provider;
}
