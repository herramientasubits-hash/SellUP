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
 * Intenta construir una dirección legible desde campos DENUE (API v1 2024+).
 * Campos reales: Tipo_vialidad, Calle, Num_Exterior, Colonia.
 * No falla si los campos están ausentes.
 */
function buildAddress(record: RawRecord): string | null {
  const parts = [
    str(record.Tipo_vialidad),
    str(record.Calle),
    str(record.Num_Exterior),
    str(record.Colonia),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Extrae ciudad y estado desde el campo Ubicacion de DENUE.
 * Formato observado: "LOCALIDAD                   , Municipio, ESTADO"
 * Devuelve [city, department] o [null, null] si no se puede parsear.
 */
function parseUbicacion(record: RawRecord): { city: string | null; department: string | null } {
  const raw = str(record.Ubicacion);
  if (!raw) return { city: null, department: null };
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length >= 3) {
    return { city: parts[1] ?? null, department: parts[2] ?? null };
  }
  if (parts.length === 2) {
    return { city: parts[0] ?? null, department: parts[1] ?? null };
  }
  return { city: parts[0] ?? null, department: null };
}

/**
 * Normaliza un registro raw de la API DENUE/INEGI (BuscarEntidad, v1 2024+).
 *
 * Campos reales que devuelve la API:
 *   CLEE         — clave única del establecimiento
 *   Id           — identificador interno
 *   Nombre       — nombre comercial del establecimiento
 *   Razon_social — razón social (vacío en personas físicas)
 *   Clase_actividad — descripción de actividad económica (sin código SCIAN numérico)
 *   Estrato      — rango de personal ocupado ("0 a 5 personas", "51 a 100 personas", …)
 *   Tipo_vialidad, Calle, Num_Exterior, Num_Interior, Colonia, CP — dirección
 *   Ubicacion    — "Localidad, Municipio, Estado"
 *   Telefono     — teléfono
 *   Correo_e     — correo electrónico
 *   Sitio_internet — sitio web
 *   Longitud, Latitud — coordenadas geográficas
 *
 * Nota: taxId (RFC) y sectorCode (SCIAN numérico) no están disponibles en este endpoint.
 */
export function normalizeDenueRecord(record: RawRecord): NormalizedMexicoCompanySample {
  const rawId = str(record.CLEE) ?? str(record.Id);
  const nombre = str(record.Nombre);
  const razonSocial = str(record.Razon_social);
  const estraroRaw = str(record.Estrato);
  const { city, department } = parseUbicacion(record);

  return {
    source: 'denue',
    sourceKey: SOURCE_KEY,
    datasetId: DATASET_ID,
    companyName: nombre ?? razonSocial,
    legalName: razonSocial,
    taxId: null,          // DENUE no entrega RFC
    legalStatus: null,    // DENUE no entrega estado legal
    sectorCode: null,     // BuscarEntidad no devuelve código SCIAN numérico
    sectorDescription: str(record.Clase_actividad),
    city,
    department,
    address: buildAddress(record),
    email: str(record.Correo_e),
    phone: str(record.Telefono),
    website: normalizeWebsite(str(record.Sitio_internet)),
    rawRecordId: rawId,
    perOcuRaw: estraroRaw,
    sourceMetadata: {
      colonia: str(record.Colonia),
      cp: str(record.CP),
      estrato: estraroRaw,
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
 * Deriva ReviewFlag de tamaño a partir del campo Estrato de DENUE (API v1 2024+).
 *
 * Valores reales del campo Estrato:
 *   "0 a 5 personas"    → bajo umbral
 *   "6 a 10 personas"   → bajo umbral
 *   "11 a 30 personas"  → bajo umbral
 *   "31 a 50 personas"  → bajo umbral
 *   "51 a 100 personas" → sobre umbral (estimado)
 *   "101 a 250 personas"→ sobre umbral (estimado)
 *   "251 y más personas"→ sobre umbral (estimado)
 *   null / desconocido  → desconocido
 *
 * Retorna un ReviewFlag de tamaño compatible con structured-candidate-types.
 */
export function deriveSizeFlagFromPerOcu(
  perOcuRaw: string | null,
): 'size_unknown' | 'size_estimated' | 'size_estimated_below_threshold' {
  if (!perOcuRaw) return 'size_unknown';

  const n = perOcuRaw.toLowerCase().trim();

  // Rangos sobre umbral de 50+
  if (n.includes('51 a 100') || n.includes('101 a 250') || n.includes('251')) {
    return 'size_estimated';
  }

  // Rangos bajo umbral
  if (
    n.includes('0 a 5') ||
    n.includes('6 a 10') ||
    n.includes('11 a 30') ||
    n.includes('31 a 50') ||
    n.includes('sin personal')
  ) {
    return 'size_estimated_below_threshold';
  }

  return 'size_unknown';
}
