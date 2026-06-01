/**
 * Chile RES → Structured Candidate Mapper
 *
 * Mapper conceptual puro. NO crea registros en DB. NO llama APIs.
 * NO escribe en HubSpot. Solo transforma NormalizedChileCompanySample
 * en StructuredSourceCandidateDraft para dry-run de validación.
 *
 * Contrato:
 *   sourceProvider = datos_gob_cl
 *   sourceKey      = cl_res
 *   countryCode    = CL
 *   taxIdentifierType = RUT
 */

import type { NormalizedChileCompanySample } from './types';
import type { StructuredSourceCandidateDraft, ReviewFlag } from '../../../agents/prospecting-toolkit/structured-candidate-types';
import {
  buildDefaultHubspotTrace,
  buildDefaultCommercialTrace,
} from '../../../agents/prospecting-toolkit/structured-candidate-helpers';
import { RES_DATASET_ID } from './cl-res-client';

const SOURCE_PROVIDER = 'datos_gob_cl' as const;
const SOURCE_KEY = 'cl_res' as const;
const SOURCE_TYPE = 'structured_registry' as const;
const SOURCE_MODE = 'pilot' as const;
const COUNTRY_CODE = 'CL' as const;
const TAX_IDENTIFIER_TYPE = 'RUT' as const;
const CONNECTOR_VERSION = '0.1.0';

/** Flags de fuente RES Chile que se pueden proyectar a ReviewFlag del sistema. */
const RES_FLAG_TO_REVIEW_FLAG: Partial<Record<string, ReviewFlag>> = {
  missing_rut: 'no_tax_id',
  rut_available: 'sector_unknown',   // sector siempre desconocido
  no_sector_data: 'sector_unknown',
  no_contact_data: 'missing_website',
  dissolved_entity: 'inactive_company',
};

/**
 * Mapea los flags específicos de RES Chile a ReviewFlag del tipo canónico.
 * Solo incluye flags que existen en la unión ReviewFlag.
 */
function mapResChileFlagsToReviewFlags(
  sample: NormalizedChileCompanySample,
): ReviewFlag[] {
  const flags: ReviewFlag[] = ['size_unknown', 'sector_unknown', 'missing_website'];

  if (!sample.taxId) flags.push('no_tax_id');
  if (sample.legalStatus === 'dissolved_candidate') flags.push('inactive_company');

  // Deduplicar
  return Array.from(new Set(flags));
}

/**
 * Convierte una muestra normalizada RES Chile en un StructuredSourceCandidateDraft.
 *
 * Siempre marca preview_mode = true — es dry-run, no produce candidato real.
 * sectorCode y sectorDescription siempre null — RES Chile no trae giro.
 */
export function mapResChileSampleToStructuredCandidate(
  sample: NormalizedChileCompanySample,
): StructuredSourceCandidateDraft {
  const now = new Date().toISOString();
  const reviewFlags = mapResChileFlagsToReviewFlags(sample);

  const hubspotTrace = buildDefaultHubspotTrace();
  const commercialTrace = buildDefaultCommercialTrace({
    employeeCountStatus: 'unknown_requires_manual_validation',
    reviewFlags,
  });

  return {
    name: sample.legalName ?? sample.companyName ?? 'Sin nombre',
    taxId: sample.taxId,
    taxIdentifierType: TAX_IDENTIFIER_TYPE,
    city: sample.city,
    department: sample.region,
    sectorCode: null,
    sectorDescription: null,
    legalStatus: sample.legalStatus,
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
      datasetId: RES_DATASET_ID,
      sourceRecordId: sample.sourceRecordId,
      queryParams: {
        resource_id: sample.resourceId,
        filters: { 'Tipo de actuacion': 'CONSTITUCIÓN' },
        preview_mode: true,
        companyType: sample.companyType,
        incorporationDate: sample.incorporationDate,
        capitalAmount: sample.capitalAmount,
        capitalCurrency: sample.capitalCurrency,
        rawRecordId: sample.rawRecordId,
      },
      fetchedAt: now,
      connectorVersion: CONNECTOR_VERSION,
      normalizedAt: now,
      countryCode: COUNTRY_CODE,
    },
    hubspotTrace,
    commercialTrace,
  };

  void RES_FLAG_TO_REVIEW_FLAG; // evitar lint unused — referencia intencional
}
