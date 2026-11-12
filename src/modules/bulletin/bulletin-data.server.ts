// ============================================================
// Boletín — lectura de la actividad del equipo (servidor, sólo lectura).
// El alcance es el de la plataforma: admin todo; líder/manager su equipo en
// cascada (grupo + reportes); vendedor lo suyo. Los sub-equipos se arman con
// el organigrama: cada reporte directo de quien recibe es un equipo con toda
// su cascada debajo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCommercialScopeForUser } from '@/modules/access/commercial-scope-core.server';
import { displayUserName } from '@/modules/access/user-names';
import { canSeeMoney } from '@/modules/ai-usage/money-visibility';
import { pendingFor } from '@/server/slack-assistant/digests/digests.server';
import type { BulletinFrequency } from '@/modules/notifications/notification-catalog';
import {
  buildBulletinModel,
  bulletinPeriod,
  periodBounds,
  type BulletinModel,
  type BulletinPeriod,
  type BulletinTeam,
  type PersonActivity,
} from './bulletin-model';

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  manager_id: string | null;
  group_id: string | null;
  access_status: string;
  roles: { key: string } | null;
}

const PAGE = 1000;
const MAX_PAGES = 30;

/** Lee todas las filas de una consulta paginada (hasta 30.000). */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function emptyActivity(id: string, name: string): PersonActivity {
  return {
    id,
    name,
    searches: 0,
    found: 0,
    approved: 0,
    discarded: 0,
    contactsApproved: 0,
    firstContacts: 0,
    firstContactsUsed: 0,
    usageUsd: 0,
    usageCredits: 0,
    pending: 0,
    oldestPendingDays: null,
  };
}

/** Actividad de cada persona del equipo en [start, end] (días de Bogotá). */
export async function readTeamActivity(
  admin: SupabaseClient,
  team: ReadonlyArray<{ id: string; name: string }>,
  start: string,
  end: string,
): Promise<PersonActivity[]> {
  const ids = team.map((t) => t.id);
  const byId = new Map(team.map((t) => [t.id, emptyActivity(t.id, t.name)]));
  if (ids.length === 0) return [];
  const { from, to } = periodBounds(start, end);
  const bump = (id: string | null | undefined, key: keyof PersonActivity, amount = 1) => {
    const row = id ? byId.get(id) : undefined;
    if (row) (row[key] as number) += amount;
  };

  const [batches, candidates, reviewed, contacts, packs, used, usage] = await Promise.all([
    readAll<{ created_by: string | null }>((a, b) =>
      admin.from('prospect_batches').select('created_by').in('created_by', ids).gte('created_at', from).lt('created_at', to).range(a, b),
    ),
    readAll<{ assigned_to: string | null; batch: { owner_id: string | null; created_by: string | null } | null }>((a, b) =>
      admin
        .from('prospect_candidates')
        .select('assigned_to, batch:prospect_batches!prospect_candidates_batch_id_fkey(owner_id, created_by)')
        .gte('created_at', from)
        .lt('created_at', to)
        .range(a, b) as never,
    ),
    readAll<{ reviewed_by: string | null; status: string }>((a, b) =>
      admin
        .from('prospect_candidates')
        .select('reviewed_by, status')
        .in('reviewed_by', ids)
        .in('status', ['approved', 'converted_to_account', 'discarded'])
        .gte('reviewed_at', from)
        .lt('reviewed_at', to)
        .range(a, b),
    ),
    readAll<{ created_by: string | null }>((a, b) =>
      admin.from('contacts').select('created_by').in('created_by', ids).gte('created_at', from).lt('created_at', to).range(a, b),
    ),
    readAll<{ created_by: string | null; status: string }>((a, b) =>
      admin.from('first_call_packs').select('created_by, status').in('created_by', ids).gte('created_at', from).lt('created_at', to).range(a, b),
    ),
    readAll<{ created_by: string | null }>((a, b) =>
      admin.from('first_call_packs').select('created_by').in('created_by', ids).gte('used_at', from).lt('used_at', to).range(a, b),
    ),
    readAll<{ triggered_by: string | null; estimated_cost_usd: number | null; credits_used: number | null }>((a, b) =>
      admin
        .from('provider_usage_logs')
        .select('triggered_by, estimated_cost_usd, credits_used')
        .in('triggered_by', ids)
        .gte('created_at', from)
        .lt('created_at', to)
        .range(a, b),
    ),
  ]);

  for (const r of batches) bump(r.created_by, 'searches');
  // Encontradas: las candidatas nuevas cuyo responsable efectivo es del equipo.
  for (const r of candidates) bump(r.assigned_to ?? r.batch?.owner_id ?? r.batch?.created_by ?? null, 'found');
  for (const r of reviewed) bump(r.reviewed_by, r.status === 'discarded' ? 'discarded' : 'approved');
  for (const r of contacts) bump(r.created_by, 'contactsApproved');
  for (const r of packs) if (r.status !== 'failed') bump(r.created_by, 'firstContacts');
  for (const r of used) bump(r.created_by, 'firstContactsUsed');
  for (const r of usage) {
    bump(r.triggered_by, 'usageUsd', Number(r.estimated_cost_usd ?? 0));
    bump(r.triggered_by, 'usageCredits', Number(r.credits_used ?? 0));
  }
  return [...byId.values()];
}

/** Sub-equipos: cada reporte directo con su cascada; si no hay, por grupo de la organización. */
export function buildTeams(
  recipientId: string,
  members: readonly UserRow[],
  groupNames: ReadonlyMap<string, string>,
): BulletinTeam[] {
  const memberIds = new Set(members.map((m) => m.id));
  const childrenOf = new Map<string, string[]>();
  for (const m of members) {
    if (!m.manager_id) continue;
    childrenOf.set(m.manager_id, [...(childrenOf.get(m.manager_id) ?? []), m.id]);
  }
  const subtree = (rootId: string): string[] => {
    const out: string[] = [];
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      if (memberIds.has(id)) out.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return out;
  };
  const direct = members.filter((m) => m.manager_id === recipientId && m.id !== recipientId);
  if (direct.length > 0) {
    // Quien tiene gente a cargo es un sub-equipo (con toda su cascada); los
    // reportes directos sin gente a cargo van juntos con quien recibe.
    const leads = direct.filter((d) => (childrenOf.get(d.id) ?? []).length > 0);
    const leaves = direct.filter((d) => (childrenOf.get(d.id) ?? []).length === 0);
    const teams: BulletinTeam[] = leads.map((d) => ({ name: displayUserName(d) ?? 'Sin nombre', memberIds: subtree(d.id) }));
    if (leaves.length > 0) {
      const ids = [...(memberIds.has(recipientId) ? [recipientId] : []), ...leaves.map((d) => d.id)];
      teams.push({ name: leads.length > 0 ? 'Tu equipo directo' : 'Tu equipo', memberIds: ids });
    }
    const covered = new Set(teams.flatMap((t) => t.memberIds));
    const rest = members.filter((m) => !covered.has(m.id)).map((m) => m.id);
    return rest.length ? [...teams, { name: 'Otros del equipo', memberIds: rest }] : teams;
  }
  const byGroup = new Map<string, string[]>();
  for (const m of members) {
    const name = (m.group_id && groupNames.get(m.group_id)) || 'Sin grupo';
    byGroup.set(name, [...(byGroup.get(name) ?? []), m.id]);
  }
  return byGroup.size > 1 ? [...byGroup.entries()].map(([name, ids]) => ({ name, memberIds: ids })) : [];
}

export interface BuiltBulletin {
  model: BulletinModel;
  recipient: { id: string; name: string };
}

/** El boletín de una persona para una frecuencia, con los datos de hoy. */
export async function buildBulletinForUser(
  admin: SupabaseClient,
  recipientId: string,
  frequency: BulletinFrequency,
  now: Date = new Date(),
  periodOverride?: BulletinPeriod,
): Promise<BuiltBulletin | null> {
  const [{ data: users }, { data: groups }] = await Promise.all([
    admin.from('internal_users').select('id, full_name, email, manager_id, group_id, access_status, roles(key)').limit(2000),
    admin.from('organization_groups').select('id, name'),
  ]);
  const all = (users ?? []) as unknown as UserRow[];
  const recipient = all.find((u) => u.id === recipientId);
  if (!recipient || recipient.access_status !== 'active') return null;
  const roleKey = recipient.roles?.key ?? null;

  const scope = await resolveCommercialScopeForUser(admin, {
    id: recipient.id,
    email: recipient.email,
    groupId: recipient.group_id,
    roleKey,
  });
  const active = all.filter((u) => u.access_status === 'active');
  // Admin: toda la operación comercial (sin otros administradores).
  const members = scope.canViewAll
    ? active.filter((u) => u.roles?.key !== 'admin' || u.id === recipient.id)
    : active.filter((u) => scope.allowedUserIds.includes(u.id));
  const team = members.map((m) => ({ id: m.id, name: displayUserName(m) ?? 'Sin nombre' }));

  const period = periodOverride ?? bulletinPeriod(frequency, now);
  const [current, previous] = await Promise.all([
    readTeamActivity(admin, team, period.start, period.end),
    readTeamActivity(admin, team, period.previousStart, period.previousEnd),
  ]);
  // Foto de hoy: pendientes de cada persona.
  for (const person of current) {
    const pending = await pendingFor(admin, person.id, now);
    person.pending = pending.total;
    person.oldestPendingDays = pending.oldestDays;
  }

  const groupNames = new Map(((groups ?? []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  const scopeLabel = scope.canViewAll
    ? 'Toda la operación comercial'
    : scope.isRestrictedToSelf
      ? 'Tu actividad'
      : 'Tu equipo y sus equipos (en cascada)';
  const recipientName = displayUserName(recipient) ?? 'Sin nombre';
  return {
    recipient: { id: recipient.id, name: recipientName },
    model: buildBulletinModel({
      period,
      recipientName,
      scopeLabel,
      moneyVisible: canSeeMoney({ viewAll: scope.canViewAll, roleKey }),
      current,
      previous,
      teams: scope.isRestrictedToSelf && !scope.canViewAll ? [] : buildTeams(recipient.id, members, groupNames),
    }),
  };
}
