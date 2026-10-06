/**
 * pe-sunat-source-rows.ts — filas de las dos fuentes nuevas de Perú en
 * `source_company_snapshots`:
 *
 *   - `pe_sunat_name_alias`: claves de nombre EXTRA para el RUC por nombre (alias
 *     tras « - » del padrón, nombres de entidades públicas sin «de/del» y nombres
 *     del listado de entidades contratantes del Estado, OECE). Varias filas por RUC
 *     (una por clave), así que la identidad es de registro, no fiscal.
 *   - `pe_sunat_directory`: la capa gratuita por industria. Sociedades y entidades
 *     ACTIVAS y HABIDAS con 200 o más trabajadores informados y actividad con
 *     macro industria.
 *
 * SOURCES-PE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj (la hora de
 * importación se inyecta).
 *
 * 🔴 No se guardan dirección, teléfono ni representantes: el Agente 1 no recoge
 * datos de personas desde estas fuentes.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import type { PeSunatOpenPadronRecord } from './pe-sunat-open-padron';
import { normalizePeruCompanyCore, peSunatOpenPadronRawData } from './pe-sunat-registry-row';
import { PE_RENAMU_DOMAIN_SOURCE } from './pe-renamu-domain';
import {
  PE_SUNAT_MACRO_TABLE_VERSION,
  resolvePeActivityMacro,
} from '@/server/prospect-batches/country-source-discovery/pe-sunat-macro-table';

export const PE_SUNAT_NAME_ALIAS_SOURCE_KEY = 'pe_sunat_name_alias' as const;
export const PE_SUNAT_DIRECTORY_SOURCE_KEY = 'pe_sunat_directory' as const;
export const PE_COUNTRY_CODE = 'PE' as const;

/** Espacio de nombres de la identidad de un alias (`pe-name-alias:<RUC>:<clave>`). */
export const PE_NAME_ALIAS_IDENTITY_NAMESPACE = 'pe-name-alias' as const;

/** Umbral de tamaño del Agente 1: la capa gratuita nunca ofrece menos. */
export const PE_SUNAT_DIRECTORY_MIN_WORKERS = 200;

/**
 * Tipos de contribuyente que nunca entran en la capa gratuita: no son clientes
 * (juntas de propietarios, sindicatos, núcleos ejecutores, consorcios temporales,
 * fondos, comunidades, iglesias, sociedades irregulares).
 */
export const PE_SUNAT_DIRECTORY_EXCLUDED_TAXPAYER_TYPES: ReadonlySet<string> = new Set([
  'JUNTA DE PROPIETARIOS',
  'SINDICATOS Y FEDERACIONES',
  'NUCLEOS EJECUTORES',
  'CONTRATOS COLABORACION EMPRESARIAL',
  'FONDOS MUTUOS DE INVERSION',
  'COMUNIDAD CAMPESINA NATIVA',
  'INSTITUCIONES RELIGIOSAS',
  'SOCIEDAD IRREGULAR',
]);

const COMPANY_RUC = /^20\d{9}$/;

/** De dónde sale un alias. */
export type PeNameAliasOrigin = 'sunat_legal_name' | 'oece_entity';

export type PeSunatNameAliasRow = {
  source_key: typeof PE_SUNAT_NAME_ALIAS_SOURCE_KEY;
  country_code: typeof PE_COUNTRY_CODE;
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
 * Una fila por clave extra. `legalName` es el nombre que se ve (la razón social de
 * SUNAT si se conoce); `open` aporta trabajadores, que el RUC por nombre necesita
 * para la regla de una palabra y el filtro de tamaño.
 */
export function buildPeSunatNameAliasRows(params: {
  ruc: string;
  legalName: string;
  keys: readonly string[];
  origin: PeNameAliasOrigin;
  open: PeSunatOpenPadronRecord | null;
  sourceYear: number;
  importedAt: string;
}): PeSunatNameAliasRow[] {
  const { ruc, legalName, keys, origin, open, sourceYear, importedAt } = params;
  if (!COMPANY_RUC.test(ruc) || legalName.trim().length === 0) return [];
  const rows: PeSunatNameAliasRow[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(PE_NAME_ALIAS_IDENTITY_NAMESPACE, `${ruc}:${core}`);
    rows.push({
      source_key: PE_SUNAT_NAME_ALIAS_SOURCE_KEY,
      country_code: PE_COUNTRY_CODE,
      source_year: sourceYear,
      tax_id: ruc,
      normalized_tax_id: ruc,
      legal_name: legalName.trim(),
      normalized_legal_name: core,
      raw_data: { alias_origin: origin, ...peSunatOpenPadronRawData(open) },
      imported_at: importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

export type PeSunatDirectoryRow = {
  source_key: typeof PE_SUNAT_DIRECTORY_SOURCE_KEY;
  country_code: typeof PE_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  region: string | null;
  priority_score: number;
  signals: Record<string, unknown>;
  financials: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * Fila de la capa gratuita, o `null` si la sociedad no entra: tipo excluido,
 * menos de 200 trabajadores informados o actividad sin macro industria.
 * `priority_score` = trabajadores (la lectura ordena por él).
 */
export function buildPeSunatDirectoryRow(params: {
  open: PeSunatOpenPadronRecord;
  legalName: string;
  importedAt: string;
  /** SOURCES-PE-MUNICIPAL-DOMAIN-1 — dominio de la municipalidad en el RENAMU, si lo hay. */
  websiteDomain?: string | null;
}): PeSunatDirectoryRow | null {
  const { open, legalName, importedAt } = params;
  const websiteDomain = params.websiteDomain?.trim().toLowerCase() || null;
  const name = legalName.trim();
  if (!COMPANY_RUC.test(open.ruc) || name.length === 0) return null;
  if (open.taxpayerType !== null && PE_SUNAT_DIRECTORY_EXCLUDED_TAXPAYER_TYPES.has(open.taxpayerType)) return null;
  if (open.workers === null || open.workers < PE_SUNAT_DIRECTORY_MIN_WORKERS || open.metricsYear === null) return null;
  const macro = resolvePeActivityMacro(open.ciiu4Code);
  if (macro === null) return null;

  const identity = deriveTaxRecordIdentity(open.ruc);
  const core = normalizePeruCompanyCore(name);
  return {
    source_key: PE_SUNAT_DIRECTORY_SOURCE_KEY,
    country_code: PE_COUNTRY_CODE,
    source_year: open.metricsYear,
    tax_id: open.ruc,
    normalized_tax_id: open.ruc,
    legal_name: name,
    normalized_legal_name: core.length > 0 ? core : name.toUpperCase(),
    sector: open.ciiu4Code,
    city: open.province,
    department: open.department,
    region: open.department,
    priority_score: open.workers,
    signals: { workers: open.workers, metrics_year: open.metricsYear },
    financials: {},
    raw_data: {
      tax_identifier_type: 'RUC',
      taxpayer_type: open.taxpayerType,
      ciiu4_code: open.ciiu4Code,
      activity_text: open.activityText,
      macro_industry_key: macro,
      macro_table_version: PE_SUNAT_MACRO_TABLE_VERSION,
      workers: open.workers,
      metrics_year: open.metricsYear,
      website_domain: websiteDomain,
      website_domain_source: websiteDomain === null ? null : PE_RENAMU_DOMAIN_SOURCE,
      source_type: 'tax_registry_open_data',
      sector_source: 'sunat_ciiu4',
      human_review_required: true,
    },
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
