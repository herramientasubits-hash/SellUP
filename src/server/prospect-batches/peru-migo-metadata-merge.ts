/**
 * Perú.6C — Peru Migo Metadata Merge Helper
 *
 * Pure helper to propagate pe_migo_api from candidate metadata to account metadata.
 *
 * Rules:
 * - If candidateMetadata has no source_enrichment.pe_migo_api → return accountMetadata unchanged.
 * - If pe_migo_api exists → merge only that key into account.metadata.source_enrichment.
 * - Never delete existing account metadata.
 * - Never overwrite other source_enrichment keys (pe_sunat_bulk, CO, MX, CL, etc.).
 * - Only applies to PE; caller is responsible for country guard if needed.
 *
 * Relationship with pe_sunat_bulk:
 * - pe_sunat_bulk: offline snapshot validation (Perú.5C) — OFFICIAL source
 * - pe_migo_api: point-query live legal enrichment (Perú.6C) — COMPLEMENTARY source
 * - Both coexist under metadata.source_enrichment — neither key overwrites the other
 *
 * GUARDRAILS — this module must NEVER:
 * - Call SUNAT API, Migo, Tavily, or any external API.
 * - Insert into prospect_candidates or accounts tables.
 * - Create or delete candidates/accounts.
 * - Set official_ciiu_available to true.
 * - Overwrite pe_sunat_bulk or any other existing source_enrichment key.
 */

// ── Main helper ────────────────────────────────────────────────────────────────

/**
 * Returns a new accountMetadata object with candidate's pe_migo_api block merged in.
 *
 * pe_sunat_bulk and all other existing source_enrichment keys are preserved.
 *
 * @param accountMetadata   - Existing account metadata (immutable — never mutated).
 * @param candidateMetadata - Source metadata read from the candidate row.
 * @returns New account metadata with pe_migo_api merged, or original if not applicable.
 */
export function mergePeruMigoMetadataIntoAccountMetadata(
  accountMetadata: Record<string, unknown>,
  candidateMetadata: Record<string, unknown>,
): Record<string, unknown> {
  const candidateSourceEnrichment = candidateMetadata.source_enrichment as
    | Record<string, unknown>
    | null
    | undefined;

  const peMigoApi = candidateSourceEnrichment?.pe_migo_api;

  // No-op: candidate has no pe_migo_api to propagate.
  if (peMigoApi === undefined || peMigoApi === null) {
    return accountMetadata;
  }

  const existingAccountSourceEnrichment =
    (accountMetadata.source_enrichment as Record<string, unknown> | null | undefined) ?? {};

  return {
    ...accountMetadata,
    source_enrichment: {
      ...existingAccountSourceEnrichment,
      pe_migo_api: peMigoApi,
    },
  };
}
