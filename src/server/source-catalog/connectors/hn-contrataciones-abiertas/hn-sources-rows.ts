/**
 * hn-sources-rows.ts — filas de las fuentes oficiales de Honduras para el Agente 1.
 *
 * SOURCES-HN-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Entradas (las produce `scripts/source-catalog/extract-hn-ocds-parties.py` desde
 * los datos abiertos OCDS de ONCAE y SEFIN 2018-2026, CC BY 4.0):
 *
 *   - Proveedores con RTN de PERSONA JURÍDICA: nombres, correos, fechas, contratos,
 *     monto en lempiras, compradores, familias UNSPSC, objetos del gasto y el año
 *     más reciente con la marca «*MIPYME*».
 *   - Entidades compradoras de ONCAE (sin RTN): nombre, web, correos, municipio.
 *   - (Opcional) Instituciones supervisadas por la CNBS: nombre y sigla.
 *
 * Salen cuatro claves de fuente:
 *
 *   - `hn_ocds_rtn_registry`: el RTN por nombre dentro de la corrida (un RTN, una
 *     fila), ahora con el núcleo de `hondurasNameCore` y la marca MIPYME para el
 *     filtro de tamaño.
 *   - `hn_rtn_name_alias`: otros nombres del mismo RTN (siglas, nombre comercial,
 *     nombres de otra fuente, clave pública, sigla de la CNBS); nunca el nombre
 *     propio de otro RTN.
 *   - `hn_honducompras_directory`: la capa gratuita de empresas por industria.
 *   - `hn_public_entities`: la capa gratuita de Gobierno (entidades compradoras con
 *     web; ONCAE no publica su RTN, salvo las que también venden al Estado).
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  HN_HONDUCOMPRAS_MACRO_TABLE_VERSION,
  HN_PUBLIC_ENTITY_MACRO,
  isHnHonducomprasRelevant,
  resolveHnSupplierMacro,
  type HnDirectoryKind,
} from '@/server/prospect-batches/country-source-discovery/hn-honducompras-macro-table';
import { HN_OCDS_RTN_SOURCE_KEY, cleanHondurasSupplierName, normalizeHondurasJuridicalRtn } from './hn-ocds-rtn-registry-rows';
import {
  endsWithHondurasLegalForm,
  hondurasNameCore,
  hondurasPublicEntityKey,
  hondurasRegistryAliasKeys,
  isHondurasPublicEntityCore,
  plainUpperHonduras,
} from './hn-name-keys';
import { hondurasCompanyDomainFromEmails, hondurasPublicEntityDomain } from './hn-domain';

export { HN_OCDS_RTN_SOURCE_KEY };
export const HN_RTN_NAME_ALIAS_SOURCE_KEY = 'hn_rtn_name_alias' as const;
export const HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY = 'hn_honducompras_directory' as const;
export const HN_PUBLIC_ENTITIES_SOURCE_KEY = 'hn_public_entities' as const;

/** Espacio de nombres de la identidad de un alias (`hn-name-alias:<RTN>:<clave>`). */
export const HN_NAME_ALIAS_IDENTITY_NAMESPACE = 'hn-name-alias' as const;
/** Espacio de nombres de una entidad compradora de ONCAE (`hn-oncae-ce:<código>`). */
export const HN_PUBLIC_ENTITY_IDENTITY_NAMESPACE = 'hn-oncae-ce' as const;

const CONSORTIUM_NAME = /^\s*["'«]?\s*CONSORCIO\b/i;

// ─── Entradas ──────────────────────────────────────────────────────────────

export type HnOcdsSupplier = {
  rtn: string;
  names: Readonly<Record<string, number>>;
  emails: readonly string[];
  region: string | null;
  locality: string | null;
  first: string | null;
  last: string | null;
  sources: readonly string[];
  contracts: number;
  hnl: number;
  buyers: number;
  fam: Readonly<Record<string, number>>;
  obj: Readonly<Record<string, number>>;
  mipymeYear: number | null;
};

export type HnOcdsBuyer = {
  id: string;
  name: string;
  urls: readonly string[];
  emails: readonly string[];
  region: string | null;
  locality: string | null;
  last: string | null;
};

export type HnCnbsInstitution = { name: string; acronym: string | null };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Una línea de hn_suppliers.jsonl, o `null` si no trae un RTN jurídico. */
export function parseHnOcdsSupplier(raw: unknown): HnOcdsSupplier | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rtn = normalizeHondurasJuridicalRtn(r['rtn']);
  const names = numberRecord(r['names']);
  if (rtn === null || Object.keys(names).length === 0) return null;
  return {
    rtn,
    names,
    emails: strList(r['emails']),
    region: str(r['region']),
    locality: str(r['locality']),
    first: str(r['first']),
    last: str(r['last']),
    sources: strList(r['sources']),
    contracts: int(r['contracts']) ?? 0,
    hnl: typeof r['hnl'] === 'number' && Number.isFinite(r['hnl']) ? (r['hnl'] as number) : 0,
    buyers: int(r['buyers']) ?? 0,
    fam: numberRecord(r['fam']),
    obj: numberRecord(r['obj']),
    mipymeYear: int(r['mipyme_year']),
  };
}

/** Una línea de hn_buyers.jsonl, o `null` si no trae nombre. */
export function parseHnOcdsBuyer(raw: unknown): HnOcdsBuyer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r['id']);
  const name = str(r['name']);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    urls: strList(r['urls']),
    emails: strList(r['emails']),
    region: str(r['region']),
    locality: str(r['locality']),
    last: str(r['last']),
  };
}

/**
 * Filas del CSV de instituciones de la CNBS (`_id,TipoInstitución,Institución,
 * Descripción,Logo`): el nombre y la sigla corta de la columna «Logo».
 */
export function parseCnbsInstitutionsCsv(csv: string): HnCnbsInstitution[] {
  const rows: HnCnbsInstitution[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (line.trim() === '') continue;
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(current);
        current = '';
      } else current += ch;
    }
    cells.push(current);
    const name = str(cells[3]);
    if (name !== null) rows.push({ name, acronym: str(cells[4]) });
  }
  return rows;
}

// ─── Nombres ───────────────────────────────────────────────────────────────

/**
 * La razón social: entre los nombres que publicó la fuente (sin las colas de
 * HonduCompras), primero los que terminan en una forma societaria —«BANCO FICOHSA
 * FIDUCIARIO» es cómo SIAFI llama a una cuenta, la razón social es «Banco
 * Financiera Comercial Hondureña S.A.»—, y entre ellos el más publicado.
 */
export function hnPreferredLegalName(supplier: Pick<HnOcdsSupplier, 'names'>): string | null {
  let best: { name: string; count: number; form: boolean } | null = null;
  const counts = new Map<string, number>();
  for (const [raw, count] of Object.entries(supplier.names)) {
    // «Banco Financiera Comercial Hondureña S.A./Banco Ficohsa»: la razón social es la
    // primera parte; la marca queda como alias.
    const full = cleanHondurasSupplierName(raw).replace(/\s+/g, ' ');
    const head = full.split(/\s*\/\s*/)[0] ?? full;
    const name = head !== full && endsWithHondurasLegalForm(head) ? head : full;
    if (name.length === 0 || hondurasNameCore(name).length < 2) continue;
    counts.set(name, (counts.get(name) ?? 0) + count);
  }
  for (const [name, count] of counts) {
    const form = endsWithHondurasLegalForm(name);
    const better =
      best === null ||
      (form && !best.form) ||
      (form === best.form && (count > best.count || (count === best.count && name.length > best.name.length)));
    if (better) best = { name, count, form };
  }
  return best?.name ?? null;
}

function year(date: string | null): number | null {
  const y = Number((date ?? '').slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
}

// ─── hn_ocds_rtn_registry ──────────────────────────────────────────────────

export type HnSnapshotRow = {
  source_key: string;
  country_code: 'HN';
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

/** Fila del registro de RTN, o `null` si el RTN no tiene un nombre utilizable. */
export function buildHnRtnRegistryRow(supplier: HnOcdsSupplier, params: { importedAt: string }): HnSnapshotRow | null {
  const legalName = hnPreferredLegalName(supplier);
  const core = legalName === null ? '' : hondurasNameCore(legalName);
  if (legalName === null || core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(supplier.rtn);
  const lastYear = year(supplier.last);
  return {
    source_key: HN_OCDS_RTN_SOURCE_KEY,
    country_code: 'HN',
    source_year: lastYear ?? 0,
    tax_id: supplier.rtn,
    normalized_tax_id: supplier.rtn,
    legal_name: legalName,
    normalized_legal_name: core,
    city: supplier.locality,
    region: supplier.region,
    priority_score: 0,
    raw_data: {
      tax_identifier_type: 'RTN',
      origins: [...supplier.sources],
      ...(supplier.last ? { last_release: supplier.last.slice(0, 10) } : {}),
      contracts: supplier.contracts,
      awarded_hnl: Math.round(supplier.hnl),
      // Marca «*MIPYME*» de HonduCompras: el filtro de tamaño la lee como tramo
      // «hasta 150 personas» (aprobado por la dueña el 07-10-2026).
      ...(supplier.mipymeYear !== null ? { hn_mipyme_year: supplier.mipymeYear } : {}),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function hnOwnNameKeys(row: Pick<HnSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = hondurasPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/** Siglas de la CNBS que nunca identifican a una sola institución. */
const CNBS_GENERIC_ACRONYM = /^(HONDURAS|BANCOS?|SEGUROS?|FINANCIERA|COOPERATIVA)$/;

/**
 * Claves EXTRA de un RTN: los núcleos de sus otros nombres y las claves de alias de
 * cada nombre (sigla, nombre comercial, partes, clave pública), más la sigla de la
 * CNBS si la institución supervisada tiene el mismo núcleo. Sin el núcleo propio.
 */
export function hnSupplierAliasKeys(
  supplier: Pick<HnOcdsSupplier, 'names'>,
  mainCore: string,
  cnbsAcronymsByCore: ReadonlyMap<string, readonly string[]> = new Map(),
): string[] {
  const keys: string[] = [];
  const push = (key: string): void => {
    if (key.length >= 2 && key !== mainCore && !keys.includes(key)) keys.push(key);
  };
  const cores = new Set<string>([mainCore]);
  for (const raw of Object.keys(supplier.names)) {
    const name = cleanHondurasSupplierName(raw);
    const core = hondurasNameCore(name);
    cores.add(core);
    push(core);
    for (const key of hondurasRegistryAliasKeys(name)) {
      cores.add(key);
      push(key);
    }
  }
  // La sigla de la CNBS se busca por cualquiera de los nombres del RTN.
  for (const core of cores) for (const acronym of cnbsAcronymsByCore.get(core) ?? []) push(acronym);
  return keys;
}

/**
 * Sigla de la CNBS por núcleo del nombre de la institución: «BANCO HONDUREÑO DEL
 * CAFÉ, S.A.» → BANHCAFE. Una sigla de una sola palabra genérica («HONDURAS») nunca.
 */
export function cnbsAcronymsByCore(institutions: readonly HnCnbsInstitution[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const institution of institutions) {
    const core = hondurasNameCore(institution.name);
    const acronym = institution.acronym === null ? '' : plainUpperHonduras(institution.acronym);
    if (core.length < 2 || acronym.length < 3 || acronym === core || CNBS_GENERIC_ACRONYM.test(acronym)) continue;
    out.set(core, [...(out.get(core) ?? []), acronym]);
  }
  return out;
}

/** Filas de alias de un RTN (ya sin las claves que son el nombre propio de otro RTN). */
export function buildHnRtnNameAliasRows(params: { registryRow: HnSnapshotRow; keys: readonly string[] }): HnSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: HnSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(HN_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: HN_RTN_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

// ─── hn_honducompras_directory ─────────────────────────────────────────────

/** Por qué una empresa no entra en la capa gratuita. */
export type HnDirectoryExclusion = 'consortium' | 'public_entity' | 'no_contracts' | 'no_dominant_macro' | 'not_relevant';

/** Orden dentro de una macro: a cuántas entidades distintas vende y cuántos contratos. */
export function hnHonducomprasPriorityScore(input: { buyers: number; contracts: number }): number {
  return Math.min(input.buyers, 999) * 1000 + Math.min(input.contracts, 999);
}

/** Dominio corporativo del proveedor (de sus correos), o `null`. */
export function hnSupplierDomain(supplier: Pick<HnOcdsSupplier, 'emails'>): string | null {
  return hondurasCompanyDomainFromEmails(supplier.emails);
}

function dominantCode(amounts: Readonly<Record<string, number>>): string | null {
  return Object.entries(amounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * Fila de la capa gratuita de empresas, o por qué no entra. `sharedDomains`:
 * dominios que usan dos o más RTN (correos de grupo o de bufete): no identifican a
 * una sola empresa.
 */
export function buildHnHonducomprasDirectoryRow(
  supplier: HnOcdsSupplier,
  params: { importedAt: string; sharedDomains: ReadonlySet<string> },
): { row: HnSnapshotRow } | { excluded: HnDirectoryExclusion } {
  const legalName = hnPreferredLegalName(supplier);
  if (legalName === null || Object.keys(supplier.names).some((name) => CONSORTIUM_NAME.test(name))) {
    return { excluded: 'consortium' };
  }
  const core = hondurasNameCore(legalName);
  // Las entidades del Estado que también venden (Hondutel, UNAH) van por Gobierno.
  if (isHondurasPublicEntityCore(core)) return { excluded: 'public_entity' };
  if (supplier.contracts === 0) return { excluded: 'no_contracts' };
  const macro = resolveHnSupplierMacro({ amountByFamily: supplier.fam, amountByObjeto: supplier.obj });
  if (macro === null) return { excluded: 'no_dominant_macro' };
  const lastYear = year(supplier.last);
  if (!isHnHonducomprasRelevant({ awardedHnl: supplier.hnl, lastYear, mipymeYear: supplier.mipymeYear })) {
    return { excluded: 'not_relevant' };
  }

  const domain = hnSupplierDomain(supplier);
  const kind: HnDirectoryKind = macro.kind;
  const code = kind === 'honducompras_supplier' ? dominantCode(supplier.fam) : dominantCode(supplier.obj);
  const identity = deriveTaxRecordIdentity(supplier.rtn);
  return {
    row: {
      source_key: HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY,
      country_code: 'HN',
      source_year: lastYear ?? 0,
      tax_id: supplier.rtn,
      normalized_tax_id: supplier.rtn,
      legal_name: legalName,
      normalized_legal_name: core,
      city: supplier.locality,
      region: supplier.region,
      priority_score: hnHonducomprasPriorityScore({ buyers: supplier.buyers, contracts: supplier.contracts }),
      raw_data: {
        directory_kind: kind,
        macro_industry_key: macro.macroIndustryKey,
        macro_share: Math.round(macro.share * 100) / 100,
        macro_table_version: HN_HONDUCOMPRAS_MACRO_TABLE_VERSION,
        activity_code: code,
        contracts: supplier.contracts,
        buyers: supplier.buyers,
        awarded_hnl: Math.round(supplier.hnl),
        last_award_year: lastYear,
        origins: [...supplier.sources],
        ...(domain !== null && !params.sharedDomains.has(domain) ? { website_domain: domain, website_origin: 'email' } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

// ─── hn_public_entities ────────────────────────────────────────────────────

/** Tipo de entidad pública, para ordenar dentro de Gobierno. */
export type HnPublicEntityKind = 'ministry' | 'national_body' | 'university_or_hospital' | 'municipality' | 'other';

export function classifyHnPublicEntity(core: string): HnPublicEntityKind {
  if (/^SECRETARIA\b/.test(core)) return 'ministry';
  if (/^(ALCALDIA|MUNICIPALIDAD|CORPORACION MUNICIPAL)\b/.test(core)) return 'municipality';
  if (/^(UNIVERSIDAD|HOSPITAL)\b/.test(core)) return 'university_or_hospital';
  if (isHondurasPublicEntityCore(core)) return 'national_body';
  return 'other';
}

const KIND_PRIORITY: Readonly<Record<HnPublicEntityKind, number>> = {
  ministry: 5,
  national_body: 4,
  university_or_hospital: 3,
  municipality: 2,
  other: 1,
};

/** Por qué una entidad compradora no entra en la capa gratuita de Gobierno. */
export type HnPublicEntityExclusion = 'no_name' | 'not_public' | 'no_website' | 'shared_website';

/**
 * Compradores de ONCAE que NO son el Estado: ONG, fundaciones, cámaras y
 * sociedades que ejecutan fondos públicos. No van a Gobierno.
 */
const NON_PUBLIC_BUYER = /^(FUNDACION|FUNDANIQUEM|ASOCIACION|PLAN INTERNACIONAL|CAMARA|COOPERATIVA|IGLESIA|CARE|VISION MUNDIAL|ALDEAS|CRUZ ROJA|MCA)\b/;

/**
 * Fila de Gobierno de una entidad compradora de ONCAE, o por qué no entra. Sólo con
 * web (aprobado por la dueña el 07-10-2026). Si la entidad también vende al Estado
 * con RTN (Hondutel, UNAH), `rtnByPublicKey` le pone ese RTN.
 */
export function buildHnPublicEntityRow(
  buyer: HnOcdsBuyer,
  params: {
    importedAt: string;
    sharedDomains: ReadonlySet<string>;
    rtnByPublicKey: ReadonlyMap<string, string>;
  },
): { row: HnSnapshotRow } | { excluded: HnPublicEntityExclusion } {
  const core = hondurasNameCore(buyer.name);
  if (core.length < 3) return { excluded: 'no_name' };
  if (NON_PUBLIC_BUYER.test(core) || endsWithHondurasLegalForm(buyer.name)) return { excluded: 'not_public' };
  const domain = hondurasPublicEntityDomain({ name: buyer.name, urls: buyer.urls, emails: buyer.emails });
  if (domain === null) return { excluded: 'no_website' };
  if (params.sharedDomains.has(domain)) return { excluded: 'shared_website' };
  const kind = classifyHnPublicEntity(core);
  const publicKey = hondurasPublicEntityKey(buyer.name) ?? core;
  const rtn = params.rtnByPublicKey.get(publicKey) ?? params.rtnByPublicKey.get(core) ?? null;
  const identity = buildRecordIdentityKey(HN_PUBLIC_ENTITY_IDENTITY_NAMESPACE, buyer.id);
  return {
    row: {
      source_key: HN_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: 'HN',
      source_year: year(buyer.last) ?? 0,
      tax_id: rtn,
      normalized_tax_id: rtn,
      legal_name: buyer.name.replace(/\s+/g, ' ').trim(),
      normalized_legal_name: core,
      city: buyer.locality,
      region: buyer.region,
      priority_score: KIND_PRIORITY[kind] * 10 + (rtn !== null ? 1 : 0),
      raw_data: {
        directory_kind: 'public_entity',
        macro_industry_key: HN_PUBLIC_ENTITY_MACRO,
        macro_table_version: HN_HONDUCOMPRAS_MACRO_TABLE_VERSION,
        entity_kind: kind,
        public_key: publicKey,
        oncae_entity_id: buyer.id,
        website_domain: domain,
        website_origin: buyer.urls.length > 0 ? 'oncae_url' : 'email',
        ...(rtn !== null ? { tax_identifier_type: 'RTN' } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}
