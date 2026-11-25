// TABLEROS-1 — A quién mira un tablero, puro.
//
// La regla de visibilidad es la de siempre (alcance comercial): admin ve a todos,
// líder/manager ve a su equipo en cascada y BD/KAM sólo se ve a sí mismo. Los
// filtros de equipo y persona sólo ACHICAN ese alcance, nunca lo agrandan: un
// id de fuera del alcance pegado en la URL no trae nada (anti-manipulación).

import { collectGroupSubtreeIds } from '@/modules/access/group-tree';
import type { DashboardPerson } from './dashboard-core';

export type DashboardScopeKind = 'admin' | 'team' | 'self';

export interface DirectoryUser {
  id: string;
  name: string;
  email: string | null;
  groupId: string | null;
}

export interface DirectoryGroup {
  id: string;
  name: string;
  parentGroupId: string | null;
  depth: number;
}

export interface DashboardAudienceInput {
  kind: DashboardScopeKind;
  currentUserId: string;
  /** Ids que el alcance deja ver (vacío para admin: los ve a todos). */
  allowedUserIds: readonly string[];
  /** Las personas que se pueden elegir (ya limitadas al alcance). */
  users: readonly DirectoryUser[];
  groups: readonly DirectoryGroup[];
  requestedTeams: readonly string[];
  requestedPeople: readonly string[];
  /** La propia persona, para el caso BD (su fila en la tabla). */
  self?: DirectoryUser | null;
}

export interface DashboardAudience {
  /**
   * Ids a los que se limitan las consultas. `null` = sin límite (admin sin
   * filtros). `[]` = nadie: no se lee nada.
   */
  queryUserIds: string[] | null;
  /** Las personas de la tabla «Por persona» (en cero si no hicieron nada). */
  people: DashboardPerson[];
  /** Los filtros pedidos que se ignoraron por estar fuera del alcance. */
  ignoredTeams: string[];
  ignoredPeople: string[];
}

function toPerson(user: DirectoryUser, groups: ReadonlyMap<string, DirectoryGroup>): DashboardPerson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    groupId: user.groupId,
    groupName: user.groupId ? groups.get(user.groupId)?.name ?? null : null,
  };
}

export function resolveDashboardAudience(input: DashboardAudienceInput): DashboardAudience {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));

  // BD/KAM (o cualquier rol desconocido): sólo él. Los filtros no cambian nada.
  if (input.kind === 'self') {
    const self = input.self ?? { id: input.currentUserId, name: 'Tú', email: null, groupId: null };
    return {
      queryUserIds: [input.currentUserId],
      people: [toPerson({ ...self, id: input.currentUserId }, groupsById)],
      ignoredTeams: [...input.requestedTeams],
      ignoredPeople: input.requestedPeople.filter((id) => id !== input.currentUserId),
    };
  }

  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const allowed = input.kind === 'admin' ? null : new Set(input.allowedUserIds);

  const validTeams = input.requestedTeams.filter((id) => groupsById.has(id));
  const ignoredTeams = input.requestedTeams.filter((id) => !groupsById.has(id));
  const validPeople = input.requestedPeople.filter(
    (id) => usersById.has(id) && (allowed === null || allowed.has(id)),
  );
  const ignoredPeople = input.requestedPeople.filter((id) => !validPeople.includes(id));

  // El universo: todo el alcance (admin: todos los activos; líder: su gente).
  let candidates: string[] =
    allowed === null ? input.users.map((user) => user.id) : [...allowed];

  if (validTeams.length > 0) {
    const subtree = new Set(
      collectGroupSubtreeIds(
        validTeams,
        input.groups.map((group) => ({ id: group.id, name: group.name, parent_group_id: group.parentGroupId })),
      ),
    );
    candidates = candidates.filter((id) => {
      const groupId = usersById.get(id)?.groupId;
      return Boolean(groupId && subtree.has(groupId));
    });
  }
  if (validPeople.length > 0) {
    const picked = new Set(validPeople);
    candidates = candidates.filter((id) => picked.has(id));
  }

  // Pidió equipos o personas y ninguno era válido: no se muestra a nadie
  // (antes que mostrar de más).
  const askedSomething = input.requestedTeams.length > 0 || input.requestedPeople.length > 0;
  const askedNothingValid = askedSomething && validTeams.length === 0 && validPeople.length === 0;

  const narrowed = validTeams.length > 0 || validPeople.length > 0;
  const queryUserIds = askedNothingValid ? [] : allowed === null && !narrowed ? null : candidates;

  const people = (askedNothingValid ? [] : candidates)
    .map((id) => usersById.get(id))
    .filter((user): user is DirectoryUser => Boolean(user))
    .map((user) => toPerson(user, groupsById));

  return { queryUserIds, people, ignoredTeams, ignoredPeople };
}
