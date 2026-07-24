/**
 * Q3F-5BB.7E — Static safety guards.
 *
 * Q3F-5BB.7E adds ONE additive migration (096) creating `accounts.linkedin_url`
 * and transfers the corporate LinkedIn company URL from an approved prospect
 * candidate into the created account, plus a read-only account-detail row. This
 * milestone does NOT apply the migration, does NOT call Lusha / HubSpot /
 * enrichment / any provider, does NOT add a HubSpot write, and does NOT touch
 * feature flags.
 *
 * These tests read files on disk and assert the invariants — no network, no DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → prospect-batches → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

function readRepo(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/** Strips `--` SQL line comments so prose ("no NOT NULL") is not scanned as DDL. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Strips TS block + line comments so doc prose is not scanned as code. */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const MIGRATION_REL = 'supabase/migrations/096_add_accounts_linkedin_url.sql';
const HELPER_REL = 'src/modules/prospect-batches/account-linkedin.ts';
const ACTIONS_REL = 'src/modules/prospect-batches/actions.ts';
const ACCOUNT_TYPES_REL = 'src/modules/accounts/types.ts';
const ACCOUNT_PAGE_REL = 'src/app/(sellup)/accounts/[accountId]/page.tsx';

// ── Migration 096: additive only ───────────────────────────────

describe('Q3F-5BB.7E migration 096 — additive only', () => {
  const rawSql = readRepo(MIGRATION_REL);
  const sql = stripSqlComments(rawSql);
  const upper = sql.toUpperCase();

  it('exists with the expected name', () => {
    assert.equal(existsSync(join(REPO_ROOT, MIGRATION_REL)), true);
  });

  it('adds accounts.linkedin_url with ADD COLUMN IF NOT EXISTS ... text', () => {
    assert.equal(
      /ALTER TABLE public\.accounts\s+ADD COLUMN IF NOT EXISTS\s+linkedin_url\s+text/i.test(sql),
      true,
    );
  });

  it('only touches public.accounts', () => {
    const altered = [...sql.matchAll(/ALTER TABLE\s+([a-z0-9_.]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    );
    assert.deepEqual(altered, ['public.accounts']);
    // never prospect_candidates or contacts
    assert.equal(/prospect_candidates/i.test(sql), false);
    assert.equal(/\bcontacts\b/i.test(sql), false);
  });

  it('is NOT destructive (no DROP / DELETE / TRUNCATE / ALTER COLUMN)', () => {
    assert.equal(/\bDROP\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
    assert.equal(/ALTER COLUMN/i.test(sql), false);
  });

  it('does NOT backfill (no UPDATE / INSERT) and adds no NOT NULL / index / constraint', () => {
    assert.equal(/\bUPDATE\b/i.test(sql), false);
    assert.equal(/\bINSERT\b/i.test(sql), false);
    assert.equal(upper.includes('NOT NULL'), false);
    assert.equal(/CREATE\s+INDEX/i.test(sql), false);
    assert.equal(/ADD CONSTRAINT|CHECK\s*\(/i.test(sql), false);
  });

  it('does NOT change RLS / policies / triggers', () => {
    assert.equal(/ROW LEVEL SECURITY/i.test(sql), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(sql), false);
    assert.equal(/CREATE TRIGGER|DROP TRIGGER/i.test(sql), false);
  });

  it('carries the documented column comment', () => {
    assert.equal(/COMMENT ON COLUMN public\.accounts\.linkedin_url/i.test(rawSql), true);
  });

  it('is repo-only: no `supabase db push`, no provider / reveal surface (code, not prose)', () => {
    // Scan the comment-stripped DDL: the header prose legitimately explains that
    // the file is NOT applied via `supabase db push`.
    assert.equal(/supabase\s+db\s+push/i.test(sql), false);
    assert.equal(/reveal_phone_number/i.test(sql), false);
    assert.equal(/hubspot/i.test(sql), false);
  });
});

// ── Pure helper: no DB / network / provider / flag ─────────────

describe('Q3F-5BB.7E helper — pure, provider-free', () => {
  const helperRaw = readRepo(HELPER_REL);
  // Scan CODE only — doc comments legitimately mention "the Lusha writer".
  const helper = stripTsComments(helperRaw);

  it('imports only the 7D LinkedIn helper (no supabase / network / provider)', () => {
    assert.equal(/from '@\/lib\/supabase/.test(helper), false);
    assert.equal(/@supabase\/supabase-js/.test(helper), false);
    assert.equal(/\bfetch\s*\(/.test(helper), false);
    for (const provider of ['hubspot', 'apollo', 'lusha', 'tavily']) {
      assert.equal(
        new RegExp(provider, 'i').test(helper),
        false,
        `helper code must not reference ${provider}`,
      );
    }
  });

  it('does not read or mutate any feature flag', () => {
    assert.equal(/feature-flags/i.test(helper), false);
    assert.equal(/process\.env/.test(helper), false);
  });

  it('reuses the canonical getCandidateLinkedInUrl helper from 7D', () => {
    assert.ok(helperRaw.includes("from './candidate-linkedin-url'"));
    assert.ok(helperRaw.includes('getCandidateLinkedInUrl'));
  });
});

// ── Wiring in actions.ts (both account-creation sites) ─────────

describe('Q3F-5BB.7E wiring — actions.ts', () => {
  const actions = readRepo(ACTIONS_REL);

  it('imports the 7E helpers', () => {
    assert.ok(actions.includes("from './account-linkedin'"));
    assert.ok(actions.includes('resolveCandidateAccountLinkedInUrl'));
    assert.ok(actions.includes('insertAccountWithLinkedInFallback'));
  });

  it('resolves the candidate LinkedIn at both account-creation sites', () => {
    const occurrences = actions.split('resolveCandidateAccountLinkedInUrl').length - 1;
    // one import reference + two call sites
    assert.ok(occurrences >= 3, `expected >=3 references, found ${occurrences}`);
  });

  it('routes the account insert through the backward-compatible fallback', () => {
    // Both call sites invoke it with an explicit generic:
    // `await insertAccountWithLinkedInFallback<ConvertedAccountRow>(`.
    const callSites = actions.split(/await insertAccountWithLinkedInFallback\s*</).length - 1;
    assert.equal(callSites, 2, 'both account inserts must use the fallback');
  });

  it('does NOT feed the 7E-resolved LinkedIn into a HubSpot call', () => {
    // The 7E variable is candidateLinkedInUrl; it must only flow into the account
    // insert, never into attemptHubSpotSync / createHubSpotCompany arguments.
    // [^)] already spans newlines, so no dotAll flag is needed.
    assert.equal(/attemptHubSpotSync\([^)]*candidateLinkedInUrl/.test(actions), false);
    assert.equal(/createHubSpotCompany\([^)]*candidateLinkedInUrl/.test(actions), false);
  });
});

// ── Account type + read model ──────────────────────────────────

describe('Q3F-5BB.7E — Account type', () => {
  const types = readRepo(ACCOUNT_TYPES_REL);

  it('declares linkedin_url as optional/nullable on Account', () => {
    assert.equal(/linkedin_url\?\s*:\s*string\s*\|\s*null/.test(types), true);
  });

  it('getAccountById still reads via select(\'*\') (no explicit linkedin_url column)', () => {
    const accountActions = readRepo('src/modules/accounts/actions.ts');
    // The read model uses `*`, so it is backward-compatible: linkedin_url appears
    // only once the column exists and is simply absent before then.
    const getByIdIdx = accountActions.indexOf('export async function getAccountById');
    const region = accountActions.slice(getByIdIdx, getByIdIdx + 400);
    assert.ok(/\.select\(\s*[`'"]\s*\*/.test(region), 'getAccountById must select *');
    assert.equal(
      region.includes('linkedin_url'),
      false,
      'getAccountById must not add an explicit linkedin_url column pre-migration',
    );
  });
});

// ── Account detail UI ──────────────────────────────────────────

describe('Q3F-5BB.7E — account detail UI', () => {
  const page = readRepo(ACCOUNT_PAGE_REL);

  it('renders a LinkedIn row guarded by account.linkedin_url (hidden when absent)', () => {
    assert.ok(page.includes('account.linkedin_url &&'));
    assert.ok(page.includes('label="LinkedIn"'));
  });

  it('opens the LinkedIn link safely (target=_blank + rel noopener noreferrer)', () => {
    const idx = page.indexOf('account.linkedin_url &&');
    const region = page.slice(idx, idx + 500);
    assert.ok(region.includes('href={account.linkedin_url}'));
    assert.ok(region.includes('target="_blank"'));
    assert.ok(region.includes('rel="noopener noreferrer"'));
  });

  it('leaves the existing website row untouched', () => {
    assert.ok(page.includes('account.website &&'));
    assert.ok(page.includes('label="Sitio web"'));
  });
});
