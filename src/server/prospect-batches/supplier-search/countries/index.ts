/**
 * Registro (puro) de los países de «Proveedores de una empresa» por compras públicas.
 * Una línea por país; ver `types.ts` para el contrato.
 */

import { CL_COUNTRY } from './cl';
import { CO_COUNTRY } from './co';
import { HN_COUNTRY } from './hn';
import { PE_COUNTRY } from './pe';
import type { PublicBuyerCountrySource } from './types';

export const PUBLIC_BUYER_COUNTRIES: readonly PublicBuyerCountrySource[] = [
  CO_COUNTRY,
  CL_COUNTRY,
  PE_COUNTRY,
  HN_COUNTRY,
];

export function publicBuyerCountry(countryCode: string): PublicBuyerCountrySource | null {
  const code = countryCode.trim().toUpperCase();
  return PUBLIC_BUYER_COUNTRIES.find((c) => c.countryCode === code) ?? null;
}
