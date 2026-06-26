/**
 * Read-only coverage summary for Peru SUNAT snapshot and Migo fallback.
 *
 * Guardrails (enforced by design — no external calls, no writes):
 *   noSunatWebRuntime      : this module never fetches from sunat.gob.pe
 *   noVercelZipProcessing  : no zip/bulk-file processing at runtime
 *   noMigoDiscovery        : Migo check is vault-presence only, no API call
 *   noOfficialCiiuForMvp   : CIIU is not available in this snapshot
 *   sectorIsInferredByWebAi: sector is inferred by web/AI, not from SUNAT
 */

import { hasMigoApiKey } from './migo-connection';

// ---------------------------------------------------------------------------
// Audited constants
// Source: AUDITORIA-FUENTES-IA.md — Hito Perú.7F (2026-06-26)
// ---------------------------------------------------------------------------

export interface SunatSnapshotCounts {
  total: number;
  activeHabido: number;
  activeNotHabido: number;
  inactiveHabido: number;
  inactiveNotHabido: number;
}

/** Last confirmed snapshot distribution (Perú.7F, 2026-06-26). */
export const AUDITED_SUNAT_SNAPSHOT: SunatSnapshotCounts = {
  total: 100_000,
  activeHabido: 14_221,
  activeNotHabido: 1_199,
  inactiveHabido: 48_188,
  inactiveNotHabido: 36_392,
};

/** Total RUC-20 universe from official SUNAT Padrón. Source: AUDITORIA-FUENTES-IA.md. */
const AUDITED_TOTAL_RUC20 = 851_883;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SunatCoverage {
  sourceKey: 'pe_sunat_bulk';
  loadedRows: number;
  activeHabidoRows: number;
  activeNotHabidoRows: number;
  inactiveHabidoRows: number;
  inactiveNotHabidoRows: number;
  nextRecommendedOffset: number;
  coverageLabel: 'partial_snapshot';
  coveragePercent: number;
  officialLegalValidation: true;
  providesCiiu: false;
  providesOfficialSector: false;
}

export interface MigoCoverage {
  sourceKey: 'pe_migo_api';
  role: 'legal_api_fallback';
  configured: boolean | 'unknown';
  providesCiiu: false;
  providesOfficialSector: false;
  performsDiscovery: false;
}

export interface PeruGuardrails {
  noSunatWebRuntime: true;
  noVercelZipProcessing: true;
  noMigoDiscovery: true;
  noOfficialCiiuForMvp: true;
  sectorIsInferredByWebAi: true;
}

export interface PeruSourceCoverageSummary {
  countryCode: 'PE';
  sunat: SunatCoverage;
  migo: MigoCoverage;
  guardrails: PeruGuardrails;
}

// ---------------------------------------------------------------------------
// Pure builders (no I/O — fully testable without mocks)
// ---------------------------------------------------------------------------

/**
 * Builds the SUNAT coverage block from provided row counts.
 * nextRecommendedOffset = loadedRows (resume point for next import batch).
 */
export function buildSunatCoverage(counts: SunatSnapshotCounts): SunatCoverage {
  const coveragePercent =
    Math.round((counts.total / AUDITED_TOTAL_RUC20) * 1000) / 10;

  return {
    sourceKey: 'pe_sunat_bulk',
    loadedRows: counts.total,
    activeHabidoRows: counts.activeHabido,
    activeNotHabidoRows: counts.activeNotHabido,
    inactiveHabidoRows: counts.inactiveHabido,
    inactiveNotHabidoRows: counts.inactiveNotHabido,
    nextRecommendedOffset: counts.total,
    coverageLabel: 'partial_snapshot',
    coveragePercent,
    officialLegalValidation: true,
    providesCiiu: false,
    providesOfficialSector: false,
  };
}

/** Builds the Migo coverage block. Never reads the API key value. */
export function buildMigoCoverage(configured: boolean | 'unknown'): MigoCoverage {
  return {
    sourceKey: 'pe_migo_api',
    role: 'legal_api_fallback',
    configured,
    providesCiiu: false,
    providesOfficialSector: false,
    performsDiscovery: false,
  };
}

/** Returns the static guardrail flags. */
export function buildGuardrails(): PeruGuardrails {
  return {
    noSunatWebRuntime: true,
    noVercelZipProcessing: true,
    noMigoDiscovery: true,
    noOfficialCiiuForMvp: true,
    sectorIsInferredByWebAi: true,
  };
}

/** Assembles the full summary from pre-fetched parts. */
export function buildPeruCoverageSummary(
  counts: SunatSnapshotCounts,
  migoConfigured: boolean | 'unknown'
): PeruSourceCoverageSummary {
  return {
    countryCode: 'PE',
    sunat: buildSunatCoverage(counts),
    migo: buildMigoCoverage(migoConfigured),
    guardrails: buildGuardrails(),
  };
}

// ---------------------------------------------------------------------------
// I/O helpers (async, injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Resolves whether the Migo API key is stored in Vault.
 * Returns 'unknown' when SUPABASE_SERVICE_ROLE_KEY is absent (cannot query).
 * Never reads or exposes the Migo key value itself.
 */
export async function resolveMigoConfigured(): Promise<boolean | 'unknown'> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 'unknown';
  try {
    return await hasMigoApiKey();
  } catch {
    return 'unknown';
  }
}

/**
 * Returns a full, read-only coverage summary.
 *
 * @param counts   Provide to override the audited constants (useful in tests).
 *                 Omit to use AUDITED_SUNAT_SNAPSHOT.
 */
export async function getPeruSourceCoverageSummary(
  counts?: SunatSnapshotCounts
): Promise<PeruSourceCoverageSummary> {
  const resolvedCounts = counts ?? AUDITED_SUNAT_SNAPSHOT;
  const migoConfigured = await resolveMigoConfigured();
  return buildPeruCoverageSummary(resolvedCounts, migoConfigured);
}
