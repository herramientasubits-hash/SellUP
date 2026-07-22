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
    sourceKey: 'co_personas_juridicas_cc',
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
    adapterKey: 'co_personas_juridicas_cc',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'Personas Jurídicas Cámaras de Comercio — señal de matrícula activa y renovación reciente. Validación NIT y enriquecimiento con CIIU, cámara de comercio y organización jurídica. Cobertura parcial (cámaras que publican en datos.gov.co). No es fuente de discovery principal. No reemplaza RUES.',
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
  {
    sourceKey: 'co_minsalud_reps',
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
    adapterKey: 'co_minsalud_reps',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'MinSalud REPS — señal de prestador de salud registrado. Enriquecimiento post-discovery por NIT exacto. Consolida sedes en metadata.sites[]. No activa discovery sectorial salud. No reemplaza RUES. No crea cuentas por sede.',
  },
  {
    sourceKey: 'co_superfinanciera',
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
    adapterKey: 'co_superfinanciera',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'Superfinanciera SFC — señal de entidad vigilada por la Superintendencia Financiera de Colombia. Enriquecimiento post-discovery por NIT exacto. Confirma sector financiero y tipo de entidad SFC. NIT 0 (entidad extranjera) es omitido. No activa discovery sectorial financiero. No reemplaza RUES. No crea cuentas.',
  },
  {
    sourceKey: 'mx_denue',
    countryCodes: ['MX'],
    capabilities: [
      'enrichment_after_discovery',
    ],
    wizardUsage: 'post_discovery_enrichment',
    requiresSnapshot: false,
    canRunLive: true,
    adapterKey: 'mx_denue',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'DENUE INEGI — señal contextual de establecimiento activo en México. Enriquecimiento post-discovery por nombre. No contiene RFC. No reemplaza resolución fiscal. Solo contexto operativo para revisión humana.',
  },
  {
    sourceKey: 'cl_inapi',
    countryCodes: ['CL'],
    capabilities: ['manual_signal'],
    wizardUsage: 'manual_signal_only',
    requiresSnapshot: false,
    canRunLive: true,
    adapterKey: 'cl_inapi',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'INAPI Chile — señal contextual de propiedad intelectual (marcas y patentes). Enriquecimiento post-discovery por nombre (razón social). No contiene RUT. No reemplaza cl_res. Solo señal contextual para revisión humana.',
  },
  {
    sourceKey: 'ec_scvs',
    countryCodes: ['EC'],
    capabilities: [
      'enrichment_after_discovery',
      'tax_id_validation',
      'commercial_signals',
      'prioritization',
    ],
    wizardUsage: 'post_discovery_enrichment',
    requiresSnapshot: true,
    canRunLive: false,
    adapterKey: 'ec_scvs',
    fallbackBehavior: 'skip_without_blocking',
    description:
      'SCVS Ecuador — señales comerciales y validación RUC para empresas ecuatorianas registradas en Superintendencia de Compañías. Solo desde snapshot/cache. No es fuente de discovery principal. Detección observable de múltiples expedientes por RUC (no selección arbitraria).',
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
