/**
 * ec-sri-registry-rows.ts — filas de `source_company_snapshots` desde el catastro
 * de RUC del Servicio de Rentas Internas (SRI) de Ecuador, para el RUC por nombre
 * dentro de la corrida del Agente 1.
 *
 * SOURCES-EC-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Fuente: datos abiertos del SRI, un CSV por provincia separado por «|»
 * (`descargas.sri.gob.ec/download/datosAbiertos/SRI_RUC_<Provincia>.csv`), una fila
 * por establecimiento: RUC, razón social, estado, tipo de contribuyente, número y
 * nombre comercial del establecimiento, provincia, cantón y CIIU.
 *
 * La Superintendencia de Compañías sólo registra compañías. El SRI cubre lo que
 * le falta al Agente 1:
 *   - entidades PÚBLICAS (RUC con tercer dígito 6): municipios, prefecturas,
 *     juntas parroquiales, ministerios, hospitales, universidades públicas,
 *     empresas públicas «EP»;
 *   - sociedades fuera de la SCVS (tercer dígito 9): bancos, cooperativas,
 *     fundaciones, colegios y universidades particulares;
 *   - el NOMBRE COMERCIAL («SUPERMAXI», «CLARO»), que es como Apollo y Tavily
 *     nombran a muchas empresas.
 *
 * Dos fuentes:
 *   - `ec_sri_registry`: razón social limpia (`normalizeEcEntityCore`: los gobiernos
 *     locales en forma canónica «GAD MUNICIPAL CELICA»).
 *   - `ec_sri_trade_name_registry`: el nombre comercial del establecimiento
 *     principal, si es distinto de la razón social. Por sí solo es una PISTA (como
 *     el nombre comercial de la DGII en RD); sólo da RUC seguro si la empresa es
 *     grande según la Superintendencia (`largeCompanyStrongMinWorkers`).
 *
 * Sólo contribuyentes ACTIVOS con RUC de sociedad. Las personas naturales
 * (tercer dígito 0-5) NUNCA entran: su RUC es su cédula.
 *
 * 🔴 No se guarda dirección, teléfono, correo ni representante.
 */

import { deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import { normalizeEcEntityCore } from './ec-entity-name-core';
import type { EcRankingMetrics } from './ec-scvs-directory-rows';
import { ecWorkforceFields } from './ec-scvs-registry-rows';

export const EC_SRI_REGISTRY_SOURCE_KEY = 'ec_sri_registry' as const;
export const EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY = 'ec_sri_trade_name_registry' as const;
const EC = 'EC' as const;

/** RUC de sociedad privada (9) o pública (6): provincia válida + 8 dígitos + 001. */
const SOCIETY_RUC = /^(0[1-9]|1[0-9]|2[0-4]|30)[69]\d{7}001$/;

/** Nombre comercial más corto que esto no identifica a nadie. */
const MIN_TRADE_NAME_CORE = 3;

/**
 * Nombres comerciales que no son una marca: el SRI los acepta como texto libre
 * («MATRIZ», «OFICINA», «S/N»…).
 */
const GENERIC_TRADE_NAMES: ReadonlySet<string> = new Set([
  'MATRIZ', 'OFICINA', 'OFICINA MATRIZ', 'SUCURSAL', 'NINGUNO', 'NINGUNA', 'S N', 'SN', 'NA', 'N A',
  'NO TIENE', 'SIN NOMBRE', 'BODEGA', 'LOCAL', 'ADMINISTRACION', 'PLANTA', 'ESTABLECIMIENTO',
]);

/** Una fila del catastro (por establecimiento), reducida a lo que se usa. */
export type EcSriRecord = {
  ruc: string;
  legalName: string;
  status: string;
  establishment: number | null;
  tradeName: string;
  province: string;
  canton: string;
  ciiuCode: string | null;
};

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();

/** Fila del CSV (objeto por cabecera) → registro, o `null` si falta RUC o razón social. */
export function readEcSriLine(row: Readonly<Record<string, unknown>>): EcSriRecord | null {
  const ruc = text(row['NUMERO_RUC']).replace(/\D/g, '');
  const legalName = text(row['RAZON_SOCIAL']);
  if (ruc === '' || legalName === '') return null;
  const establishment = Number(text(row['NUMERO_ESTABLECIMIENTO']));
  const ciiu = text(row['CODIGO_CIIU']).toUpperCase();
  return {
    ruc,
    legalName,
    status: text(row['ESTADO_CONTRIBUYENTE']).toUpperCase(),
    establishment: Number.isInteger(establishment) && establishment > 0 ? establishment : null,
    tradeName: text(row['NOMBRE_FANTASIA_COMERCIAL']),
    province: text(row['DESCRIPCION_PROVINCIA_EST']),
    canton: text(row['DESCRIPCION_CANTON_EST']),
    ciiuCode: /^[A-U]\d{4,6}$/.test(ciiu) ? ciiu : null,
  };
}

/** ¿Entra? ACTIVO + RUC de sociedad (privada o pública). */
export function admitEcSriRecord(record: EcSriRecord): boolean {
  return record.status === 'ACTIVO' && SOCIETY_RUC.test(record.ruc);
}

/**
 * Lo que se guarda de un RUC: su razón social y el establecimiento principal (el
 * de número más bajo que trae nombre comercial). Acumula fila a fila. Puro.
 */
export type EcSriEntry = { main: EcSriRecord; tradeName: string | null; tradeEstablishment: number | null };

export function accumulateEcSriEntry(previous: EcSriEntry | undefined, next: EcSriRecord): EcSriEntry {
  const nextTrade = next.tradeName !== '' ? next.tradeName : null;
  const nextNumber = next.establishment ?? Number.MAX_SAFE_INTEGER;
  if (previous === undefined) {
    return { main: next, tradeName: nextTrade, tradeEstablishment: nextTrade ? nextNumber : null };
  }
  const main = nextNumber < (previous.main.establishment ?? Number.MAX_SAFE_INTEGER) ? next : previous.main;
  const better = nextTrade !== null && (previous.tradeEstablishment === null || nextNumber < previous.tradeEstablishment);
  return {
    main,
    tradeName: better ? nextTrade : previous.tradeName,
    tradeEstablishment: better ? nextNumber : previous.tradeEstablishment,
  };
}

export type EcSriRegistryRow = {
  source_key: typeof EC_SRI_REGISTRY_SOURCE_KEY | typeof EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY;
  country_code: typeof EC;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  region: string | null;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * Filas de un RUC admitido. `metrics` = su último año en el ranking de la
 * Superintendencia, si lo tiene: así un banco o un nombre comercial también
 * llevan el tamaño oficial (mismo formato que Chile: `workers`, `metrics_year`).
 */
export function buildEcSriRegistryRows(params: {
  entry: EcSriEntry;
  metrics: EcRankingMetrics | null;
  sourceYear: number;
  importedAt: string;
}): EcSriRegistryRow[] {
  const { entry, metrics, sourceYear, importedAt } = params;
  const { main } = entry;
  const core = normalizeEcEntityCore(main.legalName);
  if (core.length === 0) return [];
  const identity = deriveTaxRecordIdentity(main.ruc);
  const workforce = ecWorkforceFields(metrics);
  const base = {
    country_code: EC,
    source_year: sourceYear,
    tax_id: main.ruc,
    normalized_tax_id: main.ruc,
    legal_name: main.legalName,
    sector: main.ciiuCode,
    city: main.canton || null,
    region: main.province || null,
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
  const raw = {
    tax_identifier_type: 'RUC',
    sector_type: main.ruc[2] === '6' ? 'public' : 'private',
    ciiu_code: main.ciiuCode,
    ...workforce,
    source_type: 'sri_ruc_registry',
  };

  const rows: EcSriRegistryRow[] = [
    { ...base, source_key: EC_SRI_REGISTRY_SOURCE_KEY, normalized_legal_name: core, raw_data: raw },
  ];
  const tradeCore = entry.tradeName ? normalizeEcEntityCore(entry.tradeName) : '';
  if (tradeCore.length >= MIN_TRADE_NAME_CORE && tradeCore !== core && !GENERIC_TRADE_NAMES.has(tradeCore)) {
    rows.push({
      ...base,
      source_key: EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY,
      normalized_legal_name: tradeCore,
      raw_data: { ...raw, trade_name: entry.tradeName, source_type: 'sri_trade_name' },
    });
  }
  return rows;
}
