/**
 * DGII República Dominicana — Normalizers
 *
 * Funciones puras de normalización para el padrón RNC DGII.
 * No usa WebForms, APIs de terceros ni SOAP.
 * No escribe en Supabase.
 */

/**
 * Normaliza un RNC/cédula: elimina guiones, puntos y espacios.
 * Retorna null si el resultado no tiene 9 u 11 dígitos.
 */
export function normalizeDominicanRnc(value: string): string | null {
  const cleaned = value.replace(/[-.\s]/g, '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  if (cleaned.length === 9 || cleaned.length === 11) return cleaned;
  return null;
}

/**
 * Retorna true si el valor (ya normalizado) corresponde a un RNC jurídico
 * de 9 dígitos (persona moral / empresa).
 */
export function isDominicanBusinessRnc(value: string): boolean {
  const normalized = normalizeDominicanRnc(value);
  return normalized !== null && normalized.length === 9;
}

export type DgiiNormalizedStatus =
  | 'active'
  | 'suspended'
  | 'inactive'
  | 'temporary_ceased'
  | 'unknown';

/**
 * Normaliza el campo estado del contribuyente del padrón DGII.
 */
export function normalizeDgiiStatus(value: string): DgiiNormalizedStatus {
  const upper = value.trim().toUpperCase();
  if (upper === 'ACTIVO') return 'active';
  if (upper === 'SUSPENDIDO') return 'suspended';
  if (upper === 'DADO DE BAJA') return 'inactive';
  // Acepta con o sin tilde; incluye variante corta CESE TEMPORAL que también aparece en el padrón
  if (
    upper === 'CESACION TEMPORAL' ||
    upper === 'CESACIÓN TEMPORAL' ||
    upper === 'CESE TEMPORAL'
  )
    return 'temporary_ceased';
  return 'unknown';
}

/**
 * Retorna true si el estado indica contribuyente activo.
 */
export function isActiveDgiiTaxpayer(value: string): boolean {
  return normalizeDgiiStatus(value) === 'active';
}
