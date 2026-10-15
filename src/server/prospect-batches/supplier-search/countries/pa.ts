/**
 * Panamá — PanamaCompra en Cifras (OCDS mensual de la DGCP), cargado en
 * `public_procurement_supplier_links` con el cargador genérico
 * (`scripts/source-catalog/run-public-procurement-load.ts --country PA`).
 * Industria por el UNSPSC de cada ítem adjudicado (tabla aprobada); web de la capa
 * gratuita (`pa_free_directory`); sin trabajadores oficiales.
 */

import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from './types';

export const PA_PANAMACOMPRA_SOURCE_KEY = 'pa_panamacompra_ocds_awards';
/** El balboa va a la par del dólar: piso ≈ US$10 mil acumulados en la ventana. */
export const PA_PANAMACOMPRA_MIN_PAIR_AMOUNT_PAB = 10_000;

/**
 * RUC tal como lo publica PanamaCompra, sin el dígito verificador pegado
 * («155590028-2-2014 DV 10» → «155590028-2-2014»), en mayúsculas y sin espacios.
 */
export function normalizePaRuc(raw: string | null | undefined): string | null {
  const text = (raw ?? '')
    .toUpperCase()
    .replace(/\s*D\.?\s*V\.?\s*\d{1,2}\s*$/, '')
    .replace(/\s+/g, '')
    .trim();
  return text.length >= 5 ? text : null;
}

/**
 * ¿Es RUC de persona JURÍDICA? Tomo-folio-asiento (o el formato nuevo
 * número-2-año) con el primer bloque de 3 dígitos o más: «44752-77-297090»,
 * «155620936-2-2016», «280-134-61098». Las personas naturales usan la cédula
 * (primer bloque = provincia 1-13, o letras E/N/PE/AV/PI) y las entidades públicas
 * llevan «NT» («8-NT-1-13653»): ninguna de las dos pasa.
 */
export function isPaCompanyRuc(ruc: string): boolean {
  return /^\d{3,}-\d{1,4}-\d{1,7}$/.test(ruc);
}

export const PA_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'PA',
  sourceKey: PA_PANAMACOMPRA_SOURCE_KEY,
  taxIdentifierType: 'RUC',
  currency: 'PAB',
  minPairAmount: PA_PANAMACOMPRA_MIN_PAIR_AMOUNT_PAB,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: UNSPSC_CLASSIFIER,
  // `pa_free_directory` guarda el RUC igual que PanamaCompra (65 con web medidas 15-10);
  // el registro de RUC no trae web ni trabajadores.
  domainSourceKeys: ['pa_free_directory'],
  workersSourceKeys: [],
};
