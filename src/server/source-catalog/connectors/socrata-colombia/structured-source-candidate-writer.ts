/**
 * Structured Source Candidate Writer — Socrata Colombia Wrapper
 *
 * Delegador/Wrapper del writer genérico centralizado para conservar
 * compatibilidad de firmas e imports existentes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StructuredSourceCandidateDraft } from '../../../agents/prospecting-toolkit/structured-candidate-types';
import {
  writeStructuredSourceCandidatesPreview as writeStructuredGeneric,
} from '../../../agents/prospecting-toolkit/structured-source-candidate-writer';
import type {
  StructuredSourceCandidateWriterReport as GenericReport,
} from '../../../agents/prospecting-toolkit/structured-source-candidate-writer';

// ── Tipos compatibles ──────────────────────────────────────────

export type StructuredSourceCandidateWriterInput = {
  dryRun: boolean;
  requestedByUserId: string;
  ownerId?: string | null;
  country: string;
  countryCode: string;
  sourceKey: string;
  sourceProvider: string;
  dataset: string;
  candidates: StructuredSourceCandidateDraft[];
  runHubSpotCheck?: boolean;
  limit?: number;
  uiSmokeTest?: boolean;
};

export type StructuredSourceCandidateWriterReport = GenericReport;

// ── Writer principal (delegado) ───────────────────────────────

/**
 * Wrapper backward-compatible que delega al writer genérico centralizado.
 */
export async function writeStructuredSourceCandidatesPreview(
  supabase: SupabaseClient,
  input: StructuredSourceCandidateWriterInput,
): Promise<StructuredSourceCandidateWriterReport> {
  return writeStructuredGeneric(supabase, {
    dryRun: input.dryRun,
    requestedByUserId: input.requestedByUserId,
    ownerId: input.ownerId,
    country: input.country,
    countryCode: input.countryCode,
    sourceKey: input.sourceKey,
    sourceProvider: input.sourceProvider,
    dataset: input.dataset,
    candidates: input.candidates,
    runHubSpotCheck: input.runHubSpotCheck,
    limit: input.limit,
    uiSmokeTest: input.uiSmokeTest,
  });
}
