/**
 * SOURCES-FREE-DISCARDS-KEEP-CUIT-1 — la identidad fiscal de una fila de
 * Descartadas del buscador gratuito, lista para el candidato que nace al
 * enviarla a revisión.
 *
 * Las empresas del buscador gratuito por país (fuente oficial) llegan con su
 * número fiscal. Si no tienen web van a Descartadas (`missing_domain_final`) y
 * el rescate de Claude —o una persona— las manda a revisión. Antes, el
 * candidato nuevo nacía SIN número fiscal: el dedupe y «una empresa, un
 * vendedor» perdían la señal más fuerte que tenían.
 *
 * No se guarda nada nuevo: la evidencia sigue declarando el número sólo como
 * PRESENCIA (`tax_identifier_present`), y el valor ya vive en el identificador
 * de la fila (`provider_identifier = tax:<número>`, la identidad de registro de
 * grano fiscal de la fuente).
 *
 * Conservador: sólo devuelve algo cuando TODO cuadra —fila de fuente oficial
 * (`public_source`), identificador `tax:`, presencia declarada, tipo que la
 * columna acepta (CHECK de la migración 141) y número con forma razonable—. La
 * razón social sólo se copia junto con el número: en filas de proveedores de
 * pago `provider_raw_name` es el nombre comercial.
 *
 * Puro: sin env, sin I/O.
 */

/** Tipos que acepta `prospect_candidates.tax_identifier_type` (sin `other`). */
const ALLOWED_TAX_IDENTIFIER_TYPES: ReadonlySet<string> = new Set([
  'NIT',
  'RFC',
  'RUT',
  'RUC',
  'CUIT',
  'CNPJ',
  'RNC',
  'RTN',
  'cedula_juridica',
  'EIN',
  'NIF',
]);

const TAX_IDENTITY_PREFIX = 'tax:';

/** Letras, dígitos y guiones; 5 a 20 caracteres. */
const TAX_IDENTIFIER_SHAPE = /^[A-Za-z0-9Ñ&-]{5,20}$/;

export type CandidateFiscalIdentityColumns = {
  tax_id: string;
  tax_identifier: string;
  tax_identifier_type: string;
  legal_name?: string;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Columnas fiscales del candidato, o `{}` si la fila no trae una identidad válida. */
export function fiscalIdentityFromDisposition(disposition: {
  sourcePrimary: string | null | undefined;
  providerIdentifier: string | null | undefined;
  evidence: Readonly<Record<string, unknown>> | null | undefined;
}): CandidateFiscalIdentityColumns | Record<string, never> {
  const { evidence } = disposition;
  if (disposition.sourcePrimary !== 'public_source' || !evidence) return {};
  if (evidence['tax_identifier_present'] !== true) return {};

  const identifier = text(disposition.providerIdentifier);
  if (identifier === null || !identifier.startsWith(TAX_IDENTITY_PREFIX)) return {};
  const taxIdentifier = identifier.slice(TAX_IDENTITY_PREFIX.length).trim();
  const type = text(evidence['tax_identifier_type']);
  if (type === null || !ALLOWED_TAX_IDENTIFIER_TYPES.has(type)) return {};
  if (!TAX_IDENTIFIER_SHAPE.test(taxIdentifier)) return {};

  const legalName = text(evidence['provider_raw_name']);
  return {
    tax_id: taxIdentifier,
    tax_identifier: taxIdentifier,
    tax_identifier_type: type,
    ...(legalName ? { legal_name: legalName } : {}),
  };
}
