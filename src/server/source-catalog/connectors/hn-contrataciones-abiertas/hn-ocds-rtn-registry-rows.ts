/**
 * hn-ocds-rtn-registry-rows.ts — personas jurídicas con RTN que participan en las
 * compras del Estado hondureño (ONCAE / HonduCompras y SEFIN, publicaciones OCDS
 * en el registro de Open Contracting, licencia CC BY 4.0), para el RTN por nombre
 * dentro de la corrida del Agente 1.
 *
 * SOURCES-HN-RTN-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Cada versión OCDS trae `parties[]` con `identifier` = { scheme: 'HN-RTN', id,
 * legalName } y `roles` (supplier / tenderer…).
 *
 * Sólo entran RTN de PERSONA JURÍDICA: 14 dígitos con un 9 en la quinta posición
 * («0801-90…», «0801-99…»). En el RTN de una persona natural esa posición es su
 * año de nacimiento («0801-19…», «0801-20…») y nunca se guarda; tampoco cédulas
 * (HND-IDCARD), pasaportes ni identificadores sin RTN.
 *
 * Límite conocido: sólo cubre a quienes han participado en compras públicas.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { CENTRAL_AMERICA_LEGAL_FORMS, normalizeCompanyNameCore } from '../../company-name-core';

export const HN_OCDS_RTN_SOURCE_KEY = 'hn_ocds_rtn_registry' as const;
export const HN_COUNTRY_CODE = 'HN' as const;

const JURIDICAL_RTN = /^\d{4}9\d{9}$/;
const SUPPLIER_ROLES = new Set(['supplier', 'tenderer']);

export type HnOcdsRtnRow = {
  source_key: typeof HN_OCDS_RTN_SOURCE_KEY;
  country_code: typeof HN_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * Nombre de proveedor sin las colas que HonduCompras le pega («*MIPYME*»,
 * «* Compra Menor», «*CM», «*FONDOS EXT»): todo lo que va desde el primer «*».
 */
export function cleanHondurasSupplierName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  const star = name.indexOf('*');
  return (star >= 0 ? name.slice(0, star) : name).replace(/\s+/g, ' ').trim();
}

/** Núcleo del nombre hondureño: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeHondurasCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(cleanHondurasSupplierName(name), CENTRAL_AMERICA_LEGAL_FORMS);
}

/** RTN crudo («HN-RTN-08019001210297», con guiones o espacios) → RTN jurídico, o `null`. */
export function normalizeHondurasJuridicalRtn(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/^HN-RTN-/i, '').replace(/\D/g, '');
  return JURIDICAL_RTN.test(digits) ? digits : null;
}

export type HnOcdsSupplier = { rtn: string; name: string; date: string };

/** Una versión OCDS → proveedores (personas jurídicas con RTN y rol de proveedor). */
export function extractHondurasSuppliers(release: unknown): HnOcdsSupplier[] {
  if (!release || typeof release !== 'object') return [];
  const record = release as Record<string, unknown>;
  const date = typeof record['date'] === 'string' ? record['date'] : '';
  const parties = Array.isArray(record['parties']) ? record['parties'] : [];
  const suppliers: HnOcdsSupplier[] = [];
  for (const raw of parties) {
    if (!raw || typeof raw !== 'object') continue;
    const party = raw as Record<string, unknown>;
    const roles = Array.isArray(party['roles']) ? (party['roles'] as unknown[]) : [];
    if (!roles.some((role) => typeof role === 'string' && SUPPLIER_ROLES.has(role))) continue;
    const identifier = (party['identifier'] ?? {}) as Record<string, unknown>;
    if (identifier['scheme'] !== 'HN-RTN') continue;
    const rtn = normalizeHondurasJuridicalRtn(identifier['id']);
    const name = cleanHondurasSupplierName(
      typeof identifier['legalName'] === 'string' ? identifier['legalName'] : typeof party['name'] === 'string' ? party['name'] : '',
    );
    if (rtn !== null && name.length > 0) suppliers.push({ rtn, name, date });
  }
  return suppliers;
}

/** Proveedores → una fila por RTN (gana la versión más reciente). */
export function buildHnOcdsRtnRows(
  suppliers: Iterable<HnOcdsSupplier>,
  params: { importedAt: string },
): HnOcdsRtnRow[] {
  const latest = new Map<string, HnOcdsSupplier>();
  for (const supplier of suppliers) {
    const previous = latest.get(supplier.rtn);
    if (previous === undefined || supplier.date >= previous.date) latest.set(supplier.rtn, supplier);
  }
  const rows: HnOcdsRtnRow[] = [];
  for (const supplier of latest.values()) {
    const core = normalizeHondurasCompanyCore(supplier.name);
    if (core.length < 2) continue;
    const identity = deriveTaxRecordIdentity(supplier.rtn);
    const year = Number(supplier.date.slice(0, 4));
    rows.push({
      source_key: HN_OCDS_RTN_SOURCE_KEY,
      country_code: HN_COUNTRY_CODE,
      source_year: Number.isInteger(year) && year > 1900 ? year : 0,
      tax_id: supplier.rtn,
      normalized_tax_id: supplier.rtn,
      legal_name: supplier.name,
      normalized_legal_name: core,
      raw_data: supplier.date ? { last_release: supplier.date.slice(0, 10) } : {},
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows.sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}
