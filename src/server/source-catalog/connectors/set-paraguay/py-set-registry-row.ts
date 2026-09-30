/**
 * py-set-registry-row.ts — fila MÍNIMA de `py_set_registry` a partir de una línea
 * del padrón público de RUC de Paraguay (SET/DNIT), para el RUC por nombre dentro
 * de la corrida del Agente 1.
 *
 * SOURCES-PY-RUC-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Formato (archivos ruc0.txt … ruc9.txt, separados por «|», UTF-8):
 *   RUC | RAZÓN SOCIAL | DV | RUC ANTERIOR | ESTADO |
 * La razón social puede contener «|» (33 de 200.955 líneas en ruc8): por eso los
 * campos fijos se leen desde la DERECHA.
 *
 * Sólo entran sociedades (RUC de 8 dígitos que empieza por 80) ACTIVAS y cuyo
 * dígito verificador cuadra. Personas físicas, suspendidas, bloqueadas y canceladas
 * quedan fuera.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeCompanyNameCore, PARAGUAY_LEGAL_FORMS } from '../../company-name-core';
import { calculateParaguayRucCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';

export const PY_SET_REGISTRY_SOURCE_KEY = 'py_set_registry' as const;
export const PY_SET_REGISTRY_COUNTRY_CODE = 'PY' as const;

/** RUC de sociedad, sin dígito verificador. */
const COMPANY_RUC_BODY = /^80\d{6}$/;

export type PySetRegistryRow = {
  source_key: typeof PY_SET_REGISTRY_SOURCE_KEY;
  country_code: typeof PY_SET_REGISTRY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre paraguayo: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeParaguayCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, PARAGUAY_LEGAL_FORMS);
}

/** Campos de una línea del padrón, o `null` si no tiene la forma esperada. */
export function parsePySetLine(
  line: string,
): { ruc: string; legalName: string; dv: string; status: string } | null {
  let text = line.replace(/\r?\n$/, '');
  if (text.endsWith('|')) text = text.slice(0, -1);
  const cells = text.split('|');
  if (cells.length < 5) return null;
  const ruc = cells[0].trim();
  const dv = cells[cells.length - 3].trim();
  const status = cells[cells.length - 1].trim().toUpperCase();
  const legalName = cells.slice(1, cells.length - 3).join('|').replace(/^[|\s]+|[|\s]+$/g, '');
  if (!/^\d+$/.test(ruc) || !/^\d$/.test(dv)) return null;
  return { ruc, legalName, dv, status };
}

/**
 * Convierte una línea del padrón en fila, o `null` si no es una sociedad activa
 * con dígito verificador válido y nombre utilizable.
 */
export function buildPySetRegistryRow(
  line: string,
  params: { sourceYear: number; importedAt: string },
): PySetRegistryRow | null {
  const parsed = parsePySetLine(line);
  if (parsed === null) return null;
  const { ruc, legalName, dv, status } = parsed;
  if (!COMPANY_RUC_BODY.test(ruc) || status !== 'ACTIVO') return null;
  if (calculateParaguayRucCheckDigit(ruc) !== Number(dv)) return null;

  const core = normalizeParaguayCompanyCore(legalName);
  if (core.length < 2) return null;

  const taxId = `${ruc}-${dv}`;
  const identity = deriveTaxRecordIdentity(taxId);
  return {
    source_key: PY_SET_REGISTRY_SOURCE_KEY,
    country_code: PY_SET_REGISTRY_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: taxId,
    normalized_tax_id: taxId,
    legal_name: legalName,
    normalized_legal_name: core,
    raw_data: {},
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
