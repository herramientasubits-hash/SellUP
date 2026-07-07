/**
 * GT RGAE — Adapter + Dedup
 *
 * Pipeline puro (sin IO):
 *   raw rows → classify tipo → filter Sociedades → normalize NIT →
 *   parse fechas/números → parse economic capacity → normalize name →
 *   dedup por NIT (latest resolution) → normalized candidates
 *
 * Dedup tie-breaker:
 *   1. FECHA_RESOLUCION más reciente (fecha ISO descendente)
 *   2. NO_RESOLUCION mayor (número descendente)
 *   3. NOMBRE_PROVEEDOR alphabetically first (determinístico, no depende del orden del XLSX)
 *
 * Hito: Centroamérica.7G.1 — sin writes DB.
 */

import type { GtRgaeRawRow, GtRgaeNormalizedCandidate, GtRgaeSupplierType } from './gt-rgae-types';
import { normalizeGuatemalaNit, maskGuatemalaNit } from './gt-nit-normalizer';
import { parseEconomicCapacity } from './gt-rgae-economic-capacity-parser';

// ─── Tipo proveedor ───────────────────────────────────────────────────────────

export function classifySupplierType(raw: string | null): GtRgaeSupplierType {
  if (!raw || raw.trim() === '') return 'missing';
  const s = raw.trim();
  if (s === 'Persona Individual') return 'Persona Individual';
  if (s === 'Sociedades') return 'Sociedades';
  if (s === 'Comerciante Individual') return 'Comerciante Individual';
  if (s === 'ONG') return 'ONG';
  if (s === 'Asociación' || s === 'Asociacion') return 'Asociación';
  return 'other';
}

// ─── Name normalizer ──────────────────────────────────────────────────────────

export function normalizeSupplierName(raw: string | null): string {
  if (!raw) return '';
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

// ─── Date parser ──────────────────────────────────────────────────────────────

/**
 * Parsea FECHA_RESOLUCION.
 * Acepta: ISO string, "DD/MM/YYYY", "MM/DD/YYYY", Excel serial number.
 * Devuelve ISO date string "YYYY-MM-DD" o null si inválida.
 */
export function parseResolutionDate(raw: string | number | null): string | null {
  if (raw === null || raw === undefined) return null;

  // Excel serial number (número entre 1 y ~50000)
  if (typeof raw === 'number') {
    if (raw > 0 && raw < 100_000) {
      const date = XLSX_dateFromSerial(raw);
      if (date) return toIsoDate(date);
    }
    return null;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Ya es ISO-like: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return s.slice(0, 10);
    return null;
  }

  // DD/MM/YYYY o MM/DD/YYYY — en MINFIN Guatemala el formato es DD/MM/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch;
    // Interpretamos como DD/MM/YYYY (convención MINFIN Guatemala)
    const d = new Date(`${y}-${b!.padStart(2, '0')}-${a!.padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return toIsoDate(d);
    return null;
  }

  // ISO date object string from SheetJS cellDates
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toIsoDate(d);

  return null;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

// SheetJS stores Excel serial as days since 1900-01-00 (with Lotus 1-2-3 bug for 1900-02-29)
function XLSX_dateFromSerial(serial: number): Date | null {
  try {
    // Use offset: Excel epoch is Dec 30, 1899
    const msPerDay = 86400000;
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + serial * msPerDay);
    if (isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

// ─── Number parser ────────────────────────────────────────────────────────────

export function parseNullableInt(raw: string | number | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  const s = String(raw).trim().replace(/,/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// ─── Adapter stats ────────────────────────────────────────────────────────────

export interface GtRgaeAdapterStats {
  totalRows: number;

  personaIndividual: number;
  sociedades: number;
  comercianteIndividual: number;
  ong: number;
  asociacion: number;
  otherType: number;
  missingType: number;

  sociedadesValidNit: number;
  sociedadesInvalidNit: number;
  sociedadesUniqueNit: number;

  duplicateSociedadRows: number;
  dedupReplacements: number;

  resolutionDateInvalid: number;
  resolutionNumberInvalid: number;

  economicCapacityNotApplicable: number;
  economicCapacityDirectPurchase: number;
  economicCapacityNumeric: number;
  economicCapacityUnparsed: number;

  supplierNameMissing: number;
  supplierNameNormalizationCollisions: number;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface GtRgaeAdapterResult {
  candidates: GtRgaeNormalizedCandidate[];
  stats: GtRgaeAdapterStats;
}

export function adaptRgaeRows(rows: GtRgaeRawRow[]): GtRgaeAdapterResult {
  const stats: GtRgaeAdapterStats = {
    totalRows: rows.length,
    personaIndividual: 0,
    sociedades: 0,
    comercianteIndividual: 0,
    ong: 0,
    asociacion: 0,
    otherType: 0,
    missingType: 0,
    sociedadesValidNit: 0,
    sociedadesInvalidNit: 0,
    sociedadesUniqueNit: 0,
    duplicateSociedadRows: 0,
    dedupReplacements: 0,
    resolutionDateInvalid: 0,
    resolutionNumberInvalid: 0,
    economicCapacityNotApplicable: 0,
    economicCapacityDirectPurchase: 0,
    economicCapacityNumeric: 0,
    economicCapacityUnparsed: 0,
    supplierNameMissing: 0,
    supplierNameNormalizationCollisions: 0,
  };

  // Step 1: classify + count tipo proveedor
  const sociedadRows: GtRgaeRawRow[] = [];

  for (const row of rows) {
    const tipo = classifySupplierType(row.TIPO_PROVEEDOR);
    switch (tipo) {
      case 'Persona Individual': stats.personaIndividual++; break;
      case 'Sociedades': stats.sociedades++; sociedadRows.push(row); break;
      case 'Comerciante Individual': stats.comercianteIndividual++; break;
      case 'ONG': stats.ong++; break;
      case 'Asociación': stats.asociacion++; break;
      case 'other': stats.otherType++; break;
      case 'missing': stats.missingType++; break;
    }
  }

  // Step 2: normalize NIT + filter valid
  type SociedadRecord = {
    normalizedNit: string;
    maskedNit: string;
    resolutionDate: string | null;
    resolutionNumber: number | null;
    raw: GtRgaeRawRow;
  };

  const validRecords: SociedadRecord[] = [];

  for (const row of sociedadRows) {
    const nitResult = normalizeGuatemalaNit(row.NIT_PROVEEDOR);
    if (!nitResult.isValid || !nitResult.normalized) {
      stats.sociedadesInvalidNit++;
      continue;
    }
    stats.sociedadesValidNit++;

    const resolutionDate = parseResolutionDate(row.FECHA_RESOLUCION);
    if (resolutionDate === null) stats.resolutionDateInvalid++;

    const resolutionNumber = parseNullableInt(row.NO_RESOLUCION);
    if (row.NO_RESOLUCION !== null && row.NO_RESOLUCION !== undefined && resolutionNumber === null) {
      stats.resolutionNumberInvalid++;
    }

    validRecords.push({
      normalizedNit: nitResult.normalized,
      maskedNit: maskGuatemalaNit(nitResult.normalized),
      resolutionDate,
      resolutionNumber,
      raw: row,
    });
  }

  // Step 3: dedup por NIT (latest resolution)
  // Tie-breaker 1: FECHA_RESOLUCION más reciente (ISO desc)
  // Tie-breaker 2: NO_RESOLUCION mayor (número desc)
  // Tie-breaker 3: NOMBRE_PROVEEDOR normalizado alphabetically first (determinístico)
  const byNit = new Map<string, SociedadRecord>();

  for (const record of validRecords) {
    const existing = byNit.get(record.normalizedNit);
    if (!existing) {
      byNit.set(record.normalizedNit, record);
      continue;
    }

    // Compare: prefer newer
    const win = shouldReplace(existing, record);
    if (win) {
      byNit.set(record.normalizedNit, record);
      stats.dedupReplacements++;
    }
    stats.duplicateSociedadRows++;
  }

  stats.sociedadesUniqueNit = byNit.size;

  // Step 4: build candidates
  const rawNamesSeen = new Map<string, string[]>(); // normalizedName → [normalizedNit, ...]

  const candidates: GtRgaeNormalizedCandidate[] = [];

  for (const record of byNit.values()) {
    const row = record.raw;

    const supplierName = row.NOMBRE_PROVEEDOR?.trim() ?? '';
    if (!supplierName) stats.supplierNameMissing++;

    const normalizedSupplierName = normalizeSupplierName(row.NOMBRE_PROVEEDOR);

    // Track name collision (two different NITs with same normalized name)
    const existingNits = rawNamesSeen.get(normalizedSupplierName) ?? [];
    existingNits.push(record.normalizedNit);
    rawNamesSeen.set(normalizedSupplierName, existingNits);

    const economicCapacity = parseEconomicCapacity(row.CAPACIDAD_ECONOMICA);
    switch (economicCapacity.kind) {
      case 'not_applicable': stats.economicCapacityNotApplicable++; break;
      case 'direct_purchase': stats.economicCapacityDirectPurchase++; break;
      case 'numeric': stats.economicCapacityNumeric++; break;
      case 'unparsed': stats.economicCapacityUnparsed++; break;
    }

    const resolutionDate = record.resolutionDate ?? '';
    const resolutionNumber = record.resolutionNumber;
    const certificateNumber = parseNullableInt(row.NO_CONSTANCIA);

    const candidate: GtRgaeNormalizedCandidate = {
      normalizedNit: record.normalizedNit,
      maskedNit: record.maskedNit,
      supplierName,
      normalizedSupplierName,
      supplierType: 'Sociedades',
      requestType: row.TIPO_SOLICITUD ? row.TIPO_SOLICITUD.trim() : null,
      resolutionDate,
      resolutionNumber,
      certificateNumber,
      economicCapacity,
      sourceYear: 2025,
      sourceType: 'government_supplier_registry',
      fiscalValidationStatus: 'not_applicable',
      legalValidationStatus: 'not_applicable',
      humanReviewRequired: true,
      postApprovalEnabled: false,
      matchingAutomaticEnabled: false,
      accountCreationEnabled: false,
      canonicalNameOverwriteEnabled: false,
    };

    candidates.push(candidate);
  }

  // Count name collisions (names shared by 2+ NITs)
  for (const nits of rawNamesSeen.values()) {
    if (nits.length > 1) stats.supplierNameNormalizationCollisions++;
  }

  return { candidates, stats };
}

/**
 * Devuelve true si el candidato incoming debe reemplazar al existing en dedup.
 * Tie-breaker determinístico: NOMBRE_PROVEEDOR normalizado alphabetically first.
 */
function shouldReplace(existing: { resolutionDate: string | null; resolutionNumber: number | null; raw: GtRgaeRawRow }, incoming: { resolutionDate: string | null; resolutionNumber: number | null; raw: GtRgaeRawRow }): boolean {
  // Tie-breaker 1: FECHA_RESOLUCION
  const dExisting = existing.resolutionDate ?? '';
  const dIncoming = incoming.resolutionDate ?? '';
  if (dIncoming > dExisting) return true;
  if (dExisting > dIncoming) return false;

  // Tie-breaker 2: NO_RESOLUCION mayor
  const nExisting = existing.resolutionNumber ?? -1;
  const nIncoming = incoming.resolutionNumber ?? -1;
  if (nIncoming > nExisting) return true;
  if (nExisting > nIncoming) return false;

  // Tie-breaker 3: NOMBRE_PROVEEDOR normalizado alphabetically first (menor alfabéticamente gana)
  const nameExisting = normalizeSupplierName(existing.raw.NOMBRE_PROVEEDOR);
  const nameIncoming = normalizeSupplierName(incoming.raw.NOMBRE_PROVEEDOR);
  return nameIncoming < nameExisting;
}
