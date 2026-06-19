/**
 * Superfinanciera SFC — Enrichment Adapter
 *
 * Señal de entidad vigilada por la Superintendencia Financiera de Colombia.
 * Enriquece candidatos post-discovery para Colombia cuando hay NIT disponible.
 *
 * Comportamiento:
 * - Solo para countryCode === 'CO'
 * - Requiere NIT válido — sin NIT devuelve skipped(missing_tax_id)
 * - NIT '0' (entidad extranjera) → skipped(invalid_colombian_tax_id)
 * - Lookup por NIT: $where=numeroidentificacion='<NIT>' con $limit=1
 * - Normaliza registro con normalizeSuperfinancieraRecord()
 * - No crea entidades; no agrega sedes; no activa discovery sectorial financiero
 * - No expone phone/legalStatus/department porque el dataset no los tiene
 * - Priority boost 8 en match por NIT válido
 * - Nunca lanza excepción al wizard (fallback controlado por el registry hook)
 *
 * No activa discovery sectorial financiero — pendiente fase siguiente.
 *
 * Solo server-side. No usar en Client Components.
 */

import { fetchSocrataDatasetSample } from '../socrata-colombia/socrata-client';
import { normalizeSuperfinancieraRecord } from '../socrata-colombia/normalizers';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_KEY = 'co_superfinanciera' as const;
const DATASET_ID = 'sr9n-792w';
const SFC_QUERY_LIMIT = 1;
const SFC_PRIORITY_BOOST = 8;

// ─── Socrata fetch type alias (for injection in tests) ───────────────────────

type SocrataFetchFn = typeof fetchSocrataDatasetSample;

// ─── NIT Normalizer ──────────────────────────────────────────────────────────

/**
 * Normaliza NIT colombiano para lookup exacto en Socrata SFC.
 * Elimina espacios y puntos; si hay guión, toma solo el número base (sin dígito de verificación).
 */
export function normalizeSuperfinancieraNIT(raw: string): string {
  const cleaned = raw.replace(/[\s.]/g, '');
  const dashIdx = cleaned.indexOf('-');
  const base = dashIdx !== -1 ? cleaned.slice(0, dashIdx) : cleaned;
  return base.replace(/\D/g, '');
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function metaStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function metaBool(val: unknown): boolean {
  return val === true;
}

// ─── Core enrichment logic (injectable for tests) ─────────────────────────────

export async function enrichCandidateImpl(
  input: SourceEnrichmentInput,
  fetchFn: SocrataFetchFn,
): Promise<SourceEnrichmentOutput> {
  if (input.countryCode !== 'CO') {
    return {
      sourceKey: SOURCE_KEY,
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'country_not_supported',
    };
  }

  if (!input.candidateTaxId || input.candidateTaxId.trim().length === 0) {
    return {
      sourceKey: SOURCE_KEY,
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  const normalizedNit = normalizeSuperfinancieraNIT(input.candidateTaxId);

  if (normalizedNit.length === 0) {
    return {
      sourceKey: SOURCE_KEY,
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  // NIT '0' signals a foreign entity without Colombian NIT — not a valid lookup key
  if (normalizedNit === '0') {
    return {
      sourceKey: SOURCE_KEY,
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'invalid_colombian_tax_id',
    };
  }

  const result = await fetchFn({
    dataset: 'superfinanciera',
    limit: SFC_QUERY_LIMIT,
    where: `numeroidentificacion='${normalizedNit}'`,
    select: [
      'numeroidentificacion',
      'cod_entidad',
      'tipo_entidad',
      'razon_social',
      'ciudad',
      'direccion',
      'emailprincipal',
      'uripaginaweb',
      'representante_legal',
      'nombrepublicocargo',
    ].join(','),
  });

  if (!result.ok) {
    return {
      sourceKey: SOURCE_KEY,
      status: 'error',
      matchedBy: null,
      confidence: 0,
      reason: result.error,
    };
  }

  if (result.records.length === 0) {
    return {
      sourceKey: SOURCE_KEY,
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
    };
  }

  const normalized = normalizeSuperfinancieraRecord(result.records[0] as Record<string, unknown>);

  const sfcEntityTypeCode = metaStr(normalized.sourceMetadata['sfc_entity_type_code']);
  const sfcEntityTypeLabel = metaStr(normalized.sourceMetadata['sfc_entity_type_label']);
  const sfcEntityCode = metaStr(normalized.sourceMetadata['sfc_entity_code']);
  const sfcSupervised = metaBool(normalized.sourceMetadata['sfc_supervised_entity']);
  const foreignEntity = metaBool(normalized.sourceMetadata['foreign_entity_without_colombian_tax_id']);
  const legalRepName = metaStr(normalized.sourceMetadata['legal_representative_name']);
  const legalRepRole = metaStr(normalized.sourceMetadata['legal_representative_role']);

  return {
    sourceKey: SOURCE_KEY,
    status: 'matched',
    matchedBy: 'tax_id',
    confidence: 0.95,
    priorityBoost: SFC_PRIORITY_BOOST,
    signals: {
      sfc_supervised_entity: sfcSupervised,
      financial_sector_confirmed: true,
      sfc_entity_type_code: sfcEntityTypeCode,
      sfc_entity_type_label: sfcEntityTypeLabel,
      has_institutional_email: normalized.email !== null,
      has_website: normalized.website !== null,
      foreign_entity_without_colombian_tax_id: foreignEntity,
    },
    metadata: {
      source_dataset_id: DATASET_ID,
      matched_by: 'tax_id',
      enrichment: {
        legal_name: normalized.companyName,
        tax_id: normalized.taxId,
        sfc_entity_code: sfcEntityCode,
        sfc_entity_type_code: sfcEntityTypeCode,
        sfc_entity_type_label: sfcEntityTypeLabel,
        city: normalized.city,
        address: normalized.address,
        email: normalized.email,
        website: normalized.website,
        legal_representative_name: legalRepName,
        legal_representative_role: legalRepRole,
        // phone: not included — SFC dataset does not have phone
        // legalStatus: not included — SFC dataset does not have estado
        // department: not included — SFC dataset does not have departamento
      },
    },
  };
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export const superfinancieraEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: SOURCE_KEY,
  supportedCapabilities: [
    'enrichment_after_discovery',
    'tax_id_validation',
    'commercial_signals',
    'prioritization',
  ] as SourceCapability[],

  async getHealthStatus() {
    const result = await fetchSocrataDatasetSample({
      dataset: 'superfinanciera',
      limit: 1,
      select: 'numeroidentificacion',
    });
    return {
      healthy: result.ok,
      message: result.ok ? undefined : (result as { ok: false; error: string }).error,
    };
  },

  async enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> {
    return enrichCandidateImpl(input, fetchSocrataDatasetSample);
  },
};
