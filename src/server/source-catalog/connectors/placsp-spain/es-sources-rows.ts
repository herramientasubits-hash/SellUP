/**
 * es-sources-rows.ts — filas de las fuentes oficiales de España para el Agente 1.
 *
 * SOURCES-ES-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Entradas (las produce `scripts/source-catalog/extract-es-sources.py`, una línea
 * JSON por NIF):
 *
 *   - Adjudicatarias de la Plataforma de Contratación del Sector Público (PLACSP:
 *     licitaciones, contratos menores y plataformas autonómicas agregadas): nombres,
 *     contratos por división CPV, euros adjudicados, último año.
 *   - Órganos de contratación (PLACSP): NIF, código DIR3, nombres, web y correos.
 *   - Beneficiarias de ayudas de Estado de la BDNS («Origen de los datos:
 *     Intervención General de la Administración del Estado»): nombres, CNAE, último
 *     año marcado «GRAN EMPRESA».
 *   - Entes de INVENTE (Inventario de Entes del Sector Público, Hacienda): forma
 *     jurídica, CNAE, web, correo, plantilla y cifra de negocios.
 *   - Bancos y financieras del registro del Banco de España: tipo y web.
 *
 * Salen cinco claves de fuente:
 *
 *   - `es_placsp_registry`: NIF por nombre (adjudicatarias), ahora con el núcleo de
 *     `spainNameCore`.
 *   - `es_official_nif_registry`: NIF por nombre de las otras fuentes (BDNS, INVENTE,
 *     Banco de España), con el tamaño cuando lo hay (plantilla de INVENTE o
 *     «GRAN EMPRESA» de la BDNS, que no decide sola).
 *   - `es_nif_name_alias`: otros nombres del mismo NIF; nunca el nombre propio de otro.
 *   - `es_free_directory`: la capa gratuita de empresas por industria.
 *   - `es_public_entities`: la capa gratuita de Gobierno (con NIF y web que la nombra).
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  ES_BDE_CLIENT_ENTITY_TYPES,
  ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  ES_PUBLIC_ENTITY_MACRO,
  isEsDirectoryRelevant,
  resolveSpainCnaeMacro,
  resolveSpainCpvMacro,
  type EsDirectoryKind,
} from '@/server/prospect-batches/country-source-discovery/es-free-directory-macro-table';
import { ES_PLACSP_REGISTRY_SOURCE_KEY, normalizeSpainCompanyNif } from './es-placsp-registry-rows';
import { endsWithSpainLegalForm, spainNameCore, spainPublicEntityKey, spainRegistryAliasKeys } from './es-name-keys';
import { spainCompanyDomain, spainPublicEntityDomain } from './es-domain';

export { ES_PLACSP_REGISTRY_SOURCE_KEY };
export const ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY = 'es_official_nif_registry' as const;
export const ES_NIF_NAME_ALIAS_SOURCE_KEY = 'es_nif_name_alias' as const;
export const ES_FREE_DIRECTORY_SOURCE_KEY = 'es_free_directory' as const;
export const ES_PUBLIC_ENTITIES_SOURCE_KEY = 'es_public_entities' as const;

/** Espacio de nombres de la identidad de un alias (`es-name-alias:<NIF>:<clave>`). */
export const ES_NAME_ALIAS_IDENTITY_NAMESPACE = 'es-name-alias' as const;

/** Categoría de tamaño de la BDNS (la lee `workforceFromRawData`; no decide sola). */
export const ES_BDNS_LARGE_TAXPAYER_CATEGORY = 'ES_BDNS_GRAN_EMPRESA' as const;

/** Etiqueta del tamaño «grande» de la BDNS en la ficha. */
export const ES_BDNS_LARGE_SIZE_LABEL = 'BDNS – Gran empresa' as const;

// ─── Entradas ──────────────────────────────────────────────────────────────

export type EsAwardee = {
  nif: string;
  names: Readonly<Record<string, number>>;
  cpv: Readonly<Record<string, number>>;
  eur: number;
  contracts: number;
  last: number | null;
  postal: string | null;
};

export type EsContractingBody = {
  nif: string;
  dir3: string | null;
  names: Readonly<Record<string, number>>;
  urls: readonly string[];
  emails: readonly string[];
  typeCode: string | null;
};

export type EsBdnsBeneficiary = {
  nif: string;
  names: Readonly<Record<string, number>>;
  cnae: Readonly<Record<string, number>>;
  largeYear: number | null;
  region: string | null;
};

export type EsInventeEntity = {
  nif: string;
  name: string;
  form: string | null;
  cnae: string | null;
  adscription: string | null;
  web: string | null;
  email: string | null;
  workers: number | null;
  workersYear: number | null;
  inventeCode: string | null;
};

export type EsBdeEntity = { nif: string; name: string; web: string | null; entityType: string | null };

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

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseEsAwardee(raw: unknown): EsAwardee | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nif = normalizeSpainCompanyNif(str(r['nif']));
  const names = numberRecord(r['names']);
  if (nif === null || Object.keys(names).length === 0) return null;
  return { nif, names, cpv: numberRecord(r['cpv']), eur: num(r['eur']), contracts: int(r['contracts']) ?? 0, last: int(r['last']), postal: str(r['postal']) };
}

export function parseEsContractingBody(raw: unknown): EsContractingBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nif = normalizeSpainCompanyNif(str(r['nif']));
  const names = numberRecord(r['names']);
  if (nif === null || Object.keys(names).length === 0) return null;
  return { nif, dir3: str(r['dir3']), names, urls: strList(r['urls']), emails: strList(r['emails']), typeCode: str(r['type_code']) };
}

export function parseEsBdnsBeneficiary(raw: unknown): EsBdnsBeneficiary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nif = normalizeSpainCompanyNif(str(r['nif']));
  const names = numberRecord(r['names']);
  if (nif === null || Object.keys(names).length === 0) return null;
  return { nif, names, cnae: numberRecord(r['cnae']), largeYear: int(r['large_year']), region: str(r['region']) };
}

export function parseEsInventeEntity(raw: unknown): EsInventeEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nif = normalizeSpainCompanyNif(str(r['nif']));
  const name = str(r['name']);
  if (nif === null || name === null) return null;
  return {
    nif,
    name,
    form: str(r['form']),
    cnae: str(r['cnae']),
    adscription: str(r['adscription']),
    web: str(r['web']),
    email: str(r['email']),
    workers: int(r['workers']),
    workersYear: int(r['workers_year']),
    inventeCode: str(r['invente_code']),
  };
}

export function parseEsBdeEntity(raw: unknown): EsBdeEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nif = normalizeSpainCompanyNif(str(r['nif']));
  const name = str(r['name']);
  if (nif === null || name === null) return null;
  return { nif, name, web: str(r['web']), entityType: str(r['entity_type']) };
}

// ─── Filas ─────────────────────────────────────────────────────────────────

export type EsSnapshotRow = {
  source_key: string;
  country_code: 'ES';
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

/**
 * Año de la carga (parte de la clave de la fila): el MISMO para todas las filas de
 * una carga, para que un NIF sea una sola fila aunque sus contratos sean de varios años.
 */
export type EsRowParams = { importedAt: string; sourceYear: number };

/** UTE y uniones temporales: no son una empresa. */
const JOINT_VENTURE = /^\s*(U\.?\s?T\.?\s?E\.?|UNION TEMPORAL|UNIÓN TEMPORAL)\b|\bU\.?T\.?E\.?\s*$/i;

/**
 * La razón social: entre los nombres publicados, primero los que terminan en una
 * forma societaria, y entre ellos el más publicado (a igualdad, el más largo).
 */
export function esPreferredLegalName(names: Readonly<Record<string, number>>): string | null {
  let best: { name: string; count: number; form: boolean } | null = null;
  for (const [raw, count] of Object.entries(names)) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name.length === 0 || spainNameCore(name).length < 2 || isEsMultiCompanyName(name)) continue;
    const form = endsWithSpainLegalForm(name);
    const better =
      best === null ||
      (form && !best.form) ||
      (form === best.form && (count > best.count || (count === best.count && name.length > best.name.length)));
    if (better) best = { name, count, form };
  }
  return best?.name ?? null;
}

function taxIdentity(nif: string): RecordIdentityKey | null {
  const identity = deriveTaxRecordIdentity(nif);
  return identity.status === 'resolved' ? identity.recordIdentityKey : null;
}

function dominantCode(counts: Readonly<Record<string, number>>, resolve: (code: string) => unknown): string | null {
  return (
    Object.entries(counts)
      .filter(([code]) => resolve(code) !== null)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  );
}

/** Fila del registro de NIF de adjudicatarias, o `null`. */
export function buildEsPlacspNifRegistryRow(awardee: EsAwardee, params: EsRowParams): EsSnapshotRow | null {
  const legalName = esPreferredLegalName(awardee.names);
  if (legalName === null || JOINT_VENTURE.test(legalName)) return null;
  return {
    source_key: ES_PLACSP_REGISTRY_SOURCE_KEY,
    country_code: 'ES',
    source_year: params.sourceYear,
    tax_id: awardee.nif,
    normalized_tax_id: awardee.nif,
    legal_name: legalName,
    normalized_legal_name: spainNameCore(legalName),
    city: null,
    region: null,
    priority_score: 0,
    raw_data: {
      tax_identifier_type: 'NIF',
      contracts: awardee.contracts,
      awarded_eur: Math.round(awardee.eur),
      ...(awardee.last !== null ? { last_award_year: awardee.last } : {}),
    },
    imported_at: params.importedAt,
    record_identity_key: taxIdentity(awardee.nif),
  };
}

/** Lo que las otras fuentes saben de un mismo NIF. */
export type EsOfficialNifInputs = {
  nif: string;
  bdns: EsBdnsBeneficiary | null;
  invente: EsInventeEntity | null;
  bde: EsBdeEntity | null;
};

/**
 * Fila del registro de NIF de las otras fuentes, o `null`. El nombre: INVENTE y el
 * Banco de España publican la razón social; si no, la más publicada en la BDNS. El
 * tamaño: la plantilla de INVENTE (número exacto) o, si no, «GRAN EMPRESA» de la
 * BDNS (tramo sin piso ni techo: no decide solo).
 */
export function buildEsOfficialNifRegistryRow(inputs: EsOfficialNifInputs, params: EsRowParams): EsSnapshotRow | null {
  const legalName =
    inputs.invente?.name ?? inputs.bde?.name ?? (inputs.bdns !== null ? esPreferredLegalName(inputs.bdns.names) : null);
  if (legalName === null || spainNameCore(legalName).length < 2 || JOINT_VENTURE.test(legalName)) return null;
  const origins = [inputs.bdns ? 'bdns' : null, inputs.invente ? 'invente' : null, inputs.bde ? 'bde' : null].filter(
    (o): o is string => o !== null,
  );
  const workers = inputs.invente?.workers ?? null;
  const workersYear = inputs.invente?.workersYear ?? null;
  const size =
    workers !== null && workersYear !== null
      ? { workers, metrics_year: workersYear }
      : inputs.bdns?.largeYear != null
        ? { taxpayer_category: ES_BDNS_LARGE_TAXPAYER_CATEGORY, metrics_year: inputs.bdns.largeYear }
        : {};
  return {
    source_key: ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY,
    country_code: 'ES',
    source_year: params.sourceYear,
    tax_id: inputs.nif,
    normalized_tax_id: inputs.nif,
    legal_name: legalName,
    normalized_legal_name: spainNameCore(legalName),
    city: null,
    region: inputs.bdns?.region ?? null,
    priority_score: 0,
    raw_data: { tax_identifier_type: 'NIF', origins, ...size },
    imported_at: params.importedAt,
    record_identity_key: taxIdentity(inputs.nif),
  };
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function esOwnNameKeys(row: Pick<EsSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = spainPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/** Claves de alias de un NIF a partir de TODOS sus nombres publicados. */
export function esAliasKeysForNames(names: readonly string[], ownCore: string): string[] {
  const keys: string[] = [];
  const ownFirst = ownCore.split(' ')[0] ?? '';
  const push = (key: string, fromOwnName: boolean): void => {
    if (key.length < 2 || key === ownCore || keys.includes(key)) return;
    // De OTRO nombre publicado sólo vale si empieza como la razón social y tiene 2+
    // palabras: los órganos a veces ponen el nombre de otra empresa del grupo o de la
    // UTE bajo el NIF («Telefónica» bajo Telefónica de España, «Eulen» bajo Schindler).
    if (!fromOwnName && (key.split(' ').length < 2 || key.split(' ')[0] !== ownFirst)) return;
    keys.push(key);
  };
  for (const name of names) {
    if (JOINT_VENTURE.test(name) || isEsMultiCompanyName(name)) continue;
    const core = spainNameCore(name);
    const fromOwnName = core === ownCore;
    push(core, fromOwnName);
    // La sigla entre paréntesis o el nombre comercial de la PROPIA razón social, sin más.
    for (const key of spainRegistryAliasKeys(name)) push(key, fromOwnName);
  }
  return keys;
}

/**
 * ¿Junta el nombre a varias sociedades? «DRAGADOS, S.A.-MONCOBRA, S.A.-INSTALACIONES
 * NEGRATIN, S.L.U.», «URBASER, S.A.-MARTINEZ CANO CANARIAS SA»: dos formas
 * societarias con texto entre ellas. No es el nombre de una empresa.
 */
export function isEsMultiCompanyName(name: string): boolean {
  const upper = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const forms = upper.match(/\bS\.?\s?[AL]\.?(?:\s?U\.?)?(?=[\s,.;\-–]|$)/g) ?? [];
  return forms.length >= 2 && /\bS\.?\s?[AL]\.?(?:\s?U\.?)?\s*[-–,;/]\s*[A-Z]{3,}/.test(upper);
}

/** Filas de alias de un NIF (ya sin las claves que son el nombre propio de otro NIF). */
export function buildEsNifNameAliasRows(params: { registryRow: EsSnapshotRow; keys: readonly string[] }): EsSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: EsSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(ES_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: ES_NIF_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

// ─── es_free_directory ─────────────────────────────────────────────────────

/** Por qué un NIF no entra en la capa gratuita. */
export type EsDirectoryExclusion = 'no_name' | 'joint_venture' | 'public_entity' | 'no_macro' | 'not_relevant';

/** Formas jurídicas de INVENTE que van a Gobierno (no son sociedades). */
const INVENTE_PUBLIC_FORM =
  /^(Organismo aut|Agencia|Universidad p|Ente p|Entidad p[uú]blica empresarial|Autoridad administrativa|Consorcio|Otro organismo|Entidades gestoras|Mutua colaboradora)/i;

export function isEsInventePublicBody(entity: Pick<EsInventeEntity, 'form'>): boolean {
  return entity.form !== null && INVENTE_PUBLIC_FORM.test(entity.form.trim());
}

/** Lo que las fuentes saben de un NIF para la capa gratuita. */
export type EsDirectoryInputs = {
  nif: string;
  awardee: EsAwardee | null;
  bdns: EsBdnsBeneficiary | null;
  invente: EsInventeEntity | null;
  bde: EsBdeEntity | null;
};

/** Orden dentro de una macro: grandes de la BDNS y entes con plantilla primero, luego por euros. */
export function esDirectoryPriorityScore(input: {
  kind: EsDirectoryKind;
  workers: number | null;
  awardedEur: number;
  large: boolean;
}): number {
  const kindWeight: Record<EsDirectoryKind, number> = {
    invente_company: 4,
    bdns_large: 3,
    bde_financial: 3,
    placsp_awardee: 2,
    public_entity: 1,
  };
  const eurBand = Math.min(Math.floor(Math.log10(Math.max(input.awardedEur, 1))), 9);
  const workersBand = input.workers === null ? 0 : Math.min(Math.floor(Math.log10(Math.max(input.workers, 1))), 9);
  return kindWeight[input.kind] * 1000 + (input.large ? 100 : 0) + workersBand * 10 + eurBand;
}

/**
 * Fila de la capa gratuita de empresas, o por qué no entra. La fuente decide el
 * tipo, en este orden: ente público empresarial de INVENTE (plantilla y web),
 * banco o financiera del Banco de España (web), «GRAN EMPRESA» de la BDNS (CNAE),
 * adjudicataria de 1 M€ o más (CPV). `sharedDomains`: dominios que publican dos o
 * más NIF (no identifican a una sola empresa).
 */
export function buildEsFreeDirectoryRow(
  inputs: EsDirectoryInputs,
  params: EsRowParams & { sharedDomains: ReadonlySet<string> },
): { row: EsSnapshotRow } | { excluded: EsDirectoryExclusion } {
  const { awardee, bdns, invente, bde } = inputs;
  // Entidades públicas (P, Q, S) van por Gobierno; UTE (U) y comunidades de propietarios (H) no son empresas.
  if (PUBLIC_NIF.test(inputs.nif) || (invente !== null && isEsInventePublicBody(invente))) return { excluded: 'public_entity' };
  if (/^[UH]/.test(inputs.nif)) return { excluded: 'joint_venture' };
  const legalName =
    invente?.name ??
    bde?.name ??
    (bdns !== null ? esPreferredLegalName(bdns.names) : null) ??
    (awardee !== null ? esPreferredLegalName(awardee.names) : null);
  if (legalName === null) return { excluded: 'no_name' };
  if (JOINT_VENTURE.test(legalName)) return { excluded: 'joint_venture' };
  const core = spainNameCore(legalName);
  if (core.length < 2) return { excluded: 'no_name' };

  const bdeClient = bde !== null && bde.entityType !== null && ES_BDE_CLIENT_ENTITY_TYPES.has(bde.entityType);
  const bdnsCnae = bdns !== null ? dominantCode(bdns.cnae, resolveSpainCnaeMacro) : null;
  const cpv = awardee !== null ? dominantCode(awardee.cpv, (d) => resolveSpainCpvMacro(`${d.padEnd(2, '0')}000000`)) : null;

  let kind: EsDirectoryKind;
  let code: string | null;
  if (invente !== null && resolveSpainCnaeMacro(invente.cnae) !== null) {
    kind = 'invente_company';
    code = invente.cnae;
  } else if (bdeClient) {
    kind = 'bde_financial';
    code = null;
  } else if (bdns?.largeYear != null && bdnsCnae !== null) {
    kind = 'bdns_large';
    code = bdnsCnae;
  } else if (cpv !== null) {
    kind = 'placsp_awardee';
    code = `${cpv.padEnd(2, '0')}000000`;
  } else {
    return { excluded: 'no_macro' };
  }
  const macro =
    kind === 'placsp_awardee'
      ? resolveSpainCpvMacro(code)
      : kind === 'bde_financial'
        ? 'insurance_financial_services'
        : resolveSpainCnaeMacro(code);
  if (macro === null) return { excluded: 'no_macro' };

  const awardedEur = Math.round(awardee?.eur ?? 0);
  const workers = invente?.workers ?? null;
  if (!isEsDirectoryRelevant({ kind, awardedEur, workers })) return { excluded: 'not_relevant' };

  const domain = spainCompanyDomain({
    urls: [invente?.web, bde?.web].filter((u): u is string => typeof u === 'string'),
    emails: [invente?.email].filter((e): e is string => typeof e === 'string'),
  });
  const large = bdns?.largeYear != null;
  return {
    row: {
      source_key: ES_FREE_DIRECTORY_SOURCE_KEY,
      country_code: 'ES',
      source_year: params.sourceYear,
      tax_id: inputs.nif,
      normalized_tax_id: inputs.nif,
      legal_name: legalName,
      normalized_legal_name: core,
      city: null,
      region: bdns?.region ?? null,
      priority_score: esDirectoryPriorityScore({ kind, workers, awardedEur, large }),
      raw_data: {
        directory_kind: kind,
        macro_industry_key: macro,
        macro_table_version: ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
        activity_code: code,
        ...(awardee !== null ? { awarded_eur: awardedEur, contracts: awardee.contracts, last_award_year: awardee.last } : {}),
        ...(large ? { bdns_large_year: bdns?.largeYear } : {}),
        ...(workers !== null && invente?.workersYear != null ? { workers, metrics_year: invente.workersYear } : {}),
        ...(bde?.entityType ? { bde_entity_type: bde.entityType } : {}),
        ...(domain !== null && !params.sharedDomains.has(domain)
          ? { website_domain: domain, website_origin: invente?.web || bde?.web ? 'official_web' : 'email' }
          : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: taxIdentity(inputs.nif),
    },
  };
}

// ─── es_public_entities ────────────────────────────────────────────────────

/** Tipo de entidad pública, para ordenar dentro de Gobierno. */
export type EsPublicEntityKind = 'state' | 'regional' | 'provincial' | 'municipality' | 'university_or_hospital' | 'other';

export function classifyEsPublicEntity(name: string, typeCode: string | null): EsPublicEntityKind {
  const upper = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/\b(UNIVERSIDAD|UNIVERSITAT|UNIBERTSITATEA|HOSPITAL|SERVICIO \w+ DE SALUD|INSTITUTO \w+ DE SALUD)\b/.test(upper)) {
    return 'university_or_hospital';
  }
  if (/\b(DIPUTACION|DIPUTACIO|CABILDO|CONSELL INSULAR)\b/.test(upper)) return 'provincial';
  if (/\b(AYUNTAMIENTO|AJUNTAMENT|CONCELLO|UDALA)\b/.test(upper)) return 'municipality';
  if (/\b(MINISTERIO|AGENCIA ESTATAL|SECRETARIA DE ESTADO)\b/.test(upper) || typeCode === '1') return 'state';
  if (/\b(CONSEJERIA|CONSELLERIA|CONSELLERIA|GENERALITAT|XUNTA|JUNTA DE|GOBIERNO DE|COMUNIDAD DE MADRID)\b/.test(upper) || typeCode === '2') {
    return 'regional';
  }
  return 'other';
}

const KIND_PRIORITY: Readonly<Record<EsPublicEntityKind, number>> = {
  state: 6,
  regional: 5,
  university_or_hospital: 4,
  provincial: 3,
  municipality: 2,
  other: 1,
};

/** NIF de entidades públicas: P (locales), Q (organismos públicos), S (órganos de la Administración). */
const PUBLIC_NIF = /^[PQS]/;

/** El nombre de la entidad sin el órgano delante: «Junta de Gobierno del Ayuntamiento de X» → «Ayuntamiento de X». */
export function esPublicEntityDisplayName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  const match = /\b(Ayuntamiento|Ajuntament|Concello|Diputaci[oó]n|Cabildo|Consell Insular|Consell Comarcal)\b.*$/i.exec(clean);
  if (match !== null && match.index > 0) return match[0];
  // «Presidencia del Organismo Autónomo X», «Gerencia de la Consorcio X», «Consejo de
  // Administración de X»: el órgano delante no es la entidad.
  const organ = ORGAN_PREFIX.exec(clean);
  const rest = organ !== null ? clean.slice(organ[0].length).trim() : '';
  return rest.length >= 3 ? rest.charAt(0).toUpperCase() + rest.slice(1) : clean;
}

/** Órganos que van delante del nombre de la entidad en la Plataforma de Contratación. */
const ORGAN_PREFIX =
  /^(?:(?:Presidencia|Gerencia|Direcci[oó]n(?: de Gesti[oó]n| Gerencia)?|Director(?:a)? Gerente|Consejo de Administraci[oó]n|Comit[eé] Ejecutivo|Junta de Gobierno(?: Local)?|Xunta de Goberno(?: Local)?|Comisi[oó]n (?:de Contrataci[oó]n|Ejecutiva|Permanente)|Mesa de Contrataci[oó]n|[OÓ]rgano de Contrataci[oó]n|Alcald[ií]a|Pleno)(?:\s*-\s*|\s+(?:del|de la|de los|de las|de|da|do|d')\s*))+/i;

/** Por qué una entidad no entra en la capa gratuita de Gobierno. */
export type EsPublicEntityExclusion = 'no_name' | 'not_public' | 'no_website' | 'shared_website';

/** Un órgano de contratación o un ente público de INVENTE, ya unidos por NIF. */
export type EsPublicEntityInputs = {
  nif: string;
  body: EsContractingBody | null;
  invente: EsInventeEntity | null;
};

/**
 * Fila de Gobierno, o por qué no entra. Sólo con NIF de entidad pública (P, Q, S)
 * o ente público de INVENTE, y sólo con una web que la nombre.
 */
export function buildEsPublicEntityRow(
  inputs: EsPublicEntityInputs,
  params: EsRowParams & { sharedDomains: ReadonlySet<string> },
): { row: EsSnapshotRow } | { excluded: EsPublicEntityExclusion } {
  const { body, invente } = inputs;
  const inventePublic = invente !== null && isEsInventePublicBody(invente);
  if (!PUBLIC_NIF.test(inputs.nif) && !inventePublic) return { excluded: 'not_public' };
  const rawName = invente?.name ?? (body !== null ? esPreferredPublicName(body.names) : null);
  if (rawName === null) return { excluded: 'no_name' };
  const legalName = esPublicEntityDisplayName(rawName);
  const core = spainNameCore(legalName);
  if (core.length < 3) return { excluded: 'no_name' };
  if (endsWithSpainLegalForm(legalName) && !inventePublic) return { excluded: 'not_public' };
  const domain = spainPublicEntityDomain({
    name: legalName,
    urls: [invente?.web, ...(body?.urls ?? [])].filter((u): u is string => typeof u === 'string'),
    emails: [invente?.email, ...(body?.emails ?? [])].filter((e): e is string => typeof e === 'string'),
  });
  if (domain === null) return { excluded: 'no_website' };
  if (params.sharedDomains.has(domain)) return { excluded: 'shared_website' };
  const kind = classifyEsPublicEntity(legalName, body?.typeCode ?? null);
  return {
    row: {
      source_key: ES_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: 'ES',
      source_year: params.sourceYear,
      tax_id: inputs.nif,
      normalized_tax_id: inputs.nif,
      legal_name: legalName,
      normalized_legal_name: core,
      city: null,
      region: null,
      priority_score: KIND_PRIORITY[kind] * 10 + (invente?.workers != null ? 1 : 0),
      raw_data: {
        directory_kind: 'public_entity',
        macro_industry_key: ES_PUBLIC_ENTITY_MACRO,
        macro_table_version: ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
        entity_kind: kind,
        public_key: spainPublicEntityKey(legalName) ?? core,
        tax_identifier_type: 'NIF',
        ...(body?.dir3 ? { dir3: body.dir3 } : {}),
        ...(invente?.inventeCode ? { invente_code: invente.inventeCode } : {}),
        ...(invente?.workers != null && invente.workersYear != null ? { workers: invente.workers, metrics_year: invente.workersYear } : {}),
        website_domain: domain,
        website_origin: invente?.web || (body?.urls.length ?? 0) > 0 ? 'official_web' : 'email',
      },
      imported_at: params.importedAt,
      record_identity_key: taxIdentity(inputs.nif),
    },
  };
}

/**
 * El nombre de la entidad entre los de sus órganos: el más publicado tras quitar el
 * órgano («Alcaldía del Ayuntamiento de X» y «Pleno del Ayuntamiento de X» cuentan
 * como «Ayuntamiento de X»).
 */
export function esPreferredPublicName(names: Readonly<Record<string, number>>): string | null {
  const counts = new Map<string, number>();
  for (const [raw, count] of Object.entries(names)) {
    const name = esPublicEntityDisplayName(raw);
    if (spainNameCore(name).length < 3) continue;
    counts.set(name, (counts.get(name) ?? 0) + count);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}
