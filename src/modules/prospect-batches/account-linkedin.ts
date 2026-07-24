/**
 * Q3F-5BB.7E — Transfer of the corporate LinkedIn company URL from an approved
 * prospect candidate into the created SellUp account.
 *
 * This module is PURE: no Supabase import, no network, no feature flags. The
 * caller passes a `runInsert` thunk so the fallback logic stays unit-testable
 * without a database. It exists so the candidate -> account conversion can carry
 * `linkedin_url` while remaining backward-compatible during the window BEFORE the
 * additive `accounts.linkedin_url` migration (096) is applied in production.
 */

import { getCandidateLinkedInUrl, isLinkedInCompanyUrl } from './candidate-linkedin-url';

/** Minimal candidate shape needed to resolve a corporate LinkedIn URL. */
export interface CandidateLinkedInSource {
  metadata?: unknown;
  linkedin_url?: unknown;
}

/**
 * Resolves the corporate LinkedIn company URL to store on the account.
 *
 * Reuses the Q3F-5BB.7D metadata helper (canonical
 * `metadata.linkedin_enrichment.company_url`, the enrichment/import fallbacks,
 * and the flat `metadata.linkedin_url` written by the Lusha writer). Only falls
 * back to the candidate's top-level `linkedin_url` column when that value is
 * itself a valid `/company/` URL.
 *
 * Never invents a URL. Never returns a personal (`/in/`), posts, jobs, school or
 * showcase profile — those are rejected by `isLinkedInCompanyUrl`.
 */
export function resolveCandidateAccountLinkedInUrl(
  candidate: CandidateLinkedInSource | null | undefined,
): string | null {
  if (!candidate) return null;

  const fromMetadata = getCandidateLinkedInUrl(
    (candidate.metadata as Record<string, unknown> | null | undefined) ?? null,
  );
  if (fromMetadata) return fromMetadata;

  if (isLinkedInCompanyUrl(candidate.linkedin_url)) return candidate.linkedin_url;

  return null;
}

/** PostgREST / Postgres error shape we care about (loosely typed on purpose). */
export interface DbInsertError {
  code?: string | null;
  message?: string | null;
}

/**
 * True when an insert failed specifically because `accounts.linkedin_url` does
 * not exist yet (migration 096 not applied). Covers the Postgres
 * `undefined_column` code (42703) and the PostgREST schema-cache miss
 * (PGRST204).
 *
 * Any other error is NOT treated as a missing column — the caller must surface
 * it. When a message is present we require it to name the column so an unrelated
 * undefined-column error is never retry-masked.
 */
export function isMissingLinkedInColumnError(
  error: DbInsertError | null | undefined,
): boolean {
  if (!error) return false;
  const code = (error.code ?? '').toString();
  const message = (error.message ?? '').toString().toLowerCase();

  if (code === '42703' || code === 'PGRST204') {
    return message.length === 0 || message.includes('linkedin_url');
  }

  return (
    message.includes('linkedin_url') &&
    (message.includes('column') || message.includes('schema cache'))
  );
}

export interface InsertResult<T> {
  data: T | null;
  error: DbInsertError | null;
}

export interface AccountInsertOutcome<T> extends InsertResult<T> {
  /** True when the insert succeeded only after dropping linkedin_url (column absent). */
  linkedinColumnMissing: boolean;
}

/**
 * Inserts an account payload, optionally carrying `linkedin_url`.
 *
 * If the column is not present yet, retries EXACTLY ONCE without it so candidate
 * approval keeps working before the migration lands, and reports the fact via
 * `linkedinColumnMissing`. Non-column errors are returned as-is (never
 * swallowed). When `linkedinUrl` is null the base payload is inserted directly
 * without a `linkedin_url` key.
 */
export async function insertAccountWithLinkedInFallback<T>(
  runInsert: (payload: Record<string, unknown>) => Promise<InsertResult<T>>,
  basePayload: Record<string, unknown>,
  linkedinUrl: string | null,
): Promise<AccountInsertOutcome<T>> {
  if (!linkedinUrl) {
    const res = await runInsert(basePayload);
    return { ...res, linkedinColumnMissing: false };
  }

  const first = await runInsert({ ...basePayload, linkedin_url: linkedinUrl });
  if (!first.error) return { ...first, linkedinColumnMissing: false };

  if (isMissingLinkedInColumnError(first.error)) {
    // Controlled, non-technical warning: approval must not break pre-migration.
    console.warn(
      '[account-linkedin] accounts.linkedin_url no existe todavía (migración 096 sin aplicar); ' +
        'reintentando alta de cuenta sin linkedin_url (account_linkedin_column_missing)',
    );
    const retry = await runInsert(basePayload);
    return { ...retry, linkedinColumnMissing: true };
  }

  // Any other error: surface it unchanged — do not swallow.
  return { ...first, linkedinColumnMissing: false };
}
