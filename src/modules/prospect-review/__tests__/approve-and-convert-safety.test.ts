// Q3F-5AZ.2E-1 — Safe approve+convert wrapper safety tests (non-live scan + shape).
//
// The wrapper needs Supabase + Next request context, so we do NOT execute it
// against a real DB. Instead we prove, by construction, that the convert path:
//   1. Exposes a callable server action + typed result.
//   2. Enforces the admin gate BEFORE data (hardening the legacy requireActiveUser).
//   3. DELEGATES the conversion to the canonical approveAndConvertCandidateAction
//      (single source of truth) — no parallel account creation, no HubSpot logic.
//   4. Never calls approveCandidate (approve-only) nor
//      approvePendingReviewCandidateAction as its conversion destination.
//   5. Reads only via .select() on prospect_candidates to gate.
//   6. Keeps the Prospectos CLIENT surface safe: it imports the WRAPPER (server),
//      never the legacy convert action, and never HubSpot.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { approveAndConvertPendingReviewCandidateAction } from '../approve-and-convert-actions';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(HERE, '..'); // src/modules/prospect-review
const SRC = join(MODULE_DIR, '..', '..'); // src

/** Strips `//` line comments so forbidden-token scans reflect code, not prose. */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const WRAPPER_SRC = stripLineComments(
  readFileSync(join(MODULE_DIR, 'approve-and-convert-actions.ts'), 'utf8'),
);
const ELIGIBILITY_SRC = stripLineComments(
  readFileSync(join(MODULE_DIR, 'approve-and-convert-eligibility.ts'), 'utf8'),
);
const CLIENT_SRC = stripLineComments(
  readFileSync(join(SRC, 'components', 'prospects', 'prospect-review-actions.tsx'), 'utf8'),
);

describe('approve+convert wrapper — exported shape', () => {
  it('exposes a callable server action', () => {
    assert.equal(typeof approveAndConvertPendingReviewCandidateAction, 'function');
  });

  it('is a server module', () => {
    assert.ok(WRAPPER_SRC.includes("'use server'"));
  });
});

describe('approve+convert wrapper — admin gate + eligibility', () => {
  it('gates on isCurrentUserAdmin before touching data', () => {
    assert.ok(WRAPPER_SRC.includes('isCurrentUserAdmin'));
    const gateIdx = WRAPPER_SRC.indexOf('isCurrentUserAdmin');
    const delegateIdx = WRAPPER_SRC.indexOf('approveAndConvertCandidateAction(');
    assert.ok(gateIdx > -1 && delegateIdx > gateIdx, 'admin gate must precede delegation');
  });

  it('validates via the pure convert eligibility policy', () => {
    assert.ok(WRAPPER_SRC.includes('evaluateConvertApproveEligibility'));
  });

  it('rejects the approved-only backlog with a controlled remediation conflict', () => {
    // The reason is produced by the pure eligibility layer the wrapper delegates to.
    assert.ok(ELIGIBILITY_SRC.includes('approved_only_requires_remediation'));
  });
});

describe('approve+convert wrapper — delegates conversion (single source of truth)', () => {
  it('delegates to the canonical approveAndConvertCandidateAction', () => {
    assert.ok(WRAPPER_SRC.includes('approveAndConvertCandidateAction'));
    assert.ok(WRAPPER_SRC.includes('@/modules/prospect-batches/actions'));
  });

  it('maps the canonical HubSpot outcome onto the wrapper vocabulary', () => {
    for (const status of [
      'created',
      'linked_existing',
      'skipped_not_configured',
      'skipped_possible_match',
      'failed_create',
    ]) {
      assert.ok(WRAPPER_SRC.includes(status), `wrapper must map hubSpotStatus "${status}"`);
    }
  });
});

describe('approve+convert wrapper — no parallel write, no approve-only destination', () => {
  it('does not create/update an account directly', () => {
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', "from('accounts')"]) {
      assert.equal(WRAPPER_SRC.includes(verb), false, `wrapper must not perform ${verb}`);
    }
  });

  it('does not contain HubSpot logic of its own', () => {
    assert.equal(WRAPPER_SRC.includes('createHubSpotCompany'), false);
    assert.equal(WRAPPER_SRC.includes('testHubSpotConnection'), false);
  });

  it('never delegates to approveCandidate (approve-only status write)', () => {
    assert.equal(WRAPPER_SRC.includes('approveCandidate'), false);
  });

  it('never delegates to approvePendingReviewCandidateAction (approve-only wrapper)', () => {
    assert.equal(WRAPPER_SRC.includes('approvePendingReviewCandidateAction'), false);
  });

  it('reads only via .select() on prospect_candidates to gate', () => {
    assert.ok(WRAPPER_SRC.includes('.select('));
    assert.ok(WRAPPER_SRC.includes("from('prospect_candidates')"));
  });
});

describe('Prospectos client surface — imports the safe wrapper only', () => {
  it('imports approveAndConvertPendingReviewCandidateAction (the safe server wrapper)', () => {
    assert.ok(CLIENT_SRC.includes('approveAndConvertPendingReviewCandidateAction'));
    assert.ok(CLIENT_SRC.includes('@/modules/prospect-review/approve-and-convert-actions'));
  });

  it('does NOT call the legacy approveAndConvertCandidateAction directly from the client', () => {
    assert.equal(
      CLIENT_SRC.includes('approveAndConvertCandidateAction'),
      false,
      'the legacy convert action must never be reached directly from the client',
    );
    assert.equal(CLIENT_SRC.includes('@/modules/prospect-batches/actions'), false);
  });

  it('does NOT use approvePendingReviewCandidateAction as the primary approve destination', () => {
    assert.equal(
      CLIENT_SRC.includes('approvePendingReviewCandidateAction'),
      false,
      'the approve-only action is no longer the Prospectos primary approve',
    );
  });

  it('does NOT import HubSpot into the client component', () => {
    for (const token of ['createHubSpotCompany', 'hubspot/', "from('accounts')", '@/server/hubspot']) {
      assert.equal(CLIENT_SRC.includes(token), false, `client must not reference ${token}`);
    }
  });

  it('does not define a "use server" action in the client component', () => {
    assert.equal(CLIENT_SRC.includes("'use server'"), false);
  });
});
