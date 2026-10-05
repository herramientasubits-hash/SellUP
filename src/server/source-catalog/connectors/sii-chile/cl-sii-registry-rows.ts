/**
 * cl-sii-registry-rows.ts — filas de `cl_sii_registry`: personas jurídicas de
 * Chile según el Servicio de Impuestos Internos (SII), para el RUT por nombre
 * dentro de la corrida del Agente 1 y, con su tamaño, para la capa gratuita.
 *
 * SOURCES-CL-SII-REGISTRY-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Tres archivos públicos y gratuitos del SII (sii.cl › Nómina de personas
 * jurídicas, texto separado por tabulador, UTF-8):
 *   1. PUB_NOMBRES_PJ: RUT | DV | COD_SUBTIPO | RAZON_SOCIAL | FECHA_INICIO_VIG |
 *      FECHA_TG_VIG (término de giro). Todas las personas jurídicas desde 1993.
 *   2. PUB_EMPRESAS_PJ_<año>: tramo según ventas, número de trabajadores
 *      dependientes informados, actividad económica (texto), etc.
 *   3. PUB_NOM_ACTECOS: código de actividad de 6 dígitos por RUT.
 *
 * Entran las personas jurídicas SIN término de giro, salvo las de una sola
 * persona o sin personalidad jurídica (EIRL, sociedades de hecho, comunidades,
 * sucesiones) y organizaciones vecinales o deportivas muy pequeñas. Universidades,
 * organismos públicos, municipalidades y fundaciones SÍ entran: también son
 * clientes de UBITS.
 *
 * «Trabajadores dependientes informados» no es el tamaño total de la empresa: es
 * un estimado oficial con su año, nunca un dato confirmado.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeChileCompanyCore, normalizeChileRut } from '../res-chile/cl-res-registry-row';

export const CL_SII_REGISTRY_SOURCE_KEY = 'cl_sii_registry' as const;

/**
 * SOURCES-CL-PUBLIC-ENTITY-ALIASES-1 — el SII escribe distinto a los organismos
 * públicos que Apollo y Tavily (medido en la corrida de Chile del 05-10):
 *   «I MUNICIPALIDAD DE CURICO»  ↔ «Municipalidad de Curicó»  (I / ILUSTRE)
 *   «SERVICIO NACIONAL DE SALUD HOSPITAL CARLOS VAN BUREN» ↔ «Hospital Carlos Van Buren»
 *   «SERVICIO SALUD ARAUCANIA HOSPITAL DE COLLIPULLI»      ↔ «Hospital de Collipulli»
 * El mismo núcleo para los dos lados: sin «I»/«ILUSTRE» delante de MUNICIPALIDAD
 * y, si un nombre que empieza por SERVICIO contiene HOSPITAL, desde HOSPITAL.
 */
export function canonicalizeChilePublicEntityCore(core: string): string {
  const municipality = /^(?:I|ILUSTRE) (MUNICIPALIDAD\b.*)$/.exec(core);
  if (municipality) return municipality[1];
  if (core.startsWith('SERVICIO ')) {
    const at = core.indexOf(' HOSPITAL ');
    if (at > 0) return core.slice(at + 1);
  }
  return core;
}

/** Núcleo del SII: el de Chile + los organismos públicos con su forma común. */
export function normalizeChileSiiCore(name: string | null | undefined): string {
  return canonicalizeChilePublicEntityCore(normalizeChileCompanyCore(name));
}
export const CL_SII_REGISTRY_COUNTRY_CODE = 'CL' as const;

/**
 * Subtipos que NO se cargan: EIRL (212), sin personalidad jurídica (311-315:
 * sociedades de hecho, comunidades de edificios, sucesiones…), juntas de vecinos
 * (811), clubes deportivos (812), sindicatos (816) y «otra OSFL» (818).
 */
export const CL_SII_EXCLUDED_SUBTYPES: ReadonlySet<string> = new Set([
  '212', '311', '312', '313', '314', '315', '811', '812', '816', '818',
]);

export type ClSiiNameRecord = {
  rut: string;
  subtype: string;
  legalName: string;
  terminated: boolean;
};

export type ClSiiMetrics = {
  year: number;
  /** Tramo según ventas del SII (1-13; 10-13 = gran empresa). */
  salesBracket: string | null;
  workers: number | null;
  activity: string | null;
};

export type ClSiiRegistryRow = {
  source_key: typeof CL_SII_REGISTRY_SOURCE_KEY;
  country_code: typeof CL_SII_REGISTRY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

function text(value: string | undefined): string | null {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : null;
}

/** Línea de PUB_NOMBRES_PJ → registro, o `null` (cabecera o línea incompleta). */
export function parseClSiiNamesLine(line: string): ClSiiNameRecord | null {
  const cells = line.replace(/\r$/, '').split('\t');
  if (cells.length < 4) return null;
  const rut = normalizeChileRut(`${cells[0].trim()}-${cells[1].trim()}`);
  const legalName = text(cells[3]);
  if (rut === null || legalName === null) return null;
  return { rut, subtype: cells[2].trim(), legalName, terminated: text(cells[5]) !== null };
}

/** Línea de PUB_EMPRESAS_PJ_<año> → [RUT, métricas], o `null`. */
export function parseClSiiCompanyLine(line: string): [string, ClSiiMetrics] | null {
  const cells = line.replace(/\r$/, '').split('\t');
  if (cells.length < 17) return null;
  const year = Number(cells[0]);
  const rut = normalizeChileRut(`${cells[1].trim()}-${cells[2].trim()}`);
  if (rut === null || !Number.isInteger(year)) return null;
  const workers = /^\d+$/.test(cells[5].trim()) ? Number(cells[5].trim()) : null;
  return [rut, { year, salesBracket: text(cells[4]), workers, activity: text(cells[16]) }];
}

/** Línea de PUB_NOM_ACTECOS → [RUT, código de 6 dígitos], o `null`. */
export function parseClSiiActivityLine(line: string): [string, string] | null {
  const cells = line.replace(/\r$/, '').split('\t');
  if (cells.length < 3) return null;
  const rut = normalizeChileRut(`${cells[0].trim()}-${cells[1].trim()}`);
  const code = cells[2].trim();
  return rut !== null && /^\d{6}$/.test(code) ? [rut, code] : null;
}

/** Registro del SII (+ métricas y código de actividad si los hay) → fila, o `null`. */
export function buildClSiiRegistryRow(
  record: ClSiiNameRecord,
  metrics: ClSiiMetrics | null,
  activityCode: string | null,
  params: { sourceYear: number; importedAt: string },
): ClSiiRegistryRow | null {
  if (record.terminated || CL_SII_EXCLUDED_SUBTYPES.has(record.subtype)) return null;
  const core = normalizeChileSiiCore(record.legalName);
  if (core.length < 2) return null;

  // raw_data mínimo: sólo los campos presentes (la tabla ya pesa ~250 B por fila).
  const raw: Record<string, unknown> = { subtype: record.subtype };
  if (metrics !== null) {
    raw.metrics_year = metrics.year;
    if (metrics.workers !== null) raw.workers = metrics.workers;
    if (metrics.salesBracket !== null) raw.sales_bracket = metrics.salesBracket;
    if (metrics.activity !== null) raw.activity = metrics.activity;
  }
  if (activityCode !== null) raw.activity_code = activityCode;

  const identity = deriveTaxRecordIdentity(record.rut);
  return {
    source_key: CL_SII_REGISTRY_SOURCE_KEY,
    country_code: CL_SII_REGISTRY_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: record.rut,
    normalized_tax_id: record.rut,
    legal_name: record.legalName,
    normalized_legal_name: core,
    raw_data: raw,
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
