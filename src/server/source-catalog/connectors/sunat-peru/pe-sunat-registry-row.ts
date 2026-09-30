/**
 * pe-sunat-registry-row.ts — fila MÍNIMA de `pe_sunat_registry` a partir de una
 * línea del padrón reducido de SUNAT, para el RUC por nombre dentro de la corrida.
 *
 * SOURCES-PE-RUC-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Formato del padrón (separado por «|», Latin-1):
 *   RUC | NOMBRE O RAZÓN SOCIAL | ESTADO DEL CONTRIBUYENTE | CONDICIÓN DE DOMICILIO |
 *   UBIGEO | …dirección…
 *
 * Sólo entran sociedades (RUC que empieza por 20, 11 dígitos) ACTIVAS y con
 * domicilio HABIDO. Personas naturales (RUC 10), bajas, suspendidas y no habidas
 * quedan fuera.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeCompanyNameCore, PERU_LEGAL_FORMS } from '../../company-name-core';

export const PE_SUNAT_REGISTRY_SOURCE_KEY = 'pe_sunat_registry' as const;
export const PE_SUNAT_REGISTRY_COUNTRY_CODE = 'PE' as const;

const COMPANY_RUC = /^20\d{9}$/;

export type PeSunatRegistryRow = {
  source_key: typeof PE_SUNAT_REGISTRY_SOURCE_KEY;
  country_code: typeof PE_SUNAT_REGISTRY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre peruano: el MISMO que calcula el resolvedor de la corrida. */
export function normalizePeruCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, PERU_LEGAL_FORMS);
}

/**
 * Convierte una línea del padrón en fila, o `null` si no es una sociedad activa y
 * habida con nombre utilizable (la cabecera también devuelve `null`).
 */
export function buildPeSunatRegistryRow(
  line: string,
  params: { sourceYear: number; importedAt: string },
): PeSunatRegistryRow | null {
  const cells = line.split('|');
  if (cells.length < 5) return null;
  const ruc = cells[0].trim();
  const legalName = cells[1].trim();
  const status = cells[2].trim().toUpperCase();
  const domicile = cells[3].trim().toUpperCase();
  if (!COMPANY_RUC.test(ruc) || status !== 'ACTIVO' || domicile !== 'HABIDO') return null;

  const core = normalizePeruCompanyCore(legalName);
  if (core.length < 2) return null;

  const identity = deriveTaxRecordIdentity(ruc);
  const ubigeo = cells[4].trim();
  return {
    source_key: PE_SUNAT_REGISTRY_SOURCE_KEY,
    country_code: PE_SUNAT_REGISTRY_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: ruc,
    normalized_tax_id: ruc,
    legal_name: legalName,
    normalized_legal_name: core,
    raw_data: { ubigeo: ubigeo && ubigeo !== '-' ? ubigeo : null },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
