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
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§10) — normalización de env:
 *   Antes, este módulo comparaba los valores crudos (`override === 'apollo_organizations'`,
 *   `ENABLE_APOLLO_COMPANY_SEARCH !== 'true'`). Ambas variables están declaradas
 *   `sensitive` en Vercel, así que su valor literal NO se puede leer desde fuera
 *   del deployment: un `TRUE`, un espacio o un salto de línea bastaba para que el
 *   código interpretara mal la configuración real. Ahora ambas pasan por el parser
 *   canónico (`trim` + `lowercase` + tokens booleanos explícitos + fail-closed).
 *
 *   El indicador del wizard (`wizard-provider-indicator.ts`) recibe el resultado
 *   de ESTA función, así que indicador y ejecución no pueden divergir.
 */

import { parseBooleanEnvFlag, parseEnvEnumValue } from '@/lib/env-flag-parser';

export type WizardDiscoveryProviderKey = 'tavily' | 'apollo_organizations';

/** Valores admitidos para AGENT1_WIZARD_DISCOVERY_PROVIDER. */
export const WIZARD_DISCOVERY_PROVIDER_KEYS: readonly WizardDiscoveryProviderKey[] = [
  'tavily',
  'apollo_organizations',
];

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
  | {
      provider: 'tavily';
      reason: 'default' | 'explicit_tavily' | 'apollo_flag_off' | 'unrecognized_provider_value';
    }
  | { provider: 'apollo_organizations'; reason: 'apollo_both_gates_on' };

/**
 * Resuelve el provider de discovery con razón explícita.
 * Usar para tests y logging interno.
 *
 * Ambas env vars se leen con el parser canónico:
 *   - `AGENT1_WIZARD_DISCOVERY_PROVIDER` se resuelve contra la allowlist, así que
 *     `" Apollo_Organizations "` y `"TAVILY"` se interpretan correctamente y un
 *     valor no reconocido cae en tavily con razón propia (nunca en Apollo).
 *   - `ENABLE_APOLLO_COMPANY_SEARCH` sólo habilita con el token `true`; ausente,
 *     vacío o inválido ⇒ apagado (fail-closed).
 */
export function resolveWizardDiscoveryProviderVerbose(): WizardDiscoveryProviderResolution {
  const rawOverride = process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;
  const override = parseEnvEnumValue(rawOverride, WIZARD_DISCOVERY_PROVIDER_KEYS);

  if (override === 'apollo_organizations') {
    if (!parseBooleanEnvFlag(process.env.ENABLE_APOLLO_COMPANY_SEARCH)) {
      return { provider: 'tavily', reason: 'apollo_flag_off' };
    }
    return { provider: 'apollo_organizations', reason: 'apollo_both_gates_on' };
  }

  if (override === 'tavily') {
    return { provider: 'tavily', reason: 'explicit_tavily' };
  }

  // Valor presente pero no reconocido: se distingue de "ausente" para que un
  // error de configuración sea visible en diagnósticos, sin habilitar Apollo.
  if (rawOverride !== undefined && rawOverride.trim() !== '') {
    return { provider: 'tavily', reason: 'unrecognized_provider_value' };
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
