/**
 * AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — la llamada a `claim_company_identities`.
 *
 * Fija: qué se envía a la RPC (candidateId, batchId, los reclamos que el
 * llamador YA derivó con `deriveGlobalIdentityClaims`), cómo se interpreta la
 * respuesta, y que la ausencia de la migración 140 (o cualquier fallo de
 * escritura) degrada CERRADO — sin marcar a nadie duplicado.
 *
 * Cliente Supabase falso: sin red, sin base de datos, sin credenciales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimGlobalCompanyIdentities,
  CLAIM_COMPANY_IDENTITIES_RPC,
  type GlobalIdentityClaimCandidateInput,
} from '../global-identity-claims-store';

type Capture = { name: string | null; args: unknown };

function fakeClient(
  response: { data?: unknown; error?: { code?: string; message?: string } } | { throws: unknown },
): { client: SupabaseClient; capture: Capture } {
  const capture: Capture = { name: null, args: null };
  const client = {
    rpc(name: string, args: unknown) {
      capture.name = name;
      capture.args = args;
      if ('throws' in response) throw response.throws;
      return Promise.resolve({ data: response.data ?? null, error: response.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('§ 1 — qué se envía', () => {
  it('empaqueta candidateId, batchId y los reclamos ya derivados, tal cual', async () => {
    const { client, capture } = fakeClient({
      data: { claimed_candidate_ids: ['cand-1'], claimed_elsewhere_candidate_ids: [] },
    });
    const candidates: GlobalIdentityClaimCandidateInput[] = [
      { candidateId: 'cand-1', claims: [{ type: 'domain', key: 'acme.com' }] },
    ];
    await claimGlobalCompanyIdentities(client, 'batch-1', candidates);
    assert.equal(capture.name, CLAIM_COMPANY_IDENTITIES_RPC);
    assert.deepEqual(capture.args, {
      p_candidates: [
        {
          candidateId: 'cand-1',
          batchId: 'batch-1',
          claims: [{ type: 'domain', key: 'acme.com' }],
        },
      ],
    });
  });

  it('un candidato sin reclamos viaja con claims: [] tal cual', async () => {
    const { client, capture } = fakeClient({
      data: { claimed_candidate_ids: [], claimed_elsewhere_candidate_ids: [] },
    });
    await claimGlobalCompanyIdentities(client, 'batch-1', [{ candidateId: 'cand-1', claims: [] }]);
    assert.deepEqual(
      (capture.args as { p_candidates: unknown[] }).p_candidates[0],
      { candidateId: 'cand-1', batchId: 'batch-1', claims: [] },
    );
  });

  it('lista vacía ⇒ no llama a la RPC', async () => {
    const { client, capture } = fakeClient({ data: null });
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', []);
    assert.equal(capture.name, null);
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.degraded, false);
  });
});

describe('§ 2 — cómo se interpreta la respuesta', () => {
  it('separa reclamados de chocados en dos conjuntos', async () => {
    const { client } = fakeClient({
      data: {
        claimed_candidate_ids: ['cand-1'],
        claimed_elsewhere_candidate_ids: ['cand-2'],
      },
    });
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', [
      { candidateId: 'cand-1', claims: [{ type: 'domain', key: 'acme.com' }] },
      { candidateId: 'cand-2', claims: [{ type: 'domain', key: 'other.com' }] },
    ]);
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.degraded, false);
    assert.ok(outcome.claimedCandidateIds.has('cand-1'));
    assert.ok(outcome.claimedElsewhereCandidateIds.has('cand-2'));
  });
});

describe('§ 3 — degradación CERRADA', () => {
  const oneCandidate: GlobalIdentityClaimCandidateInput[] = [
    { candidateId: 'cand-1', claims: [{ type: 'domain', key: 'acme.com' }] },
  ];

  it('🔴 PGRST202 (migración 140 ausente) ⇒ degraded, nadie marcado', async () => {
    const { client } = fakeClient({ error: { code: 'PGRST202', message: 'not found' } });
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', oneCandidate);
    assert.equal(outcome.attempted, false);
    assert.equal(outcome.degraded, true);
    assert.equal(outcome.claimedElsewhereCandidateIds.size, 0);
  });

  it('42883 (función no existe) ⇒ degraded igual', async () => {
    const { client } = fakeClient({ error: { code: '42883' } });
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', oneCandidate);
    assert.equal(outcome.degraded, true);
  });

  it('un fallo REAL de escritura también degrada cerrado, no se inventa un choque', async () => {
    const { client } = fakeClient({ error: { code: '53300', message: 'too many connections' } });
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', oneCandidate);
    assert.equal(outcome.degraded, true);
    assert.equal(outcome.claimedElsewhereCandidateIds.size, 0);
  });

  it('una excepción lanzada por el cliente degrada cerrado', async () => {
    const { client } = fakeClient({ throws: new Error('network down') });
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', oneCandidate);
    assert.equal(outcome.degraded, true);
  });

  it('un cliente sin `.rpc` degrada cerrado sin intentar llamar', async () => {
    const client = {} as unknown as SupabaseClient;
    const outcome = await claimGlobalCompanyIdentities(client, 'batch-1', oneCandidate);
    assert.equal(outcome.attempted, false);
    assert.equal(outcome.degraded, true);
  });
});
