// Q3F-5AZ.2D-1-UX1 — resolveReviewDecisionView pure decision-view tests.
//
// Shared gating logic used by both the informational block
// (`review-status-info.tsx`) and the action zone (`prospect-review-actions.tsx`).
// No IO, no DB, no clients.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveReviewDecisionView,
  TERMINAL_STATUS,
  type ReviewDecisionCandidate,
} from '../prospect-review-decision-utils';

const BASE: ReviewDecisionCandidate = {
  id: 'cand-1',
  name: 'Acme Analytics SA',
  status: 'needs_review',
  recordOrigin: 'production',
  duplicateStatus: 'no_match',
  matchedHubspotCompanyId: null,
  reviewedAt: null,
};

function candidate(overrides: Partial<ReviewDecisionCandidate>): ReviewDecisionCandidate {
  return { ...BASE, ...overrides };
}

describe('resolveReviewDecisionView — happy path', () => {
  it('approves a clean needs_review production candidate', () => {
    const view = resolveReviewDecisionView(candidate({}));
    assert.equal(view.terminal, null);
    assert.equal(view.canApprove, true);
    assert.equal(view.blockReason, null);
    assert.equal(view.needsWarning, false);
  });
});

describe('resolveReviewDecisionView — terminal states', () => {
  for (const status of Object.keys(TERMINAL_STATUS)) {
    it(`marks "${status}" as terminal with no Aprobar`, () => {
      const view = resolveReviewDecisionView(candidate({ status }));
      assert.ok(view.terminal);
      assert.equal(view.terminal!.label, TERMINAL_STATUS[status].label);
      assert.equal(view.canApprove, false);
    });
  }
});

describe('resolveReviewDecisionView — pre-review states', () => {
  for (const status of ['generated', 'normalized']) {
    it(`blocks Aprobar for status "${status}"`, () => {
      const view = resolveReviewDecisionView(candidate({ status }));
      assert.equal(view.terminal, null);
      assert.equal(view.canApprove, false);
      assert.match(view.blockReason ?? '', /aún debe pasar a revisión/i);
    });
  }
});

describe('resolveReviewDecisionView — record_origin gate', () => {
  it('blocks a needs_review row that is not clean production', () => {
    const view = resolveReviewDecisionView(candidate({ recordOrigin: 'sandbox' }));
    assert.equal(view.canApprove, false);
    assert.match(view.blockReason ?? '', /producción limpia/i);
  });
});

describe('resolveReviewDecisionView — duplicate policy', () => {
  it('still allows approval for possible_duplicate but flags a warning', () => {
    const view = resolveReviewDecisionView(candidate({ duplicateStatus: 'possible_duplicate' }));
    assert.equal(view.canApprove, true);
    assert.equal(view.isPossibleDuplicate, true);
    assert.equal(view.needsWarning, true);
  });

  it('hard-blocks exact_duplicate', () => {
    const view = resolveReviewDecisionView(candidate({ duplicateStatus: 'exact_duplicate' }));
    assert.equal(view.canApprove, false);
    assert.match(view.blockReason ?? '', /ya existe en SellUp o en HubSpot/i);
  });

  it('dice DÓNDE está el duplicado cuando se sabe', () => {
    const view = resolveReviewDecisionView(
      candidate({ duplicateStatus: 'exact_duplicate', matchedHubspotCompanyId: 'hs-1' }),
    );
    assert.equal(view.blockReason, 'No se puede aprobar: esta empresa ya existe en HubSpot.');
  });

  it('sin verificar: dice que SellUp aún no lo sabe, no que «la verificación bloquea»', () => {
    const view = resolveReviewDecisionView(candidate({ duplicateStatus: 'unchecked' }));
    assert.equal(view.canApprove, false);
    assert.match(view.blockReason ?? '', /SellUp aún no verificó/);
    assert.equal(view.duplicateVerdict.label, 'SellUp aún no verificó duplicidad');
  });

  it('sin coincidencia: «No es duplicado» en SellUp y HubSpot', () => {
    const view = resolveReviewDecisionView(candidate({ duplicateStatus: 'no_match' }));
    assert.equal(view.duplicateVerdict.label, 'No es duplicado');
    assert.equal(view.duplicateVerdict.detail, 'No existe en SellUp ni en HubSpot.');
  });

  it('libre en HubSpot (reciclada): no es duplicado, pero dice que YA está allí', () => {
    const view = resolveReviewDecisionView(candidate({ duplicateStatus: 'no_match', hubspotFreeReason: 'recycled' }));
    assert.equal(view.duplicateVerdict.label, 'Libre en HubSpot');
    assert.match(view.duplicateVerdict.detail, /Ya está en HubSpot, libre \(reciclada/);
    assert.equal(view.canApprove, true);
  });

  it('sin coincidencia pero sin consultar HubSpot: lo dice', () => {
    const view = resolveReviewDecisionView(candidate({ duplicateStatus: 'no_match', hubspotChecked: false }));
    assert.match(view.duplicateVerdict.detail, /HubSpot no se consultó/);
  });

  it('flags a warning for a matched HubSpot company', () => {
    const view = resolveReviewDecisionView(candidate({ matchedHubspotCompanyId: 'hs-123' }));
    assert.equal(view.hasHubspotMatch, true);
    assert.equal(view.needsWarning, true);
    // Still approvable — the warning is informational, not a hard block.
    assert.equal(view.canApprove, true);
  });
});

describe('resolveReviewDecisionView — responsable', () => {
  it('sin responsable no se aprueba y dice por qué', () => {
    const view = resolveReviewDecisionView(candidate({ needsAssignee: true }));
    assert.equal(view.canApprove, false);
    assert.equal(view.blockReason, 'Asígnale un responsable primero.');
  });

  it('un bloqueo más fuerte (duplicado exacto) conserva su propio motivo', () => {
    const view = resolveReviewDecisionView(candidate({ needsAssignee: true, duplicateStatus: 'exact_duplicate' }));
    assert.equal(view.canApprove, false);
    assert.notEqual(view.blockReason, 'Asígnale un responsable primero.');
  });
});

describe('resolveReviewDecisionView — other statuses', () => {
  it('blocks an unrecognized status with a generic reason', () => {
    const view = resolveReviewDecisionView(candidate({ status: 'enrichment_pending' }));
    assert.equal(view.terminal, null);
    assert.equal(view.canApprove, false);
    assert.ok(view.blockReason);
  });
});
