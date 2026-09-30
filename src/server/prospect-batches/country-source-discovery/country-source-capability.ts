/**
 * country-source-capability.ts — ¿tiene este país una fuente gratuita cableada?
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 7, 12, 22(G), 26.
 *
 * ── 🔴 «Cableada» significa consciente de criterios, no «existe» ─────────────
 *
 * El catálogo de fuentes del repo registra adapters para Chile (`cl_res`), México
 * (`mx_denue`) y Colombia (`co_rues`). Ninguno de los tres aparece aquí, y el
 * motivo es § 4: hoy ninguno recibe los criterios de la corrida. `co_rues`
 * concretamente sólo propaga `limit` y `offset` a `runSocrataCandidateDryRun`, que
 * consulta CUATRO datasets (rues, secop2, reps, superfinanciera) con un `$where`
 * fijo que sólo excluye personas naturales e inactivos. Una macro industria no
 * viaja en esa petición. Devolver su muestra reduciría el objetivo con lo primero
 * que Socrata tuviera a mano, que es exactamente lo prohibido.
 *
 * ── 🔴 Este registro NO decide el proveedor siguiente (§ 26) ─────────────────
 *
 * Resuelve capacidad de FUENTE y nada más. No sabe qué proveedor de pago viene
 * después ni le importa: la misma capa la consumen la ruta Apollo y la ruta
 * Lusha, y una futura cadena fuente → primario → secundario → Tavily la puede
 * consumir igual sin que aquí se cablee «después va Lusha».
 */

import type { CountrySourceAdapter } from './country-source-types';
import {
  buildCoSiisDiscoveryAdapter,
  CO_SIIS_DISCOVERY_SOURCE_KEY,
  type CoSiisSnapshotQuery,
} from './co-siis-discovery-adapter';
import {
  buildDoDgiiDiscoveryAdapter,
  DO_DGII_DISCOVERY_SOURCE_KEY,
  type DoDgiiDiscoveryReads,
} from './do-dgii-discovery-adapter';
import { macroHasCiiuCoverage } from './macro-ciiu-index';
import { macroHasDgiiCoverage } from './do-dgii-macro-table';

/**
 * Países con descubrimiento gratuito consciente de criterios.
 *
 * SOURCES-DO-FREE-DISCOVERY-1 — República Dominicana entra con el padrón DGII,
 * clasificado por la tabla oficial aprobada (`do-dgii-macro-table.ts`) y
 * restringido a proveedoras del Estado (`do-dgii-discovery-adapter.ts`).
 */
export const COUNTRY_SOURCE_DISCOVERY_COUNTRIES = ['CO', 'DO'] as const;

export type CountrySourceCapability = {
  countryCode: string;
  sourceKey: string;
};

const CAPABILITIES: Readonly<Record<string, CountrySourceCapability>> = Object.freeze({
  CO: { countryCode: 'CO', sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY },
  DO: { countryCode: 'DO', sourceKey: DO_DGII_DISCOVERY_SOURCE_KEY },
});

/** ¿Está cableado el descubrimiento gratuito para este país? */
export function resolveCountrySourceCapability(
  countryCode: string | null | undefined,
): CountrySourceCapability | null {
  if (typeof countryCode !== 'string') return null;
  return CAPABILITIES[countryCode.trim().toUpperCase()] ?? null;
}

/**
 * ¿La fuente de ESTE país puede preguntar algo útil para esta macro?
 *
 * Colombia: la macro tiene códigos CIIU derivados del evaluador canónico.
 * República Dominicana: la macro tiene actividades DGII en la tabla aprobada.
 * Sin cobertura la fuente no consulta nada (nunca una muestra genérica).
 */
export function countrySourceMacroHasCoverage(
  countryCode: string | null | undefined,
  macroIndustryKey: string | null | undefined,
): boolean {
  const capability = resolveCountrySourceCapability(countryCode);
  if (capability === null) return false;
  if (capability.countryCode === 'DO') return macroHasDgiiCoverage(macroIndustryKey);
  return macroHasCiiuCoverage(macroIndustryKey);
}

/**
 * Construye el adapter del país. `null` cuando el país no tiene fuente o cuando
 * la lectura que necesita no fue inyectada — ausencia de credencial/cliente NO es
 * un fallo silencioso, es «sin fuente», que es fail-open hacia el pago.
 */
export function buildCountrySourceAdapter(
  countryCode: string | null | undefined,
  deps: {
    coSiisSnapshotQuery?: CoSiisSnapshotQuery | null;
    doDgiiDiscoveryReads?: DoDgiiDiscoveryReads | null;
  },
): CountrySourceAdapter | null {
  const capability = resolveCountrySourceCapability(countryCode);
  if (capability === null) return null;
  if (capability.countryCode === 'DO') {
    return deps.doDgiiDiscoveryReads ? buildDoDgiiDiscoveryAdapter(deps.doDgiiDiscoveryReads) : null;
  }
  if (!deps.coSiisSnapshotQuery) return null;
  return buildCoSiisDiscoveryAdapter(deps.coSiisSnapshotQuery);
}
