/**
 * ar-public-entities.ts — directorio de entidades públicas de Argentina, listo
 * para `source_company_snapshots` (`source_key = ar_public_entities`).
 *
 * SOURCES-AR-PUBLIC-ENTITIES-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * Las fuentes gratuitas de Argentina (RNS × COMPR.AR, empleadores ATP) son de
 * SOCIEDADES: para Gobierno sólo ofrecían 7 empresas del Estado, ninguna con web,
 * y el CUIT por nombre (registro de sociedades) no encuentra municipios ni
 * organismos. Argentina no publica un directorio único con CUIT y web (como el
 * CHIP de Colombia), así que se arma cruzando fuentes oficiales
 * (`scripts/source-catalog/extract-ar-public-entities.py`):
 *
 *   · municipios ≥ 20.000 habitantes: ReFeGLo (web + población 2022) × padrón
 *     de ARCA (CUIT por nombre, coincidencia única o confirmada por el SIPRO);
 *   · organismos nacionales ≥ 200 empleados: dotación del INDEC × padrón (CUIT)
 *     × Mapa del Estado (web, sólo si el dominio lleva la sigla o el nombre);
 *   · universidades nacionales: SIPRO («Organismo Publico», CUIT) × Wikidata (web).
 *
 * Aquí se valida y se arma la fila: CUIT de persona jurídica con dígito
 * verificador válido, dominio con forma (nunca uno compartido como
 * argentina.gob.ar), tamaño y macro `government`.
 */

import { deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import { normalizeArCompanyCore } from './ar-company-name-core';
import { isLegalEntityCuit, normalizeArLegalName, normalizeCuit } from './ar-rns-snapshot-builder';

export const AR_PUBLIC_ENTITIES_SOURCE_KEY = 'ar_public_entities' as const;
export const AR_PUBLIC_ENTITIES_SOURCE_YEAR = 2026;
export const AR_PUBLIC_ENTITIES_TABLE_VERSION = 'ar-public-entities-v1' as const;

/** Tipos de entidad del directorio. */
export type ArPublicEntityType = 'municipality' | 'national_entity' | 'university';

const ENTITY_TYPES: ReadonlySet<string> = new Set(['municipality', 'national_entity', 'university']);

/** Dominios que comparten muchas entidades: nunca identifican a una. */
const SHARED_DOMAINS: ReadonlySet<string> = new Set([
  'argentina.gob.ar', 'gob.ar', 'gov.ar', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
]);

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Fila del CSV que escribe el extractor. */
export type ArPublicEntityCsvRow = {
  cuit?: string;
  name?: string;
  entity_type?: string;
  province?: string;
  website?: string;
  size?: string;
  size_kind?: string;
  match?: string;
};

export type ArPublicEntityRow = {
  source_key: typeof AR_PUBLIC_ENTITIES_SOURCE_KEY;
  country_code: 'AR';
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string;
  city: null;
  department: null;
  region: string | null;
  priority_score: number;
  signals: Record<string, unknown>;
  financials: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

const ENTITY_TYPE_LABEL: Record<ArPublicEntityType, string> = {
  municipality: 'Gobierno municipal',
  national_entity: 'Administración pública nacional',
  university: 'Universidad nacional',
};

/** Prefijos con los que se nombra a un municipio («Municipio de», «Ciudad de»…). */
const MUNICIPAL_PREFIX =
  /^(?:MUNICIPALIDAD|MUNICIPIO|GOBIERNO MUNICIPAL|INTENDENCIA|COMUNA)(?: (?:DE LA CIUDAD DE|DEL PARTIDO DE|DE|DEL))? /;

/**
 * Núcleo para buscar por nombre una entidad pública: el de las sociedades
 * (`normalizeArCompanyCore`) sin siglas entre paréntesis, y con una forma ÚNICA
 * para los municipios: «Municipalidad de La Plata», «Municipio de La Plata» y
 * «Municipalidad del Partido de La Plata» → «MUNICIPALIDAD LA PLATA». Un nombre
 * suelto («La Plata») no se convierte en municipio: sería adivinar.
 */
export function normalizeArPublicEntityCore(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  const core = normalizeArCompanyCore(name.replace(/\([^)]*\)/g, ' '));
  const municipal = core.replace(MUNICIPAL_PREFIX, '');
  return municipal !== core && municipal.length >= 2 ? `MUNICIPALIDAD ${municipal}` : core;
}

/** Dominio con forma y no compartido, sin «www.»; o `null`. */
export function arPublicEntityDomain(raw: string | null | undefined): string | null {
  const host = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split('/')[0]
    .replace(/^www\d?\./, '');
  if (!DOMAIN_SHAPE.test(host)) return null;
  const parts = host.split('.');
  const registrable =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'gob', 'gov', 'org', 'edu', 'net', 'mil', 'int', 'tur'].includes(parts[parts.length - 2])
      ? parts.slice(-3).join('.')
      : parts.slice(-2).join('.');
  return SHARED_DOMAINS.has(registrable) || SHARED_DOMAINS.has(host) ? null : host;
}

/** Percentil 0-100 dentro de una lista (empates comparten valor). */
function percentiles(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const first = new Map<number, number>();
  sorted.forEach((v, i) => {
    if (!first.has(v)) first.set(v, i);
  });
  const denominator = Math.max(sorted.length - 1, 1);
  return values.map((v) => ((first.get(v) ?? 0) / denominator) * 100);
}

/** Puntaje cuando la fuente no mide tamaño (universidades nacionales). */
export const AR_PUBLIC_ENTITY_UNSIZED_PRIORITY = 60;

/**
 * Filas del directorio. Descarta CUIT inválidas o de persona humana, tipos
 * desconocidos, nombres vacíos y CUIT repetidas (gana la primera). El puntaje es
 * el percentil del tamaño DENTRO de su tipo (población no se compara con
 * empleados).
 */
export function buildArPublicEntityRows(
  rows: readonly ArPublicEntityCsvRow[],
  importedAt: string,
): ArPublicEntityRow[] {
  const valid: Array<{ cuit: string; name: string; type: ArPublicEntityType; row: ArPublicEntityCsvRow; size: number | null }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cuit = normalizeCuit(row.cuit);
    const name = (row.name ?? '').trim();
    const type = (row.entity_type ?? '').trim();
    if (cuit === null || !isLegalEntityCuit(cuit) || !name || !ENTITY_TYPES.has(type) || seen.has(cuit)) continue;
    seen.add(cuit);
    const size = Number.parseInt((row.size ?? '').trim(), 10);
    valid.push({ cuit, name, type: type as ArPublicEntityType, row, size: Number.isInteger(size) && size > 0 ? size : null });
  }

  const scores = new Map<string, number>();
  for (const type of ENTITY_TYPES) {
    const sized = valid.filter((v) => v.type === type && v.size !== null);
    percentiles(sized.map((v) => v.size as number)).forEach((p, i) => scores.set(sized[i].cuit, p));
  }

  return valid.map(({ cuit, name, type, row, size }) => {
    const identity = deriveTaxRecordIdentity(cuit);
    const domain = arPublicEntityDomain(row.website);
    return {
      source_key: AR_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: 'AR',
      source_year: AR_PUBLIC_ENTITIES_SOURCE_YEAR,
      tax_id: cuit,
      normalized_tax_id: cuit,
      legal_name: name,
      normalized_legal_name: normalizeArPublicEntityCore(name),
      sector: ENTITY_TYPE_LABEL[type],
      city: null,
      department: null,
      region: (row.province ?? '').trim() || null,
      priority_score: Math.round((scores.get(cuit) ?? AR_PUBLIC_ENTITY_UNSIZED_PRIORITY) * 100) / 100,
      signals: size === null ? {} : { size, size_kind: (row.size_kind ?? '').trim() || null },
      financials: {},
      raw_data: {
        tax_identifier_type: 'CUIT',
        entity_type: type,
        display_name: normalizeArLegalName(name),
        website_domain: domain,
        size,
        size_kind: (row.size_kind ?? '').trim() || null,
        cuit_match: (row.match ?? '').trim() || null,
        macro_industry_key: 'government',
        macro_table_version: AR_PUBLIC_ENTITIES_TABLE_VERSION,
        source_type: 'public_entity_directory',
        human_review_required: true,
      },
      imported_at: importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    };
  });
}
