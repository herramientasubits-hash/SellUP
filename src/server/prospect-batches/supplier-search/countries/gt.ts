/**
 * Guatemala — Guatecompras (OCDS del Ministerio de Finanzas), cargadas en
 * `public_procurement_supplier_links` con el cargador genérico (`gt.loader.ts`).
 * Industria por UNSPSC (tabla aprobada); web del directorio de Guatecompras; sin
 * trabajadores oficiales en SellUp.
 */

import { canonicalGuatemalaNit } from '@/server/source-catalog/connectors/gt-guatecompras/gt-nit';
import { isGtSatPersonName } from '@/server/source-catalog/connectors/gt-guatecompras/gt-sources-rows';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from './types';

export const GT_GUATECOMPRAS_SOURCE_KEY = 'gt_guatecompras_awards';
/** ~US$10 mil a GTQ 7,7. */
export const GT_MIN_PAIR_AMOUNT_GTQ = 77_000;

/** Uniones de personas, no la empresa a prospectar («… COPROPIEDAD», «…, NEGOCIO EN PARTICIPACIÓN»). */
const CONSORTIUM_NAME = /^\s*["'«]?\s*CONSORCIO\b|\bCOPROPIEDAD\b|\bNEGOCIO EN PARTICIPACION\b/;

/** Entidades del Estado que también salen como proveedoras (las que compran se sacan por su NIT). */
const PUBLIC_ENTITY_NAME =
  /^(MUNICIPALIDAD|MINISTERIO|SECRETARIA|INSTITUTO GUATEMALTECO|INSTITUTO NACIONAL|UNIVERSIDAD DE SAN CARLOS|ORGANISMO JUDICIAL|CONGRESO|CONTRALORIA|PROCURADURIA|SUPERINTENDENCIA|EMPRESA MUNICIPAL|EMPRESA PORTUARIA|EMPRESA GUATEMALTECA DE TELECOMUNICACIONES|EMPRESA ELECTRICA MUNICIPAL|INSTITUTO NACIONAL DE ELECTRIFICACION|TRIBUNAL|CORTE|REGISTRO GENERAL|FONDO|CONSEJO|COMITE|MANCOMUNIDAD|HOSPITAL NACIONAL|DIRECCION GENERAL|BANCO DE GUATEMALA|CREDITO HIPOTECARIO NACIONAL|INDUSTRIA MILITAR|TALLER NACIONAL|INSTITUTO DE PREVISION)\b/;

/** «GT-NIT-12513687» → NIT canónico si el dígito verificador cuadra. */
export function parseGtNit(raw: unknown): string | null {
  return canonicalGuatemalaNit(typeof raw === 'string' ? raw : null);
}

/**
 * Proveedor EMPRESA: NIT válido, nombre que no sea de persona («APELLIDO,APELLIDO,,NOMBRE»
 * sin forma societaria), ni consorcio/copropiedad, ni entidad del Estado.
 */
export function gtCompanySupplier(rawId: unknown, rawName: unknown): { nit: string; name: string } | null {
  const nit = parseGtNit(rawId);
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim() : '';
  if (!nit || !name || isGtSatPersonName(name)) return null;
  const upper = normalizePublicEntityName(name);
  if (CONSORTIUM_NAME.test(upper) || PUBLIC_ENTITY_NAME.test(upper)) return null;
  return { nit, name };
}

export const GT_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'GT',
  sourceKey: GT_GUATECOMPRAS_SOURCE_KEY,
  taxIdentifierType: 'NIT',
  currency: 'GTQ',
  minPairAmount: GT_MIN_PAIR_AMOUNT_GTQ,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: UNSPSC_CLASSIFIER,
  // Directorio de Guatecompras: 748 de 1.705 con web (NIT canónico, «K» en mayúscula).
  domainSourceKeys: ['gt_guatecompras_directory'],
  workersSourceKeys: [],
};
