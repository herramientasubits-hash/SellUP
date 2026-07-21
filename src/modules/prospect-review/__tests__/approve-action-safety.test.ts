// Q3F-5AZ.2C — Approve action safety tests (non-live, static scan + shape).
//
// The action needs Supabase + Next request context, so we do NOT execute it
// against a real DB. Instead we prove, by construction, that the approve path:
//   1. Exposes a callable action + typed result.
//   2. Never converts to an account / touches HubSpot / calls a provider.
//   3. Never writes directly (write is delegated to approveCandidate).
//   4. Preserves the immutable classification/duplicate/account fields.
//   5. Delegates the status write + candidate_approved audit to approveCandidate.
//   6. Leaves the read-only queue actions.ts untouched (still no writes).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { approvePendingReviewCandidateAction } from '../approve-actions';

const HERE = dirname(fileURLToPath(import.meta.url));

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

const APPROVE_RAW = readFileSync(join(HERE, '..', 'approve-actions.ts'), 'utf8');
const APPROVE_SRC = stripLineComments(APPROVE_RAW);
const QUEUE_ACTIONS_SRC = stripLineComments(readFileSync(join(HERE, '..', 'actions.ts'), 'utf8'));
const PB_ACTIONS_SRC = readFileSync(
  join(HERE, '..', '..', 'prospect-batches', 'actions.ts'),
  'utf8',
);

describe('approve action — exported shape', () => {
  it('exposes a callable server action', () => {
    assert.equal(typeof approvePendingReviewCandidateAction, 'function');
  });

  it('is a server module', () => {
    assert.ok(APPROVE_SRC.includes("'use server'"));
  });
});

describe('approve action — no account conversion / HubSpot / providers', () => {
  const forbidden = [
    'approveAndConvert',
    "from('accounts')",
    'createHubSpotCompany',
    'hubspot',
    'apollo',
    'tavily',
    'lusha',
    'enrichment',
  ];
  for (const token of forbidden) {
    it(`does not reference "${token}"`, () => {
      assert.equal(
        APPROVE_SRC.includes(token),
        false,
        `approve-actions.ts must not reference ${token}`,
      );
    });
  }
});

describe('approve action — no direct writes (delegated)', () => {
  const writeVerbs = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc('];
  for (const verb of writeVerbs) {
    it(`does not call ${verb} directly`, () => {
      assert.equal(APPROVE_SRC.includes(verb), false, `approve-actions.ts must not call ${verb}`);
    });
  }

  it('reads only via .select() for validation', () => {
    assert.ok(APPROVE_SRC.includes('.select('));
    assert.ok(APPROVE_SRC.includes("from('prospect_candidates')"));
  });
});

describe('approve action — preserves immutable fields', () => {
  // None of these columns may appear as a write target in the action file.
  const immutable = [
    'rejection_reason',
    'classification_source',
    'classification_confidence',
    'matched_hubspot_company_id',
    'converted_account_id',
    'account_id',
    'metadata',
  ];
  for (const col of immutable) {
    it(`never writes ${col}`, () => {
      assert.equal(APPROVE_SRC.includes(col), false, `approve-actions.ts must not touch ${col}`);
    });
  }
});

describe('approve action — delegates write + audit', () => {
  it('delegates the transition to approveCandidate', () => {
    assert.ok(APPROVE_SRC.includes('approveCandidate'));
    assert.ok(APPROVE_SRC.includes('@/modules/prospect-batches/actions'));
  });

  it('gates on admin before data and validates via eligibility', () => {
    assert.ok(APPROVE_SRC.includes('isCurrentUserAdmin'));
    assert.ok(APPROVE_SRC.includes('evaluateApproveEligibility'));
  });

  it('revalidates the review queue path', () => {
    assert.ok(APPROVE_SRC.includes("'/prospect-batches/review'"));
  });

  it('approveCandidate sets the approved transition and audits candidate_approved', () => {
    assert.ok(PB_ACTIONS_SRC.includes("status: 'approved'"));
    assert.ok(PB_ACTIONS_SRC.includes('reviewed_by'));
    assert.ok(PB_ACTIONS_SRC.includes('reviewed_at'));
    assert.ok(PB_ACTIONS_SRC.includes("actionType: 'candidate_approved'"));
  });
});

describe('queue actions.ts — remains read-only', () => {
  const writeVerbs = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc('];
  for (const verb of writeVerbs) {
    it(`actions.ts does not call ${verb}`, () => {
      assert.equal(QUEUE_ACTIONS_SRC.includes(verb), false, `actions.ts must stay read-only (${verb})`);
    });
  }
});
