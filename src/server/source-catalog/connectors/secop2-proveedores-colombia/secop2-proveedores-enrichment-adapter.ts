/**
 * SECOP II Proveedores Colombia — Enrichment Adapter
 *
 * Señal comercial B2G para empresas registradas como proveedoras del Estado colombiano.
 * Opera EXCLUSIVAMENTE en modo live contra datos.gov.co/resource/qmzu-gj57.json.
 *
 * Comportamiento:
 * - Solo para countryCode === 'CO'
 * - Requiere NIT válido — sin NIT devuelve skipped(missing_tax_id)
 * - Lookup exacto por NIT normalizado vía Socrata SoQL ($where=nit='<NIT>')
 * - Sin búsqueda por nombre en esta fase
 * - Nunca lanza excepción al wizard (fallback controlado)
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
export function normalizeColombianNIT(raw: string): string {
  const cleaned = raw.replace(/[\s.]/g, '');
  const dashIdx = cleaned.indexOf('-');
  const base = dashIdx !== -1 ? cleaned.slice(0, dashIdx) : cleaned;
  return base.replace(/\D/g, '');
}

// ─── Field parsers ───────────────────────────────────────────────────────────

export function parseActiveStatus(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'si' || v === 'sí' || v === 's' || v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'no' || v === 'false' || v === '0') return false;
  }
  return null;
}

function parsePymeStatus(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'si' || v === 'sí' || v === 's' || v === 'true' || v === '1') return true;
    if (v === 'no' || v === 'false' || v === '0') return false;
  }
  return null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

// ─── Result builder ──────────────────────────────────────────────────────────

export function buildMatchResultFromRecord(record: Record<string, unknown>): SourceEnrichmentOutput {
  const isActive = parseActiveStatus(record['esta_activa']);
  const isPyme = parsePymeStatus(record['espyme']);
  const priorityBoost = isActive === true ? 8 : 4;

  return {
    sourceKey: 'co_secop2_proveedores',
    status: 'matched',
    matchedBy: 'tax_id',
    confidence: 0.9,
    priorityBoost,
    signals: {
      b2g_provider_registered: true,
      secop2_active: isActive,
      is_pyme: isPyme,
      main_category_code: str(record['codigo_categoria_principal']),
      main_category_description: str(record['descripcion_categoria_principal']),
    },
    metadata: {
      source_dataset_id: 'qmzu-gj57',
      enrichment: {
        legal_name: str(record['nombre']),
        email: str(record['correo']),
        phone: str(record['telefono']),
        address: str(record['direccion']),
        website: str(record['sitio_web']),
        department: str(record['departamento']),
        municipality: str(record['municipio']),
        company_type: str(record['tipo_empresa']),
        legal_representative_name: str(record['nombre_representante_legal']),
        legal_representative_email: str(record['correo_representante_legal']),
        created_at_secop: str(record['fecha_creacion']),
      },
    },
  };
}

// ─── Core enrichment logic (injectable for tests) ────────────────────────────

export async function enrichCandidateImpl(
  input: SourceEnrichmentInput,
  fetchFn: SocrataFetchFn,
): Promise<SourceEnrichmentOutput> {
  if (input.countryCode !== 'CO') {
    return {
      sourceKey: 'co_secop2_proveedores',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'country_not_supported',
    };
  }

  if (!input.candidateTaxId || input.candidateTaxId.trim().length === 0) {
    return {
      sourceKey: 'co_secop2_proveedores',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  const normalizedNit = normalizeColombianNIT(input.candidateTaxId);

  if (normalizedNit.length === 0) {
    return {
      sourceKey: 'co_secop2_proveedores',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_tax_id',
    };
  }

  const result = await fetchFn({
    dataset: 'secop2_proveedores',
    limit: 1,
    where: `nit='${normalizedNit}'`,
    select: [
      'nit',
      'nombre',
      'correo',
      'telefono',
      'direccion',
      'sitio_web',
      'departamento',
      'municipio',
      'tipo_empresa',
      'codigo_categoria_principal',
      'descripcion_categoria_principal',
      'esta_activa',
      'espyme',
      'nombre_representante_legal',
      'correo_representante_legal',
      'fecha_creacion',
    ].join(','),
  });

  if (!result.ok) {
    return {
      sourceKey: 'co_secop2_proveedores',
      status: 'error',
      matchedBy: null,
      confidence: 0,
      reason: result.error,
    };
  }

  if (result.records.length === 0) {
    return {
      sourceKey: 'co_secop2_proveedores',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
    };
  }

  const record = result.records[0] as Record<string, unknown>;
  return buildMatchResultFromRecord(record);
}

// ─── Adapter implementation ──────────────────────────────────────────────────

export const secop2ProveedoresEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: 'co_secop2_proveedores',
  supportedCapabilities: [
    'enrichment_after_discovery',
    'tax_id_validation',
    'commercial_signals',
    'prioritization',
  ] as SourceCapability[],

  async getHealthStatus() {
    const result = await fetchSocrataDatasetSample({
      dataset: 'secop2_proveedores',
      limit: 1,
      select: 'nit',
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
