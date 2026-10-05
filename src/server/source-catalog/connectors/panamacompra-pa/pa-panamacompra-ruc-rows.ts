/**
 * pa-panamacompra-ruc-rows.ts — personas jurídicas con RUC que participan en las
 * compras del Estado panameño (buscador de proveedores de PanamaCompraEnCifras,
 * Dirección General de Contrataciones Públicas), para el RUC por nombre dentro de
 * la corrida del Agente 1.
 *
 * SOURCES-PA-RUC-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Panamá no publica un padrón de RUC abierto (el Registro Público pide usuario).
 * El buscador público de proveedores de PanamaCompraEnCifras devuelve, por
 * proveedor, `party.identifier` = { scheme: 'PA-RUC', id, legalName }.
 *
 * Sólo entran RUC de PERSONA JURÍDICA: tomo-folio-asiento con un primer tramo de
 * 3 o más dígitos («998592-1-535732», opcionalmente con su DV). Las cédulas de
 * personas naturales (E-…, N-…, PE-…, «8-123-456», «8NT…») nunca se guardan.
 *
 * Límite conocido: sólo cubre a quienes han participado en compras públicas.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { CENTRAL_AMERICA_LEGAL_FORMS, normalizeCompanyNameCore } from '../../company-name-core';

export const PA_PANAMACOMPRA_RUC_SOURCE_KEY = 'pa_panamacompra_ruc_registry' as const;
export const PA_COUNTRY_CODE = 'PA' as const;

/** Panamá usa también formas en inglés (sociedades offshore). Más largas primero. */
export const PANAMA_LEGAL_FORMS: readonly string[] = [
  'INCORPORATED',
  'CORPORATION',
  'LIMITED',
  'INC',
  'CORP',
  'LTD',
  'LLC',
  ...CENTRAL_AMERICA_LEGAL_FORMS,
];

/** Tomo-folio-asiento con primer tramo ≥ 3 dígitos, y DV opcional al final. */
const JURIDICAL_RUC = /^(\d{3,})-(\d{1,4})-(\d{1,7})(?:-?(?:DV)?(\d{1,2}))?$/;

export type PaPanamaCompraRucRow = {
  source_key: typeof PA_PANAMACOMPRA_RUC_SOURCE_KEY;
  country_code: typeof PA_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre panameño: el MISMO que calcula el resolvedor de la corrida. */
export function normalizePanamaCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, PANAMA_LEGAL_FORMS);
}

/** RUC crudo → { ruc: tomo-folio-asiento, dv } de persona jurídica, o `null`. */
export function normalizePanamaJuridicalRuc(raw: string | null | undefined): { ruc: string; dv: string | null } | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.toUpperCase().replace(/D\.?\s*V\.?/g, 'DV').replace(/\s+/g, '');
  const match = JURIDICAL_RUC.exec(compact);
  // Un tomo de sólo ceros es un RUC de relleno (visto en la carga del 05-10: «000-2-2015»).
  if (match === null || /^0+$/.test(match[1])) return null;
  return { ruc: `${match[1]}-${match[2]}-${match[3]}`, dv: match[4] ?? null };
}

export type PaPanamaCompraSupplier = {
  id: string | null;
  scheme: string | null;
  legalName: string | null;
  lastProcess: string | null;
};

/** Un resultado del buscador → proveedor, o `null` si no trae identificador. */
export function parsePanamaCompraSupplier(result: unknown): PaPanamaCompraSupplier | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const party = (record['party'] ?? {}) as Record<string, unknown>;
  const identifier = (party['identifier'] ?? {}) as Record<string, unknown>;
  const supplier = (record['supplier'] ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
  const id = text(identifier['id']) ?? text(supplier['id']);
  if (id === null) return null;
  return {
    id,
    scheme: text(identifier['scheme']),
    legalName: text(identifier['legalName']) ?? text(supplier['name']),
    lastProcess: text(record['last_process']),
  };
}

/** Proveedores → una fila por RUC de persona jurídica (gana la participación más reciente). */
export function buildPaPanamaCompraRucRows(
  suppliers: Iterable<PaPanamaCompraSupplier>,
  params: { sourceYear: number; importedAt: string },
): PaPanamaCompraRucRow[] {
  const byRuc = new Map<string, { supplier: PaPanamaCompraSupplier; dv: string | null; name: string }>();
  for (const supplier of suppliers) {
    if (supplier.scheme !== null && supplier.scheme !== 'PA-RUC') continue;
    const ruc = normalizePanamaJuridicalRuc(supplier.id);
    const name = (supplier.legalName ?? '').replace(/\s+/g, ' ').trim();
    if (ruc === null || name.length === 0) continue;
    const previous = byRuc.get(ruc.ruc);
    if (previous === undefined || (supplier.lastProcess ?? '') > (previous.supplier.lastProcess ?? '')) {
      byRuc.set(ruc.ruc, { supplier, dv: ruc.dv ?? previous?.dv ?? null, name });
    }
  }

  const rows: PaPanamaCompraRucRow[] = [];
  for (const [ruc, entry] of byRuc) {
    const core = normalizePanamaCompanyCore(entry.name);
    if (core.length < 2) continue;
    const identity = deriveTaxRecordIdentity(ruc);
    const raw: Record<string, unknown> = {};
    if (entry.dv !== null) raw.dv = entry.dv;
    if (entry.supplier.lastProcess !== null) raw.last_process = entry.supplier.lastProcess.slice(0, 10);
    rows.push({
      source_key: PA_PANAMACOMPRA_RUC_SOURCE_KEY,
      country_code: PA_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: ruc,
      normalized_tax_id: ruc,
      legal_name: entry.name,
      normalized_legal_name: core,
      raw_data: raw,
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows.sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}
