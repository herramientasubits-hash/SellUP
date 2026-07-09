// Tests — mapping-runtime-actor.ts (Q3F-5AN.1)
// Offline: no Supabase, no network. Uses a hand-written fake auth session
// client, same convention as the domain services' fake DB clients.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTrustedIndustryMappingActor } from '../mapping-runtime-actor';
import { IndustryMappingRuntimeBoundaryError } from '../mapping-runtime-boundary-types';
import { makeFakeAuthClient } from './fake-industry-mapping-auth-client';

const AUTH_USER_ID = 'auth-user-0000-0000-0000-000000000001';
const INTERNAL_USER_ID = 'internal-user-0000-0000-0000-000000000002';

describe('resolveTrustedIndustryMappingActor', () => {
  it('RB1: rejects an unauthenticated caller', async () => {
    const authClient = makeFakeAuthClient({ authUserId: null });

    await assert.rejects(
      () => resolveTrustedIndustryMappingActor(authClient),
      (error: unknown) => {
        assert.ok(error instanceof IndustryMappingRuntimeBoundaryError);
        assert.equal(error.code, 'AUTHENTICATION_REQUIRED');
        return true;
      },
    );
  });

  it('RB1b: rejects when auth.getUser() itself errors', async () => {
    const authClient = makeFakeAuthClient({ authUserId: null, authError: { message: 'network down' } });

    await assert.rejects(
      () => resolveTrustedIndustryMappingActor(authClient),
      (error: unknown) => {
        assert.ok(error instanceof IndustryMappingRuntimeBoundaryError);
        assert.equal(error.code, 'AUTHENTICATION_REQUIRED');
        return true;
      },
    );
  });

  it('RB2: rejects an authenticated auth user with no internal_users record', async () => {
    const authClient = makeFakeAuthClient({ authUserId: AUTH_USER_ID, internalUser: null });

    await assert.rejects(
      () => resolveTrustedIndustryMappingActor(authClient),
      (error: unknown) => {
        assert.ok(error instanceof IndustryMappingRuntimeBoundaryError);
        assert.equal(error.code, 'INTERNAL_USER_NOT_FOUND');
        return true;
      },
    );
  });

  it('RB2b: rejects when the internal_users lookup itself errors', async () => {
    const authClient = makeFakeAuthClient({
      authUserId: AUTH_USER_ID,
      internalUserError: { message: 'db down' },
    });

    await assert.rejects(
      () => resolveTrustedIndustryMappingActor(authClient),
      (error: unknown) => {
        assert.ok(error instanceof IndustryMappingRuntimeBoundaryError);
        assert.equal(error.code, 'INTERNAL_USER_NOT_FOUND');
        return true;
      },
    );
  });

  it('RB3: rejects an inactive/suspended internal user', async () => {
    const authClient = makeFakeAuthClient({
      authUserId: AUTH_USER_ID,
      internalUser: { id: INTERNAL_USER_ID, access_status: 'suspended' },
    });

    await assert.rejects(
      () => resolveTrustedIndustryMappingActor(authClient),
      (error: unknown) => {
        assert.ok(error instanceof IndustryMappingRuntimeBoundaryError);
        assert.equal(error.code, 'INTERNAL_USER_ACCESS_DENIED');
        return true;
      },
    );
  });

  it('RB3b: rejects a pending_approval internal user', async () => {
    const authClient = makeFakeAuthClient({
      authUserId: AUTH_USER_ID,
      internalUser: { id: INTERNAL_USER_ID, access_status: 'pending_approval' },
    });

    await assert.rejects(
      () => resolveTrustedIndustryMappingActor(authClient),
      (error: unknown) => {
        assert.ok(error instanceof IndustryMappingRuntimeBoundaryError);
        assert.equal(error.code, 'INTERNAL_USER_ACCESS_DENIED');
        return true;
      },
    );
  });

  it('RB4: an active internal user resolves to the INTERNAL user id, not the auth user id', async () => {
    const authClient = makeFakeAuthClient({
      authUserId: AUTH_USER_ID,
      internalUser: { id: INTERNAL_USER_ID, access_status: 'active' },
    });

    const actor = await resolveTrustedIndustryMappingActor(authClient);

    assert.equal(actor.internalUserId, INTERNAL_USER_ID);
    assert.notEqual(actor.internalUserId, AUTH_USER_ID);
  });
});
