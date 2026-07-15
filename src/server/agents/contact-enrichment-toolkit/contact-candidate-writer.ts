// Agente 2A — Contact Candidate Writer
// Hito 17A.3A — Inserta candidatos deduplicados en contact_enrichment_candidates.
// status = 'pending_review'. NO crea contactos finales en `contacts`.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DeduplicatedContact } from './contact-deduplicator';
import {
  findMatchingPendingCandidate,
  readPendingCandidatesForSameAccount,
  type PendingCandidateRecord,
} from './pending-candidate-cross-run-check';

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

export interface WriteCandidatesResult {
  inserted: number;
  skippedNoName: number;
  /**
   * Omitidos por coincidir con un candidato pending_review de otro run de la
   * misma cuenta (17B.4X.7C.3H.3). Optional para no romper stubs de test
   * preexistentes que devuelven WriteCandidatesResult sin este campo —
   * los llamadores deben tratar undefined como 0.
   */
  skippedExistingPending?: number;
  error?: string;
}

interface CandidateRow {
  enrichment_run_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  country: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  source: 'apollo';
  source_contact_id: string | null;
  confidence: number;
  status: 'pending_review';
  duplicate_status: DeduplicatedContact['duplicateStatus'];
  enrichment_metadata: Record<string, unknown>;
}

function toRow(runId: string, candidate: DeduplicatedContact): CandidateRow {
  return {
    enrichment_run_id: runId,
    first_name: candidate.firstName,
    last_name: candidate.lastName,
    full_name: candidate.fullName,
    title: candidate.title,
    seniority: candidate.seniority,
    department: candidate.department,
    country: candidate.country,
    linkedin_url: candidate.linkedinUrl,
    email: candidate.email,
    phone: candidate.phone,
    source: 'apollo',
    source_contact_id: candidate.sourceContactId,
    confidence: candidate.confidence,
    status: 'pending_review',
    duplicate_status: candidate.duplicateStatus,
    enrichment_metadata: candidate.enrichmentMetadata,
  };
}

export interface ContactCandidateWriterDeps {
  insertRows?: (rows: CandidateRow[]) => Promise<{ error?: string }>;
  /**
   * account_id de la cuenta SellUp del run actual (17B.4X.7C.3H.3). Cuando
   * está presente, se consulta contact_enrichment_candidates de OTROS runs
   * de la misma cuenta para evitar insertar un pending_review duplicado.
   * null/undefined (empresa HubSpot-only o manual) → el check se omite (V1).
   */
  accountId?: string | null;
  loadExistingPendingCandidates?: (
    accountId: string,
    runId: string,
  ) => Promise<PendingCandidateRecord[]>;
}

async function defaultInsertRows(rows: CandidateRow[]): Promise<{ error?: string }> {
  const admin = getAdminClient();
  const { error } = await admin.from('contact_enrichment_candidates').insert(rows);
  return { error: error?.message };
}

/**
 * Inserta candidatos en staging. Omite cualquier candidato sin full_name
 * (regla del hito). No inserta exact_duplicate: ese filtrado ocurre antes,
 * en el deduplicador.
 */
export async function writeContactCandidates(
  runId: string,
  candidates: DeduplicatedContact[],
  deps: ContactCandidateWriterDeps = {},
): Promise<WriteCandidatesResult> {
  const {
    insertRows = defaultInsertRows,
    accountId = null,
    loadExistingPendingCandidates = readPendingCandidatesForSameAccount,
  } = deps;

  const named = candidates.filter((c) => c.fullName && c.fullName.trim().length > 0);
  const skippedNoName = candidates.length - named.length;

  if (named.length === 0) {
    return { inserted: 0, skippedNoName, skippedExistingPending: 0 };
  }

  // 17B.4X.7C.3H.3 — evita insertar un pending_review duplicado de otro run
  // de la misma cuenta. V1: solo cuando accountId está presente.
  const existingPending: PendingCandidateRecord[] = accountId
    ? await loadExistingPendingCandidates(accountId, runId)
    : [];

  const valid: DeduplicatedContact[] = [];
  let skippedExistingPending = 0;
  for (const candidate of named) {
    const match = findMatchingPendingCandidate(candidate, existingPending);
    if (match) {
      skippedExistingPending += 1;
      continue;
    }
    valid.push(candidate);
  }

  if (valid.length === 0) {
    return { inserted: 0, skippedNoName, skippedExistingPending };
  }

  const rows = valid.map((c) => toRow(runId, c));
  const { error } = await insertRows(rows);

  if (error) {
    return { inserted: 0, skippedNoName, skippedExistingPending, error };
  }

  return { inserted: rows.length, skippedNoName, skippedExistingPending };
}
