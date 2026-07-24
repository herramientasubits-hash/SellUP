/**
 * Q3F-5BB.7E — Account LinkedIn transfer (pure unit tests).
 *
 * Proves the candidate -> account LinkedIn resolution and the backward-compatible
 * insert fallback WITHOUT touching a database, network, or any provider. The
 * helper is pure and receives a `runInsert` thunk so the fallback branches are
 * exercised deterministically.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCandidateAccountLinkedInUrl,
  isMissingLinkedInColumnError,
  insertAccountWithLinkedInFallback,
  type InsertResult,
} from '../account-linkedin';

const COMPANY_URL = 'https://www.linkedin.com/company/acme-sa';
const PERSONAL_URL = 'https://www.linkedin.com/in/jane-doe';

// ── resolveCandidateAccountLinkedInUrl ─────────────────────────

describe('Q3F-5BB.7E — resolveCandidateAccountLinkedInUrl', () => {
  it('reads the canonical metadata.linkedin_enrichment.company_url', () => {
    const url = resolveCandidateAccountLinkedInUrl({
      metadata: { linkedin_enrichment: { company_url: COMPANY_URL } },
    });
    assert.equal(url, COMPANY_URL);
  });

  it('reads the flat metadata.linkedin_url written by the Lusha writer (7D)', () => {
    const url = resolveCandidateAccountLinkedInUrl({
      metadata: { linkedin_url: COMPANY_URL },
    });
    assert.equal(url, COMPANY_URL);
  });

  it('falls back to the top-level linkedin_url column when it is a company URL', () => {
    const url = resolveCandidateAccountLinkedInUrl({
      metadata: {},
      linkedin_url: COMPANY_URL,
    });
    assert.equal(url, COMPANY_URL);
  });

  it('does NOT transfer a personal (/in/) profile from metadata', () => {
    const url = resolveCandidateAccountLinkedInUrl({
      metadata: { linkedin_url: PERSONAL_URL },
    });
    assert.equal(url, null);
  });

  it('does NOT transfer a personal (/in/) profile from the top-level column', () => {
    const url = resolveCandidateAccountLinkedInUrl({
      metadata: {},
      linkedin_url: PERSONAL_URL,
    });
    assert.equal(url, null);
  });

  it('returns null when there is no LinkedIn anywhere (never invents one)', () => {
    assert.equal(resolveCandidateAccountLinkedInUrl({ metadata: {} }), null);
    assert.equal(resolveCandidateAccountLinkedInUrl({ metadata: null }), null);
    assert.equal(resolveCandidateAccountLinkedInUrl(null), null);
    assert.equal(resolveCandidateAccountLinkedInUrl(undefined), null);
  });

  it('prefers the metadata company URL over a top-level column value', () => {
    const other = 'https://www.linkedin.com/company/other-co';
    const url = resolveCandidateAccountLinkedInUrl({
      metadata: { linkedin_enrichment: { company_url: COMPANY_URL } },
      linkedin_url: other,
    });
    assert.equal(url, COMPANY_URL);
  });
});

// ── isMissingLinkedInColumnError ───────────────────────────────

describe('Q3F-5BB.7E — isMissingLinkedInColumnError', () => {
  it('detects Postgres undefined_column (42703) for linkedin_url', () => {
    assert.equal(
      isMissingLinkedInColumnError({
        code: '42703',
        message: 'column "linkedin_url" of relation "accounts" does not exist',
      }),
      true,
    );
  });

  it('detects the PostgREST schema-cache miss (PGRST204)', () => {
    assert.equal(
      isMissingLinkedInColumnError({
        code: 'PGRST204',
        message: "Could not find the 'linkedin_url' column of 'accounts' in the schema cache",
      }),
      true,
    );
  });

  it('detects a bare column error whose message names linkedin_url', () => {
    assert.equal(
      isMissingLinkedInColumnError({
        message: "Could not find the 'linkedin_url' column in the schema cache",
      }),
      true,
    );
  });

  it('does NOT treat an unrelated undefined-column error as missing linkedin_url', () => {
    assert.equal(
      isMissingLinkedInColumnError({
        code: '42703',
        message: 'column "website" of relation "accounts" does not exist',
      }),
      false,
    );
  });

  it('does NOT treat a generic DB error as a missing column', () => {
    assert.equal(
      isMissingLinkedInColumnError({ code: '23505', message: 'duplicate key value' }),
      false,
    );
    assert.equal(isMissingLinkedInColumnError(null), false);
    assert.equal(isMissingLinkedInColumnError(undefined), false);
  });
});

// ── insertAccountWithLinkedInFallback ──────────────────────────

interface FakeAccount {
  id: string;
  linkedin_url?: string;
}

/** Builds a recording runInsert that returns the queued responses in order. */
function recordingInsert(responses: InsertResult<FakeAccount>[]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const runInsert = async (payload: Record<string, unknown>) => {
    calls.push(payload);
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return res;
  };
  return { runInsert, calls };
}

describe('Q3F-5BB.7E — insertAccountWithLinkedInFallback', () => {
  it('includes linkedin_url in the insert when present and the column exists', async () => {
    const { runInsert, calls } = recordingInsert([
      { data: { id: 'acc-1', linkedin_url: COMPANY_URL }, error: null },
    ]);
    const out = await insertAccountWithLinkedInFallback(
      runInsert,
      { name: 'Acme' },
      COMPANY_URL,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].linkedin_url, COMPANY_URL);
    assert.equal(calls[0].name, 'Acme');
    assert.equal(out.linkedinColumnMissing, false);
    assert.equal(out.error, null);
    assert.equal(out.data?.id, 'acc-1');
  });

  it('omits linkedin_url entirely when the resolved URL is null', async () => {
    const { runInsert, calls } = recordingInsert([
      { data: { id: 'acc-2' }, error: null },
    ]);
    const out = await insertAccountWithLinkedInFallback(runInsert, { name: 'Acme' }, null);
    assert.equal(calls.length, 1);
    assert.equal('linkedin_url' in calls[0], false);
    assert.equal(out.linkedinColumnMissing, false);
    assert.equal(out.data?.id, 'acc-2');
  });

  it('retries once WITHOUT linkedin_url when the column is missing, keeping conversion working', async () => {
    const { runInsert, calls } = recordingInsert([
      { data: null, error: { code: '42703', message: 'column "linkedin_url" does not exist' } },
      { data: { id: 'acc-3' }, error: null },
    ]);
    const out = await insertAccountWithLinkedInFallback(
      runInsert,
      { name: 'Acme' },
      COMPANY_URL,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].linkedin_url, COMPANY_URL); // first attempt carried it
    assert.equal('linkedin_url' in calls[1], false); // retry dropped it
    assert.equal(out.linkedinColumnMissing, true);
    assert.equal(out.error, null);
    assert.equal(out.data?.id, 'acc-3');
  });

  it('retries once on the PostgREST schema-cache miss (PGRST204)', async () => {
    const { runInsert, calls } = recordingInsert([
      {
        data: null,
        error: {
          code: 'PGRST204',
          message: "Could not find the 'linkedin_url' column of 'accounts' in the schema cache",
        },
      },
      { data: { id: 'acc-4' }, error: null },
    ]);
    const out = await insertAccountWithLinkedInFallback(runInsert, { name: 'Acme' }, COMPANY_URL);
    assert.equal(calls.length, 2);
    assert.equal(out.linkedinColumnMissing, true);
    assert.equal(out.data?.id, 'acc-4');
  });

  it('does NOT retry and does NOT swallow a non-column DB error', async () => {
    const dbError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const { runInsert, calls } = recordingInsert([{ data: null, error: dbError }]);
    const out = await insertAccountWithLinkedInFallback(runInsert, { name: 'Acme' }, COMPANY_URL);
    assert.equal(calls.length, 1); // no second attempt
    assert.equal(out.linkedinColumnMissing, false);
    assert.equal(out.error, dbError); // surfaced unchanged
    assert.equal(out.data, null);
  });
});
