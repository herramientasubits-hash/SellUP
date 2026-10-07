/**
 * cr-free-directory-row.ts — filas de `cr_free_directory`: empresas y entidades de
 * Costa Rica que el descubrimiento gratuito del Agente 1 puede ofrecer por
 * industria.
 *
 * SOURCES-CR-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Fuentes (gratuitas y oficiales):
 *   - Ofertas de SICOP 2022-2024 (Hacienda, datos.go.cr, CC-BY): a cuántas
 *     instituciones ofrece cada sociedad y qué (UNSPSC). No traen el nombre: lo
 *     pone el registro (`cr_company_registry`).
 *   - PROCOMER «Empresas en Régimen de Zona Franca»: razón social, cédula,
 *     actividad CAECR y cantón.
 *   - Instituciones compradoras de SICOP: ministerios, poderes, autónomas,
 *     municipalidades, universidades públicas y empresas públicas; la web sale de
 *     la ficha de MIDEPLAN («Organización del Sector Público Costarricense»).
 *
 * Una fila por cédula. Si una empresa está en varias fuentes manda la entidad
 * pública, después Zona Franca (declaró su actividad) y después SICOP.
 *
 * Quedan FUERA:
 *   - las que el MEIC registra como micro o pequeña (decisión de la dueña,
 *     06-10-2026); la mediana entra y no decide sola;
 *   - asociaciones, fundaciones, juntas de educación, mutuales, temporalidades y
 *     fideicomisos (no son entidades públicas ni empresas a prospectar);
 *   - empresas individuales de responsabilidad limitada (3-105, una persona);
 *   - lo que no tiene macro dominante.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  CR_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  CR_PUBLIC_ENTITY_MACRO,
  resolveCrCaecrMacro,
  resolveCrSicopSupplierMacro,
  type CrDirectoryKind,
} from '@/server/prospect-batches/country-source-discovery/cr-free-directory-macro-table';
import { costaRicaNameCore, currentCostaRicaName } from './cr-name-keys';
import { normalizeCostaRicaCompanyCedula } from './cr-company-registry-rows';
import { registrableCostaRicaDomain } from './cr-domain';
import { isNonCorporateDomain, normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';

export const CR_FREE_DIRECTORY_SOURCE_KEY = 'cr_free_directory' as const;

/**
 * Prefijos de cédula de entes públicos que se ofrecen para Gobierno: poderes y
 * ministerios (2…), autónomas y bancos del Estado (4…), municipalidades (3-014),
 * órganos y entes adscritos (3-007) y empresas públicas que compran como
 * institución (3-101 dentro de la lista de compradores).
 */
const PUBLIC_ENTITY_CEDULA = /^(2\d{3}|4\d{3}|3014|3007|3101)\d{6}$/;

/** Prefijos de cédula de sociedades que se prospectan (S.A., S.R.L., cooperativas, sucursales). */
const PROSPECT_COMPANY_CEDULA = /^(3101|3102|3004|3012)\d{6}$/;

/** Tramos del MEIC que dejan a la empresa fuera. */
const SMALL_MEIC_SIZES: ReadonlySet<string> = new Set(['MICRO', 'PEQUEÑA', 'PEQUENA']);

/** Relevancia de base de Zona Franca: van delante de las proveedoras de SICOP. */
export const CR_ZONA_FRANCA_PRIORITY_BASE = 500_000;

/** Relevancia de base de una entidad pública. */
export const CR_PUBLIC_ENTITY_PRIORITY_BASE = 500_000;

export type CrFreeDirectoryRow = {
  source_key: typeof CR_FREE_DIRECTORY_SOURCE_KEY;
  country_code: 'CR';
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

/** Lo ofertado a SICOP por una sociedad (agregado de las ofertas 2022-2024). */
export type CrSicopSupplierSummary = {
  cedula: string;
  /** Monto ofertado en colones por familia UNSPSC (4 dígitos). */
  amountByFamily: Readonly<Record<string, number>>;
  /** Instituciones distintas a las que ofertó. */
  buyers: number;
  /** Líneas ofertadas. */
  offers: number;
  lastOfferYear: number | null;
};

/** Una empresa del Excel de Zona Franca. */
export type CrZonaFrancaCompany = {
  cedula: unknown;
  name: unknown;
  activity: unknown;
  companyType: unknown;
  canton: unknown;
  province: unknown;
};

/** Una institución compradora de SICOP. */
export type CrPublicEntity = {
  cedula: unknown;
  name: unknown;
  /** Solicitudes de contratación 2022-2024 (relevancia). */
  purchaseRequests: number;
  /** Web de la ficha de MIDEPLAN, si se encontró por nombre. */
  website?: string | null;
  acronym?: string | null;
};

/** Lo que el registro sabe de una cédula (nombre y tramo del MEIC). */
export type CrRegistryLookup = (cedula: string) => { legalName: string; meicSize: string | null } | null;

export type CrFreeDirectoryExclusion =
  | 'invalid_cedula'
  | 'not_prospect_company'
  | 'not_public_entity'
  | 'no_name'
  | 'meic_small'
  | 'numbered_name'
  | 'no_dominant_macro';

const cleanText = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
};

/** «… CAECR “6201 Actividades de programación informática” …» → [{ code, label }]. */
export function extractCaecrActivities(activity: unknown): { code: string; label: string | null }[] {
  const text = cleanText(activity);
  if (text === null) return [];
  const out: { code: string; label: string | null }[] = [];
  for (const match of text.matchAll(/CAECR\s*[“"”«]?\s*(\d{4})\s*([^“"”»]*)[”"»]?/gi)) {
    const label = match[2]?.replace(/[,;:]+\s*$/, '').trim() ?? '';
    if (!out.some((a) => a.code === match[1])) out.push({ code: match[1], label: label.length > 0 ? label : null });
  }
  return out;
}

/**
 * ¿Se llama la sociedad igual que su cédula («3-101-938421 SOCIEDAD ANÓNIMA»)? Son
 * sociedades sin nombre comercial: el vendedor no puede buscarlas ni reconocerlas,
 * así que el buscador no las propone (siguen dando cédula por nombre).
 */
export function isNumberedCompanyName(legalName: string): boolean {
  return /^[\d\s]+$/.test(costaRicaNameCore(legalName));
}

/**
 * La actividad principal de una empresa de Zona Franca. El Excel enumera primero
 * la de «empresa comercial de exportación» (mayoreo, 46xx) aunque la empresa
 * fabrique o preste servicios: manda la productiva (divisiones 10-33), después la
 * de servicios y por último el comercio.
 */
export function mainZonaFrancaActivity(
  activities: readonly { code: string; label: string | null }[],
): { code: string; label: string | null } | null {
  const classified = activities.filter((a) => resolveCrCaecrMacro(a.code) !== null);
  const division = (a: { code: string }) => Number(a.code.slice(0, 2));
  return (
    classified.find((a) => division(a) >= 10 && division(a) <= 33) ??
    classified.find((a) => !a.code.startsWith('46') && !a.code.startsWith('47')) ??
    classified[0] ??
    null
  );
}

/** Plantas de una empresa en Zona Franca: la principal y las satélite («ZF981647 - Planta satélite»). */
export function countZonaFrancaPlants(name: unknown): number {
  if (typeof name !== 'string') return 1;
  return 1 + (name.match(/\bZF\d{5,}\b/g)?.length ?? 0);
}

/**
 * Relevancia de una empresa de Zona Franca: delante de las proveedoras de SICOP;
 * entre ellas, más plantas primero y después a cuántas instituciones ofrece. Los
 * parques (administradoras) no son la empresa productora: van detrás.
 */
export function crZonaFrancaPriorityScore(input: { companyType: string | null; plants: number; sicopBuyers: number }): number {
  const base = /ADMINISTRADORA/i.test(input.companyType ?? '') ? 0 : CR_ZONA_FRANCA_PRIORITY_BASE;
  return base + Math.min(Math.max(input.plants, 1), 99) * 1000 + Math.min(input.sicopBuyers, 999);
}

/** Dominio comparable de una web pública, o `null`. */
export function costaRicaWebsiteDomain(url: string | null | undefined): string | null {
  const host = normalizeWebsiteHost(url ?? null);
  if (host === null || isNonCorporateDomain(host)) return null;
  // Las fichas de MIDEPLAN apuntan a veces a una red social o a Google Sites.
  if (/(facebook|instagram|twitter|x|google|youtube|linkedin)\.com$/.test(host)) return null;
  return registrableCostaRicaDomain(host);
}

/**
 * Relevancia para ordenar dentro de una macro: a cuántas instituciones ofrece
 * (una empresa que abastece a muchas es grande), luego cuántas líneas ofertó.
 */
export function crSicopPriorityScore(summary: Pick<CrSicopSupplierSummary, 'buyers' | 'offers'>): number {
  return Math.min(summary.buyers, 499) * 1000 + Math.min(Math.floor(summary.offers / 10), 999);
}

function baseRow(params: {
  cedula: string;
  legalName: string;
  city: string | null;
  region: string | null;
  priority: number;
  raw: Record<string, unknown>;
  sourceYear: number;
  importedAt: string;
}): CrFreeDirectoryRow {
  const identity = deriveTaxRecordIdentity(params.cedula);
  return {
    source_key: CR_FREE_DIRECTORY_SOURCE_KEY,
    country_code: 'CR',
    source_year: params.sourceYear,
    tax_id: params.cedula,
    normalized_tax_id: params.cedula,
    legal_name: params.legalName,
    normalized_legal_name: costaRicaNameCore(params.legalName),
    city: params.city,
    region: params.region,
    priority_score: params.priority,
    raw_data: { ...params.raw, macro_table_version: CR_FREE_DIRECTORY_MACRO_TABLE_VERSION },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Fila de una proveedora de SICOP, o por qué no entra. */
export function buildCrSicopSupplierRow(params: {
  summary: CrSicopSupplierSummary;
  registry: CrRegistryLookup;
  sourceYear: number;
  importedAt: string;
}): { row: CrFreeDirectoryRow } | { excluded: CrFreeDirectoryExclusion } {
  const cedula = normalizeCostaRicaCompanyCedula(params.summary.cedula);
  if (cedula === null) return { excluded: 'invalid_cedula' };
  if (!PROSPECT_COMPANY_CEDULA.test(cedula)) return { excluded: 'not_prospect_company' };
  const known = params.registry(cedula);
  if (known === null || costaRicaNameCore(known.legalName).length < 2) return { excluded: 'no_name' };
  if (isNumberedCompanyName(known.legalName)) return { excluded: 'numbered_name' };
  const meicSize = known.meicSize?.trim().toUpperCase() ?? null;
  if (meicSize !== null && SMALL_MEIC_SIZES.has(meicSize)) return { excluded: 'meic_small' };
  const macro = resolveCrSicopSupplierMacro(params.summary.amountByFamily);
  if (macro === null) return { excluded: 'no_dominant_macro' };
  const dominantFamily =
    Object.entries(params.summary.amountByFamily).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    null;
  const kind: CrDirectoryKind = 'sicop_supplier';
  return {
    row: baseRow({
      cedula,
      legalName: known.legalName,
      city: null,
      region: null,
      priority: crSicopPriorityScore(params.summary),
      raw: {
        directory_kind: kind,
        macro_industry_key: macro.macroIndustryKey,
        macro_share: Math.round(macro.share * 100) / 100,
        activity_code: dominantFamily,
        buyers: params.summary.buyers,
        offers: params.summary.offers,
        last_offer_year: params.summary.lastOfferYear,
        ...(meicSize !== null ? { cr_meic_size: meicSize } : {}),
      },
      sourceYear: params.sourceYear,
      importedAt: params.importedAt,
    }),
  };
}

/** Fila de una empresa de Zona Franca, o por qué no entra. */
export function buildCrZonaFrancaRow(params: {
  company: CrZonaFrancaCompany;
  registry: CrRegistryLookup;
  sicop?: CrSicopSupplierSummary | null;
  sourceYear: number;
  importedAt: string;
}): { row: CrFreeDirectoryRow } | { excluded: CrFreeDirectoryExclusion } {
  const cedula = normalizeCostaRicaCompanyCedula(params.company.cedula);
  if (cedula === null) return { excluded: 'invalid_cedula' };
  if (!PROSPECT_COMPANY_CEDULA.test(cedula)) return { excluded: 'not_prospect_company' };
  const rawName = cleanText(typeof params.company.name === 'string' ? params.company.name.split(/\r?\n/)[0] : params.company.name);
  const legalName = rawName !== null ? cleanText(currentCostaRicaName(rawName)) : null;
  if (legalName === null || costaRicaNameCore(legalName).length < 2) return { excluded: 'no_name' };
  if (isNumberedCompanyName(legalName)) return { excluded: 'numbered_name' };
  const meicSize = params.registry(cedula)?.meicSize?.trim().toUpperCase() ?? null;
  if (meicSize !== null && SMALL_MEIC_SIZES.has(meicSize)) return { excluded: 'meic_small' };
  const main = mainZonaFrancaActivity(extractCaecrActivities(params.company.activity));
  const macro = main !== null ? resolveCrCaecrMacro(main.code) : null;
  if (main === null || macro === null) return { excluded: 'no_dominant_macro' };
  const kind: CrDirectoryKind = 'zona_franca';
  const companyType = cleanText(params.company.companyType);
  const sicopBuyers = params.sicop?.buyers ?? 0;
  return {
    row: baseRow({
      cedula,
      legalName,
      city: cleanText(params.company.canton),
      region: cleanText(params.company.province),
      priority: crZonaFrancaPriorityScore({ companyType, plants: countZonaFrancaPlants(params.company.name), sicopBuyers }),
      raw: {
        directory_kind: kind,
        macro_industry_key: macro,
        activity_code: main.code,
        activity_text: main.label,
        company_type: companyType,
        plants: countZonaFrancaPlants(params.company.name),
        ...(sicopBuyers > 0 ? { buyers: sicopBuyers } : {}),
        ...(meicSize !== null ? { cr_meic_size: meicSize } : {}),
      },
      sourceYear: params.sourceYear,
      importedAt: params.importedAt,
    }),
  };
}

/** Fila de una entidad pública, o por qué no entra. */
export function buildCrPublicEntityRow(params: {
  entity: CrPublicEntity;
  sourceYear: number;
  importedAt: string;
}): { row: CrFreeDirectoryRow } | { excluded: CrFreeDirectoryExclusion } {
  const cedula = normalizeCostaRicaCompanyCedula(params.entity.cedula);
  if (cedula === null) return { excluded: 'invalid_cedula' };
  if (!PUBLIC_ENTITY_CEDULA.test(cedula)) return { excluded: 'not_public_entity' };
  const legalName = cleanText(params.entity.name);
  if (legalName === null || costaRicaNameCore(legalName).length < 2) return { excluded: 'no_name' };
  const domain = costaRicaWebsiteDomain(params.entity.website ?? null);
  const kind: CrDirectoryKind = 'public_entity';
  return {
    row: baseRow({
      cedula,
      legalName,
      city: null,
      region: null,
      priority: CR_PUBLIC_ENTITY_PRIORITY_BASE + Math.min(Math.max(params.entity.purchaseRequests, 0), 499_999),
      raw: {
        directory_kind: kind,
        macro_industry_key: CR_PUBLIC_ENTITY_MACRO,
        activity_text: 'Sector público',
        purchase_requests: params.entity.purchaseRequests,
        ...(cleanText(params.entity.acronym) ? { acronym: cleanText(params.entity.acronym) } : {}),
        ...(domain ? { website_domain: domain } : {}),
      },
      sourceYear: params.sourceYear,
      importedAt: params.importedAt,
    }),
  };
}

/**
 * Una fila por cédula: manda la entidad pública, después Zona Franca y después
 * SICOP (las demás fuentes de la misma cédula se descartan).
 */
export function mergeCrFreeDirectoryRows(rows: readonly CrFreeDirectoryRow[]): CrFreeDirectoryRow[] {
  const rank: Record<string, number> = { public_entity: 0, zona_franca: 1, sicop_supplier: 2 };
  const byCedula = new Map<string, CrFreeDirectoryRow>();
  for (const row of rows) {
    const current = byCedula.get(row.tax_id);
    const r = rank[String(row.raw_data.directory_kind)] ?? 9;
    if (current === undefined || r < (rank[String(current.raw_data.directory_kind)] ?? 9)) byCedula.set(row.tax_id, row);
  }
  return [...byCedula.values()].sort((a, b) => a.tax_id.localeCompare(b.tax_id));
}
