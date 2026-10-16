/**
 * AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 · AGENT1-CLAIMS-LINKEDIN-SUBSIDIARIES-1 ·
 * AGENT1-CLAIMS-OWN-RECLAIM-1 · AGENT1-CLAIMS-DEGRADED-RECONCILE-1 — el lado
 * TypeScript de la 152: qué viaja, qué no se reenvía y cómo se reintenta.
 *
 * Sin red, sin base: un doble de cliente con `from` y `rpc`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildCompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import {
  deriveGlobalIdentityClaimEnvelope,
  deriveGlobalIdentityClaims,
} from '@/server/agents/prospecting-toolkit/global-identity-claims';
import {
  claimGlobalCompanyIdentities,
  claimGlobalIdentitiesForPersistedCandidates,
  claimUnclaimedLiveCandidates,
  toGlobalIdentityClaimCandidateInput,
} from '../global-identity-claims-store';
import { createFakeSupabase } from '@/server/agents/prospecting-toolkit/__tests__/support/fake-supabase-query';

type RpcCall = { fn: string; args: { p_candidates: Array<Record<string, unknown>> } };

function clientWith(opts: {
  rows?: Array<Record<string, unknown>>;
  held?: Array<{ candidate_id: string; claim_type: string; claim_key: string }>;
  heldError?: unknown;
  rpc?: (call: RpcCall) => { data: unknown; error: unknown };
}) {
  const { client, queries } = createFakeSupabase((q) => {
    if (q.table === 'agent1_company_identity_claims') {
      return opts.heldError ? { data: null, error: opts.heldError } : { data: opts.held ?? [], error: null };
    }
    return { data: opts.rows ?? [], error: null };
  });
  const rpcCalls: RpcCall[] = [];
  (client as { rpc?: unknown }).rpc = async (fn: string, args: RpcCall['args']) => {
    rpcCalls.push({ fn, args });
    return opts.rpc ? opts.rpc({ fn, args }) : { data: { claimed_candidate_ids: [], claimed_elsewhere_candidate_ids: [] }, error: null };
  };
  return { client: client as unknown as SupabaseClient, queries, rpcCalls };
}

const liveRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'cand-1',
  name: 'Acme S.A.S.',
  domain: 'acme.com.co',
  website: null,
  country_code: 'CO',
  tax_id: null,
  tax_identifier: '900123456-7',
  status: 'needs_review',
  metadata: {},
  source_trace: {},
  ...overrides,
});

describe('deriveGlobalIdentityClaimEnvelope', () => {
  it('🔴 con NIT: reclama el fiscal y el dominio/LinkedIn viajan como CRUCE (antes no viajaban)', () => {
    const envelope = deriveGlobalIdentityClaimEnvelope(
      buildCompanyIdentityEvidence({
        countryCode: 'CO',
        taxIdentifier: '900.123.456-7',
        domain: 'acme.com.co',
        linkedinUrl: 'https://www.linkedin.com/company/acme/',
      }),
    );
    assert.deepEqual(envelope.claims, [{ type: 'fiscal', key: 'CO:900123456' }]);
    assert.equal(envelope.identityDomain, 'acme.com.co');
    assert.equal(envelope.identityLinkedIn, 'linkedin.com/company/acme');
  });

  it('🔴 con NIT el LinkedIn NO se reclama en exclusiva (filiales con el LinkedIn de la matriz)', () => {
    const claims = deriveGlobalIdentityClaims(
      buildCompanyIdentityEvidence({
        countryCode: 'CO',
        taxIdentifier: '900123456',
        linkedinUrl: 'linkedin.com/company/grupo',
      }),
    );
    assert.equal(claims.some((c) => c.type === 'linkedin'), false);
  });

  it('sin NIT: dominio y LinkedIn exclusivos, como antes', () => {
    const envelope = deriveGlobalIdentityClaimEnvelope(
      buildCompanyIdentityEvidence({ domain: 'acme.com', linkedinUrl: 'linkedin.com/company/acme' }),
    );
    assert.deepEqual(envelope.claims, [
      { type: 'domain', key: 'acme.com' },
      { type: 'linkedin', key: 'linkedin.com/company/acme' },
    ]);
  });

  it('un host compartido no viaja ni como reclamo ni como cruce', () => {
    const envelope = deriveGlobalIdentityClaimEnvelope(
      buildCompanyIdentityEvidence({ website: 'https://sites.google.com/view/acme' }),
    );
    assert.deepEqual(envelope.claims, []);
    assert.equal(envelope.identityDomain, null);
  });
});

describe('claimGlobalCompanyIdentities — envío', () => {
  it('manda identityDomain/identityLinkedIn por candidato', async () => {
    const { client, rpcCalls } = clientWith({});
    await claimGlobalCompanyIdentities(client, 'batch-1', [
      toGlobalIdentityClaimCandidateInput('cand-1', {
        claims: [{ type: 'fiscal', key: 'CO:900123456' }],
        identityDomain: 'acme.com.co',
        identityLinkedIn: null,
      }),
    ]);
    assert.deepEqual(rpcCalls[0].args.p_candidates[0], {
      candidateId: 'cand-1',
      batchId: 'batch-1',
      claims: [{ type: 'fiscal', key: 'CO:900123456' }],
      identityDomain: 'acme.com.co',
    });
  });

  it('un error de la RPC degrada CERRADO y ya no en silencio', async () => {
    const { client } = clientWith({ rpc: () => ({ data: null, error: { code: '57014', message: 'x' } }) });
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      const outcome = await claimGlobalCompanyIdentities(client, 'b', [
        { candidateId: 'c', claims: [{ type: 'domain', key: 'acme.com' }] },
      ]);
      assert.equal(outcome.degraded, true);
      assert.equal(outcome.claimedElsewhereCandidateIds.size, 0, 'nadie se marca por un fallo');
    } finally {
      console.error = original;
    }
    assert.ok(logged.some((args) => String(args[0]).includes('degraded')));
  });
});

describe('claimGlobalIdentitiesForPersistedCandidates — reclamos que la fila ya tiene', () => {
  it('🔴 con excludeClaimsAlreadyHeld no reenvía lo que la MISMA fila ya tiene (sin la 152 chocaba consigo misma)', async () => {
    const { client, rpcCalls } = clientWith({
      rows: [liveRow({ tax_identifier: null })],
      held: [{ candidate_id: 'cand-1', claim_type: 'domain', claim_key: 'acme.com.co' }],
    });
    const outcome = await claimGlobalIdentitiesForPersistedCandidates(client, 'batch-1', ['cand-1'], {
      excludeClaimsAlreadyHeld: true,
    });
    assert.equal(outcome.degraded, false);
    assert.equal(rpcCalls.length, 0, 'ya tenía todo: no hay nada que reclamar');
  });

  it('una fila que ganó NIT sólo envía el fiscal (y el dominio como cruce)', async () => {
    const { client, rpcCalls } = clientWith({
      rows: [liveRow()],
      held: [{ candidate_id: 'cand-1', claim_type: 'domain', claim_key: 'acme.com.co' }],
    });
    await claimGlobalIdentitiesForPersistedCandidates(client, 'batch-1', ['cand-1'], {
      excludeClaimsAlreadyHeld: true,
    });
    const sent = rpcCalls[0].args.p_candidates[0];
    assert.deepEqual(sent.claims, [{ type: 'fiscal', key: 'CO:900123456' }]);
    assert.equal(sent.identityDomain, 'acme.com.co');
  });

  it('si no se puede leer lo que ya tiene, no reenvía nada (degradado)', async () => {
    const { client, rpcCalls } = clientWith({ rows: [liveRow()], heldError: { code: 'X' } });
    const outcome = await claimGlobalIdentitiesForPersistedCandidates(client, 'batch-1', ['cand-1'], {
      excludeClaimsAlreadyHeld: true,
    });
    assert.equal(outcome.degraded, true);
    assert.equal(rpcCalls.length, 0);
  });

  it('sin la opción, el camino de siempre no lee la tabla de reclamos', async () => {
    const { client, queries } = clientWith({ rows: [liveRow()] });
    await claimGlobalIdentitiesForPersistedCandidates(client, 'batch-1', ['cand-1']);
    assert.equal(queries.some((q) => q.table === 'agent1_company_identity_claims'), false);
  });
});

describe('claimUnclaimedLiveCandidates — segundo intento', () => {
  it('reporta las que ahora resultan de otro vendedor', async () => {
    const { client } = clientWith({
      rows: [liveRow()],
      rpc: () => ({
        data: { claimed_candidate_ids: [], claimed_elsewhere_candidate_ids: ['cand-1'] },
        error: null,
      }),
    });
    const outcome = await claimUnclaimedLiveCandidates(client, 'batch-1', ['cand-1', 'cand-1']);
    assert.deepEqual(outcome.claimedElsewhereCandidateIds, ['cand-1']);
    assert.equal(outcome.degraded, false);
  });

  it('sin ids no hace nada', async () => {
    const { client, queries } = clientWith({});
    const outcome = await claimUnclaimedLiveCandidates(client, 'batch-1', []);
    assert.equal(outcome.degraded, false);
    assert.equal(queries.length, 0);
  });
});
