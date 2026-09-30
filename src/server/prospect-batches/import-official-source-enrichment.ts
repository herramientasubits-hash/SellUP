/**
 * AGENT1-IMPORT-PARITY-8 — primero las fuentes GRATUITAS.
 *
 * Una fila importada sin identificador fiscal se busca en los catálogos
 * oficiales configurados (hoy Colombia `co_siis` y República Dominicana
 * `rd_dgii_bulk`) con la MISMA costura que usan Apollo y Lusha antes de
 * escribir: `normalizeProviderDiscoveredCompany` →
 * `enrichNormalizedProspectWithOfficialSources`. Sólo una identidad FUERTE
 * (confianza ≥ política compartida) llena columnas; lo débil queda como señal
 * en metadata.
 *
 * Corre ANTES de la admisión por identidad, para que el NIT/RNC encontrado
 * también decida duplicados y el reclamo global.
 *
 * Nunca lanza: un catálogo caído degrada a «sin enriquecer» (fail-soft de la
 * política compartida) y la importación sigue.
 */

import {
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
  normalizeProviderDiscoveredCompany,
  type OfficialSourceResolver,
  type ProspectSearchCriteria,
} from '@/server/agents/prospect-intake';

export const IMPORT_SOURCE_ENRICHMENT_METADATA_KEY = 'source_enrichment';

/** Consultas simultáneas al catálogo: acota la carga de un archivo de 500 filas. */
export const IMPORT_OFFICIAL_SOURCE_CONCURRENCY = 8;

export type ImportOfficialSourceRow = {
  rowNumber: number;
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  /** Ya normalizado. Una fila CON identificador fiscal no se busca. */
  taxIdentifier: string | null;
};

export type ImportOfficialSourceOutcome = {
  /** Columnas tipadas; todas null salvo identidad fuerte. */
  typedColumns: ReturnType<typeof buildOfficialSourceTypedColumns>;
  metadata: ReturnType<typeof buildOfficialSourceEnrichmentMetadata>;
  strongIdentityAvailable: boolean;
};

function servedCountries(resolvers: readonly OfficialSourceResolver[]): Set<string> {
  return new Set(resolvers.map((r) => r.countryCode.toUpperCase()));
}

async function enrichOne(
  row: ImportOfficialSourceRow,
  resolvers: OfficialSourceResolver[],
): Promise<ImportOfficialSourceOutcome> {
  const criteria: ProspectSearchCriteria = {
    countryCode: row.countryCode,
    sourceProvider: 'external_import',
  };
  const normalized = normalizeProviderDiscoveredCompany(
    {
      provider: 'external_import',
      companyName: row.name,
      websiteUrl: row.website,
      domain: row.domain,
      countryCode: row.countryCode,
    },
    criteria,
  );
  const enriched = await enrichNormalizedProspectWithOfficialSources(normalized, criteria, resolvers);
  return {
    typedColumns: buildOfficialSourceTypedColumns(enriched),
    metadata: buildOfficialSourceEnrichmentMetadata(enriched),
    strongIdentityAvailable: enriched.strongIdentityAvailable,
  };
}

/**
 * Busca en los catálogos oficiales las filas SIN identificador fiscal cuyo país
 * tiene un catálogo conectado. Devuelve un mapa por `rowNumber`; una fila que
 * no se buscó no aparece.
 */
export async function enrichImportRowsWithOfficialSources(
  rows: readonly ImportOfficialSourceRow[],
  resolvers: OfficialSourceResolver[],
  concurrency: number = IMPORT_OFFICIAL_SOURCE_CONCURRENCY,
): Promise<Map<number, ImportOfficialSourceOutcome>> {
  const outcomes = new Map<number, ImportOfficialSourceOutcome>();
  if (resolvers.length === 0) return outcomes;

  const countries = servedCountries(resolvers);
  const pending = rows.filter(
    (r) => !r.taxIdentifier && !!r.countryCode && countries.has(r.countryCode.toUpperCase()),
  );

  for (let i = 0; i < pending.length; i += Math.max(1, concurrency)) {
    const chunk = pending.slice(i, i + Math.max(1, concurrency));
    const results = await Promise.all(
      chunk.map(async (row) => {
        try {
          return [row.rowNumber, await enrichOne(row, resolvers)] as const;
        } catch (err) {
          console.error('[import-official-source] enrichment failed:', err);
          return null;
        }
      }),
    );
    for (const entry of results) if (entry) outcomes.set(entry[0], entry[1]);
  }
  return outcomes;
}
