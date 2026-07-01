/**
 * DGCP RD Connector — Normalizer
 *
 * Funciones puras, sin I/O. Normalizan datos crudos de DGCP.
 * No escribe en Supabase. No crea candidates ni accounts.
 * No valida identidad fiscal — es señal B2G comercial.
 *
 * Reglas clave:
 * - RNC dominicano jurídico: exactamente 9 dígitos numéricos.
 * - Cédula/persona física (11 dígitos) → rechazada para este snapshot.
 * - Año se deriva de fecha_adjudicacion (ISO o DD/MM/YYYY).
 * - Si RNC no es válido, se marca skipped con reason.
 */

import type { DgcpContrato, DgcpProveedor } from './dgcp-rd-client';

// ─── RNC normalization ─────────────────────────────────────────────────────────

export type NormalizeRncResult =
  | { ok: true; normalizedRnc: string }
  | { ok: false; reason: 'missing_rnc' | 'non_juridical_identifier' | 'invalid_format' };

/**
 * Normaliza un RNC dominicano de persona jurídica.
 * - Remueve guiones, puntos, espacios.
 * - Acepta solo 9 dígitos numéricos (jurídico).
 * - Rechaza 11 dígitos (cédula/persona física).
 * - Rechaza cualquier otro formato.
 */
export function normalizeRnc(raw: string | null | undefined): NormalizeRncResult {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: 'missing_rnc' };
  }

  const cleaned = raw.trim().replace(/[-.\s]/g, '');

  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, reason: 'invalid_format' };
  }

  if (cleaned.length === 11) {
    return { ok: false, reason: 'non_juridical_identifier' };
  }

  if (cleaned.length !== 9) {
    return { ok: false, reason: 'invalid_format' };
  }

  return { ok: true, normalizedRnc: cleaned };
}

// ─── Year extraction ───────────────────────────────────────────────────────────

/**
 * Extrae el año desde una cadena de fecha.
 * Soporta ISO 8601 (YYYY-MM-DD...) y DD/MM/YYYY.
 * Retorna null si no es parseable o el año es inválido.
 */
export function extractYearFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr || dateStr.trim().length === 0) return null;

  const trimmed = dateStr.trim();

  // ISO: 2026-06-15 o 2026-06-15T...
  const isoMatch = trimmed.match(/^(\d{4})-\d{2}-\d{2}/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    return year >= 1990 && year <= 2100 ? year : null;
  }

  // DD/MM/YYYY
  const dmyMatch = trimmed.match(/^\d{2}\/\d{2}\/(\d{4})$/);
  if (dmyMatch) {
    const year = parseInt(dmyMatch[1], 10);
    return year >= 1990 && year <= 2100 ? year : null;
  }

  return null;
}

// ─── Contract normalization ────────────────────────────────────────────────────

export type NormalizedContrato = {
  codigo_contrato: string | null;
  codigo_proceso: string | null;
  estado_adjudicacion: string | null;
  fecha_adjudicacion: string | null;
  award_year: number | null;
  valor_contratado: number | null;
  divisa: string | null;
  descripcion: string | null;
  url_contrato: string | null;
  unidad_compra: string | null;
  codigo_unidad_compra: string | null;
  rpe: string | null;
  razon_social: string | null;
};

export function normalizeContrato(raw: DgcpContrato): NormalizedContrato {
  return {
    codigo_contrato: raw.codigo_contrato,
    codigo_proceso: raw.codigo_proceso,
    estado_adjudicacion: raw.estado_adjudicacion,
    fecha_adjudicacion: raw.fecha_adjudicacion,
    award_year: extractYearFromDate(raw.fecha_adjudicacion),
    valor_contratado: raw.valor_contratado,
    divisa: raw.divisa,
    descripcion: raw.descripcion ? raw.descripcion.slice(0, 280) : null,
    url_contrato: raw.url_contrato,
    unidad_compra: raw.unidad_compra,
    codigo_unidad_compra: raw.codigo_unidad_compra,
    rpe: raw.rpe,
    razon_social: raw.razon_social,
  };
}

// ─── Provider RNC resolution ───────────────────────────────────────────────────

export type ResolvedProviderRnc =
  | { ok: true; normalizedRnc: string; tipoDocumento: string }
  | { ok: false; reason: 'missing_rnc' | 'non_juridical_identifier' | 'invalid_format' | 'not_rnc_type' };

/**
 * Extrae y normaliza el RNC desde la ficha de proveedor de DGCP.
 * Solo acepta documentos tipo RNC (jurídico). Rechaza cédulas.
 */
export function resolveProviderRnc(proveedor: DgcpProveedor): ResolvedProviderRnc {
  const tipoDoc = proveedor.tipo_documento?.toUpperCase() ?? '';
  const numDoc = proveedor.numero_documento;

  // Si el tipo de documento no es RNC, rechazar
  if (tipoDoc && !tipoDoc.includes('RNC')) {
    return { ok: false, reason: 'not_rnc_type' };
  }

  const result = normalizeRnc(numDoc);
  if (!result.ok) return { ok: false, reason: result.reason };

  return { ok: true, normalizedRnc: result.normalizedRnc, tipoDocumento: tipoDoc };
}
