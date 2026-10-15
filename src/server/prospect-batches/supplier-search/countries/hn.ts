/**
 * Honduras — ONCAE/HonduCompras (OCDS), cargadas en `public_procurement_supplier_links`
 * con el cargador genérico (`hn.loader.ts`). Industria por UNSPSC (tabla aprobada); web
 * del directorio de HonduCompras; sin trabajadores oficiales en SellUp.
 */

import {
  hondurasNameCore,
  hondurasPublicEntityKey,
  isHondurasPublicEntityCore,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-name-keys';
import {
  cleanHondurasSupplierName,
  normalizeHondurasJuridicalRtn,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-rtn-registry-rows';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from './types';

export const HN_ONCAE_SOURCE_KEY = 'hn_oncae_awards';
/** ~US$10 mil a HNL 26. */
export const HN_MIN_PAIR_AMOUNT_HNL = 260_000;

const CONSORTIUM_NAME = /^\s*["'«]?\s*CONSORCIO\b/;

/**
 * Nombre de la institución compradora: la clave pública del registro de entidades
 * («Secretaría de Estado en el Despacho de Salud Pública (SESAL)» → «SECRETARIA SALUD
 * PUBLICA», «Municipalidad de Omoa, Cortés» → «ALCALDIA OMOA»), así «Secretaría de Salud»
 * la reconoce por el comienzo; si no es una entidad conocida, su núcleo sin siglas.
 */
export function normalizeHnBuyerName(raw: string): string {
  return hondurasPublicEntityKey(raw) ?? hondurasNameCore(raw);
}

/**
 * RTN de persona jurídica (14 dígitos, el 5.º es 9) que no sea consorcio ni entidad del
 * Estado; las personas naturales comparten formato pero no llevan el 9.
 */
export function hnCompanySupplier(rawId: unknown, rawName: unknown): { rtn: string; name: string } | null {
  const rtn = normalizeHondurasJuridicalRtn(rawId);
  const name = cleanHondurasSupplierName(typeof rawName === 'string' ? rawName : '');
  if (!rtn || !name) return null;
  const core = hondurasNameCore(name);
  if (CONSORTIUM_NAME.test(core) || isHondurasPublicEntityCore(core)) return null;
  return { rtn, name };
}

export const HN_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'HN',
  sourceKey: HN_ONCAE_SOURCE_KEY,
  taxIdentifierType: 'RTN',
  currency: 'HNL',
  minPairAmount: HN_MIN_PAIR_AMOUNT_HNL,
  normalizeBuyerName: normalizeHnBuyerName,
  classifier: UNSPSC_CLASSIFIER,
  // Directorio de HonduCompras: 441 de 1.272 con web (RTN de 14 dígitos, igual que aquí).
  domainSourceKeys: ['hn_honducompras_directory'],
  workersSourceKeys: [],
};
