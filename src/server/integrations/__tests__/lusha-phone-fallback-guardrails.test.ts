/**
 * Static safety guards — LUSHA-PHONE-FALLBACK-1S
 *
 * This scaffold prepares types, an eligibility gate, a status mapper, a
 * mockable client, a local migration draft, a usage-log metadata draft and UI
 * copy for a FUTURE Lusha phone reveal fallback. It must NOT activate any
 * real flow: no caller wires the new client, the old email-only Lusha ban
 * stays intact, and no HubSpot/Apollo code path is touched.
 *
 * These tests read source files from disk and check invariants. No network,
 * no DB, no providers — mirrors the style of phone-3d1-safety-guards.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isLushaPhoneRevealEnabled } from '@/lib/feature-flags.server';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → integrations → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

function readRepo(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

/**
 * Strips block and line comments so assertions check actual code, not
 * documentation prose that deliberately mentions a name to explain what is
 * NOT done (e.g. "does not call logProviderUsage()").
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('LUSHA-PHONE-FALLBACK-1S — old Lusha phone-reveal ban is untouched', () => {
  it('isLushaPhoneRevealEnabled() still returns hardcoded false', () => {
    assert.equal(isLushaPhoneRevealEnabled(), false);
  });

  it('isLushaPhoneRevealEnabled source has no env read (still a literal return false)', () => {
    const source = readRepo('src/lib/feature-flags.server.ts');
    const fnMatch = source.match(
      /export function isLushaPhoneRevealEnabled\(\): false \{[\s\S]*?\n\}/,
    );
    assert.ok(fnMatch, 'isLushaPhoneRevealEnabled function not found');
    assert.equal(/process\.env/.test(fnMatch![0]), false);
    assert.ok(/return false;/.test(fnMatch![0]));
  });
});

describe('LUSHA-PHONE-FALLBACK-1S — enrichLushaContactsV3 stays email-only', () => {
  const clientSource = readRepo('src/server/integrations/lusha-client.ts');

  it('still rejects reveal including "phones" before any fetch', () => {
    assert.ok(clientSource.includes(`input.reveal as string[]`));
    assert.ok(clientSource.includes(`includes('phones')`));
  });

  it('the exported signature still types reveal as Array<\'emails\'> only', () => {
    const fnSignatureMatch = clientSource.match(
      /export async function enrichLushaContactsV3\(input: \{[\s\S]*?\}\):/,
    );
    assert.ok(fnSignatureMatch, 'enrichLushaContactsV3 signature not found');
    assert.ok(fnSignatureMatch![0].includes(`reveal: Array<'emails'>`));
  });

  it('sanitized results still force hasPhone: false', () => {
    assert.ok(clientSource.includes('hasPhone: false as const'));
  });
});

describe('LUSHA-PHONE-FALLBACK-1S — new scaffold has no live caller', () => {
  // Files that exist elsewhere in the app and could plausibly wire a live
  // phone-reveal-fallback action. None of them should reference the new
  // scaffold's client/eligibility function in this milestone.
  const CALLER_SURFACE_FILES: readonly string[] = [
    'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
    'src/modules/contact-enrichment/phone-reveal-core.ts',
    'src/modules/contact-enrichment/bulk-enrichment-runner.ts',
    'src/modules/contact-enrichment/candidate-review-core.ts',
    'src/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner.ts',
    'src/server/agents/contact-enrichment-toolkit/contact-enrichment-runner.ts',
  ];

  for (const rel of CALLER_SURFACE_FILES) {
    it(`${rel} does not call enrichLushaContactPhonesForFallback`, () => {
      const source = readRepo(rel);
      assert.equal(source.includes('enrichLushaContactPhonesForFallback'), false);
    });

    it(`${rel} does not call evaluateLushaPhoneFallbackEligibility`, () => {
      const source = readRepo(rel);
      assert.equal(source.includes('evaluateLushaPhoneFallbackEligibility'), false);
    });
  }
});

describe('LUSHA-PHONE-FALLBACK-1S — new client makes no HubSpot / Apollo call', () => {
  const clientSource = readRepo('src/server/integrations/lusha-phone-fallback-client.ts');

  it('no HubSpot reference', () => {
    assert.equal(/hubspot/i.test(clientSource), false);
  });

  it('no Apollo reference', () => {
    assert.equal(/apollo/i.test(clientSource), false);
  });

  it('does not import or modify enrichLushaContactsV3', () => {
    const code = stripComments(clientSource);
    assert.equal(code.includes('enrichLushaContactsV3'), false);
    assert.equal(code.includes("from './lusha-client'"), false);
  });

  it('requires allowPhoneReveal === true before any fetch call', () => {
    const guardIndex = clientSource.indexOf('input.allowPhoneReveal !== true');
    const fetchIndex = clientSource.indexOf('await fetch(');
    assert.ok(guardIndex >= 0, 'allowPhoneReveal guard not found');
    assert.ok(fetchIndex >= 0, 'fetch call not found');
    assert.ok(guardIndex < fetchIndex, 'guard must appear before the fetch call in source order');
  });
});

describe('LUSHA-PHONE-FALLBACK-1S — usage-log draft never writes to the DB', () => {
  const draftSource = readRepo(
    'src/modules/usage-tracking/lusha-phone-fallback-usage-log-draft.ts',
  );

  it('does not call logProviderUsage', () => {
    assert.equal(stripComments(draftSource).includes('logProviderUsage('), false);
  });

  it('does not import a Supabase client', () => {
    assert.equal(/createClient|createSupabase|supabase\./i.test(draftSource), false);
  });
});

describe('LUSHA-PHONE-FALLBACK-1S — UI copy is not wired to a live component', () => {
  const copySource = readRepo(
    'src/components/contact-enrichment/lusha-phone-fallback-copy.ts',
  );

  it('the copy module has no React import', () => {
    assert.equal(/from ['"]react['"]/.test(copySource), false);
  });

  it('the detail sheet does not import the new copy module', () => {
    const detailSheet = readRepo(
      'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
    );
    assert.equal(detailSheet.includes('lusha-phone-fallback-copy'), false);
  });
});
