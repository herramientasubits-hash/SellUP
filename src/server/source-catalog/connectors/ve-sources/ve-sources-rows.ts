/**
 * ve-sources-rows.ts — filas de las fuentes de Venezuela para el Agente 1.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Venezuela no publica un padrón de empresas con RIF (el RNC prohíbe el rastreo en su
 * robots.txt, el SENIAT bloquea las consultas desde fuera y no publica las listas de
 * contribuyentes especiales). Lo que sí se alcanza está en `ve-sources-input.ts`.
 *
 * Salen cuatro claves de fuente:
 *
 *   - `ve_rif_registry`: el RIF por nombre dentro de la corrida (un RIF, una fila;
 *     sólo J y G con verificador).
 *   - `ve_rif_name_alias`: otros nombres del mismo RIF (sigla, nombre en otra
 *     fuente, sin «Corporación»), nunca el nombre propio de otro RIF.
 *   - `ve_free_directory`: la capa gratuita por industria de quien tiene RIF.
 *   - `ve_free_directory_web`: la capa gratuita de quien sólo tiene web propia
 *     comprobada (entes públicos, universidades y empresas): identidad `ve-web:<dominio>`.
 *
 * Ninguna fuente da trabajadores ni ventas: no hay tamaño oficial en Venezuela.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  resolveVeDirectoryMacro,
  VE_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  type VeDirectoryKind,
} from '@/server/prospect-batches/country-source-discovery/ve-free-directory-macro-table';
import {
  isVenezuelaNoAliasName,
  venezuelaNameCore,
  venezuelaPublicEntityKey,
  venezuelaRegistryAliasKeys,
} from './ve-name-keys';
import { venezuelaCompanyDomain, venezuelaPublicEntityDomain } from './ve-domain';
import type { VePublicEntity } from './ve-public-entities';
import type { VeWebEntity } from './ve-web-entities';
import {
  canonicalVenezuelaRif,
  type VeBvcIssuer,
  type VeBvcMember,
  type VeGleifEntity,
  type VeSudeasegEntity,
  type VeSunavalEntity,
  type VeWebListing,
} from './ve-sources-input';

export const VE_RIF_REGISTRY_SOURCE_KEY = 've_rif_registry' as const;
export const VE_RIF_NAME_ALIAS_SOURCE_KEY = 've_rif_name_alias' as const;
export const VE_FREE_DIRECTORY_SOURCE_KEY = 've_free_directory' as const;
export const VE_FREE_DIRECTORY_WEB_SOURCE_KEY = 've_free_directory_web' as const;

/** Espacio de nombres de un alias (`ve-name-alias:<RIF>:<clave>`) y de una fila sólo con web (`ve-web:<dominio>`). */
export const VE_NAME_ALIAS_IDENTITY_NAMESPACE = 've-name-alias' as const;
export const VE_WEB_IDENTITY_NAMESPACE = 've-web' as const;

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

// ─── Unión por RIF ─────────────────────────────────────────────────────────

export type VeRifEntry = {
  rif: string;
  bvcIssuer: VeBvcIssuer | null;
  bvcMember: VeBvcMember | null;
  sudeaseg: VeSudeasegEntity | null;
  sunaval: VeSunavalEntity[];
  gleif: VeGleifEntity | null;
  /** Webs comprobadas cuya portada muestra este RIF. */
  listings: VeWebListing[];
};

/** Junta todas las fuentes con RIF por RIF. */
export function mergeVenezuelaRifSources(input: {
  bvcIssuers: readonly VeBvcIssuer[];
  bvcMembers: readonly VeBvcMember[];
  sudeaseg: readonly VeSudeasegEntity[];
  sunaval: readonly VeSunavalEntity[];
  gleif: readonly VeGleifEntity[];
  listings: readonly VeWebListing[];
}): Map<string, VeRifEntry> {
  const entries = new Map<string, VeRifEntry>();
  const entryFor = (rif: string): VeRifEntry => {
    const existing = entries.get(rif);
    if (existing) return existing;
    const created: VeRifEntry = { rif, bvcIssuer: null, bvcMember: null, sudeaseg: null, sunaval: [], gleif: null, listings: [] };
    entries.set(rif, created);
    return created;
  };
  for (const issuer of input.bvcIssuers) entryFor(issuer.rif).bvcIssuer = issuer;
  for (const member of input.bvcMembers) entryFor(member.rif).bvcMember = member;
  for (const entity of input.sudeaseg) entryFor(entity.rif).sudeaseg = entity;
  for (const entity of input.sunaval) entryFor(entity.rif).sunaval.push(entity);
  for (const entity of input.gleif) if (entity.active) entryFor(entity.rif).gleif = entity;
  for (const listing of input.listings) if (listing.rif !== null) entryFor(listing.rif).listings.push(listing);
  return entries;
}

/** La razón social que se guarda: Bolsa, SUDEASEG, SUNAVAL, GLEIF y la web, en ese orden. */
export function vePreferredLegalName(entry: VeRifEntry): string | null {
  return (
    cleanText(entry.bvcIssuer?.name) ??
    cleanText(entry.bvcMember?.name) ??
    cleanText(entry.sudeaseg?.name) ??
    cleanText(entry.sunaval[0]?.name) ??
    cleanText(entry.gleif?.name) ??
    cleanText(entry.listings[0]?.name)
  );
}

/** Todos los nombres que las fuentes dan a un RIF (sin repetir). */
export function veAllNames(entry: VeRifEntry): string[] {
  const names = [
    entry.bvcIssuer?.name,
    entry.bvcMember?.name,
    entry.sudeaseg?.name,
    ...entry.sunaval.map((s) => s.name),
    entry.gleif?.name,
    ...(entry.gleif?.otherNames ?? []),
    ...entry.listings.map((l) => l.name),
  ]
    .map((name) => cleanText(name))
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}

/** De qué fuentes sale un RIF. */
function entryOrigins(entry: VeRifEntry): string[] {
  return [
    entry.bvcIssuer ? 'bvc_issuer' : null,
    entry.bvcMember ? 'bvc_member' : null,
    entry.sudeaseg ? 'sudeaseg' : null,
    entry.sunaval.length > 0 ? 'sunaval_2022' : null,
    entry.gleif ? 'gleif' : null,
    entry.listings.length > 0 ? 'official_site' : null,
  ].filter((origin): origin is string => origin !== null);
}

// ─── ve_rif_registry ───────────────────────────────────────────────────────

export type VeSnapshotRow = {
  source_key: string;
  country_code: 'VE';
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

/** Fila del registro de RIF, o `null` si el RIF no tiene un nombre utilizable. */
export function buildVeRifRegistryRow(entry: VeRifEntry, params: { sourceYear: number; importedAt: string }): VeSnapshotRow | null {
  const legalName = vePreferredLegalName(entry);
  const core = legalName === null ? '' : venezuelaNameCore(legalName);
  if (legalName === null || core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(entry.rif);
  return {
    source_key: VE_RIF_REGISTRY_SOURCE_KEY,
    country_code: 'VE',
    source_year: params.sourceYear,
    tax_id: entry.rif,
    normalized_tax_id: entry.rif,
    legal_name: legalName,
    normalized_legal_name: core,
    city: null,
    region: null,
    priority_score: 0,
    raw_data: {
      tax_identifier_type: 'RIF',
      origins: entryOrigins(entry),
      ...(entry.bvcIssuer ? { stock_exchange_listed: true, bvc_sector: entry.bvcIssuer.sector } : {}),
      ...(entry.sudeaseg ? { sudeaseg_category: entry.sudeaseg.category } : {}),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function veOwnNameKeys(row: Pick<VeSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = venezuelaPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/**
 * Claves EXTRA de un RIF: los núcleos de sus otros nombres (el de otra fuente, el
 * nombre en GLEIF, el de su web) y sus siglas. Sin el núcleo propio.
 */
export function veEntryAliasKeys(entry: VeRifEntry, mainCore: string): string[] {
  const keys: string[] = [];
  const push = (key: string | null): void => {
    if (key !== null && key.length >= 3 && key !== mainCore && !keys.includes(key)) keys.push(key);
  };
  for (const name of veAllNames(entry)) {
    if (isVenezuelaNoAliasName(name)) continue;
    push(venezuelaNameCore(name));
    for (const key of venezuelaRegistryAliasKeys(name)) push(key);
  }
  return keys;
}

/** Filas de alias de un RIF (ya sin las claves que son el nombre propio de otro RIF). */
export function buildVeRifNameAliasRows(params: { registryRow: VeSnapshotRow; keys: readonly string[] }): VeSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: VeSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(VE_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: VE_RIF_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

/**
 * Registro y alias de todos los RIF. Una clave que es el nombre PROPIO de otro RIF
 * nunca se guarda como alias (daría el RIF equivocado).
 */
export function buildVeRegistryAndAliasRows(
  entries: ReadonlyMap<string, VeRifEntry>,
  params: { sourceYear: number; importedAt: string },
): { registryRows: VeSnapshotRow[]; aliasRows: VeSnapshotRow[] } {
  const registryRows: VeSnapshotRow[] = [];
  for (const entry of entries.values()) {
    const row = buildVeRifRegistryRow(entry, params);
    if (row !== null) registryRows.push(row);
  }
  const ownKeys = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of veOwnNameKeys(row)) ownKeys.set(key, (ownKeys.get(key) ?? new Set<string>()).add(row.tax_id!));
  }
  const aliasRows: VeSnapshotRow[] = [];
  for (const row of registryRows) {
    const entry = entries.get(row.tax_id!)!;
    const keys = veEntryAliasKeys(entry, row.normalized_legal_name).filter((key) => {
      const owners = ownKeys.get(key);
      return owners === undefined || (owners.size === 1 && owners.has(row.tax_id!));
    });
    aliasRows.push(...buildVeRifNameAliasRows({ registryRow: row, keys }));
  }
  return { registryRows, aliasRows };
}

// ─── Capa gratuita ─────────────────────────────────────────────────────────

/**
 * Las tablas estáticas como listados con web: empresas y universidades con web
 * comprobada y entes públicos. Una universidad pública es un ente público más.
 */
export function veWebListings(input: {
  webEntities: readonly VeWebEntity[];
  publicEntities: readonly VePublicEntity[];
}): VeWebListing[] {
  const listings: VeWebListing[] = [];
  for (const entity of input.webEntities) {
    listings.push({
      kind: entity.kind === 'public_university' ? 'public_entity' : entity.kind,
      qid: entity.qid,
      name: entity.name,
      domain: entity.domain,
      publicKind: entity.kind === 'public_university' ? 'public_university' : null,
      rif: canonicalVenezuelaRif(entity.rif),
    });
  }
  const seen = new Set(listings.map((listing) => listing.domain));
  for (const entity of input.publicEntities) {
    if (seen.has(entity.domain)) continue;
    seen.add(entity.domain);
    listings.push({
      kind: 'public_entity',
      qid: entity.wikidata ?? `gob:${entity.domain}`,
      name: entity.name,
      domain: entity.domain,
      publicKind: entity.kind,
      rif: canonicalVenezuelaRif(entity.rif),
    });
  }
  return listings;
}

/** Índice núcleo → RIF con las claves propias y los alias del registro. */
export function buildVeRifNameIndex(rows: readonly VeSnapshotRow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.normalized_tax_id === null) continue;
    index.set(row.normalized_legal_name, (index.get(row.normalized_legal_name) ?? new Set<string>()).add(row.normalized_tax_id));
  }
  return index;
}

/** El RIF de una web sin RIF en su portada: su núcleo lleva a un único RIF. */
export function veListingRif(listing: VeWebListing, index: ReadonlyMap<string, ReadonlySet<string>>): string | null {
  if (listing.rif !== null) return listing.rif;
  const core = venezuelaNameCore(listing.name);
  const hits = core.length >= 3 ? index.get(core) : undefined;
  return hits !== undefined && hits.size === 1 ? [...hits][0] : null;
}

/** Por qué una entidad no entra en la capa gratuita. */
export type VeDirectoryExclusion = 'no_name' | 'not_relevant' | 'no_macro' | 'no_rif_no_web';

/** Relevancia para ordenar dentro de una macro (no es tamaño: ninguna fuente lo da). */
export function veFreeDirectoryPriorityScore(input: { kind: VeDirectoryKind; publicKind: string | null; hasDomain: boolean }): number {
  const base: Record<VeDirectoryKind, number> = {
    listed_company: 1_000_000,
    sudeaseg: 900_000,
    public_entity: input.publicKind === 'territorial_municipality' ? 800_000 : 900_000,
    bvc_member: 700_000,
    company: 600_000,
    sunaval: 500_000,
    private_university: 500_000,
  };
  return base[input.kind] + (input.hasDomain ? 1 : 0);
}

type Classification = { kind: VeDirectoryKind; code: string | null; publicKind: string | null };

/**
 * Clasificación de una entidad con RIF: ente público, tabla de empresas que cotizan,
 * categoría de la SUDEASEG, casa de bolsa, tipo de la SUNAVAL, tabla de empresas con
 * web y universidad privada, en ese orden. `null` si nada la clasifica.
 */
function classifyEntry(entry: VeRifEntry, listings: readonly VeWebListing[]): Classification | null {
  const candidates: Classification[] = [];
  for (const listing of listings) {
    if (listing.kind === 'public_entity') candidates.push({ kind: 'public_entity', code: listing.publicKind, publicKind: listing.publicKind });
  }
  if (entry.bvcIssuer) candidates.push({ kind: 'listed_company', code: entry.rif, publicKind: null });
  if (entry.sunaval.some((s) => s.kind === 'emisor')) candidates.push({ kind: 'listed_company', code: entry.rif, publicKind: null });
  if (entry.sudeaseg) candidates.push({ kind: 'sudeaseg', code: entry.sudeaseg.category, publicKind: null });
  if (entry.bvcMember) candidates.push({ kind: 'bvc_member', code: null, publicKind: null });
  for (const s of entry.sunaval) candidates.push({ kind: 'sunaval', code: s.kind, publicKind: null });
  for (const listing of listings) {
    if (listing.kind === 'company') candidates.push({ kind: 'company', code: listing.qid, publicKind: null });
    if (listing.kind === 'private_university') candidates.push({ kind: 'private_university', code: listing.qid, publicKind: null });
  }
  return candidates.find((c) => resolveVeDirectoryMacro(c.kind, c.code) !== null) ?? null;
}

/** La web de una entidad con RIF: la de su ficha en la fuente o la de su web comprobada. */
function entryDomain(entry: VeRifEntry, listings: readonly VeWebListing[], usable: (d: string | null) => string | null): string | null {
  const publicListing = listings.find((l) => l.kind === 'public_entity');
  const fromSources = [
    publicListing?.domain ?? null,
    ...listings.map((l) => l.domain),
    venezuelaCompanyDomain(entry.bvcIssuer?.web),
    venezuelaCompanyDomain(entry.bvcMember?.web),
    ...(entry.bvcIssuer?.emailDomains ?? []).map((d) => venezuelaCompanyDomain(d)),
    ...(entry.bvcMember?.emailDomains ?? []).map((d) => venezuelaCompanyDomain(d)),
  ];
  return fromSources.map((d) => usable(d)).find((d): d is string => d !== null) ?? null;
}

function directoryRaw(params: {
  classification: Classification;
  entry: VeRifEntry | null;
  listings: readonly VeWebListing[];
  domain: string | null;
}): Record<string, unknown> {
  const { classification, entry, listings, domain } = params;
  const publicListing = listings.find((l) => l.kind === 'public_entity');
  return {
    directory_kind: classification.kind,
    activity_code: classification.code,
    macro_industry_key: resolveVeDirectoryMacro(classification.kind, classification.code),
    macro_table_version: VE_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    origins: [...new Set([...(entry ? entryOrigins(entry) : []), ...listings.map((l) => `wikidata_${l.kind}`)])],
    ...(entry?.bvcIssuer ? { stock_exchange_listed: true, bvc_sector: entry.bvcIssuer.sector } : {}),
    ...(classification.publicKind ? { public_entity_kind: classification.publicKind } : {}),
    ...(listings.length > 0 ? { wikidata_ids: [...new Set(listings.map((l) => l.qid))] } : {}),
    ...(domain !== null ? { website_domain: domain, website_origin: publicListing || listings.length > 0 ? 'official_site' : 'source' } : {}),
  };
}

/**
 * Filas de la capa gratuita.
 *
 * - Con RIF (`ve_free_directory`): toda entidad del registro que una fuente clasifica
 *   (cotiza en bolsa, regulada por la SUDEASEG o la SUNAVAL, casa de bolsa, o con web
 *   comprobada y clasificada).
 * - Sin RIF (`ve_free_directory_web`): entes públicos, universidades y empresas con
 *   web propia comprobada cuyo nombre no lleva a un único RIF.
 *
 * Un dominio que usan dos o más entidades no se usa.
 */
export function buildVeFreeDirectoryRows(params: {
  entries: ReadonlyMap<string, VeRifEntry>;
  registryRows: readonly VeSnapshotRow[];
  aliasRows: readonly VeSnapshotRow[];
  listings: readonly VeWebListing[];
  sourceYear: number;
  importedAt: string;
}): { taxRows: VeSnapshotRow[]; webRows: VeSnapshotRow[]; excluded: Record<VeDirectoryExclusion, number> } {
  const excluded: Record<VeDirectoryExclusion, number> = { no_name: 0, not_relevant: 0, no_macro: 0, no_rif_no_web: 0 };
  const index = buildVeRifNameIndex([...params.registryRows, ...params.aliasRows]);
  const domainOwners = new Map<string, Set<string>>();
  const claim = (domain: string | null, owner: string): void => {
    if (domain !== null) domainOwners.set(domain, (domainOwners.get(domain) ?? new Set<string>()).add(owner));
  };
  const listingsByRif = new Map<string, VeWebListing[]>();
  const withoutRif: VeWebListing[] = [];
  for (const listing of params.listings) {
    const rif = veListingRif(listing, index);
    if (rif === null) withoutRif.push(listing);
    else listingsByRif.set(rif, [...(listingsByRif.get(rif) ?? []), listing]);
    claim(listing.domain, rif ?? `web:${listing.qid}`);
  }
  for (const entry of params.entries.values()) {
    for (const web of [entry.bvcIssuer?.web, entry.bvcMember?.web]) claim(venezuelaCompanyDomain(web), entry.rif);
  }
  const usableDomain = (domain: string | null): string | null =>
    domain !== null && (domainOwners.get(domain)?.size ?? 1) === 1 ? domain : null;

  const registryByRif = new Map(params.registryRows.map((row) => [row.normalized_tax_id!, row]));
  const taxRows: VeSnapshotRow[] = [];
  for (const rif of new Set([...params.entries.keys(), ...listingsByRif.keys()])) {
    const entry = params.entries.get(rif);
    const registry = registryByRif.get(rif);
    if (entry === undefined || registry === undefined) {
      excluded.no_name++;
      continue;
    }
    const listings = [...new Map([...entry.listings, ...(listingsByRif.get(rif) ?? [])].map((l) => [l.qid, l])).values()];
    const relevant = entry.bvcIssuer !== null || entry.bvcMember !== null || entry.sudeaseg !== null || entry.sunaval.length > 0 || listings.length > 0;
    if (!relevant) {
      excluded.not_relevant++;
      continue;
    }
    const classification = classifyEntry(entry, listings);
    if (classification === null) {
      excluded.no_macro++;
      continue;
    }
    const domain = entryDomain(entry, listings, usableDomain);
    taxRows.push({
      ...registry,
      source_key: VE_FREE_DIRECTORY_SOURCE_KEY,
      priority_score: veFreeDirectoryPriorityScore({ kind: classification.kind, publicKind: classification.publicKind, hasDomain: domain !== null }),
      raw_data: directoryRaw({ classification, entry, listings, domain }),
    });
  }

  const webRows: VeSnapshotRow[] = [];
  const seenDomains = new Set<string>();
  for (const listing of withoutRif) {
    const core = venezuelaNameCore(listing.name);
    if (core.length < 2) {
      excluded.no_name++;
      continue;
    }
    const classification: Classification =
      listing.kind === 'public_entity'
        ? { kind: 'public_entity', code: listing.publicKind, publicKind: listing.publicKind }
        : listing.kind === 'private_university'
          ? { kind: 'private_university', code: listing.qid, publicKind: null }
          : { kind: 'company', code: listing.qid, publicKind: null };
    if (resolveVeDirectoryMacro(classification.kind, classification.code) === null) {
      excluded.no_macro++;
      continue;
    }
    const domain = usableDomain(listing.kind === 'public_entity' ? venezuelaPublicEntityDomain(listing.domain) : venezuelaCompanyDomain(listing.domain));
    if (domain === null || seenDomains.has(domain)) {
      excluded.no_rif_no_web++;
      continue;
    }
    seenDomains.add(domain);
    const identity = buildRecordIdentityKey(VE_WEB_IDENTITY_NAMESPACE, domain);
    webRows.push({
      source_key: VE_FREE_DIRECTORY_WEB_SOURCE_KEY,
      country_code: 'VE',
      source_year: params.sourceYear,
      tax_id: null,
      normalized_tax_id: null,
      legal_name: listing.name,
      normalized_legal_name: core,
      city: null,
      region: null,
      priority_score: veFreeDirectoryPriorityScore({ kind: classification.kind, publicKind: classification.publicKind, hasDomain: true }),
      raw_data: directoryRaw({ classification, entry: null, listings: [listing], domain }),
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return { taxRows, webRows, excluded };
}
