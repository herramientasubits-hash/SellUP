/**
 * sv-sources-rows.ts — filas de las fuentes oficiales de El Salvador para el Agente 1.
 *
 * SOURCES-SV-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Entradas (las produce `scripts/source-catalog/extract-sv-official-sources.py`):
 *
 *   - Listados de Hacienda con NIT: Grandes Contribuyentes de la DGII al 15-01-2019
 *     (copia de archive.org), Grandes y Medianos Contribuyentes al 31-07-2012,
 *     usuarias de Zonas Francas / DPA / Servicios Internacionales (2014), entidades
 *     del Gobierno Central, autónomas y hospitales (2014) y las 262 alcaldías (2014).
 *   - Instituciones del Portal de Transparencia (nombre, sigla, dominio del correo
 *     institucional y portal propio; sin datos del oficial de información).
 *   - Adjudicaciones públicas de COMPRASAL 2025-2026 (proveedor, monto, fecha, nombre
 *     del proceso, institución; sin accionistas ni beneficiarios).
 *
 * Salen cuatro claves de fuente:
 *
 *   - `sv_nit_registry`: el NIT por nombre dentro de la corrida (un NIT, una fila,
 *     con el listado de mayor prioridad y su año real). Nunca personas naturales.
 *   - `sv_nit_name_alias`: otros nombres del mismo NIT (el de otro listado, siglas,
 *     clave pública); nunca el nombre propio de otro NIT.
 *   - `sv_public_entities`: la capa gratuita de Gobierno (instituciones VIGENTES:
 *     Transparencia o compradoras de COMPRASAL, con web y/o NIT de Hacienda).
 *   - `sv_comprasal_directory`: la capa gratuita de empresas por industria
 *     (proveedoras de COMPRASAL empatadas a UN solo NIT del registro).
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  isSvComprasalRelevant,
  resolveSvComprasalSupplierMacro,
  resolveSvProcessRule,
  SV_COMPRASAL_MACRO_TABLE_VERSION,
  SV_PUBLIC_ENTITY_MACRO,
} from '@/server/prospect-batches/country-source-discovery/sv-comprasal-macro-table';
import {
  resolveSvLargeTaxpayerMacro,
  resolveSvLargeTaxpayerWebsite,
  SV_LARGE_TAXPAYER_MACRO_TABLE_VERSION,
} from '@/server/prospect-batches/country-source-discovery/sv-large-taxpayer-macro-table';
import { normalizeSalvadoranNit } from './sv-nit';
import {
  classifySalvadorTaxpayerName,
  isSalvadorPublicEntityCore,
  salvadorNameCore,
  salvadorPublicEntityKey,
  salvadorRegistryAliasKeys,
} from './sv-name-keys';
import { salvadorPublicEntityDomain } from './sv-domain';

export const SV_NIT_REGISTRY_SOURCE_KEY = 'sv_nit_registry' as const;
export const SV_NIT_NAME_ALIAS_SOURCE_KEY = 'sv_nit_name_alias' as const;
export const SV_PUBLIC_ENTITIES_SOURCE_KEY = 'sv_public_entities' as const;
export const SV_COMPRASAL_DIRECTORY_SOURCE_KEY = 'sv_comprasal_directory' as const;
/** SOURCES-SV-LARGE-TAXPAYERS-1 — Grandes Contribuyentes que no venden al Estado. */
export const SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY = 'sv_large_taxpayer_directory' as const;

/** Espacio de nombres de la identidad de un alias (`sv-name-alias:<NIT>:<clave>`). */
export const SV_NAME_ALIAS_IDENTITY_NAMESPACE = 'sv-name-alias' as const;
/** Espacio de nombres de una entidad pública (`sv-public-entity:<clave pública>`). */
export const SV_PUBLIC_ENTITY_IDENTITY_NAMESPACE = 'sv-public-entity' as const;

/**
 * Categoría de contribuyente que lee el filtro de tamaño (`BO_TAXPAYER_CATEGORY_BANDS`):
 * un tramo SIN piso ni techo de personas que queda en la ficha y NO decide. Hacienda
 * clasifica por impuestos pagados y ventas (criterios de 2012: pagos ≥ US$ 1 millón
 * o ventas gravadas ≥ US$ 14 millones), no por trabajadores, y la lista más reciente
 * con NIT es de 2019: NO es un tamaño vigente.
 */
export const SV_LARGE_TAXPAYER_CATEGORY = 'SV_GRAN_CONTRIBUYENTE' as const;
export const SV_MEDIUM_TAXPAYER_CATEGORY = 'SV_MEDIANO_CONTRIBUYENTE' as const;

// ─── Entradas ──────────────────────────────────────────────────────────────

/** Listados de Hacienda, de mayor a menor prioridad para el nombre y el año. */
export const SV_TAX_LISTS = [
  'dgii_large_2019',
  'hacienda_large_2012',
  'hacienda_public_2014',
  'hacienda_municipality_2014',
  'hacienda_free_zone_2014',
  'hacienda_medium_2012',
] as const;
export type SvTaxList = (typeof SV_TAX_LISTS)[number];

export type SvTaxListEntry = {
  list: SvTaxList;
  year: number;
  nit: string;
  name: string;
  section: string | null;
  parent: string | null;
  municipality: string | null;
  department: string | null;
  regime: string | null;
};

export type SvTransparenciaInstitution = {
  categoryId: number;
  id: number | null;
  acronym: string | null;
  name: string;
  emailDomain: string | null;
  siteUrl: string | null;
};

export type SvComprasalAward = {
  id: number;
  supplierId: number;
  name: string;
  tradeName: string | null;
  amountUsd: number;
  date: string | null;
  process: string | null;
  institution: string | null;
  institutionCode: string | null;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim() : null;
}

function int(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

/** Una línea de sv_tax_lists.jsonl, o `null` si el NIT no pasa el dígito verificador. */
export function parseSvTaxListEntry(raw: unknown): SvTaxListEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const list = r['list'];
  const nit = normalizeSalvadoranNit(typeof r['nit'] === 'string' ? r['nit'] : null);
  const name = str(r['name']);
  const year = int(r['year']);
  if (!(SV_TAX_LISTS as readonly unknown[]).includes(list) || nit === null || name === null || year === null) return null;
  return {
    list: list as SvTaxList,
    year,
    nit,
    name,
    section: str(r['section']),
    parent: str(r['parent']),
    municipality: str(r['municipality']),
    department: str(r['department']),
    regime: str(r['regime']),
  };
}

/** Una línea de sv_transparencia.jsonl, o `null` si no trae nombre. */
export function parseSvTransparenciaInstitution(raw: unknown): SvTransparenciaInstitution | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r['name']);
  const categoryId = int(r['category_id']);
  if (name === null || categoryId === null) return null;
  return { categoryId, id: int(r['id']), acronym: str(r['acronym']), name, emailDomain: str(r['email_domain']), siteUrl: str(r['site_url']) };
}

/** Una línea de sv_comprasal_awards.jsonl, o `null` si no trae proveedor o monto. */
export function parseSvComprasalAward(raw: unknown): SvComprasalAward | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = int(r['id']);
  const supplierId = int(r['sid']);
  const name = str(r['name']);
  const amount = r['amount_usd'];
  if (id === null || supplierId === null || name === null || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  return {
    id,
    supplierId,
    name,
    tradeName: str(r['trade']),
    amountUsd: amount,
    date: str(r['date']),
    process: str(r['process']),
    institution: str(r['institution']),
    institutionCode: str(typeof r['institution_code'] === 'number' ? String(r['institution_code']) : r['institution_code']),
  };
}

function year(date: string | null): number | null {
  const y = Number((date ?? '').slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
}

// ─── sv_nit_registry ───────────────────────────────────────────────────────

export type SvSnapshotRow = {
  source_key: string;
  country_code: 'SV';
  source_year: number;
  tax_id: string | null;
  normalized_tax_id: string | null;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Por qué un NIT no entra en el registro. */
export type SvRegistryExclusion = 'natural_person' | 'excluded_kind' | 'no_name';

const LIST_RANK: ReadonlyMap<SvTaxList, number> = new Map(SV_TAX_LISTS.map((list, i) => [list, i]));

/** Las entradas de un NIT, de la lista de mayor prioridad a la de menor. */
function byPriority(entries: readonly SvTaxListEntry[]): SvTaxListEntry[] {
  return [...entries].sort((a, b) => (LIST_RANK.get(a.list) ?? 99) - (LIST_RANK.get(b.list) ?? 99) || a.name.localeCompare(b.name));
}

/** Gran o mediano contribuyente, con el año de la lista que lo dice. */
export function svTaxpayerCategory(entries: readonly SvTaxListEntry[]): { category: string; year: number } | null {
  const large = entries.filter((e) => e.list === 'dgii_large_2019' || e.list === 'hacienda_large_2012');
  if (large.length > 0) return { category: SV_LARGE_TAXPAYER_CATEGORY, year: Math.max(...large.map((e) => e.year)) };
  const medium = entries.find((e) => e.list === 'hacienda_medium_2012');
  return medium ? { category: SV_MEDIUM_TAXPAYER_CATEGORY, year: medium.year } : null;
}

/**
 * Fila del registro de NIT, o por qué no entra. Si CUALQUIERA de los nombres del NIT
 * es el de una persona natural, el NIT entero queda fuera: su nombre es un dato
 * personal y nunca se guarda.
 */
export function buildSvNitRegistryRow(
  entries: readonly SvTaxListEntry[],
  params: { importedAt: string },
): { row: SvSnapshotRow } | { excluded: SvRegistryExclusion } {
  const ordered = byPriority(entries);
  const kinds = ordered.map((e) => (e.list === 'hacienda_municipality_2014' || e.list === 'hacienda_public_2014' ? 'entity' : classifySalvadorTaxpayerName(e.name)));
  if (kinds.includes('natural_person')) return { excluded: 'natural_person' };
  if (kinds.includes('excluded')) return { excluded: 'excluded_kind' };
  const best = ordered[0];
  const core = best ? salvadorNameCore(best.name) : '';
  if (!best || core.length < 2) return { excluded: 'no_name' };
  // Una institución pública no es un contribuyente «grande» ni «mediano» a prospectar
  // por tamaño: su tramo no se guarda.
  const publicEntity = ordered.some((e) => e.list === 'hacienda_public_2014' || e.list === 'hacienda_municipality_2014') || isSalvadorPublicEntityCore(core);
  const category = publicEntity ? null : svTaxpayerCategory(ordered);
  const identity = deriveTaxRecordIdentity(best.nit);
  const municipality = ordered.find((e) => e.municipality !== null);
  return {
    row: {
      source_key: SV_NIT_REGISTRY_SOURCE_KEY,
      country_code: 'SV',
      source_year: best.year,
      tax_id: best.nit,
      normalized_tax_id: best.nit,
      legal_name: best.name,
      normalized_legal_name: core,
      city: municipality?.municipality ?? null,
      region: municipality?.department ?? null,
      priority_score: 0,
      raw_data: {
        tax_identifier_type: 'NIT',
        origins: [...new Set(ordered.map((e) => e.list))],
        list_years: Object.fromEntries(ordered.map((e) => [e.list, e.year])),
        ...(ordered.some((e) => e.regime !== null) ? { free_zone_regime: ordered.find((e) => e.regime !== null)!.regime } : {}),
        ...(ordered.some((e) => e.section !== null) ? { public_section: ordered.find((e) => e.section !== null)!.section } : {}),
        // Tramo sin piso ni techo (no decide); el año es el de la lista, NO es vigente.
        ...(category !== null ? { taxpayer_category: category.category, metrics_year: category.year } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

/**
 * NIT de instituciones públicas REEMPLAZADOS: un NIT que sólo está en los listados de
 * contribuyentes (2012/2019) con nombre de institución, cuyo nombre lleva en la lista
 * oficial de entidades de 2014 (DINAFI) o de alcaldías a OTRO NIT. Medido el
 * 07-10-2026: la Superintendencia del Sistema Financiero tiene NIT de 1990 en los
 * Medianos de 2012 y NIT de 2011 en la lista de entidades (se reorganizó en 2011).
 */
export function svSupersededPublicNits(byNit: ReadonlyMap<string, readonly SvTaxListEntry[]>): Set<string> {
  const official = new Map<string, string>();
  for (const [nit, entries] of byNit) {
    for (const e of entries) {
      if (e.list !== 'hacienda_public_2014' && e.list !== 'hacienda_municipality_2014') continue;
      for (const key of [salvadorNameCore(e.name), salvadorPublicEntityKey(e.name)]) if (key) official.set(key, nit);
    }
  }
  const out = new Set<string>();
  for (const [nit, entries] of byNit) {
    if (entries.some((e) => e.list === 'hacienda_public_2014' || e.list === 'hacienda_municipality_2014')) continue;
    for (const e of entries) {
      const core = salvadorNameCore(e.name);
      if (!isSalvadorPublicEntityCore(core)) continue;
      const other = official.get(core) ?? official.get(salvadorPublicEntityKey(e.name) ?? '');
      if (other !== undefined && other !== nit) out.add(nit);
    }
  }
  return out;
}

/**
 * Quita los alias que llevan a DOS o más NIT: sólo darían una pista ambigua. Un alias
 * nunca es el nombre propio de otro NIT (eso ya lo quita `dropAliasKeysOwnedByOthers`).
 */
export function dropSharedSvAliasRows(aliasRows: readonly SvSnapshotRow[]): SvSnapshotRow[] {
  const owners = new Map<string, Set<string | null>>();
  for (const row of aliasRows) owners.set(row.normalized_legal_name, (owners.get(row.normalized_legal_name) ?? new Set()).add(row.tax_id));
  return aliasRows.filter((row) => (owners.get(row.normalized_legal_name)?.size ?? 0) === 1);
}

/** Las entradas de los listados agrupadas por NIT. */
export function groupSvTaxListByNit(entries: readonly SvTaxListEntry[]): Map<string, SvTaxListEntry[]> {
  const out = new Map<string, SvTaxListEntry[]>();
  for (const entry of entries) out.set(entry.nit, [...(out.get(entry.nit) ?? []), entry]);
  return out;
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function svOwnNameKeys(row: Pick<SvSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = salvadorPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/**
 * Claves EXTRA de un NIT: los núcleos de sus nombres en los otros listados y las
 * claves de alias de cada nombre (sigla, clave pública). Sin el núcleo propio.
 */
export function svNitAliasKeys(entries: readonly SvTaxListEntry[], mainCore: string): string[] {
  const keys: string[] = [];
  const push = (key: string): void => {
    if (key.length >= 2 && key !== mainCore && !keys.includes(key)) keys.push(key);
  };
  for (const entry of byPriority(entries)) {
    push(salvadorNameCore(entry.name));
    for (const key of salvadorRegistryAliasKeys(entry.name)) push(key);
  }
  return keys;
}

/** Filas de alias de un NIT (ya sin las claves que son el nombre propio de otro NIT). */
export function buildSvNitNameAliasRows(params: { registryRow: SvSnapshotRow; keys: readonly string[] }): SvSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: SvSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(SV_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: SV_NIT_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

/** Quita las claves de alias que son el nombre propio de OTRO NIT. */
function dropKeysOwnedByOthers(keys: readonly string[], nit: string, owners: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return keys.filter((key) => {
    const ownedBy = owners.get(key);
    return ownedBy === undefined || ownedBy.has(nit);
  });
}

/**
 * Registro y alias completos a partir de los listados: un NIT, una fila; sin NIT de
 * institución reemplazados; alias sin el nombre propio de otro NIT ni claves que
 * lleven a dos NIT. Es lo MISMO que carga el ETL (y lo que mide la prueba de nombres).
 */
export function buildSvRegistryAndAliasRows(
  entries: readonly SvTaxListEntry[],
  params: { importedAt: string },
): {
  byNit: Map<string, SvTaxListEntry[]>;
  registryRows: SvSnapshotRow[];
  aliasRows: SvSnapshotRow[];
  excluded: Map<SvRegistryExclusion | 'superseded_public_nit', number>;
} {
  const byNit = groupSvTaxListByNit(entries);
  const superseded = svSupersededPublicNits(byNit);
  const registryRows: SvSnapshotRow[] = [];
  const excluded = new Map<SvRegistryExclusion | 'superseded_public_nit', number>();
  const count = (key: SvRegistryExclusion | 'superseded_public_nit'): void => {
    excluded.set(key, (excluded.get(key) ?? 0) + 1);
  };
  for (const [nit, group] of byNit) {
    if (superseded.has(nit)) {
      count('superseded_public_nit');
      continue;
    }
    const result = buildSvNitRegistryRow(group, params);
    if ('excluded' in result) count(result.excluded);
    else if (result.row.record_identity_key !== null) registryRows.push(result.row);
  }
  registryRows.sort((a, b) => (a.tax_id ?? '').localeCompare(b.tax_id ?? ''));

  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of svOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id!));
  }
  const aliasRows = dropSharedSvAliasRows(
    registryRows.flatMap((row) =>
      buildSvNitNameAliasRows({
        registryRow: row,
        keys: dropKeysOwnedByOthers(svNitAliasKeys(byNit.get(row.tax_id!)!, row.normalized_legal_name), row.tax_id!, owners),
      }),
    ),
  );
  return { byNit, registryRows, aliasRows, excluded };
}

/** Núcleo → NIT, sólo para los núcleos y claves que tiene UN solo NIT. */
export function svUniqueNitByKey(registryRows: readonly SvSnapshotRow[], aliasRows: readonly SvSnapshotRow[] = []): Map<string, string> {
  const owners = new Map<string, Set<string>>();
  const add = (key: string, nit: string | null): void => {
    if (nit !== null && key.length >= 2) owners.set(key, (owners.get(key) ?? new Set<string>()).add(nit));
  };
  for (const row of registryRows) for (const key of svOwnNameKeys(row)) add(key, row.tax_id);
  for (const row of aliasRows) add(row.normalized_legal_name, row.tax_id);
  const out = new Map<string, string>();
  for (const [key, nits] of owners) if (nits.size === 1) out.set(key, [...nits][0]);
  return out;
}

// ─── sv_public_entities ────────────────────────────────────────────────────

/** Categorías del Portal de Transparencia. */
export const SV_TRANSPARENCIA_CATEGORY_KIND: Readonly<Record<number, SvPublicEntityKind | 'not_public' | 'pre_reform_municipality'>> = {
  1: 'ministry',
  2: 'national_body',
  3: 'national_body',
  4: 'national_body',
  // Las 262 alcaldías anteriores a la reforma de mayo de 2024 son hoy distritos de
  // los 44 municipios nuevos: no se ofrecen en Gobierno (su NIT sigue en el registro).
  5: 'pre_reform_municipality',
  6: 'university_or_hospital',
  7: 'national_body',
  // ONG que publican voluntariamente: no son el Estado.
  8: 'not_public',
  10: 'municipality',
  11: 'national_body',
  12: 'national_body',
};

/** Tipo de entidad pública, para ordenar dentro de Gobierno. */
export type SvPublicEntityKind = 'ministry' | 'national_body' | 'university_or_hospital' | 'municipality' | 'other';

const KIND_PRIORITY: Readonly<Record<SvPublicEntityKind, number>> = {
  ministry: 5,
  national_body: 4,
  university_or_hospital: 3,
  municipality: 2,
  other: 1,
};

/** Tipo de una entidad por su núcleo (para las compradoras de COMPRASAL). */
export function classifySvPublicEntity(core: string): SvPublicEntityKind {
  if (/^(MINISTERIO|VICEMINISTERIO)\b/.test(core)) return 'ministry';
  if (/^(ALCALDIA|MUNICIPALIDAD)\b/.test(core)) return 'municipality';
  if (/^(UNIVERSIDAD|HOSPITAL)\b/.test(core)) return 'university_or_hospital';
  if (isSalvadorPublicEntityCore(core)) return 'national_body';
  return 'other';
}

/** Por qué una institución no entra en la capa gratuita de Gobierno. */
export type SvPublicEntityExclusion =
  | 'no_name'
  | 'not_public'
  | 'test_record'
  | 'pre_reform_municipality'
  | 'fund_or_trust'
  | 'no_website_no_nit';

/** Una institución vigente, venga de Transparencia o de COMPRASAL. */
export type SvPublicEntityCandidate = {
  origin: 'transparencia' | 'comprasal_buyer';
  name: string;
  acronym: string | null;
  kind: SvPublicEntityKind | 'not_public' | 'pre_reform_municipality';
  siteUrl: string | null;
  emailDomain: string | null;
  lastYear: number | null;
};

/** Fideicomisos y cuentas especiales: no son una entidad a prospectar. */
const FUND_OR_TRUST = /^(FIDEICOMISO|FONDO DE ACTIVIDADES ESPECIALES|FONDO CIRCULANTE|PATRIMONIO ESPECIAL)\b/;

/** «Portal de Tranparencia del Instituto …» (con su errata) → «Instituto …»; sin el punto final. */
function cleanTransparenciaName(name: string): string {
  return name
    .replace(/^portal\s+de\s+tran?s?parencia\s+(?:del|de\s+la|de\s+los|de)\s+/i, '')
    .replace(/[\s.]+$/, '')
    .trim();
}

/** Una institución de Transparencia como candidata a Gobierno. */
export function svTransparenciaCandidate(institution: SvTransparenciaInstitution): SvPublicEntityCandidate {
  return {
    origin: 'transparencia',
    name: cleanTransparenciaName(institution.name),
    acronym: institution.acronym !== null && /^[A-Za-z]{2,12}$/.test(institution.acronym) ? institution.acronym : null,
    kind: SV_TRANSPARENCIA_CATEGORY_KIND[institution.categoryId] ?? 'other',
    siteUrl: institution.siteUrl,
    emailDomain: institution.emailDomain,
    lastYear: null,
  };
}

/**
 * Fila de Gobierno de una institución VIGENTE (Transparencia o compradora en
 * COMPRASAL), o por qué no entra. Entra con su web (si la dirección la nombra) o
 * con el NIT de Hacienda que le corresponde por su clave pública; sin ninguno de
 * los dos, no se puede identificar.
 */
export function buildSvPublicEntityRow(
  candidate: SvPublicEntityCandidate,
  params: {
    importedAt: string;
    sharedDomains: ReadonlySet<string>;
    nitByKey: ReadonlyMap<string, string>;
    /**
     * NIT del registro que son de una institución pública: sólo a ellos se llega por
     * la SIGLA (una sigla puede ser también el nombre de una sociedad).
     */
    publicNits?: ReadonlySet<string>;
  },
): { row: SvSnapshotRow } | { excluded: SvPublicEntityExclusion } {
  const core = salvadorNameCore(candidate.name);
  if (core.length < 3) return { excluded: 'no_name' };
  if (/\b(PRUEBA|EJEMPLO|TEST)\b/.test(core)) return { excluded: 'test_record' };
  if (candidate.kind === 'not_public') return { excluded: 'not_public' };
  if (candidate.kind === 'pre_reform_municipality') return { excluded: 'pre_reform_municipality' };
  if (FUND_OR_TRUST.test(core)) return { excluded: 'fund_or_trust' };
  const publicKey = salvadorPublicEntityKey(candidate.name) ?? core;
  const acronymKey = candidate.acronym !== null ? salvadorNameCore(candidate.acronym) : '';
  const byAcronym = acronymKey.length >= 3 ? params.nitByKey.get(acronymKey) ?? null : null;
  const nit =
    params.nitByKey.get(publicKey) ??
    params.nitByKey.get(core) ??
    (byAcronym !== null && params.publicNits?.has(byAcronym) ? byAcronym : null);
  const rawDomain = salvadorPublicEntityDomain({
    name: candidate.name,
    acronym: candidate.acronym,
    siteUrl: candidate.siteUrl,
    emailDomain: candidate.emailDomain,
  });
  // Un dominio que comparten dos o más instituciones (salud.gob.sv) no es de ninguna.
  const domain = rawDomain !== null && !params.sharedDomains.has(rawDomain) ? rawDomain : null;
  if (domain === null && nit === null) return { excluded: 'no_website_no_nit' };
  const kind: SvPublicEntityKind = candidate.kind === 'other' ? classifySvPublicEntity(core) : candidate.kind;
  const identity = buildRecordIdentityKey(SV_PUBLIC_ENTITY_IDENTITY_NAMESPACE, publicKey);
  return {
    row: {
      source_key: SV_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: 'SV',
      source_year: candidate.lastYear ?? 0,
      tax_id: nit,
      normalized_tax_id: nit,
      legal_name: candidate.name.replace(/\s+/g, ' ').trim(),
      normalized_legal_name: core,
      city: null,
      region: null,
      priority_score: KIND_PRIORITY[kind] * 10 + (domain !== null ? 2 : 0) + (nit !== null ? 1 : 0),
      raw_data: {
        directory_kind: 'public_entity',
        macro_industry_key: SV_PUBLIC_ENTITY_MACRO,
        macro_table_version: SV_COMPRASAL_MACRO_TABLE_VERSION,
        entity_kind: kind,
        public_key: publicKey,
        current_listing: candidate.origin,
        ...(candidate.acronym !== null ? { acronym: candidate.acronym } : {}),
        ...(domain !== null ? { website_domain: domain, website_origin: candidate.siteUrl !== null ? 'transparencia_site' : 'transparencia_email' } : {}),
        ...(nit !== null ? { tax_identifier_type: 'NIT', nit_origin: 'hacienda_2014' } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

/** NIT del registro que son de una institución pública (lista de entidades/alcaldías o nombre de institución). */
export function svPublicEntityNits(registryRows: readonly SvSnapshotRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of registryRows) {
    const origins = Array.isArray(row.raw_data['origins']) ? (row.raw_data['origins'] as unknown[]) : [];
    const official = origins.includes('hacienda_public_2014') || origins.includes('hacienda_municipality_2014');
    if (row.tax_id !== null && (official || isSalvadorPublicEntityCore(row.normalized_legal_name))) out.add(row.tax_id);
  }
  return out;
}

/** Las instituciones compradoras de COMPRASAL (vigentes), una por código. */
export function svComprasalBuyers(awards: readonly SvComprasalAward[]): SvPublicEntityCandidate[] {
  const byName = new Map<string, SvPublicEntityCandidate>();
  for (const award of awards) {
    if (award.institution === null) continue;
    const name = award.institution;
    const current = byName.get(name);
    const y = year(award.date);
    if (current === undefined) {
      byName.set(name, { origin: 'comprasal_buyer', name, acronym: null, kind: 'other', siteUrl: null, emailDomain: null, lastYear: y });
    } else if (y !== null && (current.lastYear === null || y > current.lastYear)) {
      byName.set(name, { ...current, lastYear: y });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── sv_comprasal_directory ────────────────────────────────────────────────

export type SvComprasalSupplier = {
  supplierId: number;
  names: Readonly<Record<string, number>>;
  tradeNames: Readonly<Record<string, number>>;
  awards: number;
  awardedUsd: number;
  buyers: number;
  lastDate: string | null;
  amountByRule: Readonly<Record<string, number>>;
};

/** Regla «sin coincidencia»: cuenta en el total pero no da macro. */
export const SV_UNCLASSIFIED_RULE = 'sin_clasificar' as const;

/** Una proveedora por su código de COMPRASAL, con lo que vendió por regla. */
export function aggregateSvComprasalSuppliers(awards: readonly SvComprasalAward[]): SvComprasalSupplier[] {
  type Acc = {
    names: Map<string, number>;
    trades: Map<string, number>;
    awards: number;
    usd: number;
    buyers: Set<string>;
    last: string | null;
    rules: Map<string, number>;
  };
  const acc = new Map<number, Acc>();
  for (const award of awards) {
    const a = acc.get(award.supplierId) ?? {
      names: new Map(), trades: new Map(), awards: 0, usd: 0, buyers: new Set<string>(), last: null, rules: new Map(),
    };
    a.names.set(award.name, (a.names.get(award.name) ?? 0) + 1);
    if (award.tradeName !== null) a.trades.set(award.tradeName, (a.trades.get(award.tradeName) ?? 0) + 1);
    a.awards += 1;
    a.usd += award.amountUsd;
    if (award.institutionCode !== null || award.institution !== null) a.buyers.add(award.institutionCode ?? award.institution!);
    if (award.date !== null && (a.last === null || award.date > a.last)) a.last = award.date;
    const rule = resolveSvProcessRule(award.process)?.key ?? SV_UNCLASSIFIED_RULE;
    a.rules.set(rule, (a.rules.get(rule) ?? 0) + award.amountUsd);
    acc.set(award.supplierId, a);
  }
  return [...acc.entries()]
    .map(([supplierId, a]) => ({
      supplierId,
      names: Object.fromEntries(a.names),
      tradeNames: Object.fromEntries(a.trades),
      awards: a.awards,
      awardedUsd: Math.round(a.usd * 100) / 100,
      buyers: a.buyers.size,
      lastDate: a.last,
      amountByRule: Object.fromEntries(a.rules),
    }))
    .sort((x, y) => x.supplierId - y.supplierId);
}

/** Web de una empresa del directorio, comprobada con su propia página. */
export type SvCompanyWeb = { domain: string; check: 'page_names_company' | 'blocked_exact_name' };

/** Una línea del mapa de webs (`discover-sv-company-webs.mts`), o `null`. */
export function parseSvCompanyWebLine(raw: unknown): { nit: string; web: SvCompanyWeb } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nit = normalizeSalvadoranNit(typeof r['nit'] === 'string' ? r['nit'] : null);
  const domain = typeof r['domain'] === 'string' ? r['domain'].trim().toLowerCase() : '';
  const check = r['check'];
  if (nit === null || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if (check !== 'page_names_company' && check !== 'blocked_exact_name') return null;
  return { nit, web: { domain, check } };
}

/**
 * La capa gratuita de empresas completa: una fila por NIT, la de más relevancia
 * primero. Es lo MISMO que carga el ETL y lo que recorre el buscador de webs.
 */
export function buildSvComprasalDirectoryRows(params: {
  suppliers: readonly SvComprasalSupplier[];
  registryRows: readonly SvSnapshotRow[];
  aliasRows: readonly SvSnapshotRow[];
  importedAt: string;
  webByNit?: ReadonlyMap<string, SvCompanyWeb>;
}): { rows: SvSnapshotRow[]; excluded: Map<SvDirectoryExclusion, number>; supplierByNit: Map<string, SvComprasalSupplier> } {
  const nitByKey = svUniqueNitByKey(params.registryRows, params.aliasRows);
  const registryByNit = new Map(params.registryRows.map((row) => [row.tax_id!, row]));
  const cores = new Map<string, number>();
  for (const row of params.registryRows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const ambiguousKeys = new Set([...cores].filter(([, n]) => n > 1).map(([core]) => core));
  const rows: SvSnapshotRow[] = [];
  const excluded = new Map<SvDirectoryExclusion, number>();
  const supplierByNit = new Map<string, SvComprasalSupplier>();
  for (const supplier of params.suppliers) {
    const result = buildSvComprasalDirectoryRow(supplier, {
      importedAt: params.importedAt,
      nitByKey,
      registryByNit,
      ambiguousKeys,
      webByNit: params.webByNit,
    });
    if ('excluded' in result) excluded.set(result.excluded, (excluded.get(result.excluded) ?? 0) + 1);
    else if (result.row.record_identity_key !== null && !supplierByNit.has(result.row.tax_id!)) {
      supplierByNit.set(result.row.tax_id!, supplier);
      rows.push(result.row);
    }
  }
  rows.sort((a, b) => b.priority_score - a.priority_score || (a.tax_id ?? '').localeCompare(b.tax_id ?? ''));
  return { rows, excluded, supplierByNit };
}

/** Por qué una proveedora no entra en la capa gratuita. */
export type SvDirectoryExclusion =
  | 'natural_person'
  | 'consortium'
  | 'public_entity'
  | 'no_nit'
  | 'ambiguous_nit'
  | 'no_dominant_macro'
  | 'not_relevant';

const CONSORTIUM_NAME = /^\s*["'«]?\s*(CONSORCIO|UNION TEMPORAL|ASOCIO)\b/i;

/** Orden dentro de una macro: a cuántas instituciones distintas vende y cuántas adjudicaciones. */
export function svComprasalPriorityScore(input: { buyers: number; awards: number }): number {
  return Math.min(input.buyers, 999) * 1000 + Math.min(input.awards, 999);
}

/**
 * Fila de la capa gratuita de empresas, o por qué no entra. COMPRASAL no publica el
 * NIT: la proveedora se empata al registro de Hacienda sólo si TODOS sus nombres
 * (razón social de cada adjudicación) llevan al MISMO y ÚNICO NIT. Nunca por el
 * nombre comercial suelto.
 */
export function buildSvComprasalDirectoryRow(
  supplier: SvComprasalSupplier,
  params: {
    importedAt: string;
    nitByKey: ReadonlyMap<string, string>;
    registryByNit: ReadonlyMap<string, SvSnapshotRow>;
    ambiguousKeys: ReadonlySet<string>;
    /**
     * SOURCES-SV-COMPANY-WEB-1 — web por NIT encontrada desde el nombre y comprobada
     * con su propia página (`sv-company-web.ts`).
     */
    webByNit?: ReadonlyMap<string, SvCompanyWeb>;
  },
): { row: SvSnapshotRow } | { excluded: SvDirectoryExclusion } {
  const names = Object.keys(supplier.names);
  if (names.some((name) => CONSORTIUM_NAME.test(name))) return { excluded: 'consortium' };
  if (names.some((name) => classifySalvadorTaxpayerName(name) !== 'entity')) return { excluded: 'natural_person' };
  const cores = [...new Set(names.map((name) => salvadorNameCore(name)).filter((core) => core.length >= 2))];
  if (cores.some((core) => isSalvadorPublicEntityCore(core))) return { excluded: 'public_entity' };
  if (cores.some((core) => params.ambiguousKeys.has(core))) return { excluded: 'ambiguous_nit' };
  const nits = new Set(cores.map((core) => params.nitByKey.get(core)).filter((nit): nit is string => nit !== undefined));
  if (nits.size === 0) return { excluded: 'no_nit' };
  if (nits.size > 1) return { excluded: 'ambiguous_nit' };
  const nit = [...nits][0];
  const registry = params.registryByNit.get(nit);
  if (registry === undefined) return { excluded: 'no_nit' };
  const macro = resolveSvComprasalSupplierMacro(supplier.amountByRule);
  if (macro === null) return { excluded: 'no_dominant_macro' };
  const lastYear = year(supplier.lastDate);
  if (!isSvComprasalRelevant({ awardedUsd: supplier.awardedUsd, lastYear })) return { excluded: 'not_relevant' };

  const tradeName = Object.entries(supplier.tradeNames).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const tradeCore = tradeName === null ? '' : salvadorNameCore(tradeName);
  const identity = deriveTaxRecordIdentity(nit);
  return {
    row: {
      source_key: SV_COMPRASAL_DIRECTORY_SOURCE_KEY,
      country_code: 'SV',
      source_year: lastYear ?? 0,
      tax_id: nit,
      normalized_tax_id: nit,
      legal_name: registry.legal_name,
      normalized_legal_name: registry.normalized_legal_name,
      city: registry.city,
      region: registry.region,
      priority_score: svComprasalPriorityScore({ buyers: supplier.buyers, awards: supplier.awards }),
      raw_data: {
        directory_kind: 'comprasal_supplier',
        macro_industry_key: macro.macroIndustryKey,
        macro_share: Math.round(macro.share * 100) / 100,
        macro_table_version: SV_COMPRASAL_MACRO_TABLE_VERSION,
        activity_code: macro.ruleKey,
        awards: supplier.awards,
        buyers: supplier.buyers,
        awarded_usd: Math.round(supplier.awardedUsd),
        last_award_year: lastYear,
        comprasal_supplier_id: supplier.supplierId,
        nit_match: 'registry_name',
        // El nombre comercial que la propia empresa registró en COMPRASAL (no un dato personal).
        ...(tradeCore.length >= 3 && tradeCore !== registry.normalized_legal_name ? { trade_name: tradeName } : {}),
        ...(registry.raw_data['taxpayer_category'] !== undefined
          ? { taxpayer_category: registry.raw_data['taxpayer_category'], metrics_year: registry.raw_data['metrics_year'] }
          : {}),
        ...(params.webByNit?.get(nit)
          ? { website_domain: params.webByNit.get(nit)!.domain, website_origin: 'name_domain_verified', website_check: params.webByNit.get(nit)!.check }
          : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

// ─── sv_large_taxpayer_directory ──────────────────────────────────────────

/**
 * Fila de la capa gratuita de un Gran Contribuyente (DGII 2019) que no vende al
 * Estado, con la macro y la web de la tabla por NIT (`sv-large-taxpayer-macro-table.ts`,
 * revisada por la dueña), o `no_macro` si la tabla no lo clasifica. Va detrás de las
 * proveedoras de COMPRASAL de la misma macro (que traen lo que venden de verdad).
 */
export function buildSvLargeTaxpayerDirectoryRow(
  registryRow: SvSnapshotRow,
  params: { importedAt: string },
): { row: SvSnapshotRow } | { excluded: 'no_macro' | 'no_nit' } {
  const nit = normalizeSalvadoranNit(registryRow.tax_id);
  if (nit === null) return { excluded: 'no_nit' };
  const macro = resolveSvLargeTaxpayerMacro(nit);
  if (macro === null) return { excluded: 'no_macro' };
  const website = resolveSvLargeTaxpayerWebsite(nit);
  const identity = deriveTaxRecordIdentity(nit);
  return {
    row: {
      ...registryRow,
      source_key: SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY,
      tax_id: nit,
      normalized_tax_id: nit,
      priority_score: website !== null ? 1 : 0,
      raw_data: {
        directory_kind: 'large_taxpayer',
        macro_industry_key: macro,
        macro_table_version: SV_LARGE_TAXPAYER_MACRO_TABLE_VERSION,
        activity_code: nit,
        tax_identifier_type: 'NIT',
        ...(registryRow.raw_data['taxpayer_category'] !== undefined
          ? { taxpayer_category: registryRow.raw_data['taxpayer_category'], metrics_year: registryRow.raw_data['metrics_year'] }
          : {}),
        ...(website !== null ? { website_domain: website, website_origin: 'name_domain_verified' } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}
