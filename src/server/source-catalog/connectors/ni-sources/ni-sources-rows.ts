/**
 * ni-sources-rows.ts — filas de las fuentes oficiales de Nicaragua para el Agente 1.
 *
 * SOURCES-NI-CLOSE-2. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Las fuentes oficiales de Nicaragua no responden desde fuera del país (SISCAE, DGI,
 * Registro Público, CETREX, SIBOIF). Lo que sí se alcanza, medido el 07-10-2026:
 *
 *   1. La «Consulta Grandes Contribuyentes» de la DGI, en las tres copias del
 *      Internet Archive (2019-2020): 505 personas jurídicas con RUC, razón social y
 *      nombre comercial.
 *   2. Las licencias sanitarias del MINSA (consulta pública KARPLUS, en vivo): 947
 *      personas jurídicas con RUC que importan, distribuyen o fabrican medicamentos,
 *      dispositivos médicos o alimentos, y establecimientos de salud.
 *   3. El Directorio Industrial de la Comisión Nacional de Zonas Francas (2025): 222
 *      fichas con sección, actividad y dominio del correo corporativo. Sin RUC.
 *   4. El registro de instituciones de microfinanzas de la CONAMI: 111, con web. Sin RUC.
 *   5. Las entidades públicas con web oficial (`ni-public-entities.ts`). Sin RUC.
 *
 * Salen cuatro claves de fuente:
 *
 *   - `ni_ruc_registry`: el RUC por nombre dentro de la corrida (un RUC, una fila;
 *     sólo personas jurídicas «J» + 13 dígitos).
 *   - `ni_ruc_name_alias`: otros nombres del mismo RUC (nombre comercial, nombre en
 *     la otra fuente, sigla), nunca el nombre propio de otro RUC.
 *   - `ni_free_directory`: la capa gratuita por industria de quien tiene RUC.
 *   - `ni_free_directory_web`: la capa gratuita de quien sólo tiene web (Zona Franca,
 *     CONAMI y entidades públicas sin RUC conocido): identidad `ni-web:<dominio>`.
 *
 * Nunca se guardan correos, contactos, teléfonos ni direcciones, ni datos de
 * personas naturales.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  niCnzfEffectiveSection,
  NI_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  resolveNiDirectoryMacro,
  type NiDirectoryKind,
} from '@/server/prospect-batches/country-source-discovery/ni-free-directory-macro-table';
import {
  isNicaraguaNoAliasName,
  nicaraguaNameCore,
  nicaraguaPublicEntityKey,
  nicaraguaRegistryAliasKeys,
  plainUpperNicaragua,
} from './ni-name-keys';
import { nicaraguaCompanyDomain } from './ni-domain';
import type { NiPublicEntity } from './ni-public-entities';

export const NI_RUC_REGISTRY_SOURCE_KEY = 'ni_ruc_registry' as const;
export const NI_RUC_NAME_ALIAS_SOURCE_KEY = 'ni_ruc_name_alias' as const;
export const NI_FREE_DIRECTORY_SOURCE_KEY = 'ni_free_directory' as const;
export const NI_FREE_DIRECTORY_WEB_SOURCE_KEY = 'ni_free_directory_web' as const;

/** Espacio de nombres de un alias (`ni-name-alias:<RUC>:<clave>`) y de una fila sólo con web (`ni-web:<dominio>`). */
export const NI_NAME_ALIAS_IDENTITY_NAMESPACE = 'ni-name-alias' as const;
export const NI_WEB_IDENTITY_NAMESPACE = 'ni-web' as const;

/** Categoría de contribuyente que lee el filtro de tamaño (`workforceFromRawData`). */
export const NI_LARGE_TAXPAYER_CATEGORY = 'NI_GRAN_CONTRIBUYENTE' as const;

/** Año de la copia más reciente de la lista de la DGI (20-03-2020). */
export const NI_LARGE_TAXPAYER_LIST_YEAR = 2020;

/** RUC de persona jurídica de Nicaragua: «J» + 13 dígitos. */
export const NI_JURIDICAL_RUC = /^J\d{13}$/;

/** La DGI corta la razón social a 50 caracteres. */
const DGI_NAME_CUT_LENGTH = 49;

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

/** RUC crudo → RUC de persona jurídica canónico, o `null`. */
export function canonicalNicaraguaRuc(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.toUpperCase().replace(/[\s.-]/g, '');
  return NI_JURIDICAL_RUC.test(compact) ? compact : null;
}

// ─── Entradas (líneas de los extractores) ──────────────────────────────────

/** Una línea de `ni_large_taxpayers.jsonl` (`extract-ni-dgi-large-taxpayers.py`). */
export type NiLargeTaxpayer = { ruc: string; name: string; tradeName: string | null; snapshots: readonly string[] };

/** Una línea de `ni_minsa_licenses.jsonl` (`extract-ni-minsa-licenses.py`). */
export type NiMinsaLicense = {
  ruc: string;
  name: string | null;
  tradeName: string | null;
  licenseType: string;
  status: string | null;
};

/** Una línea de `ni_cnzf_directory.jsonl` (`extract-ni-cnzf-directory.py`). */
export type NiCnzfCompany = {
  name: string;
  section: string | null;
  activity: string | null;
  originCountry: string | null;
  domains: readonly string[];
};

/** Una línea de `ni_conami_imf.jsonl` (`extract-ni-conami-imf.py`). */
export type NiConamiImf = { name: string | null; legalName: string | null; url: string | null; category: string | null };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? cleanText(value) : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : [];

export function parseNiLargeTaxpayer(raw: unknown): NiLargeTaxpayer | null {
  const r = record(raw);
  const ruc = canonicalNicaraguaRuc(str(r?.['ruc']));
  const name = str(r?.['name']);
  if (r === null || ruc === null || name === null) return null;
  return { ruc, name, tradeName: str(r['trade_name']), snapshots: strings(r['snapshots']) };
}

export function parseNiMinsaLicense(raw: unknown): NiMinsaLicense | null {
  const r = record(raw);
  const ruc = canonicalNicaraguaRuc(str(r?.['ruc']));
  const licenseType = str(r?.['license_type']);
  if (r === null || ruc === null || licenseType === null) return null;
  return { ruc, name: str(r['name']), tradeName: str(r['trade_name']), licenseType, status: str(r['status'])?.toUpperCase() ?? null };
}

export function parseNiCnzfCompany(raw: unknown): NiCnzfCompany | null {
  const r = record(raw);
  const name = str(r?.['name']);
  if (r === null || name === null) return null;
  return {
    name,
    section: str(r['section']),
    activity: str(r['activity']),
    originCountry: str(r['origin_country']),
    domains: strings(r['domains']),
  };
}

export function parseNiConamiImf(raw: unknown): NiConamiImf | null {
  const r = record(raw);
  if (r === null) return null;
  const name = str(r['name']);
  const legalName = str(r['legal_name']);
  if (name === null && legalName === null) return null;
  return { name, legalName, url: str(r['url']), category: str(r['category']) };
}

// ─── Unión por RUC ─────────────────────────────────────────────────────────

export type NiRucEntry = {
  ruc: string;
  largeTaxpayer: NiLargeTaxpayer | null;
  licenses: NiMinsaLicense[];
};

/** Junta la lista de la DGI y las licencias del MINSA por RUC. */
export function mergeNicaraguaRucSources(input: {
  largeTaxpayers: readonly NiLargeTaxpayer[];
  licenses: readonly NiMinsaLicense[];
}): Map<string, NiRucEntry> {
  const entries = new Map<string, NiRucEntry>();
  const entryFor = (ruc: string): NiRucEntry => {
    const existing = entries.get(ruc);
    if (existing) return existing;
    const created: NiRucEntry = { ruc, largeTaxpayer: null, licenses: [] };
    entries.set(ruc, created);
    return created;
  };
  for (const taxpayer of input.largeTaxpayers) entryFor(taxpayer.ruc).largeTaxpayer = taxpayer;
  for (const license of input.licenses) entryFor(license.ruc).licenses.push(license);
  return entries;
}

/** El nombre más repetido de una lista (empate: el más largo, luego el alfabético). */
function mostCommon(names: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    const text = cleanText(name);
    if (text !== null) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * La razón social que se guarda: la de la DGI (la autoridad tributaria), salvo que
 * venga cortada a 50 caracteres y el MINSA traiga la entera con el mismo comienzo.
 */
export function niPreferredLegalName(entry: NiRucEntry): string | null {
  const dgi = cleanText(entry.largeTaxpayer?.name);
  const minsa = mostCommon(entry.licenses.map((l) => l.name));
  if (dgi === null) return minsa;
  if (minsa !== null && dgi.length >= DGI_NAME_CUT_LENGTH) {
    const dgiCore = nicaraguaNameCore(dgi);
    const minsaCore = nicaraguaNameCore(minsa);
    if (dgiCore.length > 0 && minsaCore.startsWith(dgiCore) && minsa.length > dgi.length) return minsa;
  }
  return dgi;
}

/** Todos los nombres que las fuentes dan a un RUC (sin repetir). */
export function niAllNames(entry: NiRucEntry): string[] {
  const names = [
    entry.largeTaxpayer?.name,
    entry.largeTaxpayer?.tradeName,
    ...entry.licenses.flatMap((l) => [l.name, l.tradeName]),
  ]
    .map((name) => cleanText(name))
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}

const LICENSE_ORDER = ['farmacia', 'dispositivo_medico', 'establecimiento_salud', 'alimentos_bebidas'] as const;

/** Resumen de las licencias de un RUC: vigentes por tipo. */
function licenseSummary(entry: NiRucEntry): { activeByType: Record<string, number>; active: number; total: number } {
  const activeByType: Record<string, number> = {};
  let active = 0;
  for (const license of entry.licenses) {
    if (license.status !== 'VIGENTE') continue;
    activeByType[license.licenseType] = (activeByType[license.licenseType] ?? 0) + 1;
    active++;
  }
  return { activeByType, active, total: entry.licenses.length };
}

// ─── ni_ruc_registry ───────────────────────────────────────────────────────

export type NiSnapshotRow = {
  source_key: string;
  country_code: 'NI';
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

/** Datos del Gran Contribuyente que leen el filtro de tamaño y la ficha. */
function largeTaxpayerRaw(entry: NiRucEntry | null): Record<string, unknown> {
  return entry?.largeTaxpayer
    ? {
        dgi_large_taxpayer: true,
        dgi_list_snapshots: [...entry.largeTaxpayer.snapshots],
        taxpayer_category: NI_LARGE_TAXPAYER_CATEGORY,
        metrics_year: NI_LARGE_TAXPAYER_LIST_YEAR,
        official_size_band: 'large',
      }
    : {};
}

/** Fila del registro de RUC, o `null` si el RUC no tiene un nombre utilizable. */
export function buildNiRucRegistryRow(entry: NiRucEntry, params: { sourceYear: number; importedAt: string }): NiSnapshotRow | null {
  const legalName = niPreferredLegalName(entry);
  const core = legalName === null ? '' : nicaraguaNameCore(legalName);
  if (legalName === null || core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(entry.ruc);
  const licenses = licenseSummary(entry);
  const origins = [entry.largeTaxpayer ? 'dgi_large_taxpayer' : null, entry.licenses.length > 0 ? 'minsa_license' : null].filter(
    (origin): origin is string => origin !== null,
  );
  return {
    source_key: NI_RUC_REGISTRY_SOURCE_KEY,
    country_code: 'NI',
    source_year: params.sourceYear,
    tax_id: entry.ruc,
    normalized_tax_id: entry.ruc,
    legal_name: legalName,
    normalized_legal_name: core,
    city: null,
    region: null,
    priority_score: 0,
    raw_data: {
      tax_identifier_type: 'RUC',
      origins,
      trade_name: cleanText(entry.largeTaxpayer?.tradeName) ?? mostCommon(entry.licenses.map((l) => l.tradeName)),
      ...(licenses.total > 0
        ? { minsa_licenses: licenses.total, minsa_active_licenses: licenses.active, minsa_active_by_type: licenses.activeByType }
        : {}),
      ...largeTaxpayerRaw(entry),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function niOwnNameKeys(row: Pick<NiSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = nicaraguaPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/**
 * «I . B. W.», «E.M.C.O.S.E.», «S I N S A» → «IBW», «EMCOSE», «SINSA»: una sigla
 * escrita letra por letra (antes de quitar la forma, que se comería la «S A» final).
 */
function joinedInitials(name: string): string | null {
  const words = plainUpperNicaragua(name).split(' ');
  return words.length >= 3 && words.every((w) => w.length === 1) ? words.join('') : null;
}

/** «CARGILL , CARGILL DE NICARAGUA, S.A. , TIP TOP»: varias marcas en un nombre comercial. */
function tradeNameParts(name: string): string[] {
  const parts = name.split(/\s+,\s+|\s*;\s*|\s+\/\s+/).map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.length > 1 ? parts : [];
}

/**
 * Claves EXTRA de un RUC: los núcleos de sus otros nombres (nombre comercial, el de la
 * otra fuente) y sus siglas. Sin el núcleo propio. Un consorcio o asociación
 * momentánea es OTRA entidad: su nombre nunca es alias de una socia.
 */
export function niEntryAliasKeys(entry: NiRucEntry, mainCore: string): string[] {
  const keys: string[] = [];
  const push = (key: string | null): void => {
    if (key !== null && key.length >= 3 && key !== mainCore && !keys.includes(key)) keys.push(key);
  };
  for (const name of niAllNames(entry)) {
    if (isNicaraguaNoAliasName(name)) continue;
    push(joinedInitials(name) ?? nicaraguaNameCore(name));
    for (const key of nicaraguaRegistryAliasKeys(name)) push(key);
    for (const part of tradeNameParts(name)) push(nicaraguaNameCore(part));
  }
  return keys;
}

/** Filas de alias de un RUC (ya sin las claves que son el nombre propio de otro RUC). */
export function buildNiRucNameAliasRows(params: { registryRow: NiSnapshotRow; keys: readonly string[] }): NiSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: NiSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(NI_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: NI_RUC_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

// ─── Capa gratuita ─────────────────────────────────────────────────────────

/** Lo que una fuente sin RUC dice de una entidad (Zona Franca, CONAMI, Estado). */
export type NiWebListing =
  | { kind: 'cnzf'; name: string; code: string | null; domain: string | null; originCountry: string | null; activity: string | null }
  | { kind: 'conami_imf'; name: string; code: null; domain: string | null; category: string | null }
  | { kind: 'public_entity'; name: string; code: string; domain: string | null };

/** Las fichas de la CNZF, la CONAMI y el Estado como listados con su web. */
export function niWebListings(input: {
  cnzf: readonly NiCnzfCompany[];
  conami: readonly NiConamiImf[];
  publicEntities: readonly NiPublicEntity[];
}): NiWebListing[] {
  const listings: NiWebListing[] = [];
  for (const company of input.cnzf) {
    const domain = company.domains.map((d) => nicaraguaCompanyDomain(d)).find((d): d is string => d !== null) ?? null;
    listings.push({
      kind: 'cnzf',
      name: company.name,
      code: niCnzfEffectiveSection(company.section, company.name, company.activity),
      domain,
      originCountry: company.originCountry,
      activity: company.activity,
    });
  }
  for (const imf of input.conami) {
    const name = imf.legalName ?? imf.name!;
    listings.push({ kind: 'conami_imf', name, code: null, domain: nicaraguaCompanyDomain(imf.url), category: imf.category });
  }
  for (const entity of input.publicEntities) {
    listings.push({ kind: 'public_entity', name: entity.name, code: entity.kind, domain: entity.domain });
  }
  return listings;
}

/**
 * Índice núcleo → RUC con las claves propias y los alias del registro. Sólo vale una
 * clave que lleva a UN RUC.
 */
export function buildNiRucNameIndex(rows: readonly NiSnapshotRow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.normalized_tax_id === null) continue;
    index.set(row.normalized_legal_name, (index.get(row.normalized_legal_name) ?? new Set<string>()).add(row.normalized_tax_id));
  }
  return index;
}

/** El RUC de un listado sin RUC: su núcleo (o el de su nombre comercial) lleva a un único RUC. */
export function niListingRuc(listing: NiWebListing, index: ReadonlyMap<string, ReadonlySet<string>>, extraNames: readonly string[] = []): string | null {
  const found = new Set<string>();
  for (const name of [listing.name, ...extraNames]) {
    const core = nicaraguaNameCore(name);
    const hits = core.length >= 3 ? index.get(core) : undefined;
    if (hits === undefined) continue;
    if (hits.size !== 1) return null;
    for (const ruc of hits) found.add(ruc);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** Por qué una entidad no entra en la capa gratuita. */
export type NiDirectoryExclusion = 'no_name' | 'consortium' | 'not_relevant' | 'no_macro' | 'no_ruc_no_web';

/** Relevancia para ordenar dentro de una macro. */
export function niFreeDirectoryPriorityScore(input: {
  largeTaxpayer: boolean;
  freeZone: boolean;
  publicEntityKind: string | null;
  activeLicenses: number;
  hasDomain: boolean;
}): number {
  const publicScore =
    input.publicEntityKind === null ? 0 : input.publicEntityKind === 'territorial' ? 800_000 : 900_000;
  return (
    (input.largeTaxpayer ? 1_000_000 : 0) +
    (input.freeZone ? 500_000 : 0) +
    publicScore +
    Math.min(input.activeLicenses, 999) * 1000 +
    (input.hasDomain ? 1 : 0)
  );
}

/** Tipo de licencia vigente dominante de un RUC (más licencias; empate: orden fijo). */
function dominantLicenseType(activeByType: Readonly<Record<string, number>>): string | null {
  const ranked = LICENSE_ORDER.filter((type) => (activeByType[type] ?? 0) > 0).sort(
    (a, b) => (activeByType[b] ?? 0) - (activeByType[a] ?? 0),
  );
  return ranked[0] ?? null;
}

type Classification = { kind: NiDirectoryKind; code: string | null };

/**
 * Clasificación de una entidad con RUC: lo que dice la fuente oficial de ella
 * (sección de la CNZF, entidad pública, licencia sanitaria, CONAMI) y, si no, la
 * tabla de Grandes Contribuyentes. `null` si nada la clasifica.
 */
function classifyWithRuc(entry: NiRucEntry | null, listings: readonly NiWebListing[]): Classification | null {
  const candidates: Classification[] = [];
  for (const listing of listings) {
    if (listing.kind === 'public_entity') candidates.push({ kind: 'public_entity', code: listing.code });
  }
  for (const listing of listings) {
    if (listing.kind === 'cnzf' && listing.code !== null) candidates.push({ kind: 'cnzf', code: listing.code });
  }
  const license = entry ? dominantLicenseType(licenseSummary(entry).activeByType) : null;
  if (license !== null) candidates.push({ kind: 'minsa_license', code: license });
  if (listings.some((l) => l.kind === 'conami_imf')) candidates.push({ kind: 'conami_imf', code: null });
  if (entry?.largeTaxpayer) candidates.push({ kind: 'large_taxpayer', code: entry.ruc });
  return candidates.find((c) => resolveNiDirectoryMacro(c.kind, c.code) !== null) ?? null;
}

const CONSORTIUM_NAME = /^\s*["'«]?\s*(CONSORCIO|ASOCIACI[OÓ]N MOMENT[AÁ]NEA)\b/i;

function directoryRaw(params: {
  classification: Classification;
  entry: NiRucEntry | null;
  listings: readonly NiWebListing[];
  domain: string | null;
}): Record<string, unknown> {
  const { classification, entry, listings, domain } = params;
  const licenses = entry ? licenseSummary(entry) : null;
  const cnzf = listings.find((l): l is Extract<NiWebListing, { kind: 'cnzf' }> => l.kind === 'cnzf');
  const publicEntity = listings.find((l): l is Extract<NiWebListing, { kind: 'public_entity' }> => l.kind === 'public_entity');
  return {
    directory_kind: classification.kind,
    activity_code: classification.code,
    macro_industry_key: resolveNiDirectoryMacro(classification.kind, classification.code),
    macro_table_version: NI_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    origins: [
      entry?.largeTaxpayer ? 'dgi_large_taxpayer' : null,
      licenses && licenses.total > 0 ? 'minsa_license' : null,
      ...new Set(listings.map((l) => l.kind)),
    ].filter((o): o is string => o !== null),
    ...(licenses && licenses.total > 0 ? { minsa_active_licenses: licenses.active } : {}),
    ...(cnzf ? { free_zone: true, ...(cnzf.originCountry ? { capital_origin: cnzf.originCountry } : {}) } : {}),
    ...(publicEntity ? { public_entity_kind: publicEntity.code } : {}),
    ...largeTaxpayerRaw(entry),
    ...(domain !== null ? { website_domain: domain, website_origin: publicEntity ? 'official_site' : 'source' } : {}),
  };
}

/**
 * Filas de la capa gratuita.
 *
 * - Con RUC (`ni_free_directory`): Grandes Contribuyentes clasificados, RUC con una
 *   licencia sanitaria VIGENTE, y las fichas de la CNZF, la CONAMI o el Estado cuyo
 *   nombre lleva a un único RUC del registro.
 * - Sin RUC (`ni_free_directory_web`): fichas de la CNZF, la CONAMI y el Estado con
 *   web propia. Sin web ni RUC no hay forma segura de identificarlas: no entran.
 *
 * Un dominio que usan dos o más entidades (correo de grupo o de un despacho) no se usa.
 */
export function buildNiFreeDirectoryRows(params: {
  entries: ReadonlyMap<string, NiRucEntry>;
  registryRows: readonly NiSnapshotRow[];
  aliasRows: readonly NiSnapshotRow[];
  listings: readonly NiWebListing[];
  sourceYear: number;
  importedAt: string;
}): { taxRows: NiSnapshotRow[]; webRows: NiSnapshotRow[]; excluded: Record<NiDirectoryExclusion, number> } {
  const excluded: Record<NiDirectoryExclusion, number> = { no_name: 0, consortium: 0, not_relevant: 0, no_macro: 0, no_ruc_no_web: 0 };
  const index = buildNiRucNameIndex([...params.registryRows, ...params.aliasRows]);
  const domainUse = new Map<string, number>();
  for (const listing of params.listings) {
    if (listing.domain !== null) domainUse.set(listing.domain, (domainUse.get(listing.domain) ?? 0) + 1);
  }
  const usableDomain = (domain: string | null): string | null => (domain !== null && domainUse.get(domain) === 1 ? domain : null);

  const listingsByRuc = new Map<string, NiWebListing[]>();
  const withoutRuc: NiWebListing[] = [];
  for (const listing of params.listings) {
    const ruc = CONSORTIUM_NAME.test(listing.name) ? null : niListingRuc(listing, index);
    if (ruc === null) withoutRuc.push(listing);
    else listingsByRuc.set(ruc, [...(listingsByRuc.get(ruc) ?? []), listing]);
  }

  const registryByRuc = new Map(params.registryRows.map((row) => [row.normalized_tax_id!, row]));
  const taxRows: NiSnapshotRow[] = [];
  for (const ruc of new Set([...params.entries.keys(), ...listingsByRuc.keys()])) {
    const entry = params.entries.get(ruc) ?? null;
    const registry = registryByRuc.get(ruc);
    const listings = listingsByRuc.get(ruc) ?? [];
    if (registry === undefined) {
      excluded.no_name++;
      continue;
    }
    if (CONSORTIUM_NAME.test(registry.legal_name)) {
      excluded.consortium++;
      continue;
    }
    const licenses = entry ? licenseSummary(entry) : { active: 0, activeByType: {}, total: 0 };
    const relevant = entry?.largeTaxpayer != null || licenses.active > 0 || listings.length > 0;
    if (!relevant) {
      excluded.not_relevant++;
      continue;
    }
    const classification = classifyWithRuc(entry, listings);
    if (classification === null) {
      excluded.no_macro++;
      continue;
    }
    const domain = listings.map((l) => usableDomain(l.domain)).find((d): d is string => d !== null) ?? null;
    const publicEntity = listings.find((l) => l.kind === 'public_entity');
    taxRows.push({
      ...registry,
      source_key: NI_FREE_DIRECTORY_SOURCE_KEY,
      priority_score: niFreeDirectoryPriorityScore({
        largeTaxpayer: entry?.largeTaxpayer != null,
        freeZone: listings.some((l) => l.kind === 'cnzf'),
        publicEntityKind: publicEntity?.code ?? null,
        activeLicenses: licenses.active,
        hasDomain: domain !== null,
      }),
      raw_data: directoryRaw({ classification, entry, listings, domain }),
    });
  }

  const webRows: NiSnapshotRow[] = [];
  const seenDomains = new Set<string>();
  for (const listing of withoutRuc) {
    const core = nicaraguaNameCore(listing.name);
    if (core.length < 2) {
      excluded.no_name++;
      continue;
    }
    if (CONSORTIUM_NAME.test(listing.name)) {
      excluded.consortium++;
      continue;
    }
    const classification: Classification = { kind: listing.kind, code: listing.code };
    if (resolveNiDirectoryMacro(classification.kind, classification.code) === null) {
      excluded.no_macro++;
      continue;
    }
    const domain = usableDomain(listing.domain);
    if (domain === null || seenDomains.has(domain)) {
      excluded.no_ruc_no_web++;
      continue;
    }
    seenDomains.add(domain);
    const identity = buildRecordIdentityKey(NI_WEB_IDENTITY_NAMESPACE, domain);
    webRows.push({
      source_key: NI_FREE_DIRECTORY_WEB_SOURCE_KEY,
      country_code: 'NI',
      source_year: params.sourceYear,
      tax_id: null,
      normalized_tax_id: null,
      legal_name: listing.name,
      normalized_legal_name: core,
      city: null,
      region: null,
      priority_score: niFreeDirectoryPriorityScore({
        largeTaxpayer: false,
        freeZone: listing.kind === 'cnzf',
        publicEntityKind: listing.kind === 'public_entity' ? listing.code : null,
        activeLicenses: 0,
        hasDomain: true,
      }),
      raw_data: directoryRaw({ classification, entry: null, listings: [listing], domain }),
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return { taxRows, webRows, excluded };
}
