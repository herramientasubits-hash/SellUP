/**
 * Static safety guards — LUSHA-PHONE-FALLBACK-1S scaffold → LUSHA-PHONE-FALLBACK-1 live
 *
 * LUSHA-PHONE-FALLBACK-1S prepared types, an eligibility gate, a status
 * mapper, a mockable client, a local migration draft, a usage-log metadata
 * draft and UI copy for a FUTURE Lusha phone reveal fallback, with NO caller
 * wired anywhere. LUSHA-PHONE-FALLBACK-1 wires that scaffold into a real,
 * flag-gated, admin-only, single-candidate action (see
 * lusha-phone-fallback-core.ts + lusha-phone-fallback-actions.ts): the "no
 * live caller" invariant below now describes the SPECIFIC pre-existing files
 * enumerated, not the whole repo. The invariants that still hold
 * unconditionally: the old email-only Lusha ban stays intact, and no
 * HubSpot/Apollo code path is touched by the new client or core.
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

describe('LUSHA-PHONE-FALLBACK-1 — pre-existing files never call the low-level client/eligibility functions directly', () => {
  // Files that exist elsewhere in the app and could plausibly wire a live
  // phone-reveal-fallback action. None of them should reference the
  // scaffold's client/eligibility function directly — the ONLY sanctioned
  // caller is lusha-phone-fallback-core.ts, reached through the dedicated
  // action wrapper (lusha-phone-fallback-actions.ts). The detail sheet DOES
  // wire the fallback now (LUSHA-PHONE-FALLBACK-1), but only through that
  // action wrapper — see the describe block below for that positive check.
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

describe('LUSHA-PHONE-FALLBACK-1S — UI copy module stays pure', () => {
  const copySource = readRepo(
    'src/components/contact-enrichment/lusha-phone-fallback-copy.ts',
  );

  it('the copy module has no React import', () => {
    assert.equal(/from ['"]react['"]/.test(copySource), false);
  });
});

describe('LUSHA-PHONE-FALLBACK-1 — detail sheet is wired ONLY through the dedicated action, never the low-level eligibility/client functions directly', () => {
  const detailSheet = readRepo(
    'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
  );

  it('imports the new copy module (LUSHA-PHONE-FALLBACK-1 wires the button/dialog copy)', () => {
    assert.ok(detailSheet.includes('lusha-phone-fallback-copy'));
  });

  it('imports the dedicated server action wrapper', () => {
    assert.ok(detailSheet.includes('revealCandidatePhoneViaLushaFallbackAction'));
  });

  it('does NOT call enrichLushaContactPhonesForFallback directly (goes through the action + core)', () => {
    assert.equal(detailSheet.includes('enrichLushaContactPhonesForFallback'), false);
  });

  it('does NOT call evaluateLushaPhoneFallbackEligibility directly (goes through the action + core)', () => {
    assert.equal(detailSheet.includes('evaluateLushaPhoneFallbackEligibility'), false);
  });
});

describe('LUSHA-PHONE-FALLBACK-1 — new core/action make no HubSpot / Apollo provider call', () => {
  const coreSource = readRepo('src/modules/contact-enrichment/lusha-phone-fallback-core.ts');
  const actionSource = readRepo('src/modules/contact-enrichment/lusha-phone-fallback-actions.ts');

  it('the core never imports HubSpot', () => {
    // stripComments: the module doc deliberately SAYS "no HubSpot write" to
    // document the invariant — check actual code, not prose.
    assert.equal(/hubspot/i.test(stripComments(coreSource)), false);
  });

  it('the action wrapper never imports HubSpot', () => {
    assert.equal(/hubspot/i.test(stripComments(actionSource)), false);
  });

  it('the core never imports an Apollo client/integration module', () => {
    assert.equal(/from ['"].*apollo/i.test(stripComments(coreSource)), false);
  });

  it('the action wrapper never imports an Apollo client/integration module', () => {
    assert.equal(/from ['"].*apollo/i.test(stripComments(actionSource)), false);
  });

  it('the action wrapper calls the phone-scoped Lusha client, never enrichLushaContactsV3', () => {
    assert.ok(actionSource.includes('enrichLushaContactPhonesForFallback'));
    assert.equal(stripComments(actionSource).includes('enrichLushaContactsV3'), false);
  });

  it('the client is never called with a "search" or waterfallReveal shape', () => {
    // stripComments: both files deliberately DOCUMENT that waterfallReveal/search
    // are never used (same "mentions a name to explain what is NOT done"
    // convention as the mapper's own doc comment) — check actual code, not prose.
    const code = stripComments(coreSource + actionSource);
    assert.equal(/waterfallReveal/.test(code), false);
    assert.equal(/contacts\/search/.test(code), false);
  });
});
