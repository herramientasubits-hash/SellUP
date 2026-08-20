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

/** Países con descubrimiento gratuito consciente de criterios. */
export const COUNTRY_SOURCE_DISCOVERY_COUNTRIES = ['CO'] as const;

export type CountrySourceCapability = {
  countryCode: string;
  sourceKey: string;
};

/** ¿Está cableado el descubrimiento gratuito para este país? */
export function resolveCountrySourceCapability(
  countryCode: string | null | undefined,
): CountrySourceCapability | null {
  if (typeof countryCode !== 'string') return null;
  const normalized = countryCode.trim().toUpperCase();
  if (normalized !== 'CO') return null;
  return { countryCode: 'CO', sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY };
}

/**
 * Construye el adapter del país. `null` cuando el país no tiene fuente o cuando
 * la lectura que necesita no fue inyectada — ausencia de credencial/cliente NO es
 * un fallo silencioso, es «sin fuente», que es fail-open hacia el pago.
 */
export function buildCountrySourceAdapter(
  countryCode: string | null | undefined,
  deps: { coSiisSnapshotQuery?: CoSiisSnapshotQuery | null },
): CountrySourceAdapter | null {
  const capability = resolveCountrySourceCapability(countryCode);
  if (capability === null) return null;
  if (!deps.coSiisSnapshotQuery) return null;
  return buildCoSiisDiscoveryAdapter(deps.coSiisSnapshotQuery);
}
