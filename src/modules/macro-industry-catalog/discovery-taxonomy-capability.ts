/**
 * discovery-taxonomy-capability.ts — Qué taxonomía gobierna una búsqueda, y si
 * la selección de subindustrias está disponible.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 1, 2 y 13.
 *
 * ── El mecanismo que el § 2 exige ─────────────────────────────────────────────
 *
 * «Crear mecanismo explícito, preferiblemente `subindustrySelectionEnabled =
 * false`. No usar comentarios ni dead code manual como mecanismo.»
 *
 * Aquí está: una capacidad de producto, tipada, derivada de la VERSIÓN DEL
 * CATÁLOGO. Ni una variable de entorno, ni un comentario, ni una rama muerta.
 * Todo el desarrollo de subindustrias sigue vivo, compilado y con sus pruebas en
 * verde; simplemente ninguna búsqueda de catálogo v2 lo alcanza.
 *
 * ── Por qué el enrutado es por VERSIÓN y no por «array vacío» (§ 13) ──────────
 *
 * `requestedSubindustries.length === 0` ya era un estado alcanzable antes de este
 * hito: el paso de subindustrias siempre fue opcional y `SKIP_SUBINDUSTRIES`
 * existe desde el principio. Enrutar por el array vacío mezclaría dos cosas que
 * no son la misma:
 *
 *   - «el usuario NO quiso acotar por subindustria» (v1, con la función activa);
 *   - «la selección de subindustria NO EXISTE en este catálogo» (v2).
 *
 * La primera debe seguir comportándose como siempre. La segunda es la que activa
 * la vía macro. Un solo predicado para las dos habría hecho que toda búsqueda v1
 * sin subindustrias cambiara de camino de admisión sin que nadie lo pidiera.
 *
 * La versión, en cambio, es un hecho declarado que viaja con la solicitud y queda
 * persistido, así que la decisión es reproducible a posteriori.
 *
 * ── Reactivación futura ───────────────────────────────────────────────────────
 *
 * Volver a habilitar la selección de subindustrias es publicar un catálogo cuya
 * versión esta función clasifique como `industry_subindustry`, o añadir aquí la
 * versión nueva. No hay que restaurar código borrado, porque no se borró nada.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import {
  LEGACY_INDUSTRY_CATALOG_VERSION,
  MACRO_INDUSTRY_CATALOG_VERSION,
} from './macro-industries';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Qué taxonomía gobierna la búsqueda.
 *
 * `industry_subindustry`  Catálogo v1: industria padre + hasta 5 subindustrias.
 *                         La precisión de subindustria y la admisión post-
 *                         enrichment de hija (#276) están activas.
 * `macro_industry`        Catálogo v2: exactamente UNA macro industria, sin
 *                         subindustrias. La admisión va por evidencia macro.
 */
export type DiscoveryTaxonomyMode = 'industry_subindustry' | 'macro_industry';

/**
 * Por qué se resolvió ese modo. Código estático, apto para metadata y logs.
 *
 * `unknown_catalog_version` es el fail-closed: una versión que este código no
 * conoce NO se trata como v2. Se trata como la taxonomía legacy, que es la que
 * las corridas históricas usaban, de modo que una versión inesperada nunca
 * activa una vía de admisión nueva por accidente.
 */
export type DiscoveryTaxonomyReason =
  | 'macro_industry_catalog_version'
  | 'legacy_catalog_version'
  | 'unknown_catalog_version'
  | 'catalog_version_missing';

export type DiscoveryTaxonomyCapability = {
  mode: DiscoveryTaxonomyMode;
  /** § 2 — el interruptor explícito. `false` ⇒ el wizard no muestra el paso. */
  subindustrySelectionEnabled: boolean;
  /** § 18 — exactamente una industria por búsqueda. `true` sólo en modo macro. */
  singleIndustryRequired: boolean;
  reason: DiscoveryTaxonomyReason;
  /** La versión que produjo esta resolución, saneada. `null` si no llegó ninguna. */
  catalogVersion: string | null;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

function legacy(
  reason: Extract<
    DiscoveryTaxonomyReason,
    'legacy_catalog_version' | 'unknown_catalog_version' | 'catalog_version_missing'
  >,
  catalogVersion: string | null,
): DiscoveryTaxonomyCapability {
  return {
    mode: 'industry_subindustry',
    subindustrySelectionEnabled: true,
    singleIndustryRequired: false,
    reason,
    catalogVersion,
  };
}

/**
 * Resuelve la capacidad de taxonomía a partir de la versión del catálogo.
 *
 * Es la ÚNICA función que decide esto. Cualquier consumidor —wizard, acción del
 * servidor, runner de descubrimiento— la llama; ninguno compara versiones por su
 * cuenta.
 */
export function resolveDiscoveryTaxonomyCapability(
  catalogVersion: string | null | undefined,
): DiscoveryTaxonomyCapability {
  const version = catalogVersion?.trim() || null;

  if (version === null) return legacy('catalog_version_missing', null);

  if (version === MACRO_INDUSTRY_CATALOG_VERSION) {
    return {
      mode: 'macro_industry',
      subindustrySelectionEnabled: false,
      singleIndustryRequired: true,
      reason: 'macro_industry_catalog_version',
      catalogVersion: version,
    };
  }

  if (version === LEGACY_INDUSTRY_CATALOG_VERSION) {
    return legacy('legacy_catalog_version', version);
  }

  return legacy('unknown_catalog_version', version);
}

/** Atajo legible. Equivale a `resolveDiscoveryTaxonomyCapability(v).mode === 'macro_industry'`. */
export function isMacroIndustryTaxonomy(catalogVersion: string | null | undefined): boolean {
  return resolveDiscoveryTaxonomyCapability(catalogVersion).mode === 'macro_industry';
}

/** § 2 — el interruptor, para consumidores que sólo necesitan el booleano. */
export function isSubindustrySelectionEnabled(
  catalogVersion: string | null | undefined,
): boolean {
  return resolveDiscoveryTaxonomyCapability(catalogVersion).subindustrySelectionEnabled;
}

// ─── Proyección a metadata (§ 8) ──────────────────────────────────────────────

/**
 * Bloque plano para la metadata del lote. Sin nombres de empresa, sin criterios.
 *
 * Es lo que permite responder, meses después, «¿bajo qué taxonomía se creó esta
 * búsqueda?» sin reconstruirlo por implicación.
 */
export function toDiscoveryTaxonomyMetadata(
  capability: DiscoveryTaxonomyCapability,
): Record<string, unknown> {
  return {
    discovery_taxonomy_mode: capability.mode,
    subindustry_selection_enabled: capability.subindustrySelectionEnabled,
    single_industry_required: capability.singleIndustryRequired,
    discovery_taxonomy_reason: capability.reason,
    catalog_version: capability.catalogVersion,
  };
}
