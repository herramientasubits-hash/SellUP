/**
 * México — contratos de la Plataforma Integral Compras MX (datos abiertos de la Secretaría
 * Anticorrupción y Buen Gobierno, archivos anuales 2025 y 2026), cargados en
 * `public_procurement_supplier_links` con el cargador genérico (`--country MX`).
 * Comprador = institución (clave de Compras MX, p. ej. «050GYR» = IMSS). Industria por la
 * partida del gasto (tabla BORRADOR `mx-partida-macro-table.ts`). Sin web ni trabajadores
 * por RFC en SellUp: los proveedores van al rescate.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { normalizeMexicoMoralRfc } from '@/server/source-catalog/connectors/compranet-mexico/mx-compranet-rfc-rows';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { MX_PARTIDA_CLASSIFIER } from './mx-partida-macro-table';
import type { LoadedCountrySource } from './types';

export const MX_COMPRASMX_SOURCE_KEY = 'mx_comprasmx_contracts' as const;

/** ~US$10 mil a MXN 18,5. */
export const MX_MIN_PAIR_AMOUNT_MXN = 185_000;

/** Pesos por unidad de moneda extranjera (aprox., oct-2026; sólo para el piso y el orden). */
export const MX_MXN_PER: Readonly<Record<string, number>> = Object.freeze({
  MXN: 1,
  USD: 18.5,
  EUR: 21.5,
  CAD: 13.5,
});

/**
 * Estratificación que el propio proveedor declara en Compras MX (RUPC, criterios de la
 * Secretaría de Economía): MICRO = hasta 10 trabajadores, PEQUEÑA = 11 a 30 en comercio y
 * 11 a 50 en industria y servicios. Por debajo del mínimo de 100 de «Proveedores»: fuera.
 * MEDIANA (hasta 100/250), GRANDE y «NO MIPYME» (grandes y multinacionales) se quedan.
 */
const SMALL_STRATIFICATION = new Set(['MICRO', 'PEQUENA']);

export function isMxSmallStratification(raw: string | null | undefined): boolean {
  return SMALL_STRATIFICATION.has(normalizePublicEntityName(raw ?? ''));
}

/**
 * Entidades públicas que salen como «proveedoras» (convenios entre entidades): casi todas
 * sin forma societaria («CASA DE MONEDA DE MEXICO», «SERVICIO POSTAL MEXICANO»,
 * «GOBIERNO DE LA CIUDAD DE MEXICO») y las empresas de participación estatal que sí la
 * tienen (Birmex, Alimentación para el Bienestar, Agroasemex, IEPSA…). Medido el 15-10.
 */
const MX_PUBLIC_BODY_NAME =
  /^(?:SECRETARIA|SUBSECRETARIA|GOBIERNO|MUNICIPIO|H AYUNTAMIENTO|AYUNTAMIENTO|PODER (?:JUDICIAL|LEGISLATIVO|EJECUTIVO)|INSTITUTO (?:MEXICANO|NACIONAL|DE SEGURIDAD|POLITECNICO|POTOSINO)|UNIVERSIDAD (?:NACIONAL|AUTONOMA|TECNOLOGICA|POLITECNICA|PEDAGOGICA|INTERCULTURAL)|TECNOLOGICO NACIONAL|COLEGIO DE BACHILLERES|COMISION (?:FEDERAL|NACIONAL|ESTATAL)|CFE |PETROLEOS MEXICANOS|PEMEX|TELECOMUNICACIONES DE MEXICO|SERVICIO POSTAL MEXICANO|CASA DE MONEDA|TALLERES GRAFICOS DE MEXICO|IMPRESORA Y ENCUADERNADORA PROGRESO|LABORATORIOS DE BIOLOGICOS Y REACTIVOS DE MEXICO|ALIMENTACION PARA EL BIENESTAR|LECHE PARA EL BIENESTAR|LICONSA|DICONSA|SEGURIDAD ALIMENTARIA MEXICANA|AGROASEMEX|FINANCIERA PARA EL BIENESTAR|BANCO NACIONAL|BANCO DEL BIENESTAR|NACIONAL FINANCIERA|LOTERIA NACIONAL|AEROPUERTOS Y SERVICIOS AUXILIARES|GRUPO AEROPORTUARIO DE LA CIUDAD DE MEXICO|TREN MAYA|FERROCARRIL DEL ISTMO|EXPORTADORA DE SAL|SERVICIOS DE SALUD|HOSPITAL (?:GENERAL|REGIONAL|JUAREZ|INFANTIL)|CENTRO NACIONAL|CENTRO DE INVESTIGACION|ORGANISMO|FIDEICOMISO|SISTEMA (?:NACIONAL|ESTATAL|MUNICIPAL|PARA EL DESARROLLO)|INFOTEC|CORPORACION MEXICANA DE INVESTIGACION EN MATERIALES)\b/;

export function isMxPublicBodyName(name: string): boolean {
  return MX_PUBLIC_BODY_NAME.test(normalizePublicEntityName(name));
}

/**
 * RFC de una EMPRESA mexicana (persona moral, 12 caracteres con fecha válida), o `null`.
 * Fuera personas físicas (13), extranjeros con RFC genérico («EXT…», «XEXX…») y las
 * filas de un país distinto de MX.
 */
export function parseMxCompanyRfc(raw: string | null | undefined, country: string | null | undefined): string | null {
  const countryCode = (country ?? '').trim().toUpperCase();
  if (countryCode && countryCode !== 'MX') return null;
  const rfc = normalizeMexicoMoralRfc(raw);
  if (!rfc || /^(?:EXT|XEX)/.test(rfc)) return null;
  return rfc;
}

const IMSS_BIENESTAR = 'SERVICIOS DE SALUD DEL INSTITUTO MEXICANO DEL SEGURO SOCIAL PARA EL BIENESTAR IMSS BIENESTAR';
const SICT = 'SECRETARIA DE INFRAESTRUCTURA COMUNICACIONES Y TRANSPORTES';

/**
 * Siglas y nombres cortos → el nombre de la institución tal como lo guarda Compras MX
 * (ya normalizado). La búsqueda de la entidad es por nombre exacto o por su comienzo:
 * sin esto «IMSS» o «SICT» no encontrarían nada. Las de más contratos el 15-10-2026.
 * La SICT viene en Compras MX como «INFRAESTRUCTURA, COMUNICACIONES Y TRANSPORTES».
 */
export const MX_BUYER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  IMSS: 'INSTITUTO MEXICANO DEL SEGURO SOCIAL',
  ISSSTE: 'INSTITUTO DE SEGURIDAD Y SERVICIOS SOCIALES DE LOS TRABAJADORES DEL ESTADO',
  'IMSS BIENESTAR': IMSS_BIENESTAR,
  SICT: SICT,
  'INFRAESTRUCTURA COMUNICACIONES Y TRANSPORTES': SICT,
  SEDENA: 'SECRETARIA DE LA DEFENSA NACIONAL',
  SEMAR: 'SECRETARIA DE MARINA',
  SHCP: 'SECRETARIA DE HACIENDA Y CREDITO PUBLICO',
  SEP: 'SECRETARIA DE EDUCACION PUBLICA',
  SSA: 'SECRETARIA DE SALUD',
  SEGOB: 'SECRETARIA DE GOBERNACION',
  SADER: 'SECRETARIA DE AGRICULTURA Y DESARROLLO RURAL',
  SENER: 'SECRETARIA DE ENERGIA',
  STPS: 'SECRETARIA DEL TRABAJO Y PREVISION SOCIAL',
  SRE: 'SECRETARIA DE RELACIONES EXTERIORES',
  SECTUR: 'SECRETARIA DE TURISMO',
  SEMARNAT: 'SECRETARIA DE MEDIO AMBIENTE Y RECURSOS NATURALES',
  SEDATU: 'SECRETARIA DE DESARROLLO AGRARIO TERRITORIAL Y URBANO',
  SABG: 'SECRETARIA ANTICORRUPCION Y BUEN GOBIERNO',
  FGR: 'FISCALIA GENERAL DE LA REPUBLICA',
  IPN: 'INSTITUTO POLITECNICO NACIONAL',
  CONAGUA: 'COMISION NACIONAL DEL AGUA',
  CONAFOR: 'COMISION NACIONAL FORESTAL',
  CAPUFE: 'CAMINOS Y PUENTES FEDERALES DE INGRESOS Y SERVICIOS CONEXOS',
  INAH: 'INSTITUTO NACIONAL DE ANTROPOLOGIA E HISTORIA',
  INBAL: 'INSTITUTO NACIONAL DE BELLAS ARTES Y LITERATURA',
  TECNM: 'TECNOLOGICO NACIONAL DE MEXICO',
});

/** «Instituto Mexicano del Seguro Social», «IMSS» o «I.M.S.S.» → una sola forma. */
export function normalizeMxBuyerName(raw: string): string {
  const name = normalizePublicEntityName(raw);
  return MX_BUYER_ALIASES[name] ?? MX_BUYER_ALIASES[name.replace(/ /g, '')] ?? name;
}

export const MX_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'MX',
  sourceKey: MX_COMPRASMX_SOURCE_KEY,
  taxIdentifierType: 'RFC',
  currency: 'MXN',
  minPairAmount: MX_MIN_PAIR_AMOUNT_MXN,
  normalizeBuyerName: normalizeMxBuyerName,
  classifier: MX_PARTIDA_CLASSIFIER,
  // En Prod (15-10) ninguna fuente mexicana trae web por RFC (mx_compranet_rfc_registry
  // 26.393 y mx_rfc_public_lists_registry 90.954, 0 con web; la lista curada no trae RFC).
  // Se dejan las dos con RFC para que cualquier web que se les sume después se use sola.
  domainSourceKeys: ['mx_compranet_rfc_registry', 'mx_rfc_public_lists_registry'],
  // Sin trabajadores; el tamaño lo filtra el lector con la estratificación declarada.
  workersSourceKeys: [],
  // Las dos guardan el RFC en mayúsculas, 12 caracteres, sin guiones.
};
