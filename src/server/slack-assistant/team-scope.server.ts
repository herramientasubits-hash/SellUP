// ============================================================
// Asistente de Slack — «el equipo de alguien» con la MISMA regla de la
// plataforma: su grupo con todos los subgrupos ∪ sus reportes en cascada
// (`resolveCommercialScopeForUser` como rol de equipo). Sirve para «mi equipo»
// de un administrador y para «el equipo de Carla».
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCommercialScopeForUser } from '@/modules/access/commercial-scope-core.server';

/** La persona y toda su gente en cascada (grupo ∪ reportes). */
export type TeamScopeResolver = (userId: string) => Promise<string[]>;

/** Rol de equipo con el que se calcula la cascada de cualquier persona. */
const TEAM_ROLE_FOR_CASCADE = 'commercial_manager';

export function createTeamScopeResolver(admin: SupabaseClient): TeamScopeResolver {
  return async (userId) => {
    const { data, error } = await admin.from('internal_users').select('id, email, group_id').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { id: string; email: string | null; group_id: string | null } | null;
    if (!row) return [];
    const scope = await resolveCommercialScopeForUser(admin as never, {
      id: row.id,
      email: row.email,
      groupId: row.group_id,
      roleKey: TEAM_ROLE_FOR_CASCADE,
    });
    return scope.allowedUserIds;
  };
}
