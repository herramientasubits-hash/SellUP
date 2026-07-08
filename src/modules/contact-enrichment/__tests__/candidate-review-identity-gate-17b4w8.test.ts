// Hito 17B.4W.8 — Gate de aprobación por discrepancia de identidad
//
// Verifica que runApproveCandidate bloquea la aprobación de candidatos con
// enrichment_metadata.person_identity.identity_consistency === 'mismatch'
// hasta recibir un override humano explícito (acknowledged=true + motivo no
// vacío), y que consistent/insufficient_evidence/no_evidence siguen el flujo
// normal sin cambios. Sin red, sin DB: dependencias inyectadas.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApproveCandidate,
  resolveCandidateIdentityApprovalState,
  validateIdentityApprovalOverride,
  type CandidateRecord,
  type ApproveDeps,
  type ContactInsertPayload,
  type CandidateReviewPatch,
  type IdentityApprovalOverrideInputV1,
} from '../candidate-review-core';

// ── Fixtures ────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'cand-1',
    status: 'pending_review',
    full_name: 'Ana López',
    first_name: 'Ana',
    last_name: 'López',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    email: 'ana@corp.com',
    phone: null,
    linkedin_url: 'https://linkedin.com/in/analopez',
    source: 'lusha',
    enrichment_metadata: {},
    enrichment_run_id: 'run-1',
    account_id: 'acc-1',
    hubspot_company_id: null,
    company_name: null,
    company_domain: null,
    country_code: null,
    ...overrides,
  };
}

function withIdentity(
  identity_consistency: 'consistent' | 'mismatch' | 'insufficient_evidence',
  extra: Record<string, unknown> = {},
): Partial<CandidateRecord> {
  return {
    enrichment_metadata: {
      person_identity: {
        prospect_contact_id: 'prospect-1',
        prospect_full_name: 'Ana López',
        prospect_linkedin_url: 'https://linkedin.com/in/analopez',
        enrich_contact_id: 'enrich-1',
        enrich_full_name: 'Ana López',
        enrich_linkedin_url: 'https://linkedin.com/in/analopez',
        id_consistency: 'match',
        name_consistency: 'match',
        identity_consistency,
        ...extra,
      },
    },
  };
}

interface DepCalls {
  inserted: ContactInsertPayload[];
  updated: { id: string; patch: CandidateReviewPatch }[];
  audited: { contactId: string; accountId: string; actorUserId: string | null; identityOverrideApplied?: boolean }[];
}

function makeApproveDeps(overrides: Partial<ApproveDeps> = {}): { deps: ApproveDeps; calls: DepCalls } {
  const calls: DepCalls = { inserted: [], updated: [], audited: [] };
  const deps: ApproveDeps = {
    actorId: 'user-1',
    nowIso: '2026-07-08T12:00:00.000Z',
    loadCandidate: async () => makeCandidate(),
    loadExistingContacts: async () => [],
    insertContact: async (payload) => {
      calls.inserted.push(payload);
      return { id: 'contact-new' };
    },
    updateCandidate: async (id, patch) => {
      calls.updated.push({ id, patch });
      return {};
    },
    logAudit: async (entry) => {
      calls.audited.push(entry);
    },
    ...overrides,
  };
  return { deps, calls };
}

function assertZeroMutations(calls: DepCalls) {
  assert.equal(calls.inserted.length, 0);
  assert.equal(calls.updated.length, 0);
  assert.equal(calls.audited.length, 0);
}

// ── Helpers puros ───────────────────────────────────────────────

describe('resolveCandidateIdentityApprovalState', () => {
  it('mapea consistent/mismatch/insufficient_evidence 1:1', () => {
    assert.equal(
      resolveCandidateIdentityApprovalState(makeCandidate(withIdentity('consistent'))),
      'consistent',
    );
    assert.equal(
      resolveCandidateIdentityApprovalState(makeCandidate(withIdentity('mismatch'))),
      'mismatch',
    );
    assert.equal(
      resolveCandidateIdentityApprovalState(makeCandidate(withIdentity('insufficient_evidence'))),
      'insufficient_evidence',
    );
  });

  it('sin person_identity o valor no reconocido ⇒ no_evidence', () => {
    assert.equal(
      resolveCandidateIdentityApprovalState(makeCandidate({ enrichment_metadata: {} })),
      'no_evidence',
    );
    assert.equal(
      resolveCandidateIdentityApprovalState(
        makeCandidate({ enrichment_metadata: { person_identity: null } }),
      ),
      'no_evidence',
    );
    assert.equal(
      resolveCandidateIdentityApprovalState(
        makeCandidate({
          enrichment_metadata: { person_identity: { identity_consistency: 'bogus' } },
        }),
      ),
      'no_evidence',
    );
  });
});

describe('validateIdentityApprovalOverride', () => {
  it('requiere acknowledged=true y motivo no vacío tras trim', () => {
    assert.equal(validateIdentityApprovalOverride(undefined).valid, false);
    assert.equal(
      validateIdentityApprovalOverride({ acknowledged: false, reason: 'algo' }).valid,
      false,
    );
    assert.equal(
      validateIdentityApprovalOverride({ acknowledged: true, reason: '   ' }).valid,
      false,
    );
    const ok = validateIdentityApprovalOverride({ acknowledged: true, reason: '  Verifiqué el perfil  ' });
    assert.equal(ok.valid, true);
    if (ok.valid) assert.equal(ok.reason, 'Verifiqué el perfil');
  });
});

// ── runApproveCandidate — gate de identidad ─────────────────────

describe('runApproveCandidate — identidad consistent/insufficient_evidence/no_evidence', () => {
  it('TEST 1: consistent sin override → aprobación normal', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('consistent')),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.inserted.length, 1);
  });

  it('TEST 7: consistent + override payload enviado igual → aprueba y NO persiste identity_override', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('consistent')),
    });
    const override: IdentityApprovalOverrideInputV1 = { acknowledged: true, reason: 'no debería usarse' };
    const result = await runApproveCandidate('cand-1', deps, override);
    assert.equal(result.ok, true);
    const review = calls.updated[0].patch.enrichment_metadata.review as Record<string, unknown>;
    assert.equal('identity_override' in review, false);
  });

  it('TEST 8: insufficient_evidence sin override → aprobación normal', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('insufficient_evidence')),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.inserted.length, 1);
  });

  it('TEST 9: legacy/no person_identity sin override → aprobación normal', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate({ enrichment_metadata: {} }),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.inserted.length, 1);
  });
});

describe('runApproveCandidate — identidad mismatch', () => {
  it('TEST 2: mismatch sin override → IDENTITY_MISMATCH_REQUIRES_REVIEW, cero mutaciones', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('mismatch')),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'IDENTITY_MISMATCH_REQUIRES_REVIEW');
    assertZeroMutations(calls);
  });

  it('TEST 3: mismatch + acknowledged=false → IDENTITY_OVERRIDE_REASON_REQUIRED, cero mutaciones', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('mismatch')),
    });
    const result = await runApproveCandidate('cand-1', deps, {
      acknowledged: false,
      reason: 'Verifiqué el perfil de LinkedIn',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'IDENTITY_OVERRIDE_REASON_REQUIRED');
    assertZeroMutations(calls);
  });

  it('TEST 4: mismatch + acknowledged=true + reason en blanco → IDENTITY_OVERRIDE_REASON_REQUIRED, cero mutaciones', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('mismatch')),
    });
    const result = await runApproveCandidate('cand-1', deps, {
      acknowledged: true,
      reason: '   ',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'IDENTITY_OVERRIDE_REASON_REQUIRED');
    assertZeroMutations(calls);
  });

  it('TEST 5: mismatch + override válido → aprueba y persiste identity_override truthful', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate(withIdentity('mismatch')),
    });
    const result = await runApproveCandidate('cand-1', deps, {
      acknowledged: true,
      reason: '  Confirmé con el prospecto por teléfono  ',
    });
    assert.equal(result.ok, true);
    assert.equal(calls.inserted.length, 1);
    assert.equal(calls.updated.length, 1);

    const review = calls.updated[0].patch.enrichment_metadata.review as {
      identity_override?: {
        acknowledged: boolean;
        reason: string;
        identity_state_at_override: string;
        reviewed_by: string;
        reviewed_at: string;
      };
    };
    assert.ok(review.identity_override);
    assert.equal(review.identity_override?.acknowledged, true);
    assert.equal(review.identity_override?.reason, 'Confirmé con el prospecto por teléfono');
    assert.equal(review.identity_override?.identity_state_at_override, 'mismatch');
    assert.equal(review.identity_override?.reviewed_by, 'user-1');
    assert.equal(review.identity_override?.reviewed_at, '2026-07-08T12:00:00.000Z');

    assert.equal(calls.audited.length, 1);
    assert.equal(calls.audited[0].identityOverrideApplied, true);
  });

  it('TEST 6: override válido preserva person_identity y metadata previa no relacionada', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () =>
        makeCandidate({
          ...withIdentity('mismatch'),
          enrichment_metadata: {
            ...withIdentity('mismatch').enrichment_metadata,
            relevance: { status: 'high_relevance', score: 0.9 },
            company_consistency: { status: 'match' },
          },
        }),
    });
    const result = await runApproveCandidate('cand-1', deps, {
      acknowledged: true,
      reason: 'Verificado manualmente',
    });
    assert.equal(result.ok, true);

    const meta = calls.updated[0].patch.enrichment_metadata;
    assert.ok(meta.person_identity);
    assert.equal((meta.person_identity as { identity_consistency: string }).identity_consistency, 'mismatch');
    assert.deepEqual(meta.relevance, { status: 'high_relevance', score: 0.9 });
    assert.deepEqual(meta.company_consistency, { status: 'match' });
  });
});

describe('runApproveCandidate — no debilita bloqueadores existentes', () => {
  it('TEST 10: candidato ya no pending_review sigue bloqueado aunque sea mismatch', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate({ ...withIdentity('mismatch'), status: 'approved' }),
    });
    const result = await runApproveCandidate('cand-1', deps, {
      acknowledged: true,
      reason: 'motivo',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'El candidato ya fue revisado.');
    assertZeroMutations(calls);
  });

  it('mismatch sin account_id ni hubspot_company_id sigue bloqueado por noAccount tras override válido', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () =>
        makeCandidate({ ...withIdentity('mismatch'), account_id: null, hubspot_company_id: null }),
    });
    const result = await runApproveCandidate('cand-1', deps, {
      acknowledged: true,
      reason: 'motivo',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.error,
        'No se puede aprobar este candidato porque no está asociado a una cuenta SellUp ni vinculado a HubSpot.',
      );
      assert.equal(result.code, undefined);
    }
    assertZeroMutations(calls);
  });
});
