import type { InternalUser, OrganizationGroup, Role } from './types';

export function formatGroupDisplayName(group: OrganizationGroup): string {
  return group.name?.trim() || 'Grupo sin nombre';
}

export function formatGroupLabel(groupId: string | null, groups: OrganizationGroup[]): string {
  if (!groupId) return 'Sin grupo';
  const group = groups.find(g => g.id === groupId);
  return group ? formatGroupDisplayName(group) : 'Sin grupo';
}

export function formatGroupPath(group: OrganizationGroup, allGroups: OrganizationGroup[]): string {
  if (!group.parent_group_id) return formatGroupDisplayName(group);
  const parent = allGroups.find(g => g.id === group.parent_group_id);
  if (!parent) return formatGroupDisplayName(group);
  return `${formatGroupPath(parent, allGroups)} / ${formatGroupDisplayName(group)}`;
}

export function formatUserLabel(user: InternalUser): string {
  return user.full_name ? `${user.full_name} · ${user.email}` : user.email;
}

export function formatRoleLabel(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}
