/**
 * Paraguay — DNCP (OCDS), adjudicaciones cargadas en `public_procurement_supplier_links`
 * con el cargador genérico (`py.loader.ts`, ZIP masivo «awa» por año).
 *
 * Iba a ser «live» (API v3), pero la búsqueda por comprador sólo devuelve el id de la
 * adjudicación y el proveedor —sin monto ni ítems/UNSPSC— y sacarlos exige una llamada
 * por proceso (MSPBS: 273 en 12 meses) con un tope sin token de 15 llamadas/min: inviable
 * en una corrida (medido el 15-10-2026). Con token de la DNCP podría volver a vivo.
 * Industria por UNSPSC (tabla aprobada, la de Paraguay); web del directorio DNCP.
 */

import { isConsortiumSupplierName, normalizePublicEntityName } from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from './types';

export const PY_DNCP_AWARDS_SOURCE_KEY = 'py_dncp_awards';
/** ~US$10 mil a PYG 7.800. */
export const PY_MIN_PAIR_AMOUNT_PYG = 78_000_000;

/** RUC de persona jurídica con dígito verificador (≥ 80.000.000; menor = persona física). */
const COMPANY_RUC = /^80\d{6}-\d$/;
const PUBLIC_ENTITY_NAME =
  /^(MINISTERIO|MUNICIPALIDAD|GOBERNACION|SECRETARIA|ADMINISTRACION NACIONAL|UNIVERSIDAD NACIONAL|INSTITUTO DE PREVISION SOCIAL|PETROLEOS PARAGUAYOS|COMPANIA PARAGUAYA DE COMUNICACIONES|EMPRESA DE SERVICIOS SANITARIOS DEL PARAGUAY|INDUSTRIA NACIONAL DEL CEMENTO|DIRECCION NACIONAL|BANCO CENTRAL DEL PARAGUAY|BANCO NACIONAL DE FOMENTO|CORTE SUPREMA|CONGRESO|PODER JUDICIAL|ITAIPU|ENTIDAD BINACIONAL YACYRETA)\b/;

/** «PY-RUC-80012331-0» → «80012331-0» (como `py_dncp_directory.tax_id`) si es de empresa. */
export function pyCompanySupplier(rawId: unknown, rawName: unknown): { ruc: string; name: string } | null {
  const ruc = typeof rawId === 'string' ? rawId.trim().toUpperCase().replace(/^PY-RUC-/, '') : '';
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim() : '';
  if (!COMPANY_RUC.test(ruc) || !name) return null;
  const upper = normalizePublicEntityName(name);
  if (isConsortiumSupplierName(name) || PUBLIC_ENTITY_NAME.test(upper)) return null;
  return { ruc, name };
}

export const PY_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'PY',
  sourceKey: PY_DNCP_AWARDS_SOURCE_KEY,
  taxIdentifierType: 'RUC',
  currency: 'PYG',
  minPairAmount: PY_MIN_PAIR_AMOUNT_PYG,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: UNSPSC_CLASSIFIER,
  // Directorio DNCP: 820 de 1.127 con web, RUC con guion («80001900-8»). La lista curada
  // de Paraguay no trae RUC y el registro SET no trae web.
  domainSourceKeys: ['py_dncp_directory'],
  workersSourceKeys: [],
};
