// Preparación para encender ENABLE_COMMERCIAL_SCOPE: cuenta, sin nombres, cómo
// quedaría cada usuario activo con la bandera encendida. Responde a la advertencia
// de `isCommercialScopeEnabled`: con roles o grupos sin cargar, alguien podría
// perder visibilidad. Puro (sin Supabase) para poder probarlo bajo `node --test`.

import { classifyRole } from './commercial-scope-logic';

export interface ReadinessUser {
  id: string;
  roleKey: string | null;
  groupId: string | null;
  managerId: string | null;
}

export interface CommercialScopeReadiness {
  active_users: number;
  /** Ven todo (admin). */
  admins: number;
  /** Líder/manager con grupo o con reportes: ven su equipo. */
  leaders_with_team: number;
  /** Líder/manager sin grupo ni reportes: quedarían viendo sólo lo suyo. */
  leaders_without_team: number;
  /** Vendedor/BD u otro rol: ven sólo lo suyo. */
  self_only: number;
  /** Usuarios sin rol cargado (caen en «sólo lo suyo»). */
  without_role: number;
  /** Usuarios no admin sin grupo asignado. */
  non_admin_without_group: number;
}

export function computeCommercialScopeReadiness(
  users: readonly ReadinessUser[],
): CommercialScopeReadiness {
  const managerIds = new Set(
    users.map((u) => u.managerId).filter((id): id is string => id != null),
  );

  const report: CommercialScopeReadiness = {
    active_users: users.length,
    admins: 0,
    leaders_with_team: 0,
    leaders_without_team: 0,
    self_only: 0,
    without_role: 0,
    non_admin_without_group: 0,
  };

  return users.reduce((acc, user) => {
    const roleClass = classifyRole(user.roleKey, false);
    const next = { ...acc };
    if (!user.roleKey) next.without_role += 1;
    if (roleClass !== 'admin' && !user.groupId) next.non_admin_without_group += 1;

    if (roleClass === 'admin') next.admins += 1;
    else if (roleClass === 'self') next.self_only += 1;
    else if (user.groupId || managerIds.has(user.id)) next.leaders_with_team += 1;
    else next.leaders_without_team += 1;
    return next;
  }, report);
}
