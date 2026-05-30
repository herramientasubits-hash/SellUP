/**
 * DENUE Mexico → Structured Candidate Mapper — Hito 16AD.3B
 *
 * Mapper conceptual puro. NO crea registros en DB. NO llama APIs.
 * NO escribe en HubSpot. Solo transforma NormalizedMexicoCompanySample
 * en StructuredSourceCandidateDraft para validación local.
 *
 * Contrato:
 *   sourceProvider = denue_mexico
 *   countryCode    = MX
 *   taxIdentifierType = RFC
 *   taxId          = null (DENUE no entrega RFC)
 *   sectorCode     = codigo_act SCIAN
 */

import type { NormalizedMexicoCompanySample } from './types';
import type {
  ReviewFlag,
  StructuredSourceCandidateDraft,
} from '../../../agents/prospecting-toolkit/structured-candidate-types';
import {
  buildInitialReviewFlags,
  buildDefaultHubspotTrace,
  buildDefaultCommercialTrace,
} from '../../../agents/prospecting-toolkit/structured-candidate-helpers';
import { deriveSizeFlagFromPerOcu } from './normalizers';

const SOURCE_PROVIDER = 'denue_mexico' as const;
const SOURCE_KEY = 'mx_denue' as const;
const SOURCE_TYPE = 'structured_registry' as const;
const SOURCE_MODE = 'pilot' as const;
const COUNTRY_CODE = 'MX' as const;
const TAX_IDENTIFIER_TYPE = 'RFC' as const;
const CONNECTOR_VERSION = '0.1.0';

/**
 * Convierte una muestra normalizada DENUE en un StructuredSourceCandidateDraft.
 *
 * Reglas críticas:
 *   employeeCount siempre null para fuentes estructuradas en esta etapa.
 *   employeeCountStatus siempre 'unknown_requires_manual_validation' en el draft.
 *   El sizeFlag derivado de per_ocu se propaga en reviewFlags para trazabilidad.
 *   taxId siempre null — DENUE no entrega RFC.
 *   taxIdentifierType = RFC para indicar el identificador esperado de México.
 */
export function mapDenueSampleToStructuredCandidate(
  sample: NormalizedMexicoCompanySample,
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
  });

  // Derivar flag de tamaño desde per_ocu de DENUE
  const sizeFlag: ReviewFlag = deriveSizeFlagFromPerOcu(sample.perOcuRaw);

  // structured_source_pilot como señal adicional de contexto piloto
  const pilotFlag: ReviewFlag[] = [];

  const reviewFlags: ReviewFlag[] = Array.from(
    new Set([sizeFlag, ...baseFlags, ...pilotFlag]),
  );

  const hubspotTrace = buildDefaultHubspotTrace();

  const commercialTrace = buildDefaultCommercialTrace({
    employeeCountStatus: 'unknown_requires_manual_validation',
    reviewFlags,
  });

  return {
    // Identidad
    name: sample.companyName ?? sample.legalName ?? 'Sin nombre',
    taxId: null,
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

    // Tamaño — siempre desconocido en el draft (constraint de tipo)
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
      sourceKey: SOURCE_KEY,
      sourceType: SOURCE_TYPE,
      sourceMode: SOURCE_MODE,
      datasetId: sample.datasetId,
      sourceRecordId: sample.rawRecordId,
      queryParams: {
        perOcuRaw: sample.perOcuRaw,
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
