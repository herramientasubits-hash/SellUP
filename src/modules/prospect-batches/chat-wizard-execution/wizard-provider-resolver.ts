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
 * Hito v1.16K-Y.
 */

export type WizardDiscoveryProviderKey = 'tavily' | 'apollo_organizations';

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
