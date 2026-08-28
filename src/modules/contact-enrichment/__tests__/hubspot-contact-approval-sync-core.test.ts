import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runContactHubSpotApprovalSync } from '../hubspot-contact-approval-sync-core';

describe('runContactHubSpotApprovalSync', () => {
  it('empresa "ready": procede a sincronizar el contacto', async () => {
    const syncCalls: string[] = [];
    const result = await runContactHubSpotApprovalSync('contact-1', {
      loadContactAccountId: async () => 'account-1',
      resolveCompany: async () => ({ status: 'ready', hubspotCompanyId: 'hs-1' }),
      syncContact: async (contactId) => {
        syncCalls.push(contactId);
        return { outcome: 'attempted_created', attempted: true, hubspotContactId: 'hs-c-1', syncResult: null, blockedReason: null };
      },
      markWaitingForCompanyReview: async () => {},
    });
    assert.equal(result.outcome, 'attempted_created');
    assert.deepEqual(syncCalls, ['contact-1']);
  });

  it('empresa "pending_review": NO sincroniza, marca el contacto en espera', async () => {
    const syncCalls: string[] = [];
    const waitCalls: string[] = [];
    const result = await runContactHubSpotApprovalSync('contact-1', {
      loadContactAccountId: async () => 'account-1',
      resolveCompany: async () => ({ status: 'pending_review' }),
      syncContact: async (contactId) => {
        syncCalls.push(contactId);
        throw new Error('no debe llamarse');
      },
      markWaitingForCompanyReview: async (contactId) => {
        waitCalls.push(contactId);
      },
    });
    assert.equal(result.outcome, 'waiting_company_review');
    assert.equal(syncCalls.length, 0);
    assert.deepEqual(waitCalls, ['contact-1']);
  });

  it('empresa "blocked" o "failed": no sincroniza, no marca espera (no va a resolverse solo)', async () => {
    for (const status of ['blocked', 'failed', 'account_unavailable'] as const) {
      const syncCalls: string[] = [];
      const result = await runContactHubSpotApprovalSync('contact-1', {
        loadContactAccountId: async () => 'account-1',
        resolveCompany: async () => ({ status }),
        syncContact: async (contactId) => {
          syncCalls.push(contactId);
          throw new Error('no debe llamarse');
        },
        markWaitingForCompanyReview: async () => {},
      });
      assert.equal(result.outcome, 'company_unavailable');
      assert.equal(syncCalls.length, 0);
    }
  });

  it('sin account_id en el contacto: no llama a nada', async () => {
    const result = await runContactHubSpotApprovalSync('contact-1', {
      loadContactAccountId: async () => null,
      resolveCompany: async () => {
        throw new Error('no debe llamarse');
      },
      syncContact: async () => {
        throw new Error('no debe llamarse');
      },
      markWaitingForCompanyReview: async () => {},
    });
    assert.equal(result.outcome, 'no_account');
  });
});
