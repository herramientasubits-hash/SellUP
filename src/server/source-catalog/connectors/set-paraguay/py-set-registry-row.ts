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
 *
 * SOURCES-PY-CLOSE-1 — el núcleo reconoce la forma societaria por su estructura y
 * sin el paréntesis final (`py-name-keys.ts`); cada sociedad suma sus alias
 * (`py_set_name_alias`: sigla, partes del nombre, clave de entidad pública) y,
 * si declaró su tamaño MIPYME a la DNCP, ese tramo en `raw_data`.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { calculateParaguayRucCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import { paraguayNameCore } from './py-name-keys';

export const PY_SET_REGISTRY_SOURCE_KEY = 'py_set_registry' as const;
export const PY_SET_REGISTRY_COUNTRY_CODE = 'PY' as const;
export const PY_SET_NAME_ALIAS_SOURCE_KEY = 'py_set_name_alias' as const;

/** Espacio de nombres de la identidad de un alias (`py-name-alias:<RUC>:<clave>`). */
export const PY_NAME_ALIAS_IDENTITY_NAMESPACE = 'py-name-alias' as const;

/**
 * Tamaño MIPYME que la sociedad declaró a la DNCP (Ley 4457/2012). Sólo las
 * MIPYME se categorizan: las grandes quedan «Sin categorizar» y no traen tramo.
 */
export type ParaguayMipymeSize = 'MICRO' | 'PEQUEÑA' | 'MEDIANA';

export type ParaguayDeclaredSize = { size: ParaguayMipymeSize; year: number };

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
  return paraguayNameCore(name);
}

/** `raw_data` con el tramo MIPYME declarado (lo lee `workforceFromRawData`). */
export function paraguayDeclaredSizeRawData(size: ParaguayDeclaredSize | null | undefined): Record<string, unknown> {
  return size ? { py_mipyme_size: size.size, py_mipyme_size_year: size.year } : {};
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
  params: { sourceYear: number; importedAt: string; declaredSize?: ParaguayDeclaredSize | null },
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
    raw_data: paraguayDeclaredSizeRawData(params.declaredSize),
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

export type PySetNameAliasRow = Omit<PySetRegistryRow, 'source_key'> & {
  source_key: typeof PY_SET_NAME_ALIAS_SOURCE_KEY;
};

/**
 * Filas de alias de una sociedad del padrón: una por clave EXTRA de nombre
 * (`paraguayRegistryAliasKeys`, ya sin las que son el nombre propio de otra
 * sociedad). Guardan el RUC y la razón social del padrón.
 */
export function buildPySetNameAliasRows(params: {
  registryRow: PySetRegistryRow;
  keys: readonly string[];
}): PySetNameAliasRow[] {
  const { registryRow, keys } = params;
  const rows: PySetNameAliasRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(PY_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: PY_SET_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}
