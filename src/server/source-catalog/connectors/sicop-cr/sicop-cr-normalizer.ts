/**
 * SICOP Costa Rica — Normalizador y Parser XLSX
 *
 * Parsea filas de datasets SICOP (XLSX/XLS), extrae proveedores únicos,
 * normaliza cédulas jurídicas costarricenses.
 *
 * Guardrail semántico:
 *   - SICOP no es fuente legal ni tributaria.
 *   - No valida cédula jurídica como fuente fiscal oficial.
 *   - Solo clasifica si el identificador parece de persona jurídica (inicia con 3).
 *   - human_review_required = true siempre.
 *
 * Hito: Centroamérica.4A
 */

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type SicopRawRow = Record<string, string | number | null | undefined>;

export type SicopSkipReason =
  | 'no_identifier'
  | 'invalid_identifier'
  | 'non_company_identifier'
  | 'no_name'
  | 'empty_row';

export type SicopNormalizedId =
  | { valid: true; normalized: string }
  | { valid: false; reason: SicopSkipReason };

export type SicopProviderRecord = {
  /** Cédula jurídica normalizada (solo dígitos). */
  cedula: string;
  /** Nombre/razón social del proveedor. */
  name: string;
  /** Número de procedimiento de compra. */
  procedureNumber: string | null;
  /** Cédula de la institución compradora. */
  buyerId: string | null;
  /** Nombre de la institución compradora. */
  buyerName: string | null;
  /** Fecha del evento (solicitud, presentación, etc.). */
  eventDate: string | null;
  /** Dataset de origen (e.g. 'ofertas_2024'). */
  dataset: string;
};

export type ParseSicopXlsxResult = {
  totalRows: number;
  providers: SicopProviderRecord[];
  skippedNoIdentifier: number;
  skippedInvalidIdentifier: number;
  skippedNonCompany: number;
  skippedNoName: number;
  skippedEmptyRow: number;
  warnings: string[];
};

// ─── Normalización de cédula jurídica CR ──────────────────────────────────────

/**
 * Normaliza una cédula costarricense.
 *
 * Reglas:
 * - Eliminar guiones, espacios, puntos.
 * - Aceptar solo dígitos.
 * - Persona jurídica: inicia con 3 (ej: 3-101-XXXXXX → 3101XXXXXX).
 * - Longitud esperada: 9–12 dígitos (los datasets pueden variar).
 * - Si no inicia con 3 → non_company_identifier (persona física u otro).
 * - Si longitud fuera de rango → invalid_identifier.
 * - Si vacío o no-string → no_identifier.
 *
 * Nota: SICOP no es fuente oficial de validación fiscal; esta normalización
 * es heurística para agrupar registros, no sustituto de Hacienda CR.
 */
export function normalizeCostaRicaLegalId(value: unknown): SicopNormalizedId {
  if (value === null || value === undefined || value === '') {
    return { valid: false, reason: 'no_identifier' };
  }

  const raw = String(value).trim();
  if (raw === '') return { valid: false, reason: 'no_identifier' };

  // Eliminar separadores comunes en cédulas CR: guiones, puntos, espacios
  const digits = raw.replace(/[-.\s]/g, '');

  // Debe ser solo dígitos después de limpiar
  if (!/^\d+$/.test(digits)) {
    return { valid: false, reason: 'invalid_identifier' };
  }

  // Longitud razonable para cédula CR (9 a 12 dígitos)
  if (digits.length < 9 || digits.length > 12) {
    return { valid: false, reason: 'invalid_identifier' };
  }

  // Personas jurídicas costarricenses inician con 3
  if (!digits.startsWith('3')) {
    return { valid: false, reason: 'non_company_identifier' };
  }

  return { valid: true, normalized: digits };
}

// ─── Lectura flexible de columnas SICOP ───────────────────────────────────────

/**
 * Extrae el valor de una columna buscando múltiples variantes de nombre.
 * SICOP tiene nombres de columna inconsistentes entre datasets.
 */
function getCol(row: SicopRawRow, ...candidates: string[]): string | null {
  for (const col of candidates) {
    const val = row[col] ?? row[col.toUpperCase()] ?? row[col.toLowerCase()];
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return null;
}

/**
 * Extrae la cédula del proveedor de una fila SICOP.
 * Columnas posibles: CEDULA_PROVEEDOR, cedula_proveedor.
 */
export function extractCedula(row: SicopRawRow): string | null {
  return getCol(row, 'CEDULA_PROVEEDOR', 'cedula_proveedor');
}

/**
 * Extrae el nombre del proveedor de una fila SICOP.
 * Columnas posibles: PROVEEDOR, EMPRESA_PROVEEDORA, proveedor, empresa_proveedora.
 */
export function extractProviderName(row: SicopRawRow): string | null {
  return getCol(row, 'PROVEEDOR', 'EMPRESA_PROVEEDORA', 'proveedor', 'empresa_proveedora');
}

/**
 * Extrae el número de procedimiento de compra.
 */
export function extractProcedureNumber(row: SicopRawRow): string | null {
  return getCol(row, 'NUMERO_PROCEDIMIENTO', 'NRO_PROCEDIMIENTO', 'numero_procedimiento', 'nro_procedimiento');
}

/**
 * Extrae la cédula de la institución compradora.
 */
export function extractBuyerId(row: SicopRawRow): string | null {
  return getCol(row, 'CEDULA_INSTITUCION', 'cedula_institucion');
}

/**
 * Extrae el nombre de la institución compradora.
 */
export function extractBuyerName(row: SicopRawRow): string | null {
  return getCol(row, 'INSTITUCION', 'institucion');
}

/**
 * Extrae la fecha del evento (la primera que encuentre disponible).
 */
export function extractEventDate(row: SicopRawRow): string | null {
  return getCol(
    row,
    'FECHA_SOLICITUD', 'fecha_solicitud',
    'FECHA_PRESENTACION_RECURSO', 'fecha_presentacion_recurso',
    'FECHA_PUBLICACION', 'fecha_publicacion',
    'FECHA_APERTURA', 'fecha_apertura',
    'FECHA_PRESENTA_OFERTA', 'fecha_presenta_oferta',
  );
}

// ─── Parser de filas XLSX ──────────────────────────────────────────────────────

/**
 * Parsea un array de filas raw de un XLSX SICOP.
 *
 * @param rows   Filas como objetos con claves = nombres de columna.
 * @param dataset Nombre del dataset origen (ej: 'ofertas_2024').
 * @param limitRows Máximo de filas a procesar (seguridad, default 2000).
 */
export function parseSicopRows(
  rows: SicopRawRow[],
  dataset: string,
  limitRows = 2_000,
): ParseSicopXlsxResult {
  const result: ParseSicopXlsxResult = {
    totalRows: 0,
    providers: [],
    skippedNoIdentifier: 0,
    skippedInvalidIdentifier: 0,
    skippedNonCompany: 0,
    skippedNoName: 0,
    skippedEmptyRow: 0,
    warnings: [],
  };

  const processedRows = rows.slice(0, limitRows);
  result.totalRows = processedRows.length;

  if (rows.length > limitRows) {
    result.warnings.push(`Dataset tiene ${rows.length} filas; procesando solo las primeras ${limitRows} (--limit-rows).`);
  }

  for (const row of processedRows) {
    // Fila vacía o sin campos
    const hasAnyValue = Object.values(row).some(
      (v) => v !== null && v !== undefined && String(v).trim() !== '',
    );
    if (!hasAnyValue) {
      result.skippedEmptyRow++;
      continue;
    }

    // Validar cédula
    const rawCedula = extractCedula(row);
    if (!rawCedula) {
      result.skippedNoIdentifier++;
      continue;
    }

    const idResult = normalizeCostaRicaLegalId(rawCedula);
    if (!idResult.valid) {
      if (idResult.reason === 'no_identifier') result.skippedNoIdentifier++;
      else if (idResult.reason === 'non_company_identifier') result.skippedNonCompany++;
      else result.skippedInvalidIdentifier++;
      continue;
    }

    // Nombre: intentar extraer; si no existe en el dataset (ej: ofertas_2024 no tiene columna de nombre),
    // usar placeholder para no descartar la cédula válida. human_review_required=true siempre.
    const name = extractProviderName(row) ?? `PROVEEDOR_CR_${idResult.normalized}`;

    result.providers.push({
      cedula: idResult.normalized,
      name,
      procedureNumber: extractProcedureNumber(row),
      buyerId: extractBuyerId(row),
      buyerName: extractBuyerName(row),
      eventDate: extractEventDate(row),
      dataset,
    });
  }

  return result;
}

// ─── Deduplicación de proveedores ─────────────────────────────────────────────

export type UniqueProvider = {
  cedula: string;
  name: string;
  records: SicopProviderRecord[];
};

/**
 * Agrupa los registros parseados por cédula jurídica normalizada.
 * Retiene el nombre más frecuente como nombre canónico.
 */
export function deduplicateProviders(
  records: SicopProviderRecord[],
  maxProviders = 500,
): UniqueProvider[] {
  const map = new Map<string, { nameFreq: Map<string, number>; records: SicopProviderRecord[] }>();

  for (const rec of records) {
    const existing = map.get(rec.cedula);
    if (!existing) {
      const freq = new Map<string, number>();
      freq.set(rec.name, 1);
      map.set(rec.cedula, { nameFreq: freq, records: [rec] });
    } else {
      existing.records.push(rec);
      existing.nameFreq.set(rec.name, (existing.nameFreq.get(rec.name) ?? 0) + 1);
    }
  }

  const providers: UniqueProvider[] = [];
  for (const [cedula, { nameFreq, records }] of map) {
    if (providers.length >= maxProviders) break;
    // Nombre más frecuente
    let bestName = '';
    let bestCount = 0;
    for (const [n, count] of nameFreq) {
      if (count > bestCount) { bestName = n; bestCount = count; }
    }
    providers.push({ cedula, name: bestName, records });
  }

  return providers;
}
