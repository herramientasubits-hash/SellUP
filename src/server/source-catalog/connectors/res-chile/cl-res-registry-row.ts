/**
 * cl-res-registry-row.ts — fila MÍNIMA de `cl_res_registry` a partir de un
 * registro del Registro de Empresas y Sociedades de Chile (RES, Ley 20.659,
 * datos abiertos del Ministerio de Economía en datos.gob.cl), para el RUT por
 * nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-CL-RUT-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Un CSV por año (separado por «;», UTF-8 con BOM) con las CONSTITUCIONES:
 *   ID; RUT; Razon Social; …; Comuna Tributaria; Region Tributaria;
 *   Codigo de sociedad (SpA, SRL, EIRL, SA…); Tipo de actuacion; Capital; …
 *
 * Entran sociedades con RUT de dígito verificador válido. Quedan fuera las EIRL
 * (empresas individuales de una sola persona, a menudo con su nombre propio): no
 * son clientes objetivo y así no se guardan nombres de personas.
 *
 * Límites conocidos: el RES sólo cubre sociedades constituidas por el régimen
 * simplificado desde 2013 (no las grandes empresas antiguas) y no publica si la
 * sociedad sigue activa.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { CHILE_LEGAL_FORMS, normalizeCompanyNameCore } from '../../company-name-core';
import { calculateChileCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';

export const CL_RES_REGISTRY_SOURCE_KEY = 'cl_res_registry' as const;
export const CL_RES_REGISTRY_COUNTRY_CODE = 'CL' as const;

/** Tipos de sociedad que NO se cargan. */
const EXCLUDED_COMPANY_TYPES = new Set(['EIRL']);

export type ClResRegistryRow = {
  source_key: typeof CL_RES_REGISTRY_SOURCE_KEY;
  country_code: typeof CL_RES_REGISTRY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre chileno: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeChileCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, CHILE_LEGAL_FORMS);
}

/** RUT crudo («78.081.182-k») → «78081182-K» con DV válido, o `null`. */
export function normalizeChileRut(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{7,8})-([\dK])$/.exec(raw.trim().toUpperCase().replace(/\./g, ''));
  if (match === null) return null;
  return calculateChileCheckDigit(match[1]) === match[2] ? `${match[1]}-${match[2]}` : null;
}

/** Registro del RES → fila, o `null`. */
export function buildClResRegistryRow(
  record: Record<string, string>,
  params: { sourceYear: number; importedAt: string },
): ClResRegistryRow | null {
  const companyType = (record['Codigo de sociedad'] ?? '').trim().toUpperCase();
  if (EXCLUDED_COMPANY_TYPES.has(companyType)) return null;
  const rut = normalizeChileRut(record['RUT']);
  const legalName = (record['Razon Social'] ?? '').replace(/\s+/g, ' ').trim();
  if (rut === null) return null;

  const core = normalizeChileCompanyCore(legalName);
  if (core.length < 2) return null;

  const identity = deriveTaxRecordIdentity(rut);
  const commune = (record['Comuna Tributaria'] ?? '').trim();
  return {
    source_key: CL_RES_REGISTRY_SOURCE_KEY,
    country_code: CL_RES_REGISTRY_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: rut,
    normalized_tax_id: rut,
    legal_name: legalName,
    normalized_legal_name: core,
    raw_data: {
      company_type: companyType || null,
      commune: commune || null,
      constituted_year: (record['Anio'] ?? '').trim() || null,
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
