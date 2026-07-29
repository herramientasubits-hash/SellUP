// Q3F-5AZ.2G-1 — Safe discard wrapper safety tests (non-live scan + shape).
//
// The wrapper needs Supabase + Next request context, so we do NOT execute it
// against a real DB. Instead we prove, by construction, that the discard path:
//   1. Exposes a callable server action + typed result.
//   2. Enforces the admin gate BEFORE data (hardening the legacy requireActiveUser).
//   3. DELEGATES the status write + audit to the canonical discardCandidate
//      (single source of truth) — no parallel write, no account creation.
//   4. Never calls any approve action, never creates an account, never marks a
//      candidate as duplicate, never touches HubSpot/providers/AI.
//   5. Reads only via .select() on prospect_candidates to gate.
//   6. Keeps the Prospectos CLIENT surfaces safe: the action zone imports the
//      WRAPPER (server), never the legacy discardCandidate, and never HubSpot;
//      the data table never imports the legacy discardCandidate either.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discardPendingReviewCandidateAction } from '../discard-actions';

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

const WRAPPER_SRC = stripLineComments(readFileSync(join(MODULE_DIR, 'discard-actions.ts'), 'utf8'));
const ELIGIBILITY_SRC = stripLineComments(
  readFileSync(join(MODULE_DIR, 'discard-eligibility.ts'), 'utf8'),
);
const ACTION_ZONE_SRC = stripLineComments(
  readFileSync(join(SRC, 'components', 'prospects', 'prospect-review-actions.tsx'), 'utf8'),
);
const DATA_TABLE_SRC = stripLineComments(
  readFileSync(join(SRC, 'components', 'prospects', 'prospects-data-table-client.tsx'), 'utf8'),
);

describe('discard wrapper — exported shape', () => {
  it('exposes a callable server action', () => {
    assert.equal(typeof discardPendingReviewCandidateAction, 'function');
  });

  it('is a server module', () => {
    assert.ok(WRAPPER_SRC.includes("'use server'"));
  });
});

describe('discard wrapper — admin gate + eligibility', () => {
  it('gates on isCurrentUserAdmin before touching data', () => {
    assert.ok(WRAPPER_SRC.includes('isCurrentUserAdmin'));
    const gateIdx = WRAPPER_SRC.indexOf('isCurrentUserAdmin');
    const delegateIdx = WRAPPER_SRC.indexOf('discardCandidate(');
    assert.ok(gateIdx > -1 && delegateIdx > gateIdx, 'admin gate must precede delegation');
  });

  it('validates via the pure discard eligibility policy', () => {
    assert.ok(WRAPPER_SRC.includes('evaluateDiscardEligibility'));
  });

  it('gates on clean production + needs_review (eligibility policy)', () => {
    assert.ok(ELIGIBILITY_SRC.includes('not_clean_production'));
    assert.ok(ELIGIBILITY_SRC.includes('status_conflict'));
    assert.ok(ELIGIBILITY_SRC.includes("'production'"));
    assert.ok(ELIGIBILITY_SRC.includes("'needs_review'"));
  });

  it('exposes the required typed reasons', () => {
    for (const reason of ['not_found', 'not_allowed', 'discard_failed', 'unexpected_error']) {
      assert.ok(WRAPPER_SRC.includes(reason), `wrapper must surface reason "${reason}"`);
    }
  });
});

describe('discard wrapper — delegates the write (single source of truth)', () => {
  it('delegates to the canonical discardCandidate', () => {
    assert.ok(WRAPPER_SRC.includes('discardCandidate'));
    assert.ok(WRAPPER_SRC.includes('@/modules/prospect-batches/actions'));
  });
});

describe('discard wrapper — no parallel write, no approve, no account, no HubSpot', () => {
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

  it('never marks a candidate as duplicate', () => {
    assert.equal(WRAPPER_SRC.includes('markCandidateDuplicate'), false);
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

describe('Prospectos action zone — imports the safe wrapper only', () => {
  it('imports discardPendingReviewCandidateAction (the safe server wrapper)', () => {
    assert.ok(ACTION_ZONE_SRC.includes('discardPendingReviewCandidateAction'));
    assert.ok(ACTION_ZONE_SRC.includes('@/modules/prospect-review/discard-actions'));
  });

  it('does NOT call the legacy discardCandidate directly from the client', () => {
    assert.equal(
      ACTION_ZONE_SRC.includes('discardCandidate'),
      false,
      'the legacy discard action must never be reached directly from the action zone',
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

describe('Prospectos action zone — required copy (button + confirmation + toasts)', () => {
  // Raw source (comments intact) so the exact user-facing strings are asserted.
  const RAW_ACTION_ZONE = readFileSync(
    join(SRC, 'components', 'prospects', 'prospect-review-actions.tsx'),
    'utf8',
  );
  const RAW_DECISION_UTILS = readFileSync(
    join(SRC, 'components', 'prospects', 'prospect-review-decision-utils.ts'),
    'utf8',
  );

  it('uses the required confirmation title + body copy', () => {
    assert.ok(RAW_ACTION_ZONE.includes('¿Descartar prospecto?'));
    assert.ok(
      RAW_ACTION_ZONE.includes(
        'Este prospecto saldrá de la revisión y no se creará como empresa en SellUp',
      ),
    );
    assert.ok(RAW_ACTION_ZONE.includes('Confirmar descarte'));
  });

  it('uses the required success toast copy', () => {
    assert.ok(RAW_ACTION_ZONE.includes('Prospecto descartado.'));
  });

  it('uses the required error copy for discard failures', () => {
    assert.ok(
      RAW_DECISION_UTILS.includes(
        'El prospecto no pudo descartarse. Actualiza la vista e intenta de nuevo.',
      ),
    );
  });
});

// ── Q3F-5BB.11K-FIX — mandatory traceable reason ─────────────────────────────

describe('discard wrapper — mandatory traceable reason (Q3F-5BB.11K-FIX)', () => {
  it('validates the reason with the shared pure contract', () => {
    assert.ok(WRAPPER_SRC.includes('validateDiscardReason'));
    assert.ok(WRAPPER_SRC.includes("from './discard-reason'"));
  });

  it('surfaces invalid_reason as a typed result', () => {
    assert.ok(WRAPPER_SRC.includes('invalid_reason'));
  });

  it('validates the reason AFTER the admin gate and BEFORE the delegation', () => {
    const gateIdx = WRAPPER_SRC.indexOf('isCurrentUserAdmin');
    const reasonIdx = WRAPPER_SRC.indexOf('validateDiscardReason(');
    const delegateIdx = WRAPPER_SRC.indexOf('discardCandidate(');
    assert.ok(gateIdx > -1 && reasonIdx > -1 && delegateIdx > -1);
    assert.ok(reasonIdx > gateIdx, 'admin gate must precede reason validation');
    assert.ok(delegateIdx > reasonIdx, 'reason validation must precede the mutation');
  });

  it('validates the reason BEFORE reading the candidate row (fail-closed order)', () => {
    const reasonIdx = WRAPPER_SRC.indexOf('validateDiscardReason(');
    const readIdx = WRAPPER_SRC.indexOf("from('prospect_candidates')");
    assert.ok(reasonIdx > -1 && readIdx > reasonIdx, 'no read before the reason is validated');
  });

  it('passes the VALIDATED/normalized reason to the canonical mutation, never the raw option', () => {
    assert.ok(WRAPPER_SRC.includes('discardCandidate(candidateId, validatedReason.reason)'));
    assert.equal(
      WRAPPER_SRC.includes('discardCandidate(candidateId, options.reason)'),
      false,
      'the raw client-supplied reason must never reach the mutation',
    );
  });

  it('keeps the canonical mutation signature reason-optional (Route B untouched)', () => {
    const BATCH_ACTIONS_SRC = readFileSync(
      join(SRC, 'modules', 'prospect-batches', 'actions.ts'),
      'utf8',
    );
    assert.ok(
      BATCH_ACTIONS_SRC.includes('export async function discardCandidate(id: string, reason?: string)'),
      'discardCandidate(id, reason?) must stay compatible with the legacy dialog',
    );
  });

  it('does not add any write of its own while enforcing the reason', () => {
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.equal(WRAPPER_SRC.includes(verb), false, `wrapper must not perform ${verb}`);
    }
  });
});

describe('Prospectos action zone — collects the reason with the shared contract', () => {
  it('imports the pure compose/validate helpers (not a local copy)', () => {
    assert.ok(ACTION_ZONE_SRC.includes('composeDiscardReason'));
    assert.ok(ACTION_ZONE_SRC.includes('validateDiscardReason'));
    assert.ok(ACTION_ZONE_SRC.includes('@/modules/prospect-review/discard-reason'));
  });

  it('reuses the shared reason catalog instead of redefining one', () => {
    assert.ok(ACTION_ZONE_SRC.includes('DISCARD_REASONS'));
    assert.equal(
      ACTION_ZONE_SRC.includes('const DISCARD_REASONS ='),
      false,
      'the catalog must never be duplicated on the Prospectos surface',
    );
  });

  it('sends a reason to the safe wrapper', () => {
    assert.ok(ACTION_ZONE_SRC.includes('reason: validation.reason'));
  });

  it('still does NOT reach the legacy prospect-batches action module', () => {
    assert.equal(ACTION_ZONE_SRC.includes('@/modules/prospect-batches/actions'), false);
    assert.equal(ACTION_ZONE_SRC.includes('discardCandidate'), false);
  });

  it('keeps the confirmation INLINE — no modal / dialog / portal reintroduced', () => {
    for (const token of ['AlertDialog', 'DialogContent', 'createPortal', '@/components/ui/dialog']) {
      assert.equal(ACTION_ZONE_SRC.includes(token), false, `must not reintroduce ${token}`);
    }
  });

  it('never renders the reason as HTML', () => {
    assert.equal(ACTION_ZONE_SRC.includes('dangerouslySetInnerHTML'), false);
  });

  it('surfaces the invalid_reason copy to the reviewer', () => {
    const RAW_DECISION_UTILS = readFileSync(
      join(SRC, 'components', 'prospects', 'prospect-review-decision-utils.ts'),
      'utf8',
    );
    assert.ok(RAW_DECISION_UTILS.includes('invalid_reason'));
    assert.ok(RAW_DECISION_UTILS.includes('Selecciona un motivo de descarte válido.'));
  });

  it('uses the required instruction copy in the confirmation panel', () => {
    const RAW_ACTION_ZONE = readFileSync(
      join(SRC, 'components', 'prospects', 'prospect-review-actions.tsx'),
      'utf8',
    );
    assert.ok(
      RAW_ACTION_ZONE.includes('Selecciona el motivo para conservar trazabilidad del descarte.'),
    );
  });
});

describe('audit trail — the insert error is no longer swallowed (Q3F-5BB.11K-FIX A+)', () => {
  const BATCH_ACTIONS_SRC = readFileSync(
    join(SRC, 'modules', 'prospect-batches', 'actions.ts'),
    'utf8',
  );

  /**
   * Body of logProspectCandidateAudit, up to the next top-level section comment.
   * Line comments are stripped so the forbidden-token assertions below reflect
   * CODE, not the explanatory prose inside the function.
   */
  function auditFnBody(src: string): string {
    const start = src.indexOf('export async function logProspectCandidateAudit');
    assert.ok(start > -1, 'logProspectCandidateAudit must exist');
    const rest = src.slice(start);
    const end = rest.indexOf('\n// ──');
    return stripLineComments(end === -1 ? rest : rest.slice(0, end));
  }

  const AUDIT_BODY = auditFnBody(BATCH_ACTIONS_SRC);

  it('captures the insert result instead of ignoring it', () => {
    assert.ok(
      /const\s*\{\s*error\s*\}\s*=\s*await supabase/.test(AUDIT_BODY),
      'the audit insert result must be destructured',
    );
    assert.ok(AUDIT_BODY.includes("from('prospect_candidate_audit')"));
    assert.ok(AUDIT_BODY.includes('.insert('));
  });

  it('logs the failure with console.error when the insert errors', () => {
    assert.ok(AUDIT_BODY.includes('if (error)'));
    assert.ok(AUDIT_BODY.includes('console.error'));
    assert.ok(AUDIT_BODY.includes('audit insert failed'));
    const guardIdx = AUDIT_BODY.indexOf('if (error)');
    const logIdx = AUDIT_BODY.indexOf('console.error');
    assert.ok(logIdx > guardIdx, 'the log must be inside the error branch');
  });

  it('does NOT change control flow: no throw, no retry, no transaction, no rpc', () => {
    for (const token of ['throw ', 'retry', '.rpc(', 'begin;', 'BEGIN']) {
      assert.equal(
        AUDIT_BODY.includes(token),
        false,
        `audit logging must not introduce ${token.trim()}`,
      );
    }
    assert.ok(AUDIT_BODY.includes('Promise<void>'), 'the signature must stay void');
    assert.equal(AUDIT_BODY.includes('return {'), false, 'no result object may be returned');
  });

  it('does not log the details payload (it can carry candidate PII)', () => {
    const logStart = AUDIT_BODY.indexOf('console.error');
    const logCall = AUDIT_BODY.slice(logStart, AUDIT_BODY.indexOf(');', logStart));
    assert.equal(logCall.includes('params.details'), false);
    assert.equal(logCall.includes('payload'), false);
    assert.ok(logCall.includes('params.actionType'));
  });

  it('emits no success log (only failures are surfaced)', () => {
    assert.equal(AUDIT_BODY.includes('console.log'), false);
    assert.equal(AUDIT_BODY.includes('console.info'), false);
  });
});

describe('Prospectos data table — never imports the legacy discard directly', () => {
  it('does not reference discardCandidate in the data table client', () => {
    assert.equal(
      DATA_TABLE_SRC.includes('discardCandidate'),
      false,
      'the data table routes discard through the drawer, never the legacy action',
    );
  });
});
