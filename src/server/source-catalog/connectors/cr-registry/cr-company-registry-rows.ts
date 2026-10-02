/**
 * cr-company-registry-rows.ts — empresas de Costa Rica con cédula jurídica y
 * nombre, para la cédula por nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-CR-CEDULA-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Costa Rica no publica un padrón completo de personas jurídicas. Se combinan
 * tres archivos oficiales y gratuitos de datos.go.cr (licencia CC-BY):
 *   1. MEIC «Lista de Pymes activas — Empresas activas» (NOMBRE, IDENTIFICACION,
 *      TAMAÑO, PROVINCIA, ACTIVIDAD CIIU). Manda: su nombre gana.
 *   2. Hacienda SICOP «recursos» 2022-2024 (CEDULA_PROVEEDOR, PROVEEDOR).
 *   3. Hacienda SICOP «aclaraciones» 2022-2024 (CEDULA_PROVEEDOR, EMPRESA_PROVEEDORA;
 *      la columna SOLICITANTE es un nombre de persona y NUNCA se lee).
 *
 * Sólo entran cédulas jurídicas de sociedades (10 dígitos que empiezan por 3):
 * cédulas físicas, DIMEX y entes estatales quedan fuera. Una cédula = una fila.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { COSTA_RICA_LEGAL_FORMS, normalizeCompanyNameCore } from '../../company-name-core';

export const CR_COMPANY_REGISTRY_SOURCE_KEY = 'cr_company_registry' as const;
export const CR_COUNTRY_CODE = 'CR' as const;

const COMPANY_CEDULA = /^3\d{9}$/;

export type CrCompanyRegistryRow = {
  source_key: typeof CR_COMPANY_REGISTRY_SOURCE_KEY;
  country_code: typeof CR_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

export type CrSourceRecords = {
  pymes?: readonly Record<string, unknown>[];
  recursos?: readonly Record<string, unknown>[];
  aclaraciones?: readonly Record<string, unknown>[];
};

/** Núcleo del nombre costarricense: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeCostaRicaCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, COSTA_RICA_LEGAL_FORMS);
}

/** Cédula cruda → 10 dígitos de sociedad, o `null`. */
export function normalizeCostaRicaCompanyCedula(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/\D/g, '');
  return COMPANY_CEDULA.test(digits) ? digits : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : null;
}

/** Combina los tres archivos en una fila por cédula (gana el nombre del MEIC). */
export function buildCrCompanyRegistryRows(
  records: CrSourceRecords,
  params: { sourceYear: number; importedAt: string },
): CrCompanyRegistryRow[] {
  const byCedula = new Map<string, CrCompanyRegistryRow>();

  const offer = (
    cedulaRaw: unknown,
    nameRaw: unknown,
    origin: 'meic_pymes' | 'sicop_recursos' | 'sicop_aclaraciones',
    extra: Record<string, unknown> = {},
  ) => {
    const cedula = normalizeCostaRicaCompanyCedula(cedulaRaw);
    const legalName = text(nameRaw);
    if (cedula === null || legalName === null || byCedula.has(cedula)) return;
    const core = normalizeCostaRicaCompanyCore(legalName);
    if (core.length < 2) return;
    const identity = deriveTaxRecordIdentity(cedula);
    byCedula.set(cedula, {
      source_key: CR_COMPANY_REGISTRY_SOURCE_KEY,
      country_code: CR_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: cedula,
      normalized_tax_id: cedula,
      legal_name: legalName,
      normalized_legal_name: core,
      raw_data: { origin, ...extra },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  };

  for (const record of records.pymes ?? []) {
    offer(record['IDENTIFICACION'], record['NOMBRE'], 'meic_pymes', {
      size: text(record['TAMAÑO']),
      province: text(record['PROVINCIA']),
      ciiu: text(record['ACTIVIDAD CIIU']),
    });
  }
  for (const record of records.recursos ?? []) {
    offer(record['CEDULA_PROVEEDOR'], record['PROVEEDOR'], 'sicop_recursos');
  }
  for (const record of records.aclaraciones ?? []) {
    offer(record['CEDULA_PROVEEDOR'], record['EMPRESA_PROVEEDORA'], 'sicop_aclaraciones');
  }

  return [...byCedula.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}
