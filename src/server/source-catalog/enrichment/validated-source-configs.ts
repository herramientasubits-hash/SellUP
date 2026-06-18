/**
 * Source Catalog — Validated Source Configs
 *
 * Registro de fuentes validadas con sus capacidades de enriquecimiento.
 * Agregar nuevas fuentes aquí cuando pasen a operational_verified.
 *
 * Solo server-side. No importar en Client Components.
 */

import type { ValidatedSourceConfig, SourceCapability } from './types';

export const VALIDATED_SOURCE_CONFIGS: ValidatedSourceConfig[] = [
  {
    sourceKey: 'co_siis',
    countryCodes: ['CO'],
    capabilities: [
      'discovery_secondary',
      'enrichment_after_discovery',
      'tax_id_validation',
      'financial_signals',
      'prioritization',
    ],
    wizardUsage: 'post_discovery_enrichment',
    requiresSnapshot: true,
    canRunLive: false,
    adapterKey: 'co_siis',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'Supersociedades SIIS — señales financieras y validación NIT para empresas medianas/grandes colombianas supervisadas. Solo desde snapshot/cache. No es fuente de discovery principal.',
  },
];

/**
 * Devuelve las configs aplicables para un país y capacidad de enriquecimiento.
 * Solo devuelve fuentes con wizardUsage === 'post_discovery_enrichment'.
 */
export function getValidatedSourcesForEnrichment(
  countryCode: string,
  capability: Extract<SourceCapability, 'enrichment_after_discovery' | 'prioritization'>,
): ValidatedSourceConfig[] {
  return VALIDATED_SOURCE_CONFIGS.filter(
    (c) =>
      c.countryCodes.includes(countryCode) &&
      c.capabilities.includes(capability) &&
      c.wizardUsage === 'post_discovery_enrichment',
  );
}
