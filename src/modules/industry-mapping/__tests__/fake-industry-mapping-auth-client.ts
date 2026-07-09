// fake-industry-mapping-auth-client.ts — Injectable in-memory fake for
// IndustryMappingAuthSessionClient. No Supabase, no network.

import type {
  IndustryMappingAuthSessionClient,
  IndustryMappingInternalUserRow,
} from '../mapping-runtime-actor';

export interface FakeAuthClientOptions {
  authUserId?: string | null;
  authError?: { message?: string } | null;
  internalUser?: IndustryMappingInternalUserRow | null;
  internalUserError?: { message?: string } | null;
}

export function makeFakeAuthClient(options: FakeAuthClientOptions = {}): IndustryMappingAuthSessionClient {
  const { authUserId = null, authError = null, internalUser = null, internalUserError = null } = options;

  return {
    auth: {
      async getUser() {
        return {
          data: { user: authUserId ? { id: authUserId } : null },
          error: authError,
        };
      },
    },
    from(table: string) {
      if (table !== 'internal_users') {
        throw new Error(`fake auth client: unexpected table "${table}"`);
      }
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            async maybeSingle() {
              return { data: internalUser, error: internalUserError };
            },
          };
          return chain;
        },
      };
    },
  };
}

/** Convenience: a fake auth client that resolves to a known active internal user. */
export function makeFakeActiveAuthClient(
  authUserId: string,
  internalUserId: string,
): IndustryMappingAuthSessionClient {
  return makeFakeAuthClient({
    authUserId,
    internalUser: { id: internalUserId, access_status: 'active' },
  });
}
