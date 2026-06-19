/**
 * Personas Jurídicas Cámaras de Comercio — Enrichment Adapter
 *
 * Señal de registro mercantil activo para empresas colombianas.
 * Opera EXCLUSIVAMENTE en modo live contra datos.gov.co/resource/c82u-588k.json.
 *
 * Comportamiento:
 * - Solo para countryCode === 'CO'
 * - Requiere NIT válido — sin NIT devuelve skipped(missing_tax_id)
 * - Lookup exacto por NIT normalizado con filtro estado_matricula='ACTIVA'
 * - Sin búsqueda por nombre en esta fase
 * - Nunca lanza excepción al wizard (fallback controlado)
 * - Cobertura parcial: solo cámaras que publican en datos.gov.co
 *
 * Solo server-side. No usar en Client Components.
 */

import { fetchSocrataDatasetSample } from '../socrata-colombia/socrata-client';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Socrata fetch type alias (for injection in tests) ───────────────────────

type SocrataFetchFn = typeof fetchSocrataDatasetSample;

// ─── NIT Normalizer ──────────────────────────────────────────────────────────

/**
 * Normaliza NIT colombiano para lookup exacto en Socrata.
 * Elimina espacios y puntos; si hay guión, toma solo el número base (sin dígito de verificación).
 */
export function normalizePersonasJuridicasTaxId(raw: string): string {
  const cleaned = raw.replace(/[\s.]/g, '');
  const dashIdx = cleaned.indexOf('-');
  const base = dashIdx !== -1 ? cleaned.slice(0, dashIdx) : cleaned;
  return base.replace(/\D/g, '');
}

// ─── Registration status ─────────────────────────────────────────────────────

/**
 * Retorna true solo si estado_matricula es 'ACTIVA' (case-insensitive).
 * Cualquier otro valor (CANCELADA, INACTIVA, desconocido) retorna false.
 */
export function isActiveRegistrationStatus(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().toUpperCase() === 'ACTIVA';
  }
  return false;
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

// ─── Signals calculator ───────────────────────────────────────────────────────

export type RegistrationSignals = {
  legal_registry_match: boolean;
  active_registration: boolean;
  recent_renewal: boolean | null;
  last_renewal_year: number | null;
  chamber_of_commerce: string | null;
  primary_ciiu_code: string | null;
};

export function calculateRegistrationSignals(
  record: Record<string, unknown>,
  currentYear: number = new Date().getFullYear(),
): RegistrationSignals {
  const registrationStatus = str(record['estado_matricula']);
  const activeRegistration = isActiveRegistrationStatus(registrationStatus);

  const lastRenewalRaw = record['ultimo_ano_renovado'];
  let lastRenewalYear: number | null = null;
  if (typeof lastRenewalRaw === 'number') {
    lastRenewalYear = lastRenewalRaw;
  } else if (typeof lastRenewalRaw === 'string') {
    const parsed = parseInt(lastRenewalRaw.trim(), 10);
    if (!isNaN(parsed)) lastRenewalYear = parsed;
  }

  const recentRenewal =
    lastRenewalYear !== null ? lastRenewalYear >= currentYear - 1 : null;

  return {
    legal_registry_match: true,
    active_registration: activeRegistration,
    recent_renewal: recentRenewal,
    last_renewal_year: lastRenewalYear,
    chamber_of_commerce: str(record['camara_comercio']),
    // Dataset may use either field name variant
    primary_ciiu_code:
      str(record['codigo_ciiu_act_econ_pri']) ?? str(record['cod_ciiu_act_econ_pri']),
  };
}

// ─── Priority boost ───────────────────────────────────────────────────────────

export function calculateRegistrationPriorityBoost(signals: RegistrationSignals): number {
  if (!signals.active_registration) return 0;
  if (signals.recent_renewal === true) return 6;
  return 4;
}

// ─── Result builder ───────────────────────────────────────────────────────────

export function buildMatchResultFromCCRecord(
  record: Record<string, unknown>,
  currentYear: number = new Date().getFullYear(),
): SourceEnrichmentOutput {
  const signals = calculateRegistrationSignals(record, currentYear);
  const priorityBoost = calculateRegistrationPriorityBoost(signals);

  return {
    sourceKey: 'co_personas_juridicas_cc',
    status: 'matched',
    matchedBy: 'tax_id',
    confidence: 0.85,
    priorityBoost,
    signals: { ...signals },
    metadata: {
      source_dataset_id: 'c82u-588k',
      matched_by: 'tax_id',
      enrichment: {
        legal_name: str(record['razon_social']),
        chamber_of_commerce: str(record['camara_comercio']),
        registration_category: str(record['categoria_matricula']),
        legal_organization: str(record['organizacion_juridica']),
        registration_status: str(record['estado_matricula']),
        registration_date: str(record['fecha_matricula']),
        cancellation_date: str(record['fecha_cancelacion']),
        validity_date: str(record['fecha_vigencia']),
        last_renewal_year: signals.last_renewal_year,
        primary_ciiu_code: signals.primary_ciiu_code,
      },
    },
  };
}

// ─── Core enrichment logic (injectable for tests) ─────────────────────────────

export async function enrichCandidateImpl(
  input: SourceEnrichmentInput,
  fetchFn: SocrataFetchFn,
  currentYear: number = new Date().getFullYear(),
): Promise<SourceEnrichmentOutput> {
  if (input.countryCode !== 'CO') {
    return {
      sourceKey: 'co_personas_juridicas_cc',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'country_not_supported',
    };
  }

  if (!input.candidateTaxId || input.candidateTaxId.trim().length === 0) {
    return {
      sourceKey: 'co_personas_juridicas_cc',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  const normalizedNit = normalizePersonasJuridicasTaxId(input.candidateTaxId);

  if (normalizedNit.length === 0) {
    return {
      sourceKey: 'co_personas_juridicas_cc',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  const result = await fetchFn({
    dataset: 'personas_juridicas_cc',
    limit: 1,
    where: `numero_identificacion='${normalizedNit}' AND estado_matricula='ACTIVA'`,
    select: [
      'numero_identificacion',
      'razon_social',
      'camara_comercio',
      'categoria_matricula',
      'organizacion_juridica',
      'estado_matricula',
      'fecha_matricula',
      'fecha_cancelacion',
      'fecha_vigencia',
      'ultimo_ano_renovado',
      'codigo_ciiu_act_econ_pri',
    ].join(','),
  });

  if (!result.ok) {
    return {
      sourceKey: 'co_personas_juridicas_cc',
      status: 'error',
      matchedBy: null,
      confidence: 0,
      reason: result.error,
    };
  }

  if (result.records.length === 0) {
    return {
      sourceKey: 'co_personas_juridicas_cc',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
    };
  }

  const record = result.records[0] as Record<string, unknown>;

  // Safety check: confirm ACTIVA even though WHERE should filter it
  if (!isActiveRegistrationStatus(record['estado_matricula'])) {
    return {
      sourceKey: 'co_personas_juridicas_cc',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      reason: 'registration_not_active',
    };
  }

  return buildMatchResultFromCCRecord(record, currentYear);
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export const personasJuridicasCCEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: 'co_personas_juridicas_cc',
  supportedCapabilities: [
    'enrichment_after_discovery',
    'tax_id_validation',
    'commercial_signals',
    'prioritization',
  ] as SourceCapability[],

  async getHealthStatus() {
    const result = await fetchSocrataDatasetSample({
      dataset: 'personas_juridicas_cc',
      limit: 1,
      select: 'numero_identificacion',
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
