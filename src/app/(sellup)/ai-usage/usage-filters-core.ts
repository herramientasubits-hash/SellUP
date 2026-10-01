// Reglas puras de los filtros de /ai-usage: qué cambia en la URL al mover un
// filtro, qué combinaciones son imposibles y qué etiquetas se enseñan. Sin React
// ni router para poder probarlas solas.

import type { FilterGroup, FilterOptions, FilterUser } from '@/modules/ai-usage/queries';
import { agentLabel, providerLabel, statusLabel } from './usage-labels';

export const USAGE_FILTER_KEYS = [
  'period',
  'provider',
  'agent',
  'status',
  'role',
  'groupId',
  'user',
] as const;

export type UsageFilterKey = (typeof USAGE_FILTER_KEYS)[number];

/** Cada filtro con su valor de la URL; cadena vacía = sin filtrar. */
export type UsageFilterValues = Record<UsageFilterKey, string>;

/** Filtros que viven detrás de «Más filtros». El periodo va siempre a la vista. */
export const SECONDARY_FILTER_KEYS: readonly UsageFilterKey[] = [
  'provider',
  'agent',
  'status',
  'role',
  'groupId',
  'user',
];

export const ALL_VALUE = 'all';

export const PERIOD_OPTIONS = [
  { value: ALL_VALUE, label: 'Todo el periodo' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'current_month', label: 'Mes actual' },
] as const;

export const FILTER_NAMES: Record<UsageFilterKey, string> = {
  period: 'Periodo',
  provider: 'Proveedor',
  agent: 'Agente',
  status: 'Estado',
  role: 'Rol',
  groupId: 'Grupo',
  user: 'Persona',
};

export function userLabel(user: FilterUser): string {
  if (user.full_name && user.email) return `${user.full_name} (${user.email})`;
  return user.full_name ?? user.email ?? user.id.slice(0, 8);
}

/**
 * El grupo elegido más todos sus descendientes en la jerarquía real. Elegir un
 * grupo padre abarca todo su subárbol, igual que resuelve el servidor.
 */
export function descendantGroupIds(rootId: string, groups: readonly FilterGroup[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parent_group_id) continue;
    const siblings = childrenByParent.get(group.parent_group_id) ?? [];
    childrenByParent.set(group.parent_group_id, [...siblings, group.id]);
  }

  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (result.has(id)) continue;
    result.add(id);
    pending.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

function normalize(value: string | null | undefined): string {
  return !value || value === ALL_VALUE ? '' : value;
}

/**
 * Devuelve los filtros tras mover uno. Cambiar el rol o el grupo quita a la
 * persona elegida si deja de encajar: los filtros nunca expresan una
 * combinación imposible.
 */
export function applyFilterChange(
  values: UsageFilterValues,
  key: UsageFilterKey,
  rawValue: string | null,
  options: Pick<FilterOptions, 'users' | 'groups'>,
): UsageFilterValues {
  const value = normalize(rawValue);
  const next: UsageFilterValues = { ...values, [key]: value };
  if (!value || !values.user) return next;

  const selected = options.users.find((user) => user.id === values.user);
  if (!selected) return next;

  if (key === 'role' && selected.role_key !== value) return { ...next, user: '' };
  if (key === 'groupId') {
    const scope = descendantGroupIds(value, options.groups);
    if (!selected.group_id || !scope.has(selected.group_id)) return { ...next, user: '' };
  }
  return next;
}

/** Todos los filtros quitados. */
export function clearedFilters(): UsageFilterValues {
  return { period: '', provider: '', agent: '', status: '', role: '', groupId: '', user: '' };
}

/** Las personas que se pueden elegir con el rol y el grupo puestos. */
export function visibleUsers(
  values: Pick<UsageFilterValues, 'role' | 'groupId'>,
  options: Pick<FilterOptions, 'users' | 'groups'>,
): FilterUser[] {
  const scope = values.groupId ? descendantGroupIds(values.groupId, options.groups) : null;
  return options.users.filter((user) => {
    if (values.role && user.role_key !== values.role) return false;
    if (scope && (!user.group_id || !scope.has(user.group_id))) return false;
    return true;
  });
}

/**
 * El texto de un filtro puesto. Un valor que ya no existe (un enlace viejo) se
 * dice con palabras: nunca se enseña un identificador crudo.
 */
export function filterValueLabel(
  key: UsageFilterKey,
  value: string,
  options: FilterOptions,
): string {
  switch (key) {
    case 'period':
      return PERIOD_OPTIONS.find((option) => option.value === value)?.label ?? 'Periodo no válido';
    case 'provider':
      return providerLabel(value);
    case 'agent':
      return agentLabel(value, options.agents.find((agent) => agent.key === value)?.name);
    case 'status':
      return statusLabel(value);
    case 'role':
      return options.roles.find((role) => role.key === value)?.label ?? 'Rol no encontrado';
    case 'groupId':
      return options.groups.find((group) => group.id === value)?.name ?? 'Grupo no encontrado';
    case 'user': {
      const user = options.users.find((candidate) => candidate.id === value);
      return user ? userLabel(user) : 'Persona no encontrada';
    }
  }
}

export interface ActiveUsageFilter {
  key: UsageFilterKey;
  label: string;
  value: string;
}

/** Los filtros puestos, en el orden en que se leen en la barra. */
export function describeActiveFilters(
  values: UsageFilterValues,
  options: FilterOptions,
): ActiveUsageFilter[] {
  return USAGE_FILTER_KEYS.filter((key) => values[key] !== '').map((key) => ({
    key,
    label: FILTER_NAMES[key],
    value: filterValueLabel(key, values[key], options),
  }));
}

export function countSecondaryFilters(values: UsageFilterValues): number {
  return SECONDARY_FILTER_KEYS.filter((key) => values[key] !== '').length;
}

/**
 * La query de la URL con los filtros aplicados. Conserva lo que no es un filtro
 * (la pestaña puesta, por ejemplo).
 */
export function toQueryString(current: string, values: UsageFilterValues): string {
  const params = new URLSearchParams(current);
  for (const key of USAGE_FILTER_KEYS) {
    if (values[key]) params.set(key, values[key]);
    else params.delete(key);
  }
  return params.toString();
}
