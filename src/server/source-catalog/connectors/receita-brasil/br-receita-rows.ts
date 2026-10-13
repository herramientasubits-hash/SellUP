/**
 * br-receita-rows.ts — filas de `source_company_snapshots` para Brasil a partir
 * del subconjunto LIVIANO del cadastro CNPJ de la Receita Federal.
 *
 * SOURCES-BR-LIGHT-1 (opción A aprobada por la dueña el 13-10-2026). Puro: sin
 * env, sin I/O, sin DB, sin reloj.
 *
 * ── Qué entra (nunca los ~60 M de CNPJ) ─────────────────────────────────────
 *
 * Sólo la MATRIZ ACTIVA (situação 02) de:
 *   - sociedades privadas (naturaleza 2xxx, salvo el empresário individual 2135,
 *     cuya razón social es el nombre de una persona) con porte DEMAIS (ni ME ni
 *     EPP): 1,36 M en 2026-09;
 *   - entes públicos (naturaleza 1xxx): 66 mil.
 * Las asociaciones, condominios, partidos (3xxx) y personas físicas (4xxx) no
 * entran. Del correo sólo llega el DOMINIO y sólo si encaja con el nombre
 * (`br-domain.ts`); nunca teléfonos, socios ni direcciones.
 *
 * ── Cuatro claves de fuente ─────────────────────────────────────────────────
 *
 *   br_receita_registry     una fila por CNPJ: el CNPJ por nombre (TAX_GRAIN).
 *   br_receita_name_alias   nome fantasia, nombre comercial de la CVM, partes de
 *                           la razón social y clave pública (NATIVE_RECORD_GRAIN).
 *   br_receita_domain_key   «@etiqueta» del dominio que encaja con el nombre: el
 *                           CNPJ por dominio cuando el nombre comercial no es la
 *                           razón social (NATIVE_RECORD_GRAIN).
 *   br_receita_directory    el buscador gratuito por industria (TAX_GRAIN).
 *
 * ── Tamaño ──────────────────────────────────────────────────────────────────
 *
 * `raw_data.br_porte` lleva el porte de la Receita. Lo lee `workforceFromRawData`
 * (`snapshot-name-query.ts`): ME y EPP son micro y pequeña y se descartan; DEMAIS
 * no decide el tamaño. Como esta carga sólo trae DEMAIS y entes públicos, en la
 * práctica el porte nunca descarta aquí: lo deja escrito para que nadie crea que
 * DEMAIS significa grande.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeBrazilCnpj } from '../br-receita-cnpj/br-cnpj';
import {
  brazilCoreContainsWords,
  brazilNameCore,
  brazilNameMayHaveAliases,
  brazilPublicEntityKey,
} from './br-name-keys';
import { brazilCompanyDomainFromEmail, brazilDomainLookupKey, isBrazilPublicSectorDomain } from './br-domain';
import {
  brCnaeAllowedInDiscovery,
  BR_RECEITA_MACRO_TABLE_VERSION,
  resolveBrCnaeMacro,
} from '@/server/prospect-batches/country-source-discovery/br-receita-macro-table';

export const BR_RECEITA_REGISTRY_SOURCE_KEY = 'br_receita_registry' as const;
export const BR_RECEITA_NAME_ALIAS_SOURCE_KEY = 'br_receita_name_alias' as const;
export const BR_RECEITA_DOMAIN_KEY_SOURCE_KEY = 'br_receita_domain_key' as const;
export const BR_RECEITA_DIRECTORY_SOURCE_KEY = 'br_receita_directory' as const;
export const BR_COUNTRY_CODE = 'BR' as const;

/** Espacios de nombres de la identidad de un alias y de una clave de dominio. */
export const BR_NAME_ALIAS_IDENTITY_NAMESPACE = 'br-name-alias' as const;
export const BR_DOMAIN_KEY_IDENTITY_NAMESPACE = 'br-domain-key' as const;

/** Porte de la Receita: 01 ME, 03 EPP, 05 DEMAIS. */
export type BrPorte = '01' | '03' | '05';

/** Corte del buscador gratuito (aprobado: «el mayor número de empresas gratis»). */
export const BR_DIRECTORY_MIN_CAPITAL_BRL = 1_000_000;
export const BR_DIRECTORY_MIN_ACTIVE_BRANCHES = 3;

/** Capital o sucursales desde los que una empresa cuenta como «grande» para desempatar. */
export const BR_LARGE_CAPITAL_BRL = 10_000_000;
export const BR_LARGE_ACTIVE_BRANCHES = 10;

/** Empresário individual: la razón social es el nombre de una persona. */
const INDIVIDUAL_ENTREPRENEUR_NATUREZA = '2135';

/** País «Brasil» en la tabla de países de la Receita (o vacío). */
const BRAZIL_COUNTRY_CODES: ReadonlySet<string> = new Set(['', '105', '1058']);

/** Razones sociales que nunca se ofrecen en el buscador (fondos, SPE, holdings). */
const NOT_OPERATING_NAME = /\b(FUNDO|FIDC|FII|CONDOMINIO|SPE|PARTICIPACOES|HOLDING|EMPREENDIMENTOS? IMOBILIARIOS?|INCORPORADORA|SECURITIZADORA)\b/;

/** Una matriz activa del subconjunto (una línea de `extract-br-receita-light.py`). */
export interface BrReceitaCompanyRecord {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  naturezaJuridica: string;
  capitalSocial: number;
  porte: string;
  openingDate: string | null;
  cnae: string | null;
  /** Descripción oficial de la CNAE (tabla «Cnaes» de la Receita, en portugués). */
  cnaeDescription: string | null;
  uf: string | null;
  municipality: string | null;
  emailDomain: string | null;
  activeBranches: number;
  countryCode: string | null;
}

/** Empresa con acciones en bolsa (cadastro de la CVM), para alias y desempate de grupos. */
export interface BrCvmListing {
  tradeName: string | null;
  domain: string | null;
  sector: string | null;
}

export type BrReceitaSnapshotRow = {
  source_key: string;
  country_code: typeof BR_COUNTRY_CODE;
  source_year: number;
  source_period: string;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  region: string | null;
  priority_score: number | null;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

export type BrReceitaRowParams = { sourceYear: number; sourcePeriod: string; importedAt: string };

/** ¿Es un ente público (naturaleza 1xxx)? */
export function isBrazilPublicNatureza(natureza: string): boolean {
  return /^1\d{3}$/.test(natureza);
}

/** ¿Entra esta matriz al registro? (privada DEMAIS o pública; nunca personas). */
export function brReceitaRecordEligible(record: BrReceitaCompanyRecord): boolean {
  if (isBrazilPublicNatureza(record.naturezaJuridica)) return true;
  return (
    /^2\d{3}$/.test(record.naturezaJuridica) &&
    record.naturezaJuridica !== INDIVIDUAL_ENTREPRENEUR_NATUREZA &&
    record.porte === '05'
  );
}

/** «Grande» para desempatar homónimos y grupos: capital ≥ 10 M o 10+ sucursales. */
export function brReceitaIsLarge(capital: number, activeBranches: number): boolean {
  return capital >= BR_LARGE_CAPITAL_BRL || activeBranches >= BR_LARGE_ACTIVE_BRANCHES;
}

/** «12.345.678/0001-95» a partir de los 14 caracteres. */
export function formatBrazilCnpj(normalized: string): string {
  return `${normalized.slice(0, 2)}.${normalized.slice(2, 5)}.${normalized.slice(5, 8)}/${normalized.slice(8, 12)}-${normalized.slice(12)}`;
}

/** La web de la empresa: la de la CVM si la hay, si no la del correo del cadastro (siempre que encaje). */
export function brReceitaCompanyDomain(record: BrReceitaCompanyRecord, cvm: BrCvmListing | null): string | null {
  const names = [record.legalName, record.tradeName, cvm?.tradeName ?? null];
  const publicEntity = isBrazilPublicNatureza(record.naturezaJuridica);
  for (const candidate of [cvm?.domain ?? null, record.emailDomain]) {
    const domain = brazilCompanyDomainFromEmail({ email: candidate, names, publicEntity });
    if (domain !== null) return domain;
  }
  return null;
}

function registryRawData(
  record: BrReceitaCompanyRecord,
  cvm: BrCvmListing | null,
  domain: string | null,
  params: BrReceitaRowParams,
) {
  return {
    tax_identifier_type: 'CNPJ',
    br_porte: record.porte,
    br_porte_year: params.sourceYear,
    br_porte_period: params.sourcePeriod,
    natureza_juridica: record.naturezaJuridica,
    capital_social: record.capitalSocial,
    active_branches: record.activeBranches,
    cnae_principal: record.cnae,
    ...(record.cnaeDescription ? { activity_text: record.cnaeDescription } : {}),
    opening_date: record.openingDate,
    ...(domain !== null ? { website_domain: domain, website_domain_source: cvm?.domain ? 'cvm_cadastro' : 'receita_email_domain' } : {}),
    ...(isBrazilPublicNatureza(record.naturezaJuridica) ? { public_entity: true } : {}),
    ...(cvm !== null ? { cvm_listed: true } : {}),
  };
}

/** Fila `br_receita_registry`, o `null` si la matriz no entra o el CNPJ no valida. */
export function buildBrReceitaRegistryRow(
  record: BrReceitaCompanyRecord,
  params: BrReceitaRowParams,
  cvm: BrCvmListing | null = null,
): BrReceitaSnapshotRow | null {
  if (!brReceitaRecordEligible(record)) return null;
  const cnpj = normalizeBrazilCnpj(record.cnpj);
  if (cnpj.status !== 'valid' || cnpj.normalized === null) return null;
  const legalName = record.legalName.trim();
  const core = brazilNameCore(legalName);
  if (core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(cnpj.normalized);
  const domain = brReceitaCompanyDomain(record, cvm);
  return {
    source_key: BR_RECEITA_REGISTRY_SOURCE_KEY,
    country_code: BR_COUNTRY_CODE,
    source_year: params.sourceYear,
    source_period: params.sourcePeriod,
    tax_id: formatBrazilCnpj(cnpj.normalized),
    normalized_tax_id: cnpj.normalized,
    legal_name: legalName,
    normalized_legal_name: core,
    sector: record.cnae,
    city: record.municipality,
    region: record.uf,
    priority_score: null,
    raw_data: registryRawData(record, cvm, domain, params),
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

function derivedRow(
  registryRow: BrReceitaSnapshotRow,
  sourceKey: string,
  namespace: string,
  key: string,
  extra: Record<string, unknown>,
): BrReceitaSnapshotRow {
  const identity = buildRecordIdentityKey(namespace, `${registryRow.normalized_tax_id}:${key}`);
  return {
    ...registryRow,
    source_key: sourceKey,
    normalized_legal_name: key,
    raw_data: { ...registryRow.raw_data, ...extra },
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Filas `br_receita_name_alias`: una por clave EXTRA (ya sin las que son el nombre propio de otra). */
export function buildBrReceitaNameAliasRows(registryRow: BrReceitaSnapshotRow, keys: readonly string[]): BrReceitaSnapshotRow[] {
  if (!brazilNameMayHaveAliases(registryRow.legal_name)) return [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  const rows: BrReceitaSnapshotRow[] = [];
  for (const raw of keys) {
    const key = raw.trim();
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    rows.push(
      derivedRow(registryRow, BR_RECEITA_NAME_ALIAS_SOURCE_KEY, BR_NAME_ALIAS_IDENTITY_NAMESPACE, key, {
        alias_of: registryRow.normalized_legal_name,
      }),
    );
  }
  return rows;
}

/** Fila `br_receita_domain_key` («@etiqueta») si la empresa tiene una web que encaja con su nombre. */
export function buildBrReceitaDomainKeyRow(registryRow: BrReceitaSnapshotRow): BrReceitaSnapshotRow | null {
  const domain = registryRow.raw_data['website_domain'];
  if (typeof domain !== 'string') return null;
  if (!brazilNameMayHaveAliases(registryRow.legal_name)) return null;
  const key = brazilDomainLookupKey(domain);
  if (key === null) return null;
  return derivedRow(registryRow, BR_RECEITA_DOMAIN_KEY_SOURCE_KEY, BR_DOMAIN_KEY_IDENTITY_NAMESPACE, key, {
    domain_of: registryRow.normalized_legal_name,
  });
}

/** Prioridad del buscador: más capital y más sucursales primero. Determinista. */
export function brReceitaDirectoryPriority(capital: number, activeBranches: number): number {
  const capitalScore = Math.round(Math.log10(1 + Math.max(0, capital)) * 1000);
  return capitalScore + Math.min(Math.max(0, activeBranches), 1000) * 20;
}

/** Cabezas de entes públicos que el buscador ofrece en Gobierno o Salud. */
const PUBLIC_HEAD_START = /^(MUNICIPIO|PREFEITURA|ESTADO|GOVERNO|MINISTERIO|UNIVERSIDADE|INSTITUTO FEDERAL|HOSPITAL|TRIBUNAL|ASSEMBLEIA LEGISLATIVA|CAMARA MUNICIPAL|SECRETARIA DE ESTADO|DEFENSORIA|MINISTERIO PUBLICO|AGENCIA NACIONAL|BANCO CENTRAL)\b/;

/** ¿Es la cabeza de un ente público (no un fondo o un órgano interno)? */
export function isBrazilPublicHead(record: Pick<BrReceitaCompanyRecord, 'naturezaJuridica' | 'legalName'>): boolean {
  if (!isBrazilPublicNatureza(record.naturezaJuridica)) return false;
  if (record.naturezaJuridica === '1244' || record.naturezaJuridica === '1236') return true;
  return PUBLIC_HEAD_START.test(brazilNameCore(record.legalName));
}

/** Macro de un ente público: hospital → Salud, el resto → Gobierno. */
function publicEntityMacro(record: BrReceitaCompanyRecord): 'health_pharma' | 'government' {
  const core = brazilNameCore(record.legalName);
  const cnaeDivision = record.cnae?.slice(0, 2) ?? '';
  return core.startsWith('HOSPITAL') || cnaeDivision === '86' ? 'health_pharma' : 'government';
}

/** Por qué una matriz no entra al buscador (o `null` si entra). */
export function brReceitaDirectoryExclusion(
  record: BrReceitaCompanyRecord,
  registryRow: BrReceitaSnapshotRow,
): string | null {
  const domain = registryRow.raw_data['website_domain'];
  if (isBrazilPublicNatureza(record.naturezaJuridica)) {
    if (!isBrazilPublicHead(record)) return 'public_not_head';
    // Un ente público sólo entra con su web `.gov.br` que lleva su nombre o sigla.
    if (typeof domain !== 'string' || !isBrazilPublicSectorDomain(domain)) return 'public_without_gov_web';
    return null;
  }
  if (!BRAZIL_COUNTRY_CODES.has(record.countryCode?.trim() ?? '')) return 'foreign_address';
  if (record.capitalSocial < BR_DIRECTORY_MIN_CAPITAL_BRL && record.activeBranches < BR_DIRECTORY_MIN_ACTIVE_BRANCHES) {
    return 'below_directory_cut';
  }
  if (!brCnaeAllowedInDiscovery(record.cnae)) return 'not_operating_activity';
  if (NOT_OPERATING_NAME.test(registryRow.normalized_legal_name)) return 'not_operating_name';
  if (resolveBrCnaeMacro(record.cnae) === null) return 'no_macro';
  return null;
}

/** Fila `br_receita_directory`, o `null` si la matriz no entra al buscador. */
export function buildBrReceitaDirectoryRow(
  record: BrReceitaCompanyRecord,
  registryRow: BrReceitaSnapshotRow,
): BrReceitaSnapshotRow | null {
  if (brReceitaDirectoryExclusion(record, registryRow) !== null) return null;
  const publicEntity = isBrazilPublicNatureza(record.naturezaJuridica);
  const macro = publicEntity ? publicEntityMacro(record) : resolveBrCnaeMacro(record.cnae);
  if (macro === null) return null;
  return {
    ...registryRow,
    source_key: BR_RECEITA_DIRECTORY_SOURCE_KEY,
    priority_score: publicEntity ? brReceitaDirectoryPriority(0, record.activeBranches) : brReceitaDirectoryPriority(record.capitalSocial, record.activeBranches),
    raw_data: {
      ...registryRow.raw_data,
      macro_industry_key: macro,
      macro_table_version: BR_RECEITA_MACRO_TABLE_VERSION,
      sector_source: publicEntity ? 'receita_natureza_publica' : 'receita_cnae23',
    },
  };
}

/** ¿Contiene la razón social o el alias de una fila el núcleo pedido como palabras completas? */
export function brReceitaRowNamesContain(row: { normalizedLegalName: string | null; aliasOf?: string | null }, core: string): boolean {
  return [row.normalizedLegalName, row.aliasOf].some((name) => typeof name === 'string' && brazilCoreContainsWords(name, core));
}

/** La clave pública del núcleo de la razón social (para las alcaldías y estados). */
export function brReceitaPublicKey(legalName: string): string | null {
  return brazilPublicEntityKey(brazilNameCore(legalName));
}
