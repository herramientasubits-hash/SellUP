/**
 * DENUE Mexico Connector — Normalizers
 *
 * Mapea campos DENUE al tipo común NormalizedMexicoCompanySample.
 * Normalización defensiva: si un campo no existe o es inesperado, no rompe.
 * No incluye PII innecesaria. No guarda raw completo.
 */

import type { NormalizedMexicoCompanySample } from './types';

const SOURCE_KEY = 'mx_denue';
const DATASET_ID = 'denue';

type RawRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

/**
 * Intenta construir una dirección legible desde campos DENUE.
 * No falla si los campos están ausentes.
 */
function buildAddress(record: RawRecord): string | null {
  const parts = [
    str(record.tipo_vial),
    str(record.nom_vial),
    str(record.num_ext),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Normaliza un registro raw de la API DENUE/INEGI.
 *
 * Campos DENUE esperados (defensivos — pueden variar):
 *   id / clee: identificador único del establecimiento
 *   nom_estab: nombre del establecimiento (nombre comercial)
 *   raz_social: razón social (puede estar vacío en personas físicas)
 *   codigo_act: código de actividad SCIAN
 *   nombre_act: descripción de actividad SCIAN
 *   per_ocu: rango de personal ocupado (texto, p.ej. "51 a 100 personas")
 *   nom_mun: nombre del municipio/delegación
 *   nom_ent: nombre de la entidad federativa (estado)
 *   tipo_vial / nom_vial / num_ext: componentes de dirección
 *   correoelec: correo electrónico
 *   www: sitio web
 *   telefono: teléfono
 */
export function normalizeDenueRecord(record: RawRecord): NormalizedMexicoCompanySample {
  const rawId = str(record.id) ?? str(record.clee);
  const nomEstab = str(record.nom_estab);
  const razSocial = str(record.raz_social);
  const perOcuRaw = str(record.per_ocu);

  return {
    source: 'denue',
    sourceKey: SOURCE_KEY,
    datasetId: DATASET_ID,
    companyName: nomEstab ?? razSocial,
    legalName: razSocial,
    taxId: null, // DENUE no entrega RFC
    legalStatus: null, // DENUE no entrega estado legal
    sectorCode: str(record.codigo_act),
    sectorDescription: str(record.nombre_act),
    city: str(record.nom_mun),
    department: str(record.nom_ent),
    address: buildAddress(record),
    email: str(record.correoelec),
    phone: str(record.telefono),
    website: normalizeWebsite(str(record.www)),
    rawRecordId: rawId,
    perOcuRaw,
    sourceMetadata: {
      nom_loc: str(record.nom_loc),
      cod_postal: str(record.cod_postal),
      per_ocu: perOcuRaw,
    },
  };
}

/**
 * Normaliza la URL del sitio web DENUE.
 * DENUE a veces entrega valores como "www.ejemplo.com" sin esquema.
 */
function normalizeWebsite(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('www.')) return `https://${trimmed}`;
  return null;
}

/**
 * Deriva ReviewFlag de tamaño a partir del campo per_ocu de DENUE.
 *
 * Rangos DENUE per_ocu:
 *   "0 personas" / "Sin personal"  → bajo umbral
 *   "1 a 5 personas"               → bajo umbral
 *   "6 a 10 personas"              → bajo umbral
 *   "11 a 30 personas"             → bajo umbral
 *   "31 a 50 personas"             → bajo umbral
 *   "51 a 100 personas"            → sobre umbral (estimado)
 *   "101 a 250 personas"           → sobre umbral (estimado)
 *   "251 y más personas"           → sobre umbral (estimado)
 *   null / desconocido             → desconocido
 *
 * Retorna un ReviewFlag de tamaño compatible con structured-candidate-types.
 */
export function deriveSizeFlagFromPerOcu(
  perOcuRaw: string | null,
): 'size_unknown' | 'size_estimated' | 'size_estimated_below_threshold' {
  if (!perOcuRaw) return 'size_unknown';

  const normalized = perOcuRaw.toLowerCase().trim();

  // Rangos claramente sobre el umbral de 50+
  if (
    normalized.includes('51') ||
    normalized.includes('101') ||
    normalized.includes('251') ||
    normalized.includes('251 y más')
  ) {
    return 'size_estimated';
  }

  // Rangos claramente bajo el umbral
  if (
    normalized.includes('0 persona') ||
    normalized.includes('sin personal') ||
    normalized.includes('1 a 5') ||
    normalized.includes('6 a 10') ||
    normalized.includes('11 a 30') ||
    normalized.includes('31 a 50')
  ) {
    return 'size_estimated_below_threshold';
  }

  return 'size_unknown';
}
