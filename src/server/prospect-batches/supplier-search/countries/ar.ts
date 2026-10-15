/**
 * Argentina — adjudicaciones de COMPR.AR (Administración Pública Nacional, datos.gob.ar
 * «Sistema de Contrataciones Electrónicas»), cargadas en `public_procurement_supplier_links`
 * con el cargador genérico (`--country AR`). Comprador = Servicio Administrativo
 * Financiero (SAF). Industria por los «Rubros» de COMPR.AR (tabla aprobada 15-10,
 * `ar-rubro-macro-table.ts`). Web: RNS, ATP y la lista curada; sin trabajadores.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { calculateArgentinaCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { AR_RUBRO_CLASSIFIER } from './ar-rubro-macro-table';
import type { LoadedCountrySource } from './types';

export const AR_COMPRAR_SOURCE_KEY = 'ar_comprar_adjudications' as const;

/**
 * Piso acumulado entidad × proveedor en la ventana: ARS 15 millones. Con ~ARS 1.450 por
 * dólar (oct-2026) son ~US$10 mil; la ventana tiene 12 meses de inflación (~2 % mensual),
 * así que una compra de hace un año pesa algo menos que hoy: un piso fijo y redondo que
 * se revisa en cada recarga semestral, en vez de indexarlo mes a mes.
 */
export const AR_COMPRAR_MIN_PAIR_AMOUNT_ARS = 15_000_000;

/** Pesos por unidad de moneda extranjera (aprox., oct-2026; sólo para el piso y el orden). */
export const AR_ARS_PER: Readonly<Record<string, number>> = Object.freeze({
  'PESO ARGENTINO': 1,
  'DOLAR ESTADOUNIDENSE': 1_450,
  'EURO - EUROPEAN MONETARY UNION': 1_650,
  'LIBRA ESTERLINA': 1_900,
  'FRANCO SUIZO': 1_800,
});

/** «310 - Ministerio de Salud» → «MINISTERIO DE SALUD». */
export function normalizeArBuyerName(raw: string): string {
  return normalizePublicEntityName(raw.replace(/^\s*\d+\s*-\s*/, ''));
}

function validCuit(digits: string): boolean {
  return /^\d{11}$/.test(digits) && calculateArgentinaCheckDigit(digits.slice(0, 10)) === digits[10];
}

/**
 * CUIT del CSV → 11 dígitos válidos, o `null`. Un cuarto de las filas trae 12 dígitos
 * con el verificador repetido al final del cuerpo («30-656088636-6» = 30-65608863-6):
 * se corrige sólo si los 11 primeros forman un CUIT válido y los dos últimos coinciden.
 */
export function parseArCuit(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11) return validCuit(digits) ? digits : null;
  if (digits.length === 12 && digits[10] === digits[11] && validCuit(digits.slice(0, 11))) return digits.slice(0, 11);
  return null;
}

/** CUIT de persona jurídica (30, 33, 34). 20/23/24/27 = personas físicas: fuera. */
export function isArCompanyCuit(cuit: string): boolean {
  return /^3[034]\d{9}$/.test(cuit);
}

/**
 * Organismos públicos que aparecen como proveedores (con CUIT 30-/33-): fuera. También las
 * sociedades del Estado que SellUp ya tiene en su capa de Gobierno (`ar_public_entities`):
 * de los 1.627 proveedores de la ventana medida (15-10), 7 estaban ahí (Banco Nación,
 * Casa de Moneda, Correo Oficial, FAdeA, Tandanor, SEGEMAR, SIGEN) y se excluyen por nombre.
 */
const AR_PUBLIC_BODY_NAME =
  /^(?:MINISTERIO|SECRETARIA|SUBSECRETARIA|MUNICIPALIDAD|GOBIERNO|PROVINCIA DE|ESTADO NACIONAL|PODER (?:JUDICIAL|LEGISLATIVO|EJECUTIVO)|HONORABLE|UNIVERSIDAD (?:NACIONAL|TECNOLOGICA NACIONAL)|INSTITUTO NACIONAL|ADMINISTRACION (?:NACIONAL|FEDERAL|GENERAL)|DIRECCION (?:NACIONAL|GENERAL|PROVINCIAL)|AGENCIA NACIONAL|SERVICIO NACIONAL|COMISION NACIONAL|ENTE NACIONAL|ESTADO MAYOR|EJERCITO ARGENTINO|ARMADA ARGENTINA|FUERZA AEREA|GENDARMERIA|PREFECTURA|POLICIA|TRIBUNAL|CORTE SUPREMA|CONSEJO DE LA MAGISTRATURA|DEFENSORIA|HOSPITAL (?:NACIONAL|PROVINCIAL|MUNICIPAL|PUBLICO)|BANCO CENTRAL|BANCO DE LA NACION|CASA DE MONEDA|CORREO OFICIAL|FABRICA ARGENTINA DE AVIONES|TALLERES NAVALES DARSENA NORTE|SERVICIO GEOLOGICO|SINDICATURA|FABRICACIONES MILITARES|NUCLEOELECTRICA|ENERGIA ARGENTINA|TRENES ARGENTINOS|AGUA Y SANEAMIENTOS ARGENTINOS|EMPRESA ARGENTINA DE SOLUCIONES SATELITALES)\b/;

export function isArPublicBodyName(name: string): boolean {
  return AR_PUBLIC_BODY_NAME.test(normalizePublicEntityName(name));
}

export const AR_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'AR',
  sourceKey: AR_COMPRAR_SOURCE_KEY,
  taxIdentifierType: 'CUIT',
  currency: 'ARS',
  minPairAmount: AR_COMPRAR_MIN_PAIR_AMOUNT_ARS,
  normalizeBuyerName: normalizeArBuyerName,
  classifier: AR_RUBRO_CLASSIFIER,
  // En Prod (15-10): ar_rns 1.657 con web de 6.350, ar_atp_employers 348/2.851, lista curada 131/581.
  domainSourceKeys: ['ar_rns', 'ar_atp_employers', 'latam_curated_directory'],
  // Ninguna fuente argentina cargada trae `workers`.
  workersSourceKeys: [],
  // Todas guardan el CUIT en 11 dígitos sin guiones.
};
