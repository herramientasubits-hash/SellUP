import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runResolveHubSpotCompanyMatch } from '../hubspot-company-resolution-review-core';

describe('runResolveHubSpotCompanyMatch', () => {
  it('decisión "same": vincula el hubspot_company_id pendiente, no crea nada', async () => {
    const updateCalls: unknown[] = [];
    const createCalls: unknown[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: {
            hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' },
          },
        }),
        updateAccount: async (id, patch) => {
          updateCalls.push({ id, patch });
        },
        createCompany: async () => {
          createCalls.push(true);
          return { ok: true, hubspotCompanyId: 'hs-new' };
        },
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async () => [],
        syncContact: async () => {},
      },
    );
    assert.equal(result.ok, true);
    assert.equal(createCalls.length, 0);
    assert.equal(updateCalls.length, 1);
    const patch = (updateCalls[0] as { patch: Record<string, unknown> }).patch;
    assert.equal(patch.hubspot_company_id, 'hs-999');
  });

  it('decisión "different": crea empresa nueva, ignora el pendiente', async () => {
    const createCalls: unknown[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'different' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: { hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' } },
        }),
        updateAccount: async () => {},
        createCompany: async () => {
          createCalls.push(true);
          return { ok: true, hubspotCompanyId: 'hs-brand-new' };
        },
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async () => [],
        syncContact: async () => {},
      },
    );
    assert.equal(result.ok, true);
    assert.equal(createCalls.length, 1);
  });

  it('sin cuenta pendiente, no hace nada y reporta el motivo', async () => {
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => null,
        updateAccount: async () => {},
        createCompany: async () => ({ ok: true, hubspotCompanyId: 'x' }),
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async () => [],
        syncContact: async () => {},
      },
    );
    assert.equal(result.ok, false);
  });

  it('decisión "different": si createCompany falla, no actualiza la cuenta', async () => {
    const updateCalls: unknown[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'different' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: { hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' } },
        }),
        updateAccount: async (id, patch) => {
          updateCalls.push({ id, patch });
        },
        createCompany: async () => ({ ok: false, error: 'HUBSPOT_CREATE_FAILED' }),
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async () => [],
        syncContact: async () => {},
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.hubspotCompanyId, null);
    assert.equal(updateCalls.length, 0);
  });

  it('cuenta existe pero sin match pendiente, no hace nada y reporta el motivo', async () => {
    const updateCalls: unknown[] = [];
    const createCalls: unknown[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => ({ id: 'account-1', metadata: {} }),
        updateAccount: async (id, patch) => {
          updateCalls.push({ id, patch });
        },
        createCompany: async () => {
          createCalls.push(true);
          return { ok: true, hubspotCompanyId: 'hs-x' };
        },
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async () => [],
        syncContact: async () => {},
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.hubspotCompanyId, null);
    assert.equal(updateCalls.length, 0);
    assert.equal(createCalls.length, 0);
  });

  it('tras resolver, dispara el sync de los contactos en espera de esa cuenta', async () => {
    const syncedContactIds: string[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: { hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' } },
        }),
        updateAccount: async () => {},
        createCompany: async () => ({ ok: true, hubspotCompanyId: 'hs-new' }),
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async (accountId) => {
          assert.equal(accountId, 'account-1');
          return ['contact-1', 'contact-2'];
        },
        syncContact: async (contactId) => {
          syncedContactIds.push(contactId);
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(syncedContactIds, ['contact-1', 'contact-2']);
  });

  it('un fallo al sincronizar un contacto en espera no detiene el resto ni falla la resolución', async () => {
    const syncedContactIds: string[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: { hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' } },
        }),
        updateAccount: async () => {},
        createCompany: async () => ({ ok: true, hubspotCompanyId: 'hs-new' }),
        nowIso: '2026-08-27T22:00:00.000Z',
        loadWaitingContacts: async () => ['contact-1', 'contact-2'],
        syncContact: async (contactId) => {
          if (contactId === 'contact-1') throw new Error('boom');
          syncedContactIds.push(contactId);
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(syncedContactIds, ['contact-2']);
  });
});
