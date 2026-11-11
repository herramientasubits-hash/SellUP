'use server';

// Global commercial visibility scope — the single source of truth for "who can
// see whose data" across SellUp operativa surfaces (Empresas, Prospectos, Uso
// de IA, …).
//
// This resolves the current authenticated user into a `CommercialScope` snapshot
// that downstream queries apply server-side. It is intentionally read-only and
// uses the service-role client to read across `internal_users` (a vendedor can't
// read other users' rows under RLS, but the scope must still compute their
// team), exactly like the existing ai-usage and activity-feed queries.
//
// Hierarchy model: a líder/manager's reach is the UNION of two axes that already
// exist in the codebase, so neither under- nor over-exposes:
//   1. organization_groups subtree of their home group (the axis the
//      "Usuarios y grupos" screen and the Uso de IA "Grupo" filter use), and
//   2. their manager_id report subtree via the get_subordinate_ids RPC (the axis
//      the activity feed uses).
// Admin sees everything; vendedor/BD and any unknown/misconfigured role see only
// themselves (safe fallback).

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { CommercialScope } from './commercial-scope-logic';
import { resolveCommercialScopeForUser, type ScopeUserRow } from './commercial-scope-core.server';

const ACTIVE_USER_STATUS = 'active';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function resolveCurrentUserRow(
  admin: AdminClient,
): Promise<ScopeUserRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await admin
    .from('internal_users')
    .select('id, email, group_id, role_id, roles(key)')
    .eq('auth_user_id', user.id)
    .eq('access_status', ACTIVE_USER_STATUS)
    .maybeSingle();

  if (!data) return null;

  const roleKey = (data.roles as unknown as { key: string } | null)?.key ?? null;
  return {
    id: data.id as string,
    email: (data.email as string | null) ?? null,
    groupId: (data.group_id as string | null) ?? null,
    roleKey,
  };
}

/**
 * Resolve the current user's commercial scope. Returns `null` only when there is
 * no authenticated active internal user (callers treat that as "no access").
 *
 * This always computes the real, role-based scope; it does NOT consult the
 * `ENABLE_COMMERCIAL_SCOPE` feature flag. Call sites decide whether to apply the
 * result (see `isCommercialScopeEnabled`), so the flag governs rollout without
 * this resolver having to know about per-surface semantics.
 */
export async function resolveCommercialScope(): Promise<CommercialScope | null> {
  const admin = createSupabaseAdminClient();
  const current = await resolveCurrentUserRow(admin);
  if (!current) return null;
  return resolveCommercialScopeForUser(admin, current);
}
