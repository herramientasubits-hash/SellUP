// ── Import catalog loader — Hito 16AB.39 ─────────────────────────────────────
// Server-only. Fetches published catalog (industries + subindustries + aliases)
// in a single logical operation and returns the contract required by the
// import classification normalizer (16AB.37).
//
// AGENT1-MACRO-CATALOG-PRE119-LEGACY-READERS-1 §§ 3, 6, 7, 17 y 18.
//
// ── Qué cambió, y por qué no es un parche al resultado vacío ──────────────────
//
// Antes la primera consulta era `active_industry_catalog`, que hace INNER JOIN
// con `subindustries`. Bajo el catálogo v2 —12 macro industrias, cero
// subindustrias— esa vista devuelve CERO filas, y el cargador lo reportaba como
// `empty_catalog`: las cuatro rutas de importación respondían 503 con un catálogo
// perfectamente publicado.
//
// El cero de esa vista es CORRECTO y va a seguir siendo cero: la vista describe
// el cruce industria × subindustria, y un catálogo macro no tiene ninguna. El
// error era preguntarle a ESA vista por la existencia del catálogo. Ahora la
// taxonomía de primer nivel se lee de `active_macro_industry_catalog` —versión
// publicada e industrias activas, sin exigir subindustrias— y las subindustrias
// se piden SÓLO cuando la CAPACIDAD de la versión las selecciona
// (`resolveDiscoveryTaxonomyCapability`, el contrato canónico de #281).
//
// Bajo v1 el resultado es el mismo que antes: la función de publicación de la
// migración 057 exige que cada industria activa tenga al menos una subindustria
// activa, así que el conjunto de industrias de las dos vistas coincide (8 y 8 en
// Producción hoy), y las 73 subindustrias y sus alias se siguen leyendo igual.
//
// ── Clasificación macro-only (§ 7) ────────────────────────────────────────────
//
// No se inventa ninguna hija. Bajo v2 `subindustries` y `aliases` llegan vacíos y
// el normalizador ya sabe qué hacer con eso: una fila con industria resuelta y
// subindustria ausente es `SUBINDUSTRY_MISSING` → estado `warning`, que NO
// bloquea la persistencia (`subindustry_id` es NULL-able desde la migración 061,
// y su única constraint es la inversa: una hija exige su padre). El objetivo de
// clasificación pasa a ser la macro industria, sin sustituto sintético.
//
// ── Dos lecturas, una sola versión ───────────────────────────────────────────
//
// Separar la lectura en dos abre una ventana en la que un
// `publish_industry_catalog_version` puede colarse en medio. Por eso las filas de
// subindustria se cotejan contra el `catalog_version_id` que devolvió la lectura
// de industrias y una discrepancia se rehúsa como `mixed_versions` — la misma
// disciplina que `discovery-catalog-loader` y el cargador de términos aplican, y
// el mismo código de error que las rutas ya conocen.
//
// Never queries search_terms, rules, or other catalog metadata.
// Never calls any AI provider.

import { createClient } from '@/lib/supabase/server';
import { resolveDiscoveryTaxonomyCapability } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import type {
  ImportClassificationCatalog,
  ImportCatalogIndustry,
  ImportCatalogSubindustry,
  ImportCatalogAlias,
} from './import-classification/import-classification-types';

// ── Result types ──────────────────────────────────────────────────────────────

export type ImportCatalogLoadErrorCode =
  | 'supabase_error'
  | 'empty_catalog'
  | 'mixed_versions'
  | 'missing_ids'
  | 'alias_version_mismatch';

export type ImportCatalogLoadResult =
  | {
      success: true;
      catalog: ImportClassificationCatalog;
      catalogVersionId: string;
    }
  | {
      success: false;
      code: ImportCatalogLoadErrorCode;
      message: string;
    };

// ── Raw row types ─────────────────────────────────────────────────────────────

type MacroIndustryRow = {
  catalog_version_id: string;
  catalog_version: string;
  industry_id: string;
  industry_name: string;
  industry_slug: string;
};

type SubindustryRow = {
  catalog_version_id: string;
  industry_id: string;
  subindustry_id: string;
  subindustry_name: string;
  subindustry_slug: string;
  applicable_countries: string[] | null;
};

type AliasRow = {
  id: string;
  subindustry_id: string;
  catalog_version_id: string;
  alias: string;
  language_code: string | null;
  country_code: string | null;
};

// ── Main loader ───────────────────────────────────────────────────────────────

export async function loadImportCatalog(): Promise<ImportCatalogLoadResult> {
  const supabase = await createClient();

  // ── Query 1: published version + its active industries ────────────────────
  //
  // Esta es la fuente de la taxonomía de primer nivel y de la versión activa,
  // bajo cualquiera de las dos taxonomías. No exige subindustrias.

  const { data: industryData, error: industryError } = await supabase
    .from('active_macro_industry_catalog')
    .select('catalog_version_id, catalog_version, industry_id, industry_name, industry_slug');

  if (industryError) {
    return {
      success: false,
      code: 'supabase_error',
      message: `active_macro_industry_catalog query failed: ${industryError.message}`,
    };
  }

  if (!industryData || industryData.length === 0) {
    return {
      success: false,
      code: 'empty_catalog',
      message: 'No published catalog found in active_macro_industry_catalog.',
    };
  }

  const industryRows = industryData as MacroIndustryRow[];

  // Validate: single version
  const versionIds = new Set(industryRows.map((r) => r.catalog_version_id));
  if (versionIds.size > 1) {
    return {
      success: false,
      code: 'mixed_versions',
      message: `active_macro_industry_catalog returned rows from multiple version IDs: ${[...versionIds].join(', ')}`,
    };
  }

  const catalogVersionId = [...versionIds][0];
  const catalogVersion = industryRows[0].catalog_version;

  // Validate: no missing IDs
  for (const row of industryRows) {
    if (!row.industry_id?.trim()) {
      return { success: false, code: 'missing_ids', message: 'Row with missing industry_id found.' };
    }
  }

  // Build industries (deduplicated)
  const industryMap = new Map<string, ImportCatalogIndustry>();
  for (const row of industryRows) {
    if (!industryMap.has(row.industry_id)) {
      industryMap.set(row.industry_id, {
        id: row.industry_id,
        name: row.industry_name,
        slug: row.industry_slug,
        active: true,
      });
    }
  }

  // ── Capability gate ───────────────────────────────────────────────────────
  //
  // § 3 — la disponibilidad de subindustrias la decide la VERSIÓN, no el número
  // de filas de la vista legacy. Una versión que este código no reconoce se trata
  // como legacy (fail-closed en `resolveDiscoveryTaxonomyCapability`): nunca
  // entra en modo macro por accidente.
  const capability = resolveDiscoveryTaxonomyCapability(catalogVersion);

  if (!capability.subindustrySelectionEnabled) {
    // Taxonomía macro: no hay subindustrias que leer, y por tanto tampoco alias
    // que puedan referenciarlas. No se consulta ninguna vista legacy.
    const catalog: ImportClassificationCatalog = {
      version: catalogVersion,
      industries: [...industryMap.values()],
      subindustries: [],
      aliases: [],
    };
    return { success: true, catalog, catalogVersionId };
  }

  // ── Query 2: subindustries from the published version ─────────────────────

  const { data: subData, error: subError } = await supabase
    .from('active_industry_catalog')
    .select(
      'catalog_version_id, industry_id, subindustry_id, subindustry_name, subindustry_slug, applicable_countries',
    );

  if (subError) {
    return {
      success: false,
      code: 'supabase_error',
      message: `active_industry_catalog query failed: ${subError.message}`,
    };
  }

  const subRows = (subData ?? []) as SubindustryRow[];

  // Un publish entre las dos lecturas invalida el cruce entero: la lectura de
  // industrias podría ser la vieja. No se filtra por la versión «buena» — se
  // rehúsa.
  for (const row of subRows) {
    if (row.catalog_version_id !== catalogVersionId) {
      return {
        success: false,
        code: 'mixed_versions',
        message: `active_industry_catalog returned rows from multiple version IDs: ${catalogVersionId}, ${row.catalog_version_id}`,
      };
    }
  }

  // Validate: no missing IDs
  for (const row of subRows) {
    if (!row.subindustry_id?.trim()) {
      return { success: false, code: 'missing_ids', message: 'Row with missing subindustry_id found.' };
    }
    if (!row.industry_id?.trim()) {
      return { success: false, code: 'missing_ids', message: 'Row with missing industry_id found.' };
    }
  }

  // Build subindustries (deduplicated)
  const subindustryMap = new Map<string, ImportCatalogSubindustry>();
  for (const row of subRows) {
    if (!subindustryMap.has(row.subindustry_id)) {
      subindustryMap.set(row.subindustry_id, {
        id: row.subindustry_id,
        industryId: row.industry_id,
        name: row.subindustry_name,
        slug: row.subindustry_slug,
        applicableCountries: row.applicable_countries ?? null,
        active: true,
      });
    }
  }

  // ── Query 3: aliases from published version ───────────────────────────────

  const { data: aliasData, error: aliasError } = await supabase
    .from('active_subindustry_aliases')
    .select('id, subindustry_id, catalog_version_id, alias, language_code, country_code');

  if (aliasError) {
    return {
      success: false,
      code: 'supabase_error',
      message: `active_subindustry_aliases query failed: ${aliasError.message}`,
    };
  }

  const aliasRows = (aliasData ?? []) as AliasRow[];

  // Validate: all aliases belong to the same catalog version
  for (const alias of aliasRows) {
    if (alias.catalog_version_id !== catalogVersionId) {
      return {
        success: false,
        code: 'alias_version_mismatch',
        message: `Alias ${alias.id} belongs to version ${alias.catalog_version_id} but catalog is ${catalogVersionId}.`,
      };
    }
  }

  const aliases: ImportCatalogAlias[] = aliasRows
    .filter((a) => subindustryMap.has(a.subindustry_id))
    .map((a) => ({
      id: a.id,
      subindustryId: a.subindustry_id,
      alias: a.alias,
      languageCode: a.language_code,
      countryCode: a.country_code,
      active: true,
    }));

  const catalog: ImportClassificationCatalog = {
    version: catalogVersion,
    industries: [...industryMap.values()],
    subindustries: [...subindustryMap.values()],
    aliases,
  };

  return { success: true, catalog, catalogVersionId };
}
