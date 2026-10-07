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
 *   - `ec_sri_trade_name_registry`: hasta 3 marcas por RUC, las que más
 *     establecimientos usan (SOURCES-EC-CLOSE-2: Favorita → SUPERMAXI, AKI…;
 *     El Rosado → MI COMISARIATO…). Por sí solo es una PISTA (como
 *     el nombre comercial de la DGII en RD); sólo da RUC seguro si la empresa es
 *     grande según la Superintendencia (`largeCompanyStrongMinWorkers`).
 *
 * Sólo contribuyentes ACTIVOS con RUC de sociedad. Las personas naturales
 * (tercer dígito 0-5) NUNCA entran: su RUC es su cédula.
 *
 * 🔴 No se guarda dirección, teléfono, correo ni representante.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import { normalizeEcEntityCore } from './ec-entity-name-core';
import type { EcRankingMetrics } from './ec-scvs-directory-rows';
import { ecWorkforceFields } from './ec-scvs-registry-rows';

export const EC_SRI_REGISTRY_SOURCE_KEY = 'ec_sri_registry' as const;
export const EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY = 'ec_sri_trade_name_registry' as const;
const EC = 'EC' as const;

/** RUC de sociedad privada (9) o pública (6): provincia válida + 8 dígitos + 001. */
const SOCIETY_RUC = /^(0[1-9]|1[0-9]|2[0-4]|30)[69]\d{7}001$/;

/** Espacio de la clave de la 2.ª y 3.ª marca de un RUC (`sri_trade:<RUC>-<n>`). */
const EC_SRI_TRADE_NAME_NAMESPACE = 'sri_trade';

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
  /**
   * `TIPO_CONTRIBUYENTE` del SRI («SOCIEDAD» / «PERSONA NATURAL»). Vacío si el
   * archivo no trae la columna.
   */
  taxpayerType: string;
  establishment: number | null;
  tradeName: string;
  /** El establecimiento está abierto (`ABI`); `CER` = cerrado. */
  establishmentOpen: boolean;
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
    taxpayerType: text(row['TIPO_CONTRIBUYENTE']).toUpperCase(),
    establishment: Number.isInteger(establishment) && establishment > 0 ? establishment : null,
    tradeName: text(row['NOMBRE_FANTASIA_COMERCIAL']),
    establishmentOpen: text(row['ESTADO_ESTABLECIMIENTO']).toUpperCase() === 'ABI',
    province: text(row['DESCRIPCION_PROVINCIA_EST']),
    canton: text(row['DESCRIPCION_CANTON_EST']),
    ciiuCode: /^[A-U]\d{4,6}$/.test(ciiu) ? ciiu : null,
  };
}

/**
 * ¿Entra? ACTIVO + RUC de sociedad (privada o pública) + contribuyente SOCIEDAD.
 *
 * SOURCES-EC-SRI-NO-PERSONS-1 — el tercer dígito NO basta: el catastro tiene
 * ~36.000 PERSONAS NATURALES extranjeras activas con RUC de tercer dígito 6 (el
 * de las entidades públicas; p. ej. «0962420170001 … PERSONA NATURAL»). Medido el
 * 07-10 al recargar: sin esta regla, `ec_sri_registry` habría pasado de 3.232 a
 * 36.271 «públicas». La carga anterior estaba limpia porque los archivos se
 * filtraron a mano; ahora lo garantiza el código.
 */
export function admitEcSriRecord(record: EcSriRecord): boolean {
  return record.status === 'ACTIVO' && record.taxpayerType === 'SOCIEDAD' && SOCIETY_RUC.test(record.ruc);
}

/** Cuántas marcas por RUC se guardan (SOURCES-EC-CLOSE-2). */
export const EC_SRI_MAX_TRADE_NAMES = 3;

/** Conectores: pueden ir DENTRO de una marca («MI COMISARIATO»), nunca solos ni al final. */
const BRAND_CONNECTOR_WORDS: ReadonlySet<string> = new Set(['MI', 'LA', 'EL', 'LOS', 'LAS', 'DE', 'DEL', 'Y', 'TU', 'SU', 'AL', 'P', 'S']);

/**
 * Palabras que describen el local, no la marca («ALMACEN AGROPECUARIO INDIA»,
 * «FARMACIAS CRUZ AZUL», «CENTRO DE …»): nunca abren una marca corta ni son una marca.
 */
const BRAND_DESCRIPTOR_WORDS: ReadonlySet<string> = new Set([
  'SUPER', 'MINI', 'MEGA', 'GRAN', 'PLAZA', 'CENTRO', 'FARMACIA', 'FARMACIAS', 'ALMACEN', 'ALMACENES', 'TIENDA',
  'TIENDAS', 'COMERCIAL', 'BODEGA', 'LOCAL', 'OFICINA', 'SUCURSAL', 'AGENCIA', 'PUNTO', 'ISLA', 'KIOSKO',
  'DISTRIBUIDORA', 'MATRIZ', 'COMPANIA', 'CIA', 'EMPRESA', 'GRUPO', 'CORPORACION', 'CONSORCIO', 'SOCIEDAD',
  'SERVICIOS', 'RESTAURANTE', 'HOTEL', 'PANADERIA', 'FERRETERIA', 'PLANTA', 'GALPON', 'HACIENDA', 'FINCA',
]);

/**
 * Lo que se guarda de un RUC: su razón social (del establecimiento de número más
 * bajo) y, para las marcas, cuántos establecimientos usan cada una. Cada nombre
 * comercial suma su forma completa y sus 1-2 primeras palabras («SUPERMAXI CUMBAYA»
 * suma «SUPERMAXI CUMBAYA» y «SUPERMAXI»; nunca un trozo que empieza por una palabra
 * descriptiva ni termina en conector): así la marca que se
 * repite en muchas tiendas («SUPERMAXI», «MI COMISARIATO», «TIA», «CLARO») gana.
 * Un establecimiento abierto pesa 2; uno cerrado, 1. Puro.
 */
export type EcSriEntry = { main: EcSriRecord; tradeScores: ReadonlyMap<string, number> };

/**
 * SOURCES-EC-NAME-MATCH-GAPS-1 — el SRI acepta texto libre como nombre comercial y
 * algunos establecimientos llevan un código, no una marca: un RUC o una cédula
 * («0501161124»), una fecha («14 10 2020») o un número de chasis
 * («…MOSCOSOZCFCB35A6R55817032075»). Una marca con números («1001CARROS», «RADIO
 * UNICA 94 5 FM», «G4S») sí se conserva.
 */
export function isCodeLikeTradeName(core: string): boolean {
  if (!/[A-Z]/.test(core)) return true;
  return core
    .split(' ')
    .some((word) => /^\d{7,}$/.test(word) || (/[A-Z]/.test(word) && (word.match(/\d/g)?.length ?? 0) >= 5));
}

/** Formas de un nombre comercial que pueden ser la marca. */
export function ecTradeNameKeys(tradeName: string): string[] {
  const core = normalizeEcEntityCore(tradeName);
  if (core.length < MIN_TRADE_NAME_CORE || isCodeLikeTradeName(core)) return [];
  const words = core.split(' ').filter((w) => w.length > 0);
  const keys = new Set<string>([core]);
  const [first, second] = words;
  const opensBrand = !BRAND_DESCRIPTOR_WORDS.has(first);
  if (words.length > 1 && opensBrand && !BRAND_CONNECTOR_WORDS.has(first) && first.length >= MIN_TRADE_NAME_CORE) {
    keys.add(first);
  }
  if (words.length > 2 && opensBrand && !BRAND_CONNECTOR_WORDS.has(second) && second.length >= MIN_TRADE_NAME_CORE) {
    keys.add(`${first} ${second}`);
  }
  return [...keys].filter(
    (k) => k.length >= MIN_TRADE_NAME_CORE && !GENERIC_TRADE_NAMES.has(k) && !BRAND_DESCRIPTOR_WORDS.has(k),
  );
}

export function accumulateEcSriEntry(previous: EcSriEntry | undefined, next: EcSriRecord): EcSriEntry {
  const nextNumber = next.establishment ?? Number.MAX_SAFE_INTEGER;
  const main =
    previous === undefined || nextNumber < (previous.main.establishment ?? Number.MAX_SAFE_INTEGER) ? next : previous.main;
  const scores = new Map(previous?.tradeScores ?? []);
  if (next.tradeName !== '') {
    const weight = next.establishmentOpen ? 2 : 1;
    for (const key of ecTradeNameKeys(next.tradeName)) scores.set(key, (scores.get(key) ?? 0) + weight);
  }
  return { main, tradeScores: scores };
}

/**
 * Las marcas de un RUC, de la más usada a la menos (empate: la más larga, que es la
 * marca completa: «FARMACIAS CRUZ AZUL» antes que un trozo suyo). Nunca la razón social; nunca una forma que sólo amplía una
 * marca ya elegida con el nombre de la tienda («SUPERMAXI EL INCA» tras «SUPERMAXI»).
 */
export function pickEcTradeNames(entry: EcSriEntry, legalCore: string): string[] {
  // Ni la razón social ni un trozo de ella («CORPORACION» de «CORPORACION FAVORITA»).
  const ranked = [...entry.tradeScores]
    .filter(([key]) => key !== legalCore && !legalCore.startsWith(`${key} `))
    .sort(([a, sa], [b, sb]) => sb - sa || b.length - a.length || a.localeCompare(b));
  const picked: string[] = [];
  for (const [key] of ranked) {
    if (picked.length >= EC_SRI_MAX_TRADE_NAMES) break;
    if (picked.some((p) => key.startsWith(`${p} `) || p.startsWith(`${key} `))) continue;
    picked.push(key);
  }
  return picked;
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
  // La 1.ª marca conserva la identidad por RUC (una recarga actualiza la fila que ya
  // existe); la 2.ª y la 3.ª llevan su propia clave.
  pickEcTradeNames(entry, core).forEach((tradeCore, index) => {
    const key = index === 0 ? identity : buildRecordIdentityKey(EC_SRI_TRADE_NAME_NAMESPACE, `${main.ruc}-${index + 1}`);
    rows.push({
      ...base,
      source_key: EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY,
      normalized_legal_name: tradeCore,
      raw_data: { ...raw, trade_name: tradeCore, trade_name_rank: index + 1, source_type: 'sri_trade_name' },
      record_identity_key: key.status === 'resolved' ? key.recordIdentityKey : null,
    });
  });
  return rows;
}
