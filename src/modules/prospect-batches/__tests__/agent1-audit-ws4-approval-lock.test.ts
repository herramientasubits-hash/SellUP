/**
 * AGENT1-AUDIT-WS4 — candado de aprobación, huérfanos, error ≠ 0 filas y qué
 * ficha de HubSpot se enlaza.
 *
 * Defecto que cierra: dos aprobaciones simultáneas creaban dos cuentas en SellUp
 * y dos empresas en HubSpot (el corte idempotente iba al principio y el UPDATE
 * condicional al final, después de los efectos), y la perdedora respondía
 * «éxito idempotente». Además el `error` del UPDATE final se descartaba.
 *
 * Sin Supabase real: cliente falso en memoria que registra los filtros.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  APPROVAL_LOCK_ABSENT_FILTER,
  APPROVAL_LOCK_TOKEN_FILTER,
  APPROVAL_LOCK_TTL_MS,
  applyOptimisticCandidateConversionUpdate,
  buildApprovalOrphanRecord,
  claimCandidateApprovalLock,
  isApprovalLockFresh,
  readApprovalLock,
  releaseCandidateApprovalLock,
  resolveApprovalHubSpotLinkTarget,
  resolveExistingAccountOwnerConflict,
  stripApprovalLock,
  isDuplicateCheckStale,
  withoutStaleDuplicateEvidence,
} from '../approval-idempotency';

type Filter = [op: 'eq' | 'is', column: string, value: unknown];

interface FakeOpts {
  /** Filas devueltas por un UPDATE…select (null ⇒ error). */
  updateRows?: { id: string }[] | null;
  updateError?: { message: string } | null;
  /** Fila devuelta por la relectura (select…maybeSingle / single). */
  rereadRow?: Record<string, unknown> | null;
  rereadError?: { message: string } | null;
}

function fakeSupabase(opts: FakeOpts) {
  const updates: Array<{ payload: Record<string, unknown>; filters: Filter[] }> = [];
  const client = {
    from() {
      let payload: Record<string, unknown> | null = null;
      const filters: Filter[] = [];
      const builder: Record<string, unknown> = {
        update(p: Record<string, unknown>) {
          payload = p;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push(['eq', column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push(['is', column, value]);
          return builder;
        },
        select() {
          if (payload) {
            updates.push({ payload, filters });
            return Promise.resolve({ data: opts.updateRows ?? [], error: opts.updateError ?? null });
          }
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: opts.rereadRow ?? null, error: opts.rereadError ?? null });
        },
        single() {
          return Promise.resolve({ data: opts.rereadRow ?? null, error: opts.rereadError ?? null });
        },
        // UPDATE sin .select() (release): el builder se espera directamente.
        then(resolve: (v: { data: null; error: unknown }) => void) {
          if (payload) updates.push({ payload, filters });
          resolve({ data: null, error: opts.updateError ?? null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as Pick<SupabaseClient, 'from'>, updates };
}

const NOW = '2026-10-16T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

describe('candado de aprobación — lectura y vigencia', () => {
  it('lee el candado y lo considera vigente sólo dentro del TTL', () => {
    const fresh = readApprovalLock({ approval_lock: { token: 't1', locked_at: NOW, locked_by: 'u1' } });
    assert.deepEqual(fresh, { token: 't1', locked_at: NOW, locked_by: 'u1' });
    assert.equal(isApprovalLockFresh(fresh, NOW_MS + 1000), true);
    assert.equal(isApprovalLockFresh(fresh, NOW_MS + APPROVAL_LOCK_TTL_MS + 1), false);
  });

  it('sin token o con fecha ilegible no hay candado vigente', () => {
    assert.equal(readApprovalLock({ approval_lock: { locked_at: NOW } }), null);
    assert.equal(readApprovalLock(null), null);
    assert.equal(isApprovalLockFresh({ token: 't', locked_at: 'basura', locked_by: null }, NOW_MS), false);
  });

  it('stripApprovalLock quita sólo el candado', () => {
    assert.deepEqual(stripApprovalLock({ a: 1, approval_lock: { token: 't' } }), { a: 1 });
  });
});

describe('claimCandidateApprovalLock', () => {
  it('sin candado: UPDATE condicionado a status + ausencia de candado, y lo toma', async () => {
    const { client, updates } = fakeSupabase({ updateRows: [{ id: 'c1' }] });
    const out = await claimCandidateApprovalLock(client, {
      candidateId: 'c1',
      expectedStatus: 'needs_review',
      metadata: { keep: true },
      token: 'tok',
      actorUserId: 'u1',
      nowIso: NOW,
    });
    assert.equal(out.outcome, 'claimed');
    assert.equal(updates.length, 1);
    const { payload, filters } = updates[0];
    assert.deepEqual(payload.metadata, { keep: true, approval_lock: { token: 'tok', locked_at: NOW, locked_by: 'u1' } });
    assert.deepEqual(filters, [
      ['eq', 'id', 'c1'],
      ['eq', 'status', 'needs_review'],
      ['is', APPROVAL_LOCK_ABSENT_FILTER, null],
    ]);
  });

  it('candado vigente de otra operación ⇒ busy, sin escribir', async () => {
    const { client, updates } = fakeSupabase({ updateRows: [{ id: 'c1' }] });
    const out = await claimCandidateApprovalLock(client, {
      candidateId: 'c1',
      expectedStatus: 'needs_review',
      metadata: { approval_lock: { token: 'other', locked_at: NOW, locked_by: 'u2' } },
      token: 'tok',
      actorUserId: 'u1',
      nowIso: new Date(NOW_MS + 5_000).toISOString(),
    });
    assert.equal(out.outcome, 'busy');
    assert.equal(updates.length, 0);
  });

  it('candado vencido ⇒ se retoma comparando SU token (compare-and-swap)', async () => {
    const { client, updates } = fakeSupabase({ updateRows: [{ id: 'c1' }] });
    const out = await claimCandidateApprovalLock(client, {
      candidateId: 'c1',
      expectedStatus: 'needs_review',
      metadata: { approval_lock: { token: 'dead', locked_at: NOW, locked_by: 'u2' } },
      token: 'tok',
      actorUserId: 'u1',
      nowIso: new Date(NOW_MS + APPROVAL_LOCK_TTL_MS + 1).toISOString(),
    });
    assert.equal(out.outcome, 'claimed');
    assert.deepEqual(updates[0].filters.at(-1), ['eq', APPROVAL_LOCK_TOKEN_FILTER, 'dead']);
  });

  it('0 filas (otra operación ganó la carrera) ⇒ busy; error de la base ⇒ error', async () => {
    const lost = await claimCandidateApprovalLock(fakeSupabase({ updateRows: [] }).client, {
      candidateId: 'c1', expectedStatus: 'needs_review', metadata: {}, token: 't', actorUserId: 'u', nowIso: NOW,
    });
    assert.equal(lost.outcome, 'busy');
    const failed = await claimCandidateApprovalLock(
      fakeSupabase({ updateRows: null, updateError: { message: 'boom' } }).client,
      { candidateId: 'c1', expectedStatus: 'needs_review', metadata: {}, token: 't', actorUserId: 'u', nowIso: NOW },
    );
    assert.equal(failed.outcome, 'error');
  });
});

describe('releaseCandidateApprovalLock', () => {
  it('suelta el candado propio y anota el huérfano', async () => {
    const orphan = buildApprovalOrphanRecord({
      nowIso: NOW,
      reason: 'approval_not_completed',
      accountId: 'acc-1',
      accountCreated: true,
      hubspotCompanyId: 'hs-9',
      hubspotCompanyCreated: true,
    });
    const { client, updates } = fakeSupabase({
      rereadRow: { metadata: { keep: 1, approval_lock: { token: 'tok', locked_at: NOW }, approval_orphans: [{ old: true }] } },
    });
    const ok = await releaseCandidateApprovalLock(client, { candidateId: 'c1', token: 'tok', orphan });
    assert.equal(ok, true);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].payload.metadata, { keep: 1, approval_orphans: [{ old: true }, orphan] });
  });

  it('el candado ya es de otro: no lo toca; sin huérfano, no escribe nada', async () => {
    const { client, updates } = fakeSupabase({
      rereadRow: { metadata: { approval_lock: { token: 'otro', locked_at: NOW } } },
    });
    assert.equal(await releaseCandidateApprovalLock(client, { candidateId: 'c1', token: 'tok' }), true);
    assert.equal(updates.length, 0);
  });

  it('sin nada creado no hay huérfano que anotar', () => {
    assert.equal(
      buildApprovalOrphanRecord({ nowIso: NOW, reason: 'x', accountId: 'acc', accountCreated: false, hubspotCompanyId: 'hs', hubspotCompanyCreated: false }),
      null,
    );
  });

  it('una cuenta EXISTENTE enlazada no se anota como huérfana (no la creó esta aprobación)', () => {
    const rec = buildApprovalOrphanRecord({ nowIso: NOW, reason: 'x', accountId: 'acc', accountCreated: false, hubspotCompanyId: 'hs', hubspotCompanyCreated: true });
    assert.equal(rec?.account_id, null);
    assert.equal(rec?.hubspot_company_id, 'hs');
  });
});

describe('applyOptimisticCandidateConversionUpdate — error ≠ 0 filas + token del candado', () => {
  it('un error de la base es update_failed (antes se leía como carrera)', async () => {
    const { client } = fakeSupabase({ updateRows: null, updateError: { message: 'db down' } });
    const out = await applyOptimisticCandidateConversionUpdate(client, {
      candidateId: 'c1',
      expectedStatus: 'needs_review',
      updates: { status: 'converted_to_account' },
    });
    assert.equal(out.outcome, 'update_failed');
  });

  it('con lockToken, sólo quien tiene el candado puede convertir', async () => {
    const { client, updates } = fakeSupabase({ updateRows: [{ id: 'c1' }] });
    const out = await applyOptimisticCandidateConversionUpdate(client, {
      candidateId: 'c1',
      expectedStatus: 'needs_review',
      updates: { status: 'converted_to_account' },
      lockToken: 'tok',
    });
    assert.equal(out.outcome, 'updated');
    assert.deepEqual(updates[0].filters, [
      ['eq', 'id', 'c1'],
      ['eq', 'status', 'needs_review'],
      ['eq', APPROVAL_LOCK_TOKEN_FILTER, 'tok'],
    ]);
  });
});

describe('resolveApprovalHubSpotLinkTarget — nunca se crea una segunda ficha', () => {
  it('la ficha que ya tiene la cuenta de SellUp manda sobre todo lo demás', () => {
    assert.deepEqual(
      resolveApprovalHubSpotLinkTarget({
        existingAccountHubSpotCompanyId: 'hs-account',
        freePoolLinkCompanyId: 'hs-pool',
        matchedCompanyId: 'hs-match',
      }),
      { companyId: 'hs-account', source: 'sellup_account' },
    );
  });

  it('sin ficha en la cuenta: la libre marcada, luego la coincidencia guardada', () => {
    assert.deepEqual(
      resolveApprovalHubSpotLinkTarget({ existingAccountHubSpotCompanyId: ' ', freePoolLinkCompanyId: 'hs-pool', matchedCompanyId: 'hs-match' }),
      { companyId: 'hs-pool', source: 'free_pool' },
    );
    assert.deepEqual(
      resolveApprovalHubSpotLinkTarget({ existingAccountHubSpotCompanyId: null, freePoolLinkCompanyId: null, matchedCompanyId: 'hs-match' }),
      { companyId: 'hs-match', source: 'candidate_match' },
    );
    assert.deepEqual(
      resolveApprovalHubSpotLinkTarget({ existingAccountHubSpotCompanyId: null, freePoolLinkCompanyId: null, matchedCompanyId: null }),
      { companyId: null, source: null },
    );
  });
});

describe('resolveExistingAccountOwnerConflict — enlazar una cuenta de otra persona ya no es silencioso', () => {
  it('cuenta existente de otra persona ⇒ conflicto informado', () => {
    assert.deepEqual(
      resolveExistingAccountOwnerConflict({ accountCreated: false, existingOwnerId: 'otro', searcherUserId: 'yo' }),
      { linkedToOtherOwner: true, existingOwnerId: 'otro' },
    );
  });

  it('cuenta nueva, propia o sin responsable ⇒ sin conflicto', () => {
    assert.equal(resolveExistingAccountOwnerConflict({ accountCreated: true, existingOwnerId: 'otro', searcherUserId: 'yo' }).linkedToOtherOwner, false);
    assert.equal(resolveExistingAccountOwnerConflict({ accountCreated: false, existingOwnerId: 'yo', searcherUserId: 'yo' }).linkedToOtherOwner, false);
    assert.equal(resolveExistingAccountOwnerConflict({ accountCreated: false, existingOwnerId: null, searcherUserId: 'yo' }).linkedToOtherOwner, false);
  });
});

describe('comprobaciones de duplicados desactualizadas (cambió el NIT)', () => {
  it('sólo `duplicate_check_stale === true` cuenta como desactualizado', () => {
    assert.equal(isDuplicateCheckStale({ duplicate_check_stale: true }), true);
    assert.equal(isDuplicateCheckStale({ duplicate_check_stale: 'true' }), false);
    assert.equal(isDuplicateCheckStale(null), false);
  });

  it('se descarta toda la evidencia guardada (SellUp, HubSpot y ficha libre) y se conserva el resto', () => {
    const cleaned = withoutStaleDuplicateEvidence({
      duplicate_check_stale: true,
      hubspot_free_pool: { company_id: 'hs-old' },
      duplicate_check: { stale: true, summary: 'viejo' },
      validation: {
        hubspot_duplicate_check: { status: 'match', matched_company_id: 'hs-old', stale: true },
        sellup_duplicate_check: { matched_account_id: 'acc-old', stale: true },
        normalized_keys: { normalized_domain: 'acme.co' },
      },
      enrichment: { web: {} },
    });
    assert.deepEqual(cleaned, {
      duplicate_check_stale: true,
      validation: { normalized_keys: { normalized_domain: 'acme.co' } },
      enrichment: { web: {} },
    });
  });
});
