/**
 * apollo-subindustry-catalog-terms-loader.server.ts — la ÚNICA lectura de
 * `subindustry_search_terms` de la ruta de descubrimiento.
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SOURCE-OF-TRUTH FINAL
 * ADDENDUM · §§ 2 (CASO B) y 3.
 *
 * ── Una lectura, dos vistas, una sola versión ──────────────────────────────────
 *
 * Los términos viven en `active_subindustry_search_terms` y los NOMBRES canónicos en
 * `active_industry_catalog` — la misma vista que `resolveWizardCatalog` usa para
 * resolver la selección del usuario. Las dos filtran por `status = 'published'`, así
 * que las dos describen la versión publicada... pero son DOS consultas, y entre una y
 * otra puede colarse un `publish_industry_catalog_version`.
 *
 * Por eso las dos vistas exponen `catalog_version_id` y aquí se exige igualdad de
 * UUID entre ambas lecturas: si un publish se cuela en medio, los ids difieren y la
 * carga falla en vez de devolver una mezcla de dos versiones. Es la misma disciplina
 * que `loadActiveCatalog` aplica con `mixed_versions`, llevada al cruce de las dos
 * vistas.
 *
 * Un fallo NO se traduce en «sin términos» silencioso: devuelve `null` con su razón,
 * y el gate de coherencia del § 3 lo convierte en un bloqueo antes del gasto (cero
 * llamadas al proveedor, cero filas económicas). Sin resolución no hay búsqueda; no
 * hay respaldo estático al que caer, y explícitamente no se cae a la industria padre.
 *
 * ── Sólo lectura ───────────────────────────────────────────────────────────────
 *
 * `select` sobre dos vistas `security_invoker` que sólo tienen `GRANT SELECT`
 * (migraciones 058/059). Cero escrituras, cero créditos, cero llamadas a Apollo o
 * Tavily.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import {
  buildApolloSubindustryCatalogTermsResolution,
  type ApolloSubindustryCatalogTermsResolution,
} from './apollo-subindustry-catalog-terms-resolution';

/** `term_type` que se conecta hoy. Ver § 5 del addendum para los otros tres. */
const CONNECTED_TERM_TYPE = 'keyword' as const;

export type ApolloSubindustryCatalogTermsLoadFailureReason =
  /** La consulta de una de las dos vistas falló. */
  | 'query_failed'
  /** No hay catálogo publicado, o no devolvió subindustrias activas. */
  | 'empty_catalog'
  /** La vista del catálogo devolvió más de una versión publicada. */
  | 'mixed_catalog_versions'
  /** Un publish se coló entre las dos lecturas: los `catalog_version_id` difieren. */
  | 'version_straddled_publish'
  /** El catálogo publicado no tiene ni un término `keyword` activo. */
  | 'no_connected_terms';

export type ApolloSubindustryCatalogTermsLoadResult =
  | { resolution: ApolloSubindustryCatalogTermsResolution; failureReason: null }
  | { resolution: null; failureReason: ApolloSubindustryCatalogTermsLoadFailureReason };

type CatalogNameRow = {
  catalog_version_id: string;
  catalog_version: string;
  subindustry_id: string;
  subindustry_name: string;
};

type TermRow = {
  catalog_version_id: string;
  subindustry_id: string;
  term: string;
  term_type: string;
  weight: number | null;
};

/**
 * Lee la versión publicada del catálogo y sus términos `keyword`.
 *
 * El cliente se recibe por parámetro a propósito: es el MISMO que resolvió la
 * selección del wizard, así que la selección y los términos se leen con la misma
 * identidad y las mismas políticas. Inyectarlo además permite que la suite atraviese
 * esta función sin base de datos real.
 */
export async function loadApolloSubindustryCatalogTerms(
  supabase: SupabaseClient,
): Promise<ApolloSubindustryCatalogTermsLoadResult> {
  const catalogQuery = await supabase
    .from('active_industry_catalog')
    .select('catalog_version_id, catalog_version, subindustry_id, subindustry_name');

  if (catalogQuery.error) return { resolution: null, failureReason: 'query_failed' };

  const catalogRows = (catalogQuery.data ?? []) as CatalogNameRow[];
  if (catalogRows.length === 0) return { resolution: null, failureReason: 'empty_catalog' };

  const versionIds = new Set(catalogRows.map((row) => row.catalog_version_id));
  const versions = new Set(catalogRows.map((row) => row.catalog_version));
  if (versionIds.size !== 1 || versions.size !== 1) {
    return { resolution: null, failureReason: 'mixed_catalog_versions' };
  }

  const catalogVersionId = catalogRows[0].catalog_version_id;
  const catalogVersion = catalogRows[0].catalog_version;

  const termsQuery = await supabase
    .from('active_subindustry_search_terms')
    .select('catalog_version_id, subindustry_id, term, term_type, weight')
    .eq('term_type', CONNECTED_TERM_TYPE);

  if (termsQuery.error) return { resolution: null, failureReason: 'query_failed' };

  const termRows = (termsQuery.data ?? []) as TermRow[];

  // Un publish entre las dos lecturas: cualquier fila de otra versión invalida el
  // cruce entero. No se filtra por la versión «buena» — se rehúsa, porque la lectura
  // de nombres ya podría ser la vieja.
  if (termRows.some((row) => row.catalog_version_id !== catalogVersionId)) {
    return { resolution: null, failureReason: 'version_straddled_publish' };
  }
  if (termRows.length === 0) return { resolution: null, failureReason: 'no_connected_terms' };

  // Orden de prioridad: `weight DESC NULLS LAST, term ASC`. Es significativo — la
  // primera posición de cada subindustria es la que el reparto round-robin coloca
  // primero, así que un orden inestable cambiaría la consulta sin cambiar el catálogo.
  const termsBySubindustry = new Map<string, TermRow[]>();
  for (const row of termRows) {
    const bucket = termsBySubindustry.get(row.subindustry_id);
    if (bucket) bucket.push(row);
    else termsBySubindustry.set(row.subindustry_id, [row]);
  }
  for (const bucket of termsBySubindustry.values()) {
    bucket.sort((a, b) => {
      const weightA = a.weight ?? Number.NEGATIVE_INFINITY;
      const weightB = b.weight ?? Number.NEGATIVE_INFINITY;
      if (weightA !== weightB) return weightB - weightA;
      return a.term.localeCompare(b.term);
    });
  }

  const seenSubindustryIds = new Set<string>();
  const entries: {
    canonicalSubindustryId: string;
    canonicalSubindustry: string;
    terms: string[];
  }[] = [];

  for (const row of catalogRows) {
    if (seenSubindustryIds.has(row.subindustry_id)) continue;
    seenSubindustryIds.add(row.subindustry_id);
    const bucket = termsBySubindustry.get(row.subindustry_id);
    if (!bucket || bucket.length === 0) continue;
    entries.push({
      canonicalSubindustryId: row.subindustry_id,
      canonicalSubindustry: row.subindustry_name,
      terms: bucket.map((term) => term.term),
    });
  }

  if (entries.length === 0) return { resolution: null, failureReason: 'no_connected_terms' };

  return {
    resolution: buildApolloSubindustryCatalogTermsResolution({
      catalogVersion,
      catalogVersionId,
      termType: CONNECTED_TERM_TYPE,
      entries,
    }),
    failureReason: null,
  };
}

/**
 * La misma lectura con un cliente de la petición en curso.
 *
 * Existe para que la frontera del wizard funcione sin que cada llamador tenga que
 * fabricar un cliente, y usa `createClient()` —el cliente SSR del usuario, con RLS—
 * exactamente igual que `loadActiveCatalog` y `resolveWizardCatalog`: la selección y
 * los términos se leen con la misma identidad. Un fallo al crear el cliente se trata
 * como la consulta fallida que es, no como «sin términos».
 */
export async function loadApolloSubindustryCatalogTermsForRequest(): Promise<ApolloSubindustryCatalogTermsLoadResult> {
  try {
    const supabase = await createClient();
    return await loadApolloSubindustryCatalogTerms(supabase);
  } catch {
    return { resolution: null, failureReason: 'query_failed' };
  }
}
