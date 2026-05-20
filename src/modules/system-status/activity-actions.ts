'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  ActivityUser,
  ActivityViewerContext,
  PlatformActivityEvent,
  PlatformActivityFilter,
  PlatformActivityResult,
} from './types';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ─── Auth label maps ─────────────────────────────────────────────

const ACCESS_LABELS: Record<string, string> = {
  approved: 'Usuario aprobado',
  rejected: 'Usuario rechazado',
  suspended: 'Usuario suspendido',
  reactivated: 'Usuario reactivado',
  role_changed: 'Rol modificado',
  created: 'Usuario creado',
  manager_changed: 'Manager actualizado',
  archived: 'Usuario archivado',
  reactivated_from_archive: 'Usuario restaurado',
};

const INTEGRATION_LABELS: Record<string, string> = {
  credential_stored: 'Credencial guardada',
  credential_updated: 'Credencial actualizada',
  connection_tested: 'Conexión probada',
  connection_succeeded: 'Conexión exitosa',
  connection_failed: 'Conexión fallida',
  disconnected: 'Integración desconectada',
  oauth_started: 'OAuth iniciado',
  oauth_connected: 'OAuth conectado',
  oauth_failed: 'OAuth fallido',
};

const INTEGRATION_KEY_LABELS: Record<string, string> = {
  hubspot: 'HubSpot',
  slack: 'Slack',
  apollo: 'Apollo.io',
  lusha: 'Lusha',
};

const AI_LABELS: Record<string, string> = {
  ai_provider_credential_stored: 'Credencial de IA guardada',
  ai_provider_credential_updated: 'Credencial de IA actualizada',
  ai_provider_connection_succeeded: 'Conexión IA exitosa',
  ai_provider_connection_failed: 'Conexión IA fallida',
  ai_provider_disconnected: 'Proveedor IA desconectado',
  ai_active_config_changed: 'Configuración activa IA modificada',
  ai_model_pricing_added: 'Tarifa de modelo IA registrada',
};

// ─── Helper: fetch user map by IDs ───────────────────────────────

async function fetchUsersMap(
  admin: ReturnType<typeof getAdminClient>,
  ids: string[],
): Promise<Map<string, ActivityUser>> {
  if (ids.length === 0) return new Map();

  const { data } = await admin
    .from('internal_users')
    .select('id, email, full_name')
    .in('id', ids);

  const map = new Map<string, ActivityUser>();
  for (const u of data ?? []) {
    map.set(u.id, { id: u.id, email: u.email, full_name: u.full_name ?? null });
  }
  return map;
}

// ─── Helper: get current internal user + hierarchy ───────────────

async function resolveCurrentUser(admin: ReturnType<typeof getAdminClient>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await admin
    .from('internal_users')
    .select('id, role_id, roles(key)')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .maybeSingle();

  if (!data) return null;

  const roleKey = (data.roles as unknown as { key: string } | null)?.key ?? null;
  return { id: data.id as string, roleKey };
}

// ─── Public: context for the activity feed viewer ────────────────

export async function getActivityViewerContext(): Promise<ActivityViewerContext | null> {
  const admin = getAdminClient();
  const current = await resolveCurrentUser(admin);
  if (!current) return null;

  const isAdmin = current.roleKey === 'admin';

  // Fetch subordinates regardless (needed to determine isManager)
  const { data: subsData } = await admin.rpc('get_subordinate_ids', {
    p_manager_id: current.id,
  });
  const subordinateIds: string[] = (subsData ?? []).map(
    (r: { user_id: string }) => r.user_id,
  );
  const isManager = subordinateIds.length > 0;

  // Determine which users are selectable in the filter
  let allowedUsers: ActivityUser[] = [];

  if (isAdmin) {
    // Admin can filter by any active user
    const { data } = await admin
      .from('internal_users')
      .select('id, email, full_name')
      .eq('access_status', 'active')
      .order('full_name', { ascending: true, nullsFirst: false });
    allowedUsers = (data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name ?? null,
    }));
  } else if (isManager) {
    // Manager can filter within their subtree (including themselves)
    const visibleIds = [current.id, ...subordinateIds];
    const { data } = await admin
      .from('internal_users')
      .select('id, email, full_name')
      .in('id', visibleIds)
      .order('full_name', { ascending: true, nullsFirst: false });
    allowedUsers = (data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name ?? null,
    }));
  }
  // Regular users: no user selector shown (allowedUsers stays empty)

  return {
    currentUserId: current.id,
    isAdmin,
    isManager,
    allowedUsers,
  };
}

// ─── Public: paginated platform activity ─────────────────────────

export async function getPlatformActivity(
  filter: PlatformActivityFilter = {},
): Promise<PlatformActivityResult> {
  const admin = getAdminClient();
  const current = await resolveCurrentUser(admin);
  if (!current) return { events: [], hasMore: false };

  const isAdmin = current.roleKey === 'admin';

  // Build allowed ID set (null = no restriction for admin)
  let allowedIds: string[] | null = null;
  if (!isAdmin) {
    const { data: subsData } = await admin.rpc('get_subordinate_ids', {
      p_manager_id: current.id,
    });
    const subordinateIds = (subsData ?? []).map(
      (r: { user_id: string }) => r.user_id,
    );
    allowedIds = [current.id, ...subordinateIds];
  }

  // Validate targetUserId permission
  const targetId = filter.userId;
  if (targetId && allowedIds !== null && !allowedIds.includes(targetId)) {
    return { events: [], hasMore: false };
  }

  const limit = filter.limit ?? 30;
  const offset = filter.offset ?? 0;
  // Fetch generously so we can search/filter client-side
  const fetchLimit = (offset + limit) * 3 + 10;
  const sourceFilter = filter.source ?? 'all';

  // ── Query each audit table based on source filter ──────────────

  const [accessRaw, integrationRaw, aiRaw] = await Promise.all([
    sourceFilter === 'all' || sourceFilter === 'users'
      ? queryAccessAudit(admin, { isAdmin, allowedIds, targetId, fetchLimit })
      : Promise.resolve([]),
    sourceFilter === 'all' || sourceFilter === 'integrations'
      ? queryIntegrationAudit(admin, { isAdmin, allowedIds, targetId, fetchLimit })
      : Promise.resolve([]),
    sourceFilter === 'all' || sourceFilter === 'ai'
      ? queryAiAudit(admin, { isAdmin, allowedIds, targetId, fetchLimit })
      : Promise.resolve([]),
  ]);

  // ── Resolve user names ─────────────────────────────────────────

  const userIdSet = new Set<string>();
  for (const e of accessRaw) {
    if (e.actor_user_id) userIdSet.add(e.actor_user_id);
    if (e.target_user_id) userIdSet.add(e.target_user_id);
  }
  for (const e of integrationRaw) {
    if (e.actor_user_id) userIdSet.add(e.actor_user_id);
  }
  for (const e of aiRaw) {
    if (e.user_id) userIdSet.add(e.user_id);
  }

  const usersMap = await fetchUsersMap(admin, [...userIdSet]);

  // ── Normalize ─────────────────────────────────────────────────

  const events: PlatformActivityEvent[] = [];

  for (const e of accessRaw) {
    const label = ACCESS_LABELS[e.action_type] ?? e.action_type;
    const description =
      e.previous_status && e.new_status
        ? `${e.previous_status} → ${e.new_status}`
        : null;
    events.push({
      id: `access_${e.id}`,
      source: 'users',
      event_type: e.action_type,
      label,
      description,
      created_at: e.created_at,
      actor: e.actor_user_id ? (usersMap.get(e.actor_user_id) ?? null) : null,
      target: e.target_user_id ? (usersMap.get(e.target_user_id) ?? null) : null,
    });
  }

  for (const e of integrationRaw) {
    const label = INTEGRATION_LABELS[e.event_type] ?? e.event_type;
    const integrationName = INTEGRATION_KEY_LABELS[e.integration_key] ?? e.integration_key;
    events.push({
      id: `integration_${e.id}`,
      source: 'integrations',
      event_type: e.event_type,
      label,
      description: integrationName,
      created_at: e.created_at,
      actor: e.actor_user_id ? (usersMap.get(e.actor_user_id) ?? null) : null,
      target: null,
    });
  }

  for (const e of aiRaw) {
    const label = AI_LABELS[e.event_type] ?? e.event_type;
    const providerName =
      (e.provider as unknown as { name: string } | null)?.name ?? null;
    events.push({
      id: `ai_${e.id}`,
      source: 'ai',
      event_type: e.event_type,
      label,
      description: providerName,
      created_at: e.created_at,
      actor: e.user_id ? (usersMap.get(e.user_id) ?? null) : null,
      target: null,
    });
  }

  // ── Sort ───────────────────────────────────────────────────────

  events.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // ── Search filter (applied after merge) ───────────────────────

  let filtered = events;
  if (filter.search && filter.search.trim().length > 0) {
    const q = filter.search.trim().toLowerCase();
    filtered = events.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.actor?.email.toLowerCase().includes(q) ||
        e.actor?.full_name?.toLowerCase().includes(q) ||
        e.target?.email.toLowerCase().includes(q) ||
        e.target?.full_name?.toLowerCase().includes(q),
    );
  }

  const hasMore = filtered.length > offset + limit;
  return {
    events: filtered.slice(offset, offset + limit),
    hasMore,
  };
}

// ─── Query helpers ────────────────────────────────────────────────

type QueryOpts = {
  isAdmin: boolean;
  allowedIds: string[] | null;
  targetId: string | undefined;
  fetchLimit: number;
};

async function queryAccessAudit(
  admin: ReturnType<typeof getAdminClient>,
  opts: QueryOpts,
) {
  let q = admin
    .from('access_audit')
    .select('id, action_type, previous_status, new_status, created_at, actor_user_id, target_user_id')
    .order('created_at', { ascending: false })
    .limit(opts.fetchLimit);

  if (opts.targetId) {
    q = q.or(`actor_user_id.eq.${opts.targetId},target_user_id.eq.${opts.targetId}`);
  } else if (!opts.isAdmin && opts.allowedIds && opts.allowedIds.length > 0) {
    q = q.or(
      `actor_user_id.in.(${opts.allowedIds.join(',')}),target_user_id.in.(${opts.allowedIds.join(',')})`,
    );
  }

  const { data } = await q;
  return data ?? [];
}

async function queryIntegrationAudit(
  admin: ReturnType<typeof getAdminClient>,
  opts: QueryOpts,
) {
  let q = admin
    .from('integration_audit')
    .select('id, event_type, integration_key, created_at, actor_user_id')
    .order('created_at', { ascending: false })
    .limit(opts.fetchLimit);

  if (opts.targetId) {
    q = q.eq('actor_user_id', opts.targetId);
  } else if (!opts.isAdmin && opts.allowedIds && opts.allowedIds.length > 0) {
    q = q.in('actor_user_id', opts.allowedIds);
  }

  const { data } = await q;
  return data ?? [];
}

async function queryAiAudit(
  admin: ReturnType<typeof getAdminClient>,
  opts: QueryOpts,
) {
  let q = admin
    .from('ai_provider_audit')
    .select('id, event_type, created_at, user_id, provider:provider_id(name)')
    .order('created_at', { ascending: false })
    .limit(opts.fetchLimit);

  if (opts.targetId) {
    q = q.eq('user_id', opts.targetId);
  } else if (!opts.isAdmin && opts.allowedIds && opts.allowedIds.length > 0) {
    q = q.in('user_id', opts.allowedIds);
  }

  const { data } = await q;
  return data ?? [];
}
