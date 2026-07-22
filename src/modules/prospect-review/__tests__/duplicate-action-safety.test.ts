// Q3F-5AZ.2G-2 — Safe mark-duplicate wrapper safety tests (non-live scan + shape).
//
// The wrapper needs Supabase + Next request context, so we do NOT execute it
// against a real DB. Instead we prove, by construction, that the mark-duplicate
// path:
//   1. Exposes a callable server action + typed result.
//   2. Enforces the admin gate BEFORE data (hardening the legacy requireActiveUser).
//   3. DELEGATES the status write + audit to the canonical markCandidateDuplicate
//      (single source of truth) — no parallel write, no account creation, no merge.
//   4. Never calls any approve action, never calls any discard action, never
//      creates an account, never touches HubSpot/providers/AI.
//   5. Reads only via .select() on prospect_candidates to gate.
//   6. Keeps the Prospectos CLIENT surfaces safe: the action zone imports the
//      WRAPPER (server), never the legacy markCandidateDuplicate, and never
//      HubSpot; the data table never imports the legacy markCandidateDuplicate.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { markDuplicatePendingReviewCandidateAction } from '../duplicate-actions';

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

const WRAPPER_SRC = stripLineComments(readFileSync(join(MODULE_DIR, 'duplicate-actions.ts'), 'utf8'));
const ELIGIBILITY_SRC = stripLineComments(
  readFileSync(join(MODULE_DIR, 'duplicate-eligibility.ts'), 'utf8'),
);
const ACTION_ZONE_SRC = stripLineComments(
  readFileSync(join(SRC, 'components', 'prospects', 'prospect-review-actions.tsx'), 'utf8'),
);
const DATA_TABLE_SRC = stripLineComments(
  readFileSync(join(SRC, 'components', 'prospects', 'prospects-data-table-client.tsx'), 'utf8'),
);

describe('mark-duplicate wrapper — exported shape', () => {
  it('exposes a callable server action', () => {
    assert.equal(typeof markDuplicatePendingReviewCandidateAction, 'function');
  });

  it('is a server module', () => {
    assert.ok(WRAPPER_SRC.includes("'use server'"));
  });
});

describe('mark-duplicate wrapper — admin gate + eligibility', () => {
  it('gates on isCurrentUserAdmin before touching data', () => {
    assert.ok(WRAPPER_SRC.includes('isCurrentUserAdmin'));
    const gateIdx = WRAPPER_SRC.indexOf('isCurrentUserAdmin');
    const delegateIdx = WRAPPER_SRC.indexOf('markCandidateDuplicate(');
    assert.ok(gateIdx > -1 && delegateIdx > gateIdx, 'admin gate must precede delegation');
  });

  it('validates via the pure mark-duplicate eligibility policy', () => {
    assert.ok(WRAPPER_SRC.includes('evaluateDuplicateEligibility'));
  });

  it('gates on clean production + needs_review (eligibility policy)', () => {
    assert.ok(ELIGIBILITY_SRC.includes('not_clean_production'));
    assert.ok(ELIGIBILITY_SRC.includes('status_conflict'));
    assert.ok(ELIGIBILITY_SRC.includes("'production'"));
    assert.ok(ELIGIBILITY_SRC.includes("'needs_review'"));
  });

  it('exposes the required typed reasons', () => {
    for (const reason of ['not_found', 'not_allowed', 'duplicate_failed', 'unexpected_error']) {
      assert.ok(WRAPPER_SRC.includes(reason), `wrapper must surface reason "${reason}"`);
    }
  });
});

describe('mark-duplicate wrapper — delegates the write (single source of truth)', () => {
  it('delegates to the canonical markCandidateDuplicate', () => {
    assert.ok(WRAPPER_SRC.includes('markCandidateDuplicate'));
    assert.ok(WRAPPER_SRC.includes('@/modules/prospect-batches/actions'));
  });
});

describe('mark-duplicate wrapper — no parallel write, no approve, no discard, no account, no HubSpot', () => {
  it('does not create/update/delete any row directly', () => {
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.equal(WRAPPER_SRC.includes(verb), false, `wrapper must not perform ${verb}`);
    }
  });

  it('never touches the accounts table', () => {
    assert.equal(WRAPPER_SRC.includes("from('accounts')"), false);
  });

  it('never calls any approve action', () => {
    assert.equal(WRAPPER_SRC.includes('approveCandidate'), false);
    assert.equal(WRAPPER_SRC.includes('approveAndConvertCandidateAction'), false);
    assert.equal(WRAPPER_SRC.includes('approvePendingReviewCandidateAction'), false);
    assert.equal(WRAPPER_SRC.includes('approveAndConvertPendingReviewCandidateAction'), false);
  });

  it('never calls any discard action', () => {
    assert.equal(WRAPPER_SRC.includes('discardCandidate'), false);
    assert.equal(WRAPPER_SRC.includes('discardPendingReviewCandidateAction'), false);
  });

  it('does not pass matched_account_id / matched_hubspot_company_id (classification, not a merge)', () => {
    assert.equal(WRAPPER_SRC.includes('matched_account_id'), false);
    assert.equal(WRAPPER_SRC.includes('matched_hubspot_company_id'), false);
  });

  it('does not contain HubSpot / provider / AI logic of its own', () => {
    for (const token of ['createHubSpotCompany', 'testHubSpotConnection', 'apollo', 'tavily', 'lusha']) {
      assert.equal(WRAPPER_SRC.toLowerCase().includes(token.toLowerCase()), false, `must not reference ${token}`);
    }
  });

  it('reads only via .select() on prospect_candidates to gate', () => {
    assert.ok(WRAPPER_SRC.includes('.select('));
    assert.ok(WRAPPER_SRC.includes("from('prospect_candidates')"));
  });
});

describe('Prospectos action zone — imports the safe mark-duplicate wrapper only', () => {
  it('imports markDuplicatePendingReviewCandidateAction (the safe server wrapper)', () => {
    assert.ok(ACTION_ZONE_SRC.includes('markDuplicatePendingReviewCandidateAction'));
    assert.ok(ACTION_ZONE_SRC.includes('@/modules/prospect-review/duplicate-actions'));
  });

  it('does NOT call the legacy markCandidateDuplicate directly from the client', () => {
    assert.equal(
      ACTION_ZONE_SRC.includes('markCandidateDuplicate'),
      false,
      'the legacy mark-duplicate action must never be reached directly from the action zone',
    );
    assert.equal(ACTION_ZONE_SRC.includes('@/modules/prospect-batches/actions'), false);
  });

  it('does NOT import HubSpot / provider modules into the client component', () => {
    for (const token of ['createHubSpotCompany', 'hubspot/', "from('accounts')", '@/server/hubspot']) {
      assert.equal(ACTION_ZONE_SRC.includes(token), false, `client must not reference ${token}`);
    }
  });

  it('does not define a "use server" action in the client component', () => {
    assert.equal(ACTION_ZONE_SRC.includes("'use server'"), false);
  });
});

describe('Prospectos action zone — required copy (item + confirmation + toasts)', () => {
  // Raw source (comments intact) so the exact user-facing strings are asserted.
  const RAW_ACTION_ZONE = readFileSync(
    join(SRC, 'components', 'prospects', 'prospect-review-actions.tsx'),
    'utf8',
  );
  const RAW_DECISION_UTILS = readFileSync(
    join(SRC, 'components', 'prospects', 'prospect-review-decision-utils.ts'),
    'utf8',
  );

  it('uses the required menu item label', () => {
    assert.ok(RAW_ACTION_ZONE.includes('Marcar duplicado'));
  });

  it('uses the required confirmation title + body copy', () => {
    assert.ok(RAW_ACTION_ZONE.includes('¿Marcar prospecto como duplicado?'));
    assert.ok(
      RAW_ACTION_ZONE.includes(
        'Este prospecto saldrá de la revisión como duplicado. No se creará empresa en SellUp ni',
      ),
    );
    assert.ok(RAW_ACTION_ZONE.includes('se sincronizará con HubSpot.'));
    assert.ok(RAW_ACTION_ZONE.includes('Confirmar duplicado'));
  });

  it('uses the required success toast copy', () => {
    assert.ok(RAW_ACTION_ZONE.includes('Prospecto marcado como duplicado.'));
  });

  it('uses the required error copy for mark-duplicate failures', () => {
    assert.ok(
      RAW_DECISION_UTILS.includes(
        'No se pudo marcar el prospecto como duplicado. Actualiza la vista e intenta de nuevo.',
      ),
    );
  });
});

describe('Prospectos data table — never imports the legacy mark-duplicate directly', () => {
  it('does not reference markCandidateDuplicate in the data table client', () => {
    assert.equal(
      DATA_TABLE_SRC.includes('markCandidateDuplicate'),
      false,
      'the data table routes mark-duplicate through the drawer, never the legacy action',
    );
  });
});
