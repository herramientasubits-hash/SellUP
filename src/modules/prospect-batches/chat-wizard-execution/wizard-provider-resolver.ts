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
 * Tavily es el default. Apollo solo se activa con AMBAS env vars configuradas
 * explícitamente server-side. No hay selector en UI.
 *
 * AGENT1-AUTO-PROVIDER-CASCADE-1 — con `ENABLE_AGENT1_AUTO_PROVIDER_CASCADE=true`
 * el principal es Apollo sin necesidad de `AGENT1_WIZARD_DISCOVERY_PROVIDER`
 * (decisión de producto del 2026-09-24: Apollo principal, Lusha respaldo). El
 * interruptor de Apollo sigue mandando: con `ENABLE_APOLLO_COMPANY_SEARCH`
 * apagado, Tavily, exactamente como hoy.
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
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1: las dos lecturas de env de abajo usaban
 * comparación cruda (`=== 'apollo_organizations'`, `!== 'true'`) mientras otros
 * lectores de las MISMAS variables ya hacían trim + lowercase (ver
 * isApolloCompanySearchEnabled). Un valor como `" TRUE "` significaba entonces
 * "encendido" para un módulo y "apagado" para otro, y el indicador de proveedor
 * podía discrepar del código que gasta créditos. Ambas lecturas pasan ahora por
 * el parser canónico de `@/lib/env-flag-parser`, que falla cerrado: sólo el
 * token exacto `true` habilita Apollo; cualquier valor no interpretable deja
 * Tavily.
 */

import { matchesEnvToken, parseEnvBooleanFlag } from '@/lib/env-flag-parser';

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
  | { provider: 'apollo_organizations'; reason: 'apollo_both_gates_on' | 'auto_provider_cascade' };

/**
 * Resuelve el provider de discovery con razón explícita.
 * Usar para tests y logging interno.
 */
export function resolveWizardDiscoveryProviderVerbose(): WizardDiscoveryProviderResolution {
  // AGENT1-AUTO-PROVIDER-CASCADE-1 — el modo automático gana sobre el override
  // global, pero nunca sobre el interruptor de Apollo.
  if (parseEnvBooleanFlag(process.env.ENABLE_AGENT1_AUTO_PROVIDER_CASCADE).enabled) {
    const companySearchFlag = parseEnvBooleanFlag(process.env.ENABLE_APOLLO_COMPANY_SEARCH);
    if (!companySearchFlag.enabled) {
      return { provider: 'tavily', reason: 'apollo_flag_off' };
    }
    return { provider: 'apollo_organizations', reason: 'auto_provider_cascade' };
  }

  const override = process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;

  if (matchesEnvToken(override, 'apollo_organizations')) {
    const companySearchFlag = parseEnvBooleanFlag(process.env.ENABLE_APOLLO_COMPANY_SEARCH);
    if (!companySearchFlag.enabled) {
      return { provider: 'tavily', reason: 'apollo_flag_off' };
    }
    return { provider: 'apollo_organizations', reason: 'apollo_both_gates_on' };
  }

  if (matchesEnvToken(override, 'tavily')) {
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
