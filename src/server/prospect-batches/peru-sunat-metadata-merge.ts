/**
 * Perú.5I — Peru SUNAT Metadata Merge Helper
 *
 * Pure helper to propagate pe_sunat_bulk from candidate metadata to account metadata.
 *
 * Rules:
 * - If candidateMetadata has no source_enrichment.pe_sunat_bulk → return accountMetadata unchanged.
 * - If pe_sunat_bulk exists → merge only that key into account.metadata.source_enrichment.
 * - Never delete existing account metadata.
 * - Never overwrite other source_enrichment keys (CO, MX, CL, etc.).
 * - Only applies to PE; caller is responsible for country guard if needed.
 *
 * GUARDRAILS — this module must NEVER:
 * - Call SUNAT API, Migo, Tavily, or any external API.
 * - Insert into prospect_candidates or accounts tables.
 * - Create or delete candidates/accounts.
 * - Set official_ciiu_available to true.
 */

// ── Main helper ────────────────────────────────────────────────────────────────

/**
 * Returns a new accountMetadata object with candidate's pe_sunat_bulk block merged in.
 *
 * @param accountMetadata  - Existing account metadata (immutable — never mutated).
 * @param candidateMetadata - Source metadata read from the candidate row.
 * @returns New account metadata with pe_sunat_bulk merged, or original if not applicable.
 */
export function mergePeruSunatMetadataIntoAccountMetadata(
  accountMetadata: Record<string, unknown>,
  candidateMetadata: Record<string, unknown>,
): Record<string, unknown> {
  const candidateSourceEnrichment = candidateMetadata.source_enrichment as
    | Record<string, unknown>
    | null
    | undefined;

  const peSunatBulk = candidateSourceEnrichment?.pe_sunat_bulk;

  // No-op: candidate has no pe_sunat_bulk to propagate.
  if (peSunatBulk === undefined || peSunatBulk === null) {
    return accountMetadata;
  }

  const existingAccountSourceEnrichment =
    (accountMetadata.source_enrichment as Record<string, unknown> | null | undefined) ?? {};

  return {
    ...accountMetadata,
    source_enrichment: {
      ...existingAccountSourceEnrichment,
      pe_sunat_bulk: peSunatBulk,
    },
  };
}
