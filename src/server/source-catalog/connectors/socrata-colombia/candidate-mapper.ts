/**
 * Socrata Colombia → Structured Candidate Mapper — Hito 16AB.4
 *
 * Mapper conceptual puro. NO crea registros en DB. NO llama APIs.
 * NO escribe en HubSpot. Solo transforma NormalizedColombiaCompanySample
 * en StructuredSourceCandidateDraft para validación local.
 *
 * Preparación para 16AB.5/16AB.6 donde se integrará al writer.
 */

import type { NormalizedColombiaCompanySample } from './types';
import type { StructuredSourceCandidateDraft, ReviewFlag } from '../../../agents/prospecting-toolkit/structured-candidate-types';
import {
  buildInitialReviewFlags,
  buildDefaultHubspotTrace,
  buildDefaultCommercialTrace,
} from '../../../agents/prospecting-toolkit/structured-candidate-helpers';

// Constantes Socrata Colombia
const SOURCE_PROVIDER = 'socrata_colombia' as const;
const SOURCE_TYPE = 'structured_registry' as const;
const SOURCE_MODE = 'pilot' as const;
const COUNTRY_CODE = 'CO' as const;
const TAX_IDENTIFIER_TYPE = 'NIT' as const;

const CONNECTOR_VERSION = '0.1.0';

/**
 * Convierte una muestra normalizada de Socrata Colombia en un
 * StructuredSourceCandidateDraft conceptual.
 *
 * Regla crítica: employeeCount siempre null para Socrata en esta etapa.
 * Nunca descarta por empleados desconocidos.
 */
export function mapSocrataSampleToStructuredCandidate(
  sample: NormalizedColombiaCompanySample
): StructuredSourceCandidateDraft {
  const now = new Date().toISOString();

  const baseFlags = buildInitialReviewFlags({
    taxId: sample.taxId,
    website: sample.website,
    linkedinUrl: null,
    decisionMakerName: null,
    sectorCode: sample.sectorCode,
    legalStatus: sample.legalStatus,
    source: sample.source,
    email: sample.email,
    phone: sample.phone,
    companyName: sample.companyName,
  });

  // Siempre unknown para Socrata: no tenemos datos de empleados
  const sizeFlags: ReviewFlag[] = ['size_unknown'];

  const reviewFlags: ReviewFlag[] = Array.from(
    new Set([...sizeFlags, ...baseFlags])
  );

  const hubspotTrace = buildDefaultHubspotTrace();

  const commercialTrace = buildDefaultCommercialTrace({
    employeeCountStatus: 'unknown_requires_manual_validation',
    reviewFlags,
  });

  return {
    // Identidad
    name: sample.companyName ?? 'Sin nombre',
    taxId: sample.taxId,
    taxIdentifierType: TAX_IDENTIFIER_TYPE,
    city: sample.city,
    department: sample.department,
    sectorCode: sample.sectorCode,
    sectorDescription: sample.sectorDescription,
    legalStatus: sample.legalStatus,
    website: sample.website,
    countryCode: COUNTRY_CODE,

    // Fuente
    sourcePrimary: SOURCE_PROVIDER,

    // Tamaño — siempre desconocido en esta etapa
    employeeCount: null,
    employeeCountStatus: 'unknown_requires_manual_validation',

    // Clasificación inicial
    commercialFitStatus: 'needs_manual_review',
    hubspotMatchStatus: 'not_attempted',
    reviewStatus: 'needs_manual_review',
    reviewFlags,

    // Trazabilidad
    sourceTrace: {
      sourceProvider: SOURCE_PROVIDER,
      sourceKey: sample.sourceKey,
      sourceType: SOURCE_TYPE,
      sourceMode: SOURCE_MODE,
      datasetId: sample.datasetId,
      sourceRecordId: sample.rawRecordId,
      queryParams: {},
      fetchedAt: now,
      connectorVersion: CONNECTOR_VERSION,
      normalizedAt: now,
      countryCode: COUNTRY_CODE,
    },
    hubspotTrace,
    commercialTrace,
  };
}
