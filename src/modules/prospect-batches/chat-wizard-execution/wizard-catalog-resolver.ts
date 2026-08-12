import type { SupabaseClient } from '@supabase/supabase-js';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { resolveDiscoveryTaxonomyCapability } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { WizardExecutionError } from './wizard-execution-types';
import type {
  ResolvedCountry,
  ResolvedIndustry,
  ResolvedSubindustry,
  ResolvedCatalog,
} from './wizard-execution-types';

// ── Input / output ────────────────────────────────────────────────────────────

export type CatalogResolutionInput = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  catalogVersion: string;
};

export type CatalogResolutionOutput = {
  country: ResolvedCountry;
  catalog: ResolvedCatalog;
  industry: ResolvedIndustry;
  subindustries: ResolvedSubindustry[];
};

// ── Resolución bajo la taxonomía macro ────────────────────────────────────────

type MacroCatalogRow = {
  catalog_version: string;
  industry_id: string;
  industry_name: string;
  industry_slug: string;
};

/**
 * Resuelve país, versión e industria bajo el catálogo de Macro Industrias.
 *
 * Tres diferencias con la ruta legacy, y ninguna es una relajación:
 *
 *   1. Lee `active_macro_industry_catalog`, que no exige subindustrias.
 *   2. § 18 — EXACTAMENTE una macro industria. Sigue siendo obligatoria y sigue
 *      verificándose contra el catálogo publicado por UUID.
 *   3. § 7 — cualquier subindustria que llegue en la petición se RECHAZA en vez
 *      de ignorarse. Bajo v2 el paso no existe, así que recibir ids sólo puede
 *      significar estado obsoleto de una sesión anterior o una petición
 *      manipulada; aceptarlos en silencio dejaría que un lote nuevo arrastrara
 *      criterios que la persona nunca vio.
 */
async function resolveMacroWizardCatalog(
  input: CatalogResolutionInput,
  supabase: SupabaseClient,
): Promise<CatalogResolutionOutput> {
  const { countryCode, industryId, subindustryIds, catalogVersion } = input;

  if (subindustryIds.length > 0) {
    throw new WizardExecutionError(
      'INVALID_REQUEST',
      'La selección de subindustrias no está disponible en este catálogo.',
    );
  }

  const { data: rows, error } = await supabase
    .from('active_macro_industry_catalog')
    .select('catalog_version, industry_id, industry_name, industry_slug');

  if (error || !rows || rows.length === 0) {
    throw new WizardExecutionError(
      'CATALOG_VERSION_NOT_FOUND',
      'No se pudo consultar el catálogo publicado.',
    );
  }

  const catalogRows = rows as MacroCatalogRow[];
  const publishedVersion = catalogRows[0].catalog_version;
  if (catalogVersion !== publishedVersion) {
    throw new WizardExecutionError(
      'CATALOG_VERSION_CHANGED',
      'El catálogo ha sido actualizado. Recarga la página e intenta nuevamente.',
    );
  }

  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === countryCode);
  if (!countryEntry) {
    throw new WizardExecutionError('INVALID_REQUEST', `País no soportado: ${countryCode}`);
  }

  const industryRow = catalogRows.find((r) => r.industry_id === industryId);
  if (!industryRow) {
    throw new WizardExecutionError(
      'INDUSTRY_NOT_FOUND',
      'La macro industria seleccionada no existe en el catálogo publicado.',
    );
  }

  return {
    country: { code: countryEntry.code, name: countryEntry.name },
    catalog: { version: publishedVersion },
    industry: {
      id: industryRow.industry_id,
      slug: industryRow.industry_slug,
      name: industryRow.industry_name,
    },
    subindustries: [],
  };
}

// ── Raw row shape from active_industry_catalog ────────────────────────────────

type CatalogRow = {
  catalog_version: string;
  industry_id: string;
  industry_name: string;
  industry_slug: string;
  subindustry_id: string;
  subindustry_name: string;
  subindustry_slug: string;
  applicable_countries: string[] | null;
};

// ── Resolver ──────────────────────────────────────────────────────────────────
// Accepts the Supabase server client as a parameter to enable unit testing with mocks.
// All operations are read-only. No writes, no mutations, no side effects.
// Never trusts labels from the input — all canonical data comes from the catalog.

export async function resolveWizardCatalog(
  input: CatalogResolutionInput,
  supabase: SupabaseClient,
): Promise<CatalogResolutionOutput> {
  const { countryCode, industryId, subindustryIds, catalogVersion } = input;

  // ── MACRO-INDUSTRY-CATALOG-DISCOVERY-1 §§ 7, 8 y 18 ───────────────────────
  //
  // Bajo la taxonomía macro la resolución es OTRA: `active_industry_catalog`
  // devuelve cero filas (hace INNER JOIN con subindustrias y no hay ninguna), y
  // la validación de subindustrias no tiene nada que validar. La bifurcación va
  // primero, antes de cualquier consulta, y NO confía en el cliente: la versión
  // enviada se vuelve a comprobar contra la publicada dentro de cada rama.
  if (resolveDiscoveryTaxonomyCapability(catalogVersion).mode === 'macro_industry') {
    return resolveMacroWizardCatalog(input, supabase);
  }

  // Guard: subindustries length (defense-in-depth before any DB query)
  if (subindustryIds.length > EXPLORATORY_SEARCH_LIMITS.subindustries.max) {
    throw new WizardExecutionError(
      'TOO_MANY_SUBINDUSTRIES',
      `Máximo ${EXPLORATORY_SEARCH_LIMITS.subindustries.max} subindustrias permitidas.`,
    );
  }

  // 1. Query the published catalog
  const { data: rows, error } = await supabase
    .from('active_industry_catalog')
    .select(
      'catalog_version, industry_id, industry_name, industry_slug, subindustry_id, subindustry_name, subindustry_slug, applicable_countries',
    );

  if (error || !rows || rows.length === 0) {
    throw new WizardExecutionError(
      'CATALOG_VERSION_NOT_FOUND',
      'No se pudo consultar el catálogo publicado.',
    );
  }

  const catalogRows = rows as CatalogRow[];

  // 2. Verify the submitted version matches the current published version
  const publishedVersion = catalogRows[0].catalog_version;
  if (catalogVersion !== publishedVersion) {
    throw new WizardExecutionError(
      'CATALOG_VERSION_CHANGED',
      'El catálogo ha sido actualizado. Recarga la página e intenta nuevamente.',
    );
  }

  // 3. Resolve country — must be in the supported LATAM_COUNTRIES list
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === countryCode);
  if (!countryEntry) {
    throw new WizardExecutionError(
      'INVALID_REQUEST',
      `País no soportado: ${countryCode}`,
    );
  }
  const country: ResolvedCountry = { code: countryEntry.code, name: countryEntry.name };

  // 4. Resolve industry by UUID — confirms it exists in this catalog version
  const industryRow = catalogRows.find((r) => r.industry_id === industryId);
  if (!industryRow) {
    throw new WizardExecutionError(
      'INDUSTRY_NOT_FOUND',
      'La industria seleccionada no existe en el catálogo publicado.',
    );
  }
  const industry: ResolvedIndustry = {
    id: industryRow.industry_id,
    slug: industryRow.industry_slug,
    name: industryRow.industry_name,
  };

  // 5. Build subindustry map scoped to this industry
  const subMap = new Map<
    string,
    { name: string; slug: string; applicableCountries: string[] | null }
  >();
  for (const row of catalogRows) {
    if (row.industry_id === industryId && !subMap.has(row.subindustry_id)) {
      subMap.set(row.subindustry_id, {
        name: row.subindustry_name,
        slug: row.subindustry_slug,
        applicableCountries: row.applicable_countries,
      });
    }
  }

  // 6. Resolve and validate each requested subindustry
  const subindustries: ResolvedSubindustry[] = [];
  for (const subId of subindustryIds) {
    const sub = subMap.get(subId);

    if (!sub) {
      // Check if the UUID exists under a different industry (mismatch vs not found)
      const existsElsewhere = catalogRows.some((r) => r.subindustry_id === subId);
      throw new WizardExecutionError(
        existsElsewhere ? 'SUBINDUSTRY_INDUSTRY_MISMATCH' : 'SUBINDUSTRY_NOT_FOUND',
        existsElsewhere
          ? 'Una subindustria no pertenece a la industria seleccionada.'
          : 'Una subindustria seleccionada no existe en el catálogo.',
      );
    }

    // Check country applicability — null means applicable everywhere
    if (
      sub.applicableCountries !== null &&
      !sub.applicableCountries.includes(countryCode)
    ) {
      throw new WizardExecutionError(
        'SUBINDUSTRY_COUNTRY_MISMATCH',
        `La subindustria "${sub.name}" no está disponible para el país seleccionado.`,
      );
    }

    subindustries.push({
      id: subId,
      slug: sub.slug,
      name: sub.name,
      applicableCountries: sub.applicableCountries,
    });
  }

  return {
    country,
    catalog: { version: publishedVersion },
    industry,
    subindustries,
  };
}
