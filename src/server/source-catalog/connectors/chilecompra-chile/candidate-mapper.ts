/**
 * ChileCompra → Structured Candidate Mapper
 *
 * Mapper conceptual puro. NO crea registros en DB. NO llama APIs.
 * NO escribe en HubSpot. Solo transforma NormalizedChileCompraSupplier
 * en StructuredSourceCandidateDraft para dry-run de validación.
 *
 * Contrato:
 *   sourcePrimary      = chilecompra_chile
 *   sourceKey          = cl_chilecompra
 *   sourceType         = structured_procurement
 *   sourceMode         = pilot
 *   countryCode        = CL
 *   taxIdentifierType  = RUT
 */

import type { NormalizedChileCompraSupplier } from './types';
import type { StructuredSourceCandidateDraft, ReviewFlag } from '../../../agents/prospecting-toolkit/structured-candidate-types';
import {
  buildDefaultHubspotTrace,
  buildDefaultCommercialTrace,
} from '../../../agents/prospecting-toolkit/structured-candidate-helpers';

const SOURCE_PROVIDER = 'chilecompra_chile' as const;
const SOURCE_KEY = 'cl_chilecompra' as const;
const SOURCE_TYPE = 'structured_procurement' as const;
const SOURCE_MODE = 'pilot' as const;
const COUNTRY_CODE = 'CL' as const;
const TAX_IDENTIFIER_TYPE = 'RUT' as const;
const CONNECTOR_VERSION = '0.1.0';

function mapChileCompraFlagsToReviewFlags(
  supplier: NormalizedChileCompraSupplier,
): ReviewFlag[] {
  const flags: ReviewFlag[] = ['size_unknown', 'sector_unknown', 'missing_website'];

  if (!supplier.taxId) flags.push('no_tax_id');

  // Si hay categoría UNSPSC, no es sector completamente desconocido
  if (supplier.procurementCategoryCode || supplier.procurementCategoryName) {
    // Mantener sector_unknown hasta enriquecimiento manual — el UNSPSC
    // es señal de actividad, no clasificación CIIU directa.
  }

  return Array.from(new Set(flags));
}

/**
 * Convierte un proveedor normalizado de ChileCompra en un StructuredSourceCandidateDraft.
 *
 * Siempre preview_mode = true — es dry-run, no produce candidato real.
 * sectorCode = UNSPSC si está disponible.
 * sectorDescription = categoría de compra pública si existe.
 * website = null — ChileCompra no entrega website.
 */
export function mapChileCompraSampleToStructuredCandidate(
  supplier: NormalizedChileCompraSupplier,
): StructuredSourceCandidateDraft {
  const now = new Date().toISOString();
  const reviewFlags = mapChileCompraFlagsToReviewFlags(supplier);

  const hubspotTrace = buildDefaultHubspotTrace();
  const commercialTrace = buildDefaultCommercialTrace({
    employeeCountStatus: 'unknown_requires_manual_validation',
    reviewFlags,
  });

  return {
    name: supplier.legalName ?? supplier.companyName ?? 'Sin nombre',
    taxId: supplier.taxId,
    taxIdentifierType: TAX_IDENTIFIER_TYPE,
    city: supplier.city,
    department: supplier.region,
    sectorCode: supplier.unspscCode,
    sectorDescription: supplier.procurementCategoryName,
    legalStatus: null,
    website: null,
    countryCode: COUNTRY_CODE,

    sourcePrimary: SOURCE_PROVIDER,

    employeeCount: null,
    employeeCountStatus: 'unknown_requires_manual_validation',

    commercialFitStatus: 'needs_manual_review',
    hubspotMatchStatus: 'not_attempted',
    reviewStatus: 'needs_manual_review',
    reviewFlags,

    sourceTrace: {
      sourceProvider: SOURCE_PROVIDER,
      sourceKey: SOURCE_KEY,
      sourceType: SOURCE_TYPE,
      sourceMode: SOURCE_MODE,
      datasetId: null,
      sourceRecordId: supplier.sourceRecordId,
      queryParams: {
        preview_mode: true,
        procurementSignal: true,
        procurementCategoryCode: supplier.procurementCategoryCode,
        procurementCategoryName: supplier.procurementCategoryName,
        unspscCode: supplier.unspscCode,
        governmentBuyer: supplier.governmentBuyer,
        icpMatch: supplier.icpMatch,
        icpMatchKeyword: supplier.icpMatchKeyword,
        rawRecordId: supplier.rawRecordId,
      },
      fetchedAt: now,
      connectorVersion: CONNECTOR_VERSION,
      normalizedAt: now,
      countryCode: COUNTRY_CODE,
    },
    hubspotTrace,
    commercialTrace,
  };
}
