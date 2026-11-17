import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runHubSpotEnrichmentRequest,
  type HubSpotEnrichmentRequestDeps,
} from '../hubspot-enrichment-request.server';

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;

/** Base mínima en memoria: `accounts` (select/update por id) y `account_audit` (insert). */
function fakeAdmin(account: Row | null) {
  const state = { account: account ? { ...account } : null, audits: [] as Row[] };
  const from = (table: string) => {
    if (table === 'account_audit') {
      return {
        insert: async (row: Row) => {
          state.audits.push(row);
          return { error: null };
        },
      };
    }
    const filters: Row = {};
    let patch: Row | null = null;
    const builder = {
      select: () => builder,
      update: (values: Row) => {
        patch = values;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        if (patch) {
          if (state.account && state.account.id === filters.id) state.account = { ...state.account, ...patch };
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      is: () => builder,
      maybeSingle: async () => ({
        data: state.account && state.account.id === filters.id ? { ...state.account } : null,
        error: null,
      }),
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, state };
}

function baseAccount(overrides: Row = {}): Row {
  return {
    id: ACCOUNT_ID,
    name: 'LVP Real Estate Investment',
    owner_id: null,
    hubspot_company_id: '55403069082',
    tax_identifier: null,
    legal_name: null,
    country: null,
    industry: null,
    company_size: null,
    metadata: {},
    ...overrides,
  };
}

function recordingDeps(
  admin: ReturnType<typeof fakeAdmin>,
  effects: {
    sync?: Row;
    profile?: Row;
    official?: Row;
    throwIn?: 'sync' | 'profile' | 'official';
  } = {},
) {
  const calls: Array<{ step: string; input: Row }> = [];
  const apply = (step: 'sync' | 'profile' | 'official', input: Row) => {
    calls.push({ step, input });
    if (effects.throwIn === step) throw new Error(`${step} caído`);
    const patch = effects[step];
    if (patch && admin.state.account) admin.state.account = { ...admin.state.account, ...patch };
  };
  const deps: HubSpotEnrichmentRequestDeps = {
    syncFromHubSpot: (async (_c: unknown, input: Row) => {
      apply('sync', input);
      return { status: 'updated', columns: [], ownerSource: null };
    }) as unknown as HubSpotEnrichmentRequestDeps['syncFromHubSpot'],
    completeProfile: (async (_c: unknown, input: Row) => {
      apply('profile', input);
      return { status: 'updated', filled: [], hubspot: { status: 'skipped', written: [] }, stillMissing: [] };
    }) as unknown as HubSpotEnrichmentRequestDeps['completeProfile'],
    enrichOfficial: (async (_c: unknown, input: Row) => {
      apply('official', input);
      return { status: 'updated', columns: [] };
    }) as unknown as HubSpotEnrichmentRequestDeps['enrichOfficial'],
    loadOwnerName: async (_c, userId) => (userId === OTHER ? 'Carla Pía' : null),
  };
  return { deps, calls };
}

const fixedNow = () => new Date('2026-11-17T12:00:00.000Z');

describe('runHubSpotEnrichmentRequest', () => {
  it('corre HubSpot → país/industria → fuentes oficiales, sin escribir en HubSpot, y asigna a quien pidió', async () => {
    const admin = fakeAdmin(baseAccount());
    const { deps, calls } = recordingDeps(admin, {
      sync: { owner_id: REQUESTER, company_size: '120' },
      profile: { country: 'México', industry: 'Bienes raíces' },
      official: { tax_identifier: 'LVP123456AB1', legal_name: 'LVP REAL ESTATE INVESTMENT S.A. DE C.V.' },
    });

    const result = await runHubSpotEnrichmentRequest(
      admin.client,
      { accountId: ACCOUNT_ID, requesterId: REQUESTER, now: fixedNow },
      deps,
    );

    assert.deepEqual(
      calls.map((c) => c.step),
      ['sync', 'profile', 'official'],
    );
    assert.equal(calls[0].input.hubspotCompanyId, '55403069082');
    assert.equal(calls[0].input.searcherUserId, REQUESTER);
    assert.equal(calls[1].input.writeHubSpot, false, 'el completado de país/industria no escribe en HubSpot');

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.status, 'completed');
    assert.equal(result.summary.ownership, 'assigned_to_requester');

    const block = (admin.state.account?.metadata as Row).hubspot_enrichment_request as Row;
    assert.equal(block.status, 'completed');
    assert.equal(block.requested_by, REQUESTER);
    assert.deepEqual(admin.state.audits, [
      {
        account_id: ACCOUNT_ID,
        actor_user_id: REQUESTER,
        action_type: 'account_owner_changed',
        details: { from: null, to: REQUESTER, via: 'hubspot_enrichment_request' },
      },
    ]);
  });

  it('una empresa de otra persona sigue siendo suya y no deja auditoría de cambio', async () => {
    const admin = fakeAdmin(baseAccount({ owner_id: OTHER, country: 'México' }));
    const { deps } = recordingDeps(admin);

    const result = await runHubSpotEnrichmentRequest(
      admin.client,
      { accountId: ACCOUNT_ID, requesterId: REQUESTER, now: fixedNow },
      deps,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.ownership, 'kept_other_owner');
    assert.match(result.summary.message, /Sigue a nombre de Carla Pía/);
    assert.equal(admin.state.account?.owner_id, OTHER);
    assert.deepEqual(admin.state.audits, []);
  });

  it('un paso caído no frena los siguientes', async () => {
    const admin = fakeAdmin(baseAccount({ owner_id: REQUESTER }));
    const { deps, calls } = recordingDeps(admin, {
      throwIn: 'profile',
      official: { tax_identifier: '900123456' },
    });

    const result = await runHubSpotEnrichmentRequest(
      admin.client,
      { accountId: ACCOUNT_ID, requesterId: REQUESTER, now: fixedNow },
      deps,
    );

    assert.deepEqual(
      calls.map((c) => c.step),
      ['sync', 'profile', 'official'],
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.status, 'partial');
    assert.deepEqual(result.summary.filled, ['tax_identifier']);
  });

  it('sin vínculo con HubSpot no corre nada', async () => {
    const admin = fakeAdmin(baseAccount({ hubspot_company_id: null }));
    const { deps, calls } = recordingDeps(admin);

    const result = await runHubSpotEnrichmentRequest(
      admin.client,
      { accountId: ACCOUNT_ID, requesterId: REQUESTER, now: fixedNow },
      deps,
    );

    assert.deepEqual(result, {
      ok: false,
      reason: 'not_linked',
      message: 'Esta empresa no está vinculada a HubSpot. Tráela primero desde HubSpot.',
    });
    assert.equal(calls.length, 0);
  });

  it('empresa inexistente o archivada', async () => {
    const admin = fakeAdmin(null);
    const { deps, calls } = recordingDeps(admin);
    const result = await runHubSpotEnrichmentRequest(
      admin.client,
      { accountId: ACCOUNT_ID, requesterId: REQUESTER, now: fixedNow },
      deps,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'account_unavailable');
    assert.equal(calls.length, 0);
  });

  it('otro pedido en curso: no repite el gasto de Claude', async () => {
    const admin = fakeAdmin(
      baseAccount({
        metadata: {
          hubspot_enrichment_request: { status: 'running', started_at: '2026-11-17T11:59:00.000Z' },
        },
      }),
    );
    const { deps, calls } = recordingDeps(admin);
    const result = await runHubSpotEnrichmentRequest(
      admin.client,
      { accountId: ACCOUNT_ID, requesterId: REQUESTER, now: fixedNow },
      deps,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'in_progress');
    assert.equal(calls.length, 0);
  });
});
