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
    sourceKey: 'co_secop2_proveedores',
    countryCodes: ['CO'],
    capabilities: [
      'enrichment_after_discovery',
      'tax_id_validation',
      'commercial_signals',
      'prioritization',
    ],
    wizardUsage: 'post_discovery_enrichment',
    requiresSnapshot: false,
    canRunLive: true,
    adapterKey: 'co_secop2_proveedores',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'SECOP II Proveedores Registrados — señal comercial B2G. Indica si la empresa está registrada como proveedora del Estado colombiano. Solo por NIT exacto. No es fuente de discovery principal.',
  },
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
