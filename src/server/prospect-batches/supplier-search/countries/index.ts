/**
 * Registro (puro) de los países de «Proveedores de una empresa» por compras públicas.
 * Una línea por país; ver `types.ts` para el contrato.
 */

import { BR_COUNTRY } from './br';
import { CL_COUNTRY } from './cl';
import { CO_COUNTRY } from './co';
import { GT_COUNTRY } from './gt';
import { HN_COUNTRY } from './hn';
import { PE_COUNTRY } from './pe';
import { PY_COUNTRY } from './py';
import { DO_COUNTRY } from './do';
import { PA_COUNTRY } from './pa';
import { AR_COUNTRY } from './ar';
import { UY_COUNTRY } from './uy';
import { ES_COUNTRY } from './es';
import type { PublicBuyerCountrySource } from './types';
import { US_COUNTRY } from './us';

export const PUBLIC_BUYER_COUNTRIES: readonly PublicBuyerCountrySource[] = [
  CO_COUNTRY,
  CL_COUNTRY,
  PE_COUNTRY,
  HN_COUNTRY,
  GT_COUNTRY,
  PY_COUNTRY,
  PA_COUNTRY,
  DO_COUNTRY,
  BR_COUNTRY,
  US_COUNTRY,
  AR_COUNTRY,
  UY_COUNTRY,
  ES_COUNTRY,
];

export function publicBuyerCountry(countryCode: string): PublicBuyerCountrySource | null {
  const code = countryCode.trim().toUpperCase();
  return PUBLIC_BUYER_COUNTRIES.find((c) => c.countryCode === code) ?? null;
}
