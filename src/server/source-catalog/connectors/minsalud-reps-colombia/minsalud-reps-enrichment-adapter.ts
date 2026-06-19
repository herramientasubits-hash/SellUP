/**
 * MinSalud REPS — Enrichment Adapter
 *
 * Señal comercial de prestador de salud registrado en el Registro Especial de
 * Prestadores de Servicios de Salud (REPS). Enriquece candidatos post-discovery
 * para Colombia cuando hay NIT disponible.
 *
 * Comportamiento:
 * - Solo para countryCode === 'CO'
 * - Requiere NIT válido — sin NIT devuelve skipped(missing_tax_id)
 * - Lookup por NIT: $where=numeroidentificacion='<NIT>' con $limit=20
 * - Normaliza cada fila con normalizeRepsRecord()
 * - Agrupa sedes con dedupeRepsRecordsByProvider() — una entidad por NIT
 * - No crea entidades por codigohabilitacionsede; las sedes van en sites[]
 * - Protección de datos personales: email/phone principales nulos para tipoid != NI
 * - Priority boost según tipoid y número de sedes
 * - Nunca lanza excepción al wizard (fallback controlado por el registry hook)
 *
 * No activa discovery sectorial salud — pendiente fase siguiente.
 *
 * Solo server-side. No usar en Client Components.
 */

import { fetchSocrataDatasetSample } from '../socrata-colombia/socrata-client';
import { normalizeRepsRecord } from '../socrata-colombia/normalizers';
import { dedupeRepsRecordsByProvider } from '../socrata-colombia/reps-helpers';
import type { RepsGroupedProvider } from '../socrata-colombia/reps-helpers';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_KEY = 'co_minsalud_reps' as const;
const DATASET_ID = 'c36g-9fc2';
const REPS_QUERY_LIMIT = 20;

// ─── Socrata fetch type alias (for injection in tests) ───────────────────────

type SocrataFetchFn = typeof fetchSocrataDatasetSample;

// ─── NIT Normalizer ──────────────────────────────────────────────────────────

/**
 * Normaliza NIT colombiano para lookup exacto en Socrata.
 * Elimina espacios y puntos; si hay guión, toma solo el número base (sin dígito de verificación).
 */
export function normalizeRepsNIT(raw: string): string {
  const cleaned = raw.replace(/[\s.]/g, '');
  const dashIdx = cleaned.indexOf('-');
  const base = dashIdx !== -1 ? cleaned.slice(0, dashIdx) : cleaned;
  return base.replace(/\D/g, '');
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function metaStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function parseEseFlag(val: unknown): boolean | null {
  if (typeof val !== 'string') return null;
  const v = val.trim().toUpperCase();
  if (v === 'SI' || v === 'SÍ' || v === 'S' || v === '1' || v === 'TRUE') return true;
  if (v === 'NO' || v === '0' || v === 'FALSE') return false;
  return null;
}

// ─── Priority boost ───────────────────────────────────────────────────────────

/**
 * Priority boost rules:
 * - tipoid NI + múltiples sedes: 8
 * - tipoid NI + una sede:        6
 * - tipoid distinto de NI:       3
 */
export function calculateRepsPriorityBoost(idType: string | null, totalSites: number): number {
  if (idType !== 'NI') return 3;
  return totalSites > 1 ? 8 : 6;
}

// ─── Result builder ───────────────────────────────────────────────────────────

export function buildMatchResultFromRepsGroup(
  grouped: RepsGroupedProvider,
): SourceEnrichmentOutput {
  const idType = metaStr(grouped.sourceMetadata['id_type']);
  const providerClass = metaStr(grouped.sourceMetadata['provider_class']);
  const legalNature = metaStr(grouped.sourceMetadata['legal_nature']);
  const isEse = parseEseFlag(grouped.sourceMetadata['is_ese']);
  // Personal data guard: normalizeRepsRecord already nulls email/phone for non-NI.
  // We also mark the flag explicitly for non-NI even if sourceMetadata doesn't carry it.
  const personalDataGuard =
    grouped.sourceMetadata['personal_data_guard_applied'] === true || idType !== 'NI';

  const priorityBoost = calculateRepsPriorityBoost(idType, grouped.total_sites);

  return {
    sourceKey: SOURCE_KEY,
    status: 'matched',
    matchedBy: 'tax_id',
    confidence: 0.95,
    priorityBoost,
    signals: {
      health_provider_registered: true,
      provider_class: providerClass,
      legal_nature: legalNature,
      is_ese: isEse,
      total_sites: grouped.total_sites,
      departments: grouped.departments,
      municipalities: grouped.municipalities,
      has_multiple_sites: grouped.total_sites > 1,
    },
    metadata: {
      source_dataset_id: DATASET_ID,
      matched_by: 'tax_id',
      personal_data_guard_applied: personalDataGuard,
      enrichment: {
        provider_name: grouped.companyName,
        tax_id: grouped.taxId,
        reps_provider_code: metaStr(grouped.sourceMetadata['reps_provider_code']),
        id_type: idType,
        provider_class: providerClass,
        legal_nature: legalNature,
        department: grouped.department,
        municipality: grouped.city,
        address: grouped.address,
        // email/phone already guarded to null for non-NI by normalizeRepsRecord
        email: grouped.email,
        phone: grouped.phone,
        sites: grouped.sites,
      },
    },
  };
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

  const normalizedNit = normalizeRepsNIT(input.candidateTaxId);

  if (normalizedNit.length === 0) {
    return {
      sourceKey: SOURCE_KEY,
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  const result = await fetchFn({
    dataset: 'reps',
    limit: REPS_QUERY_LIMIT,
    where: `numeroidentificacion='${normalizedNit}'`,
    select: [
      'numeroidentificacion',
      'tipoid',
      'nombreprestador',
      'codigoprestador',
      'claseprestador',
      'naturalezajuridica',
      'ese',
      'departamentoprestadordesc',
      'municipioprestadordesc',
      'direccionprestador',
      'email_prestador',
      'telefonoprestador',
      'codigohabilitacionsede',
      'nombresede',
      'direcci_nsede',
      'email_sede',
      't_lefonosede',
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

  const normalizedRecords = (result.records as Record<string, unknown>[]).map(normalizeRepsRecord);
  const grouped = dedupeRepsRecordsByProvider(normalizedRecords);

  if (grouped.length === 0) {
    return {
      sourceKey: SOURCE_KEY,
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
    };
  }

  return buildMatchResultFromRepsGroup(grouped[0]!);
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export const minsaludRepsEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: SOURCE_KEY,
  supportedCapabilities: [
    'enrichment_after_discovery',
    'tax_id_validation',
    'commercial_signals',
    'prioritization',
  ] as SourceCapability[],

  async getHealthStatus() {
    const result = await fetchSocrataDatasetSample({
      dataset: 'reps',
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
