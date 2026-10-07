/**
 * gt-sources-rows.ts — filas de las fuentes oficiales de Guatemala para el Agente 1.
 *
 * SOURCES-GT-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Cuatro fuentes gratuitas y oficiales se juntan por NIT (un NIT, una fila):
 *
 *   1. Guatecompras (MINFIN, datos abiertos OCDS 2023-2026, CC BY 4.0): quien
 *      vende o se presenta al Estado, con su tipo de persona, departamento,
 *      municipio, correo, monto adjudicado y lo que vende (UNSPSC).
 *   2. Las entidades compradoras de Guatecompras: municipalidades, ministerios,
 *      autónomas, empresas públicas y USAC, con su NIT.
 *   3. El listado de agentes de retención del IVA de la SAT: grandes
 *      contribuyentes privados y entidades del Estado.
 *   4. El RGAE (Registro General de Adquisiciones del Estado) que ya estaba en Prod.
 *
 * Salen tres claves de fuente:
 *
 *   - `gt_nit_registry`: el NIT por nombre dentro de la corrida (todas las
 *     sociedades, entidades públicas, asociaciones y cooperativas; nunca personas
 *     individuales ni copropiedades).
 *   - `gt_nit_name_alias`: otros nombres de la misma fila (siglas, nombre
 *     comercial tras la forma, nombre de otra fuente, clave de municipalidad),
 *     nunca el nombre propio de otro NIT.
 *   - `gt_guatecompras_directory`: la capa gratuita por industria (sólo
 *     sociedades con adjudicaciones, macro dominante y relevancia).
 *
 * Cada NIT pasa el dígito verificador (`canonicalGuatemalaNit`).
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  GT_GUATECOMPRAS_MACRO_TABLE_VERSION,
  isGtGuatecomprasRelevant,
  resolveGtGuatecomprasSupplierMacro,
} from '@/server/prospect-batches/country-source-discovery/gt-guatecompras-macro-table';
import { canonicalGuatemalaNit } from './gt-nit';
import { guatemalaNameCore, guatemalaPublicEntityKey, guatemalaRegistryAliasKeys } from './gt-name-keys';
import { guatemalaCompanyDomainFromEmails } from './gt-domain';

export const GT_NIT_REGISTRY_SOURCE_KEY = 'gt_nit_registry' as const;
export const GT_NIT_NAME_ALIAS_SOURCE_KEY = 'gt_nit_name_alias' as const;
export const GT_GUATECOMPRAS_DIRECTORY_SOURCE_KEY = 'gt_guatecompras_directory' as const;

/** Espacio de nombres de la identidad de un alias (`gt-name-alias:<NIT>:<clave>`). */
export const GT_NAME_ALIAS_IDENTITY_NAMESPACE = 'gt-name-alias' as const;

/** Tipos de proveedor de Guatecompras que son una sociedad (capa gratuita). */
const COMPANY_SUPPLIER_TYPES: ReadonlySet<string> = new Set([
  'SOCIEDAD ANONIMA',
  'RESPONSABILIDAD LIMITADA',
  'SUCURSAL EMPRESA EXTRANJERA',
  'EMPRESA EXTRANJERA INSCRITA EN EL PAIS',
  'SOCIEDAD CIVIL CON FINES LUCRATIVOS',
]);

/** Tipos que nunca entran: personas (y la copropiedad, que es de personas). */
const PERSON_SUPPLIER_TYPES: ReadonlySet<string> = new Set(['INDIVIDUAL', 'COPROPIEDAD']);

const CONSORTIUM_NAME = /^\s*["'«]?\s*CONSORCIO\b/i;

/**
 * Persona en el listado de la SAT: «APELLIDO,APELLIDO,,NOMBRE,NOMBRE» (comas sin
 * espacio y sin forma societaria).
 */
const SAT_PERSON_NAME = /[A-ZÑÁÉÍÓÚÜ],[A-ZÑÁÉÍÓÚÜ,]/;
const LEGAL_FORM_WORD = /SOCIEDAD|S\.\s?A\b|LIMITADA|LTDA|COOPERATIVA|ASOCIACI|FUNDACI|MUNICIPALIDAD|MINISTERIO/i;

const plainType = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

// ─── Entradas (líneas de los extractores) ──────────────────────────────────

/** Una línea de `gt_suppliers.jsonl` (`extract-gt-guatecompras-parties.py`). */
export type GtGuatecomprasSupplier = {
  nit: string;
  name: string | null;
  names: readonly string[];
  type: string | null;
  region: string | null;
  locality: string | null;
  emails: readonly string[];
  awards: number;
  amountGtq: number;
  buyers: number;
  lastYear: number | null;
  /** Monto adjudicado por familia UNSPSC (4 dígitos), en quetzales. */
  fam: Readonly<Record<string, number>>;
  activity: string | null;
};

/** Una línea de `gt_buyers.jsonl`. */
export type GtGuatecomprasBuyer = {
  nit: string;
  name: string | null;
  names: readonly string[];
  level: string | null;
  entityType: string | null;
  region: string | null;
  locality: string | null;
  processes: number;
};

/** Una línea de `gt_sat_iva_agents.jsonl` (`extract-gt-sat-iva-agents.py`). */
export type GtSatIvaAgent = { nit: string; name: string; start: string | null; listDate: string | null };

/** Una fila del RGAE ya cargada en Prod. */
export type GtRgaeSupplier = {
  nit: string;
  name: string;
  economicCapacityKind: string | null;
  economicCapacityGtq: number | null;
  resolutionDate: string | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? cleanText(value) : null);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : [];

/** Línea de `gt_suppliers.jsonl` → proveedor, o `null`. */
export function parseGtGuatecomprasSupplier(raw: unknown): GtGuatecomprasSupplier | null {
  const r = record(raw);
  const nit = str(r?.['nit']);
  if (r === null || nit === null) return null;
  const fam: Record<string, number> = {};
  for (const [family, amount] of Object.entries(record(r['fam']) ?? {})) {
    if (/^\d{4}$/.test(family) && num(amount) > 0) fam[family] = num(amount);
  }
  const lastYear = num(r['last_year']);
  return {
    nit,
    name: str(r['name']),
    names: strings(r['names']),
    type: str(r['type']),
    region: str(r['region']),
    locality: str(r['locality']),
    emails: strings(r['emails']),
    awards: Math.trunc(num(r['awards'])),
    amountGtq: num(r['amount_gtq']),
    buyers: Math.trunc(num(r['buyers'])),
    lastYear: lastYear > 0 ? Math.trunc(lastYear) : null,
    fam,
    activity: str(r['activity']),
  };
}

/** Línea de `gt_buyers.jsonl` → entidad compradora, o `null`. */
export function parseGtGuatecomprasBuyer(raw: unknown): GtGuatecomprasBuyer | null {
  const r = record(raw);
  const nit = str(r?.['nit']);
  if (r === null || nit === null) return null;
  return {
    nit,
    name: str(r['name']),
    names: strings(r['names']),
    level: str(r['level']),
    entityType: str(r['entity_type']),
    region: str(r['region']),
    locality: str(r['locality']),
    processes: Math.trunc(num(r['processes'])),
  };
}

/** Línea de `gt_sat_iva_agents.jsonl` → agente de retención, o `null`. */
export function parseGtSatIvaAgent(raw: unknown): GtSatIvaAgent | null {
  const r = record(raw);
  const nit = str(r?.['nit']);
  const name = str(r?.['name']);
  if (nit === null || name === null) return null;
  return { nit, name, start: str(r?.['start']), listDate: str(r?.['list_date']) };
}

/** ¿Es el nombre del listado de la SAT el de una persona? */
export function isGtSatPersonName(name: string): boolean {
  return SAT_PERSON_NAME.test(name) && !LEGAL_FORM_WORD.test(name);
}

// ─── Unión por NIT ─────────────────────────────────────────────────────────

/** Todo lo que las fuentes dicen de un NIT. */
export type GtNitEntry = {
  nit: string;
  supplier: GtGuatecomprasSupplier | null;
  buyer: GtGuatecomprasBuyer | null;
  satAgent: GtSatIvaAgent | null;
  rgae: GtRgaeSupplier | null;
};

/** Por qué una fila de una fuente no entra (para el informe de la carga). */
export type GtSourceExclusion = 'invalid_nit' | 'person' | 'no_name';

/**
 * Junta las cuatro fuentes por NIT canónico. Personas (individuales, copropiedades
 * y nombres de persona de la SAT) y NIT con dígito verificador inválido no entran.
 */
export function mergeGuatemalaNitSources(input: {
  suppliers: readonly GtGuatecomprasSupplier[];
  buyers: readonly GtGuatecomprasBuyer[];
  satAgents: readonly GtSatIvaAgent[];
  rgae: readonly GtRgaeSupplier[];
}): { entries: Map<string, GtNitEntry>; excluded: Record<string, Record<GtSourceExclusion, number>> } {
  const entries = new Map<string, GtNitEntry>();
  const excluded: Record<string, Record<GtSourceExclusion, number>> = {};
  const skip = (source: string, reason: GtSourceExclusion): void => {
    excluded[source] = excluded[source] ?? { invalid_nit: 0, person: 0, no_name: 0 };
    excluded[source][reason]++;
  };
  const entryFor = (nit: string): GtNitEntry => {
    const existing = entries.get(nit);
    if (existing) return existing;
    const created: GtNitEntry = { nit, supplier: null, buyer: null, satAgent: null, rgae: null };
    entries.set(nit, created);
    return created;
  };

  for (const supplier of input.suppliers) {
    const nit = canonicalGuatemalaNit(supplier.nit);
    if (nit === null) skip('guatecompras_supplier', 'invalid_nit');
    else if (PERSON_SUPPLIER_TYPES.has(plainType(supplier.type))) skip('guatecompras_supplier', 'person');
    else if (supplier.name === null) skip('guatecompras_supplier', 'no_name');
    else entryFor(nit).supplier = supplier;
  }
  for (const buyer of input.buyers) {
    const nit = canonicalGuatemalaNit(buyer.nit);
    if (nit === null) skip('guatecompras_buyer', 'invalid_nit');
    else if (buyer.name === null) skip('guatecompras_buyer', 'no_name');
    else entryFor(nit).buyer = buyer;
  }
  for (const agent of input.satAgents) {
    const nit = canonicalGuatemalaNit(agent.nit);
    if (nit === null) skip('sat_iva_agent', 'invalid_nit');
    else if (isGtSatPersonName(agent.name)) skip('sat_iva_agent', 'person');
    else entryFor(nit).satAgent = agent;
  }
  for (const row of input.rgae) {
    const nit = canonicalGuatemalaNit(row.nit);
    if (nit === null) skip('rgae', 'invalid_nit');
    else entryFor(nit).rgae = row;
  }
  return { entries, excluded };
}

/**
 * La razón social que se guarda: la de la SAT (la autoridad tributaria) y, si no
 * está, la del RGAE, la de la entidad compradora o la más usada en Guatecompras.
 */
export function gtPreferredLegalName(entry: GtNitEntry): string | null {
  return (
    cleanText(entry.satAgent?.name) ??
    cleanText(entry.rgae?.name) ??
    cleanText(entry.buyer?.name) ??
    cleanText(entry.supplier?.name)
  );
}

/** Todos los nombres que las fuentes dan a un NIT (sin repetir). */
export function gtAllNames(entry: GtNitEntry): string[] {
  const names = [
    entry.satAgent?.name,
    entry.rgae?.name,
    entry.buyer?.name,
    ...(entry.buyer?.names ?? []),
    entry.supplier?.name,
    ...(entry.supplier?.names ?? []),
  ]
    .map((name) => cleanText(name))
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}

/** Fecha d/mm/aaaa de la SAT → aaaa-mm-dd, o `null`. */
function isoDate(value: string | null | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value?.trim() ?? '');
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

// ─── gt_nit_registry ───────────────────────────────────────────────────────

export type GtSnapshotRow = {
  source_key: string;
  country_code: 'GT';
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Fila del registro de NIT, o `null` si el NIT no tiene un nombre utilizable. */
export function buildGtNitRegistryRow(
  entry: GtNitEntry,
  params: { sourceYear: number; importedAt: string },
): GtSnapshotRow | null {
  const legalName = gtPreferredLegalName(entry);
  const core = legalName === null ? '' : guatemalaNameCore(legalName);
  if (legalName === null || core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(entry.nit);
  const origins = [
    entry.supplier ? 'guatecompras_supplier' : null,
    entry.buyer ? 'guatecompras_buyer' : null,
    entry.satAgent ? 'sat_iva_agent' : null,
    entry.rgae ? 'rgae' : null,
  ].filter((origin): origin is string => origin !== null);
  return {
    source_key: GT_NIT_REGISTRY_SOURCE_KEY,
    country_code: 'GT',
    source_year: params.sourceYear,
    tax_id: entry.nit,
    normalized_tax_id: entry.nit,
    legal_name: legalName,
    normalized_legal_name: core,
    city: cleanText(entry.buyer?.locality ?? entry.supplier?.locality),
    region: cleanText(entry.buyer?.region ?? entry.supplier?.region),
    priority_score: 0,
    raw_data: {
      tax_identifier_type: 'NIT',
      origins,
      ...(entry.supplier ? { guatecompras_type: entry.supplier.type, awarded_gtq: Math.round(entry.supplier.amountGtq), awards: entry.supplier.awards, last_award_year: entry.supplier.lastYear } : {}),
      ...(entry.buyer ? { public_entity_level: entry.buyer.level, public_entity_type: entry.buyer.entityType } : {}),
      ...(entry.satAgent ? { sat_iva_agent: true, sat_iva_agent_since: isoDate(entry.satAgent.start), sat_list_date: entry.satAgent.listDate } : {}),
      ...(entry.rgae ? { rgae_economic_capacity_kind: entry.rgae.economicCapacityKind, rgae_economic_capacity_gtq: entry.rgae.economicCapacityGtq } : {}),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function gtOwnNameKeys(row: Pick<GtSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = guatemalaPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/**
 * Claves EXTRA de un NIT: los núcleos de sus otros nombres (de otras fuentes) y
 * las claves de alias de cada nombre (sigla, nombre comercial, partes, clave
 * pública). Sin el núcleo propio.
 */
export function gtEntryAliasKeys(entry: GtNitEntry, mainCore: string): string[] {
  const keys: string[] = [];
  const push = (key: string): void => {
    if (key.length >= 2 && key !== mainCore && !keys.includes(key)) keys.push(key);
  };
  for (const name of gtAllNames(entry)) {
    push(guatemalaNameCore(name));
    for (const key of guatemalaRegistryAliasKeys(name)) push(key);
  }
  return keys;
}

/** Filas de alias de un NIT (ya sin las claves que son el nombre propio de otro NIT). */
export function buildGtNitNameAliasRows(params: { registryRow: GtSnapshotRow; keys: readonly string[] }): GtSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: GtSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(GT_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: GT_NIT_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

// ─── gt_guatecompras_directory ─────────────────────────────────────────────

/** Por qué una sociedad no entra en la capa gratuita. */
export type GtDirectoryExclusion =
  | 'not_a_company'
  | 'consortium'
  | 'no_awards'
  | 'no_dominant_macro'
  | 'not_relevant';

/**
 * Relevancia para ordenar dentro de una macro: primero los agentes de retención
 * del IVA (contribuyentes especiales), luego a cuántas entidades distintas vende y
 * cuántas adjudicaciones tiene (igual que Paraguay: el monto no ordena).
 */
export function gtGuatecomprasPriorityScore(input: { satIvaAgent: boolean; buyers: number; awards: number }): number {
  return (input.satIvaAgent ? 1_000_000 : 0) + Math.min(input.buyers, 999) * 1000 + Math.min(input.awards, 999);
}

/**
 * Fila de la capa gratuita, o por qué no entra. `sharedDomains`: dominios que
 * usan dos o más NIT (correos de grupo): no identifican a una sola empresa.
 */
export function buildGtGuatecomprasDirectoryRow(
  entry: GtNitEntry,
  params: { sourceYear: number; importedAt: string; sharedDomains: ReadonlySet<string> },
): { row: GtSnapshotRow } | { excluded: GtDirectoryExclusion } {
  const supplier = entry.supplier;
  if (supplier === null || !COMPANY_SUPPLIER_TYPES.has(plainType(supplier.type))) return { excluded: 'not_a_company' };
  const legalName = gtPreferredLegalName(entry);
  if (legalName === null || CONSORTIUM_NAME.test(legalName) || CONSORTIUM_NAME.test(supplier.name ?? '')) {
    return { excluded: 'consortium' };
  }
  if (supplier.awards === 0) return { excluded: 'no_awards' };
  const macro = resolveGtGuatecomprasSupplierMacro(supplier.fam);
  if (macro === null) return { excluded: 'no_dominant_macro' };
  const satIvaAgent = entry.satAgent !== null;
  if (!isGtGuatecomprasRelevant({ satIvaAgent, awardedGtq: supplier.amountGtq })) return { excluded: 'not_relevant' };

  const core = guatemalaNameCore(legalName);
  const domain = gtGuatecomprasSupplierDomain(supplier);
  const dominantFamily =
    Object.entries(supplier.fam).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const identity = deriveTaxRecordIdentity(entry.nit);
  return {
    row: {
      source_key: GT_GUATECOMPRAS_DIRECTORY_SOURCE_KEY,
      country_code: 'GT',
      source_year: params.sourceYear,
      tax_id: entry.nit,
      normalized_tax_id: entry.nit,
      legal_name: legalName,
      normalized_legal_name: core,
      city: cleanText(supplier.locality),
      region: cleanText(supplier.region),
      priority_score: gtGuatecomprasPriorityScore({ satIvaAgent, buyers: supplier.buyers, awards: supplier.awards }),
      raw_data: {
        macro_industry_key: macro.macroIndustryKey,
        macro_share: Math.round(macro.share * 100) / 100,
        macro_table_version: GT_GUATECOMPRAS_MACRO_TABLE_VERSION,
        unspsc_family: dominantFamily,
        activity_text: cleanText(supplier.activity),
        awards: supplier.awards,
        buyers: supplier.buyers,
        awarded_gtq: Math.round(supplier.amountGtq),
        last_award_year: supplier.lastYear,
        legal_entity_type: cleanText(supplier.type),
        sat_iva_agent: satIvaAgent,
        ...(domain !== null && !params.sharedDomains.has(domain)
          ? { website_domain: domain, website_origin: 'email' }
          : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

/** Dominio corporativo del proveedor (de sus correos), o `null`. */
export function gtGuatecomprasSupplierDomain(supplier: Pick<GtGuatecomprasSupplier, 'emails'>): string | null {
  return guatemalaCompanyDomainFromEmails(supplier.emails);
}
