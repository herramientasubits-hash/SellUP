/**
 * Perú — OECE Contrataciones Abiertas (OCDS, SEACE), cargadas en
 * `public_procurement_supplier_links` con el cargador genérico (`pe.loader.ts`).
 * Industria por UNSPSC (tabla aprobada); trabajadores y web de SUNAT.
 */

import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from './types';

export const PE_OECE_SOURCE_KEY = 'pe_oece_contracts';
/** ~US$10 mil a PEN 3,4. */
export const PE_MIN_PAIR_AMOUNT_PEN = 34_000;

/** RUC de persona jurídica: 11 dígitos que empiezan por 20 (10 = persona natural). */
const COMPANY_RUC = /^20\d{9}$/;

/**
 * Entidades del Estado con RUC 20 (también salen como proveedoras de otras entidades:
 * convenios). Las que además compran en el OCDS se sacan igual por su RUC de comprador.
 */
const PUBLIC_ENTITY_NAME =
  /^(MUNICIPALIDAD|MINISTERIO|GOBIERNO REGIONAL|HOSPITAL|RED DE SALUD|RED ASISTENCIAL|DIRECCION|UNIDAD EJECUTORA|INSTITUTO NACIONAL|INSTITUTO REGIONAL|UNIVERSIDAD NACIONAL|SUPERINTENDENCIA|PROGRAMA NACIONAL|PROGRAMA DE|PROYECTO ESPECIAL|SEGURO SOCIAL|ORGANISMO|AUTORIDAD|SERVICIO NACIONAL|CENTRO NACIONAL|CORTE SUPERIOR|PODER JUDICIAL|MINISTERIO PUBLICO|CONTRALORIA|DEFENSORIA|JURADO NACIONAL|OFICINA NACIONAL|REGISTRO NACIONAL|FONDO NACIONAL|COMISION NACIONAL|CONGRESO|PRESIDENCIA|EJERCITO|MARINA DE GUERRA|FUERZA AEREA|POLICIA NACIONAL|BENEFICENCIA|SOCIEDAD DE BENEFICENCIA|CAJA DE PENSIONES|ZONA REGISTRAL|GERENCIA REGIONAL|ARCHIVO GENERAL|BIBLIOTECA NACIONAL|INSTITUTO GEOLOGICO|INSTITUTO DEL MAR|INSTITUTO PERUANO)\b/;

/** Consorcios: unión temporal, no la empresa a prospectar (muchos sin RUC propio). */
const CONSORTIUM_NAME = /^\s*["'«]?\s*CONSORCIO\b/;

/** «PE-RUC-20512831983» / «20512831983» → RUC de 11 dígitos, o `null`. */
export function parsePeRuc(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase().replace(/^PE-RUC-/, '') : '';
  return /^\d{11}$/.test(text) ? text : null;
}

/** ¿Es este proveedor una EMPRESA (no persona natural, consorcio ni entidad pública)? */
export function isPeCompanySupplier(ruc: string, name: string): boolean {
  if (!COMPANY_RUC.test(ruc)) return false;
  const upper = normalizePublicEntityName(name);
  return !CONSORTIUM_NAME.test(upper) && !PUBLIC_ENTITY_NAME.test(upper);
}

export const PE_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'PE',
  sourceKey: PE_OECE_SOURCE_KEY,
  taxIdentifierType: 'RUC',
  currency: 'PEN',
  minPairAmount: PE_MIN_PAIR_AMOUNT_PEN,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: UNSPSC_CLASSIFIER,
  // El directorio SUNAT trae web (169 de 3.069) y trabajadores; el registro, trabajadores
  // para casi todo RUC. La lista curada del Perú no trae RUC: no sirve aquí.
  domainSourceKeys: ['pe_sunat_directory'],
  workersSourceKeys: ['pe_sunat_directory', 'pe_sunat_registry'],
  workersSourceLabel: 'SUNAT',
};
