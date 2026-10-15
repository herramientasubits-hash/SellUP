/**
 * Registro de servidor: las consultas de cada país de «Proveedores de una empresa».
 * Un país «loaded» usa las genéricas (con sus ganchos si los tiene); uno «live», las suyas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCoLookups } from './co.server';
import { buildDoLookups } from './do.server';
import { publicBuyerCountry } from './index';
import { buildLoadedLinksLookups, type CountryLookups, type LoadedCountryServerHooks } from './loaded-lookups.server';

/** Consultas en vivo por país (`kind: 'live'`). */
const LIVE_LOOKUPS: Readonly<Record<string, (serviceClient: SupabaseClient) => CountryLookups>> = {
  CO: buildCoLookups,
  DO: buildDoLookups,
};

/** Ganchos de servidor de los países «loaded» que los necesitan. */
const LOADED_HOOKS: Readonly<Record<string, LoadedCountryServerHooks>> = {};

export function publicBuyerCountryLookups(countryCode: string, serviceClient: SupabaseClient): CountryLookups | null {
  const country = publicBuyerCountry(countryCode);
  if (!country) return null;
  if (country.kind === 'loaded') return buildLoadedLinksLookups(country, serviceClient, LOADED_HOOKS[country.countryCode]);
  return LIVE_LOOKUPS[country.countryCode]?.(serviceClient) ?? null;
}
