/**
 * Q3F-5BB.7B — static safety guards.
 *
 * Greps the Lusha pending-review writer + action + wizard sources to LOCK the
 * hard boundaries of this milestone: no migrations, no account/company/HubSpot
 * writes, no enrichment, no provider_usage_logs / agent_runs writes, and the
 * top-up guardrails (max 2 pages, max 2 credits) are constants — not client input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../..', 'src');

const WRITER = resolve(SRC, 'server/prospect-batches/lusha-pending-review.ts');
const ACTION = resolve(SRC, 'modules/prospect-batches/lusha-pending-review-actions.ts');
const WIZARD = resolve(SRC, 'components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx');
const PREVIEW = resolve(SRC, 'server/prospect-batches/lusha-preview.ts');

const read = (p: string) => readFileSync(p, 'utf8');

/** Strip block + line comments so forbidden-pattern checks target real CODE only
 *  (doc comments legitimately name the tables/APIs this milestone must NOT touch). */
function readCode(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (leave URLs' `://` intact)
}

describe('Q3F-5BB.7B static safety', () => {
  it('37/38. page + credit ceilings are hard constants (not client-supplied)', () => {
    const w = read(WRITER);
    assert.match(w, /LUSHA_PENDING_REVIEW_MAX_PAGES\s*=\s*2/);
    assert.match(w, /LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS\s*=\s*2/);
    assert.match(w, /LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES\s*=\s*5/);
    // The loop is bounded by the constant, not by any request/response value.
    assert.match(w, /page\s*<\s*LUSHA_PENDING_REVIEW_MAX_PAGES/);
    // Preview clamps the page — deep pagination is impossible.
    assert.match(read(PREVIEW), /LUSHA_PREVIEW_MAX_PAGE\s*=\s*1/);
  });

  it('32. writer never creates accounts / companies / contacts', () => {
    const w = readCode(WRITER);
    assert.doesNotMatch(w, /\.from\(\s*['"](accounts|companies|contacts)['"]\s*\)/);
    assert.doesNotMatch(w, /insertAccount|createAccount|createCompany|createContact/i);
  });

  it('33. writer + action never call HubSpot WRITE endpoints', () => {
    for (const p of [WRITER, ACTION]) {
      const s = readCode(p);
      assert.doesNotMatch(s, /createHubSpot|updateHubSpot|syncHubSpot|hubspot.*create|hubspot.*write/i);
      // POST to HubSpot objects is forbidden.
      assert.doesNotMatch(s, /\/crm\/v3\/objects/i);
    }
  });

  it('34. writer + action never import enrichment / people search', () => {
    for (const p of [WRITER, ACTION]) {
      const s = readCode(p);
      assert.doesNotMatch(s, /companies\/enrich|contact-enrich|people.*search|enrichCompany|enrichContact/i);
    }
  });

  it('35/36. writer + action never ACCESS provider_usage_logs or agent_runs (doc comments allowed)', () => {
    for (const p of [WRITER, ACTION]) {
      const s = readCode(p);
      // Only actual table access is forbidden — a doc comment naming the table is fine.
      assert.doesNotMatch(s, /\.from\(\s*['"]provider_usage_logs['"]\s*\)/);
      assert.doesNotMatch(s, /\.from\(\s*['"]agent_runs['"]\s*\)/);
      assert.doesNotMatch(s, /logProviderUsage|insertProviderUsage|recordAgentRun|insertAgentRun/i);
    }
  });

  it('writer only writes prospect_batches + prospect_candidates (via injected deps)', () => {
    const a = readCode(ACTION);
    // The action wires exactly these two write surfaces.
    assert.match(a, /\.from\('prospect_batches'\)[\s\S]*?\.insert\(/);
    assert.match(a, /\.from\('prospect_candidates'\)[\s\S]*?\.insert\(/);
    // No other .insert/.update/.delete/.upsert against a different table.
    const forbidden = a.match(/\.from\('(?!prospect_batches|prospect_candidates)[^']+'\)\s*[\s\S]{0,80}?\.(insert|update|delete|upsert)\(/g);
    assert.equal(forbidden, null);
  });

  it('31. no migration files were added in this milestone', () => {
    // The writer/action/wizard/preview diff must not ship SQL migrations.
    const migrationsDir = resolve(SRC, '..', 'supabase', 'migrations');
    let files: string[] = [];
    try {
      files = readdirSync(migrationsDir);
    } catch {
      files = [];
    }
    // Guard: none of the changed sources reference a new migration number.
    for (const p of [WRITER, ACTION, WIZARD]) {
      assert.doesNotMatch(read(p), /migration 09[6-9]|migration 1\d\d/i);
    }
    // The migrations dir is only read here to prove we didn't add one referencing 5BB.7B.
    assert.equal(files.some((f) => /5bb7b|topup|duplicate_details/i.test(f)), false);
  });

  it('wizard shows the "up to 2 credits" pre-search notice', () => {
    assert.match(read(WIZARD), /hasta 2 créditos/);
  });
});
