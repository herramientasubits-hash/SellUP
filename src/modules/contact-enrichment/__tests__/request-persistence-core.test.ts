// Tests — Request Persistence Core (Hito 17B.4X.7C.1)
//
// Pure validation/normalization + injected-persistence orchestration.
// No Supabase, no network.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createContactEnrichmentRequestCore,
  isValidCompanyResolutionSource,
  normalizeCreateRequestInput,
  type NormalizedRequestContext,
} from '../request-persistence-core';
import type { ContactEnrichmentRequest, CreateContactEnrichmentRequestInput } from '../request-attempt-types';

function fakeRequestRow(context: NormalizedRequestContext): ContactEnrichmentRequest {
  return {
    id: 'req-1',
    accountId: context.accountId,
    companyName: context.companyName,
    companyDomain: context.companyDomain,
    companyCountryCode: context.companyCountryCode,
    hubspotCompanyId: context.hubspotCompanyId,
    companyResolutionSource: context.companyResolutionSource,
    triggeredBy: context.triggeredBy,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}

describe('isValidCompanyResolutionSource', () => {
  it('accepts sellup, hubspot, manual', () => {
    assert.equal(isValidCompanyResolutionSource('sellup'), true);
    assert.equal(isValidCompanyResolutionSource('hubspot'), true);
    assert.equal(isValidCompanyResolutionSource('manual'), true);
  });

  it('rejects anything else', () => {
    assert.equal(isValidCompanyResolutionSource('apollo'), false);
    assert.equal(isValidCompanyResolutionSource(''), false);
    assert.equal(isValidCompanyResolutionSource(undefined), false);
    assert.equal(isValidCompanyResolutionSource(123), false);
  });
});

describe('normalizeCreateRequestInput', () => {
  it('TEST 20/21 — manual context with account_id/hubspot_company_id null and valid company_name is valid', () => {
    const input: CreateContactEnrichmentRequestInput = {
      companyName: '  Acme Corp  ',
      companyResolutionSource: 'manual',
      accountId: null,
      hubspotCompanyId: null,
    };
    const result = normalizeCreateRequestInput(input);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.context.companyName, 'Acme Corp');
      assert.equal(result.context.accountId, null);
      assert.equal(result.context.hubspotCompanyId, null);
      assert.equal(result.context.companyResolutionSource, 'manual');
    }
  });

  it('rejects empty/whitespace-only company_name', () => {
    const result = normalizeCreateRequestInput({
      companyName: '   ',
      companyResolutionSource: 'sellup',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'company_name_required');
  });

  it('TEST 22 — rejects invalid company_resolution_source', () => {
    const result = normalizeCreateRequestInput({
      companyName: 'Acme',
      // @ts-expect-error — intentionally invalid for the test
      companyResolutionSource: 'apollo',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'invalid_company_resolution_source');
  });

  it('normalizes blank optional fields to null', () => {
    const result = normalizeCreateRequestInput({
      companyName: 'Acme',
      companyResolutionSource: 'sellup',
      companyDomain: '   ',
      companyCountryCode: '',
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.context.companyDomain, null);
      assert.equal(result.context.companyCountryCode, null);
    }
  });
});

describe('createContactEnrichmentRequestCore', () => {
  it('TEST 20 — persists exact context fields through the injected insertRequest', async () => {
    let capturedContext: NormalizedRequestContext | null = null;
    const result = await createContactEnrichmentRequestCore(
      {
        companyName: 'Acme Corp',
        companyDomain: 'acme.com',
        companyCountryCode: 'CO',
        hubspotCompanyId: 'hs-123',
        companyResolutionSource: 'hubspot',
        accountId: 'acc-1',
        triggeredBy: 'user-1',
      },
      {
        insertRequest: async (context) => {
          capturedContext = context;
          return { ok: true, row: fakeRequestRow(context) };
        },
      }
    );

    assert.equal(result.status, 'created');
    if (!capturedContext) throw new Error('expected insertRequest to capture a context');
    const ctx: NormalizedRequestContext = capturedContext;
    assert.equal(ctx.companyName, 'Acme Corp');
    assert.equal(ctx.companyDomain, 'acme.com');
    assert.equal(ctx.companyCountryCode, 'CO');
    assert.equal(ctx.hubspotCompanyId, 'hs-123');
    assert.equal(ctx.companyResolutionSource, 'hubspot');
    assert.equal(ctx.accountId, 'acc-1');
    assert.equal(ctx.triggeredBy, 'user-1');
  });

  it('does not call insertRequest when input is invalid', async () => {
    let called = false;
    const result = await createContactEnrichmentRequestCore(
      { companyName: '', companyResolutionSource: 'sellup' },
      {
        insertRequest: async (context) => {
          called = true;
          return { ok: true, row: fakeRequestRow(context) };
        },
      }
    );

    assert.equal(result.status, 'invalid_input');
    assert.equal(called, false);
  });

  it('maps a failed insertRequest to persistence_error', async () => {
    const result = await createContactEnrichmentRequestCore(
      { companyName: 'Acme', companyResolutionSource: 'manual' },
      { insertRequest: async () => ({ ok: false, reason: 'db_unreachable' }) }
    );

    assert.equal(result.status, 'persistence_error');
    if (result.status === 'persistence_error') assert.equal(result.reason, 'db_unreachable');
  });
});
