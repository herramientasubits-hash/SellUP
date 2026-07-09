// mapping-runtime-actor.ts — Provider Industry Mapping Server-Only Runtime
// Boundary (Q3F-5AN.1).
//
// Resolves the trusted internal SellUp actor for the current authenticated
// session: auth.getUser() → active internal_users record → internal user id.
// This is the ONLY path by which the industry-mapping application boundary
// obtains an actorId/createdByActorId/publisherActorId — client-supplied
// actor ids, emails, or request-JSON identities are never accepted.
//
// Injectable structural client (same convention as MappingDraftDbClient /
// MappingPublicationDbClient): the real Supabase server client satisfies
// this shape structurally; tests inject hand-written fakes, no Supabase
// network is ever used here.

import { IndustryMappingRuntimeBoundaryError } from './mapping-runtime-boundary-types';

export interface IndustryMappingAuthUser {
  id: string;
}

export interface IndustryMappingAuthUserResult {
  data: { user: IndustryMappingAuthUser | null };
  error: { message?: string } | null;
}

export interface IndustryMappingInternalUserRow {
  id: string;
  access_status: string;
}

export interface IndustryMappingInternalUserResult {
  data: IndustryMappingInternalUserRow | null;
  error: { message?: string } | null;
}

export interface IndustryMappingInternalUserSelectChain {
  eq(column: string, value: string): IndustryMappingInternalUserSelectChain;
  maybeSingle(): Promise<IndustryMappingInternalUserResult>;
}

export interface IndustryMappingAuthSessionClient {
  auth: {
    getUser(): Promise<IndustryMappingAuthUserResult>;
  };
  from(table: string): {
    select(columns: string): IndustryMappingInternalUserSelectChain;
  };
}

export interface TrustedIndustryMappingActor {
  internalUserId: string;
}

const INTERNAL_USERS_TABLE = 'internal_users';
const ACTIVE_ACCESS_STATUS = 'active';

/**
 * Resolves the current authenticated session to its active internal SellUp
 * user id. Throws IndustryMappingRuntimeBoundaryError for every failure mode
 * — never returns a null/undefined actor, and never falls back to a
 * caller-supplied or dev-shortcut identity.
 */
export async function resolveTrustedIndustryMappingActor(
  authClient: IndustryMappingAuthSessionClient,
): Promise<TrustedIndustryMappingActor> {
  const { data: authData, error: authError } = await authClient.auth.getUser();

  if (authError || !authData.user) {
    throw new IndustryMappingRuntimeBoundaryError(
      'AUTHENTICATION_REQUIRED',
      'An authenticated SellUp session is required for this operation.',
      authError ?? undefined,
    );
  }

  const { data: internalUser, error: internalUserError } = await authClient
    .from(INTERNAL_USERS_TABLE)
    .select('id, access_status')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (internalUserError) {
    throw new IndustryMappingRuntimeBoundaryError(
      'INTERNAL_USER_NOT_FOUND',
      'Failed to resolve the internal SellUp user for the authenticated session.',
      internalUserError,
    );
  }
  if (!internalUser) {
    throw new IndustryMappingRuntimeBoundaryError(
      'INTERNAL_USER_NOT_FOUND',
      'No internal SellUp user record exists for the authenticated session.',
    );
  }
  if (internalUser.access_status !== ACTIVE_ACCESS_STATUS) {
    throw new IndustryMappingRuntimeBoundaryError(
      'INTERNAL_USER_ACCESS_DENIED',
      'The internal SellUp user does not have active access.',
    );
  }

  return { internalUserId: internalUser.id };
}
