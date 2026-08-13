/**
 * discovery-catalog-loader.ts — Carga del catálogo publicado, sea cual sea la
 * taxonomía que gobierne.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 1, 2 y 3.
 *
 * ── Por qué no bastaba `loadActiveCatalog` ────────────────────────────────────
 *
 * `active_industry_catalog` hace INNER JOIN con `subindustries`. Una industria
 * sin subindustrias activas es INVISIBLE en esa vista, así que bajo el catálogo
 * v2 —12 macro industrias, cero subindustrias— la consulta devuelve cero filas y
 * `loadActiveCatalog` lanza `empty_catalog`. El wizard no mostraría ninguna
 * industria: no porque no las haya, sino porque la vista no puede verlas.
 *
 * Este cargador consulta primero `active_macro_industry_catalog` (industrias de
 * la versión publicada, sin exigir subindustrias) y sólo pide subindustrias
 * cuando la CAPACIDAD dice que esta versión las selecciona. Bajo v1 el resultado
 * es el mismo que antes: 8 industrias y sus 73 subindustrias.
 *
 * ── Lo que NO cambia ──────────────────────────────────────────────────────────
 *
 * `loadActiveCatalog` queda intacto y sigue siendo la lectura de industria +
 * subindustria para quien la necesite. Aquí no se borra ni se reemplaza: se
 * añade la lectura que la taxonomía macro necesita.
 */

import { createClient } from '@/lib/supabase/server';
import { CatalogLoadError } from './loader';
import type {
  ActiveIndustryCatalog,
  CatalogIndustryOption,
  CatalogSubindustryOption,
} from './types';
import {
  resolveDiscoveryTaxonomyCapability,
  type DiscoveryTaxonomyCapability,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';

// ─── Formas crudas ────────────────────────────────────────────────────────────

type MacroCatalogRow = {
  catalog_version: string;
  industry_id: string;
  industry_name: string;
  industry_slug: string;
  industry_description: string | null;
  industry_sort_order: number;
  has_active_subindustries: boolean;
};

type SubindustryRow = {
  catalog_version: string;
  industry_id: string;
  subindustry_id: string;
  subindustry_name: string;
  subindustry_slug: string;
  subindustry_description: string | null;
  subindustry_sort_order: number;
  applicable_countries: string[] | null;
};

// ─── Resultado ────────────────────────────────────────────────────────────────

export type ActiveDiscoveryCatalog = ActiveIndustryCatalog & {
  /** Qué taxonomía gobierna esta versión. Derivada, nunca almacenada. */
  capability: DiscoveryTaxonomyCapability;
};

// ─── Cargador ─────────────────────────────────────────────────────────────────

export async function loadActiveDiscoveryCatalog(): Promise<ActiveDiscoveryCatalog> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('active_macro_industry_catalog')
    .select(
      'catalog_version, industry_id, industry_name, industry_slug, industry_description, industry_sort_order, has_active_subindustries',
    );

  if (error) {
    throw new CatalogLoadError('query_failed', `Supabase query failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new CatalogLoadError(
      'empty_catalog',
      'No published catalog found in active_macro_industry_catalog.',
    );
  }

  const rows = data as MacroCatalogRow[];

  const versions = new Set(rows.map((r) => r.catalog_version));
  if (versions.size > 1) {
    throw new CatalogLoadError(
      'mixed_versions',
      `active_macro_industry_catalog returned rows from multiple versions: ${[...versions].join(', ')}`,
    );
  }
  const version = [...versions][0];

  const industryMap = new Map<string, CatalogIndustryOption>();
  for (const row of rows) {
    if (!row.industry_id || row.industry_id.trim() === '') {
      throw new CatalogLoadError('invalid_industry', 'Row with missing industry_id found in catalog.');
    }
    if (industryMap.has(row.industry_id)) {
      // La vista es una fila por industria: un id repetido significa que la
      // consulta devolvió más de una versión o que la vista cambió de forma.
      throw new CatalogLoadError('duplicate_ids', `Duplicate industry id ${row.industry_id}.`);
    }
    industryMap.set(row.industry_id, {
      id: row.industry_id,
      name: row.industry_name,
      slug: row.industry_slug,
      description: row.industry_description ?? null,
      sortOrder: row.industry_sort_order,
    });
  }

  const capability = resolveDiscoveryTaxonomyCapability(version);
  const industries = [...industryMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  // § 2 — la selección de subindustria desactivada NO consulta subindustrias.
  //
  // No es una optimización: es lo que garantiza que ninguna selección residual
  // pueda llegar a la UI. Un catálogo macro no puede entregar opciones de
  // subindustria porque nadie las pide.
  if (!capability.subindustrySelectionEnabled) {
    return { version, industries, subindustries: [], capability };
  }

  const subQuery = await supabase
    .from('active_industry_catalog')
    .select(
      'catalog_version, industry_id, subindustry_id, subindustry_name, subindustry_slug, subindustry_description, subindustry_sort_order, applicable_countries',
    );

  if (subQuery.error) {
    throw new CatalogLoadError(
      'query_failed',
      `Supabase query failed: ${subQuery.error.message}`,
    );
  }

  const subRows = (subQuery.data ?? []) as SubindustryRow[];

  // La versión de las subindustrias tiene que ser la MISMA que la de las
  // industrias. Dos lecturas separadas pueden caer a ambos lados de una
  // publicación, y un catálogo mitad v1 mitad v2 es peor que ninguno.
  for (const row of subRows) {
    if (row.catalog_version !== version) {
      throw new CatalogLoadError(
        'mixed_versions',
        `Subindustry rows belong to version ${row.catalog_version}, industries to ${version}.`,
      );
    }
  }

  const subindustryMap = new Map<string, CatalogSubindustryOption>();
  for (const row of subRows) {
    if (!row.subindustry_id || row.subindustry_id.trim() === '') {
      throw new CatalogLoadError(
        'invalid_subindustry',
        'Row with missing subindustry_id found in catalog.',
      );
    }
    const existing = subindustryMap.get(row.subindustry_id);
    if (existing) {
      if (existing.industryId !== row.industry_id) {
        throw new CatalogLoadError(
          'inconsistent_payload',
          `Subindustry ${row.subindustry_id} appears under different industries.`,
        );
      }
      continue;
    }
    if (!industryMap.has(row.industry_id)) {
      throw new CatalogLoadError(
        'invalid_subindustry',
        `Subindustry ${row.subindustry_id} references unknown industry ${row.industry_id}.`,
      );
    }
    subindustryMap.set(row.subindustry_id, {
      id: row.subindustry_id,
      industryId: row.industry_id,
      name: row.subindustry_name,
      slug: row.subindustry_slug,
      description: row.subindustry_description ?? null,
      applicableCountries: row.applicable_countries ?? null,
      sortOrder: row.subindustry_sort_order,
    });
  }

  return {
    version,
    industries,
    subindustries: [...subindustryMap.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    capability,
  };
}
