'use client';

// Filtro «Equipo» de las tablas operativas: muestra solo lo de un grupo (y sus
// subgrupos) o lo de una persona, dentro del alcance comercial de quien mira.
//
// Es un FILTRO, no una preferencia de la tabla: vive en la barra de la tabla,
// junto al buscador, y no dentro de «Configurar tabla» (que solo decide cómo se
// ve la tabla). Dos variantes con el mismo botón:
//   TeamFilterUrlButton — escribe `?groupId=` / `?userId=` y filtra el servidor
//                         (Empresas › Prospectos y Descartadas).
//   TeamFilterButton    — controlado por estado; la pantalla filtra en el cliente
//                         (Contactos, Candidatos de contacto).
//
// El antiguo filtro por rol se quitó: en las pantallas que filtran en el
// servidor solo acotaba la lista de personas, nunca las filas.

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Users } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

const GROUP_INDENT_STEP_PX = 16;
const ALL = 'all';

export interface ScopeFilterState {
  userId: string;
  groupId: string;
}

export const EMPTY_SCOPE_FILTER: ScopeFilterState = { userId: '', groupId: '' };

type ScopeUser = ScopeFilterOptions['users'][number];

function labelUser(u: { full_name: string | null; email: string | null }): string {
  if (u.full_name && u.email) return `${u.full_name} (${u.email})`;
  return u.full_name ?? u.email ?? '—';
}

function shortUser(u: { full_name: string | null; email: string | null }): string {
  return u.full_name ?? u.email ?? 'Persona';
}

/** El grupo elegido y todos sus descendientes. */
export function groupDescendantIds(
  rootId: string,
  groups: ScopeFilterOptions['groups'],
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.parent_group_id) continue;
    childrenByParent.set(g.parent_group_id, [...(childrenByParent.get(g.parent_group_id) ?? []), g.id]);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return result;
}

/**
 * Las personas cuyos registros entran con este filtro, o `null` si no filtra.
 * Para las pantallas que filtran en el cliente por responsable.
 */
export function resolveScopeOwnerIds(
  options: ScopeFilterOptions | undefined,
  value: ScopeFilterState,
): Set<string> | null {
  if (!options?.showScopeFilters) return null;
  if (value.userId) return new Set([value.userId]);
  if (!value.groupId) return null;
  const scope = groupDescendantIds(value.groupId, options.groups);
  return new Set(options.users.filter((u) => u.group_id && scope.has(u.group_id)).map((u) => u.id));
}

/** Cambiar de grupo suelta a la persona elegida si queda fuera del grupo. */
function nextOnGroupChange(
  options: ScopeFilterOptions,
  value: ScopeFilterState,
  groupId: string,
): ScopeFilterState {
  const next = { ...value, groupId };
  if (!groupId) return next;
  const scope = groupDescendantIds(groupId, options.groups);
  const selected = options.users.find((u) => u.id === value.userId);
  if (selected && (!selected.group_id || !scope.has(selected.group_id))) return { ...next, userId: '' };
  return next;
}

interface TeamFilterButtonProps {
  scopeFilterOptions: ScopeFilterOptions;
  value: ScopeFilterState;
  onChange: (next: ScopeFilterState) => void;
  className?: string;
}

/**
 * El botón «Equipo» de la barra de la tabla. Activo, dice qué filtra («Ventas
 * Norte», «Ana Gómez») en vez de un contador: es lo que se quiere leer de un
 * vistazo. Quien solo se ve a sí mismo no lo recibe (`showScopeFilters`).
 */
export function TeamFilterButton({ scopeFilterOptions, value, onChange, className }: TeamFilterButtonProps) {
  const { users, groups } = scopeFilterOptions;

  const groupScope = useMemo(
    () => (value.groupId ? groupDescendantIds(value.groupId, groups) : null),
    [value.groupId, groups],
  );
  const visibleUsers = useMemo<ScopeUser[]>(
    () => users.filter((u) => !groupScope || (u.group_id != null && groupScope.has(u.group_id))),
    [users, groupScope],
  );
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  if (!scopeFilterOptions.showScopeFilters) return null;

  const selectedUser = value.userId ? userById.get(value.userId) : undefined;
  const isActive = Boolean(value.userId || value.groupId);
  const triggerLabel = selectedUser
    ? shortUser(selectedUser)
    : value.groupId
      ? (groupName.get(value.groupId) ?? 'Grupo')
      : 'Equipo';

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={isActive ? `Filtro de equipo: ${triggerLabel}` : 'Filtrar por equipo'}
            className={cn('max-w-48', isActive && 'border-primary/50 bg-primary/10 text-primary', className)}
          />
        }
      >
        <Users aria-hidden />
        <span className="truncate">{triggerLabel}</span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        aria-label="Filtrar por equipo"
        // Por encima de las barras flotantes (z-60) y por debajo del
        // desplegable de los `Select` (z-70).
        positionerClassName="z-[65]"
        className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Equipo</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Solo lo de un grupo o de una persona.
            </p>
          </div>
          {isActive && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_SCOPE_FILTER)}
              className="shrink-0 rounded-sm pt-0.5 text-xs font-medium text-primary underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Quitar
            </button>
          )}
        </div>

        {groups.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Grupo</span>
            <Select
              value={value.groupId || ALL}
              onValueChange={(v) =>
                onChange(nextOnGroupChange(scopeFilterOptions, value, !v || v === ALL ? '' : v))
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Grupo">
                  {value.groupId ? (groupName.get(value.groupId) ?? 'Grupo no encontrado') : 'Todos los grupos'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-xs">
                  Todos los grupos
                </SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id} className="text-xs">
                    <span style={{ paddingLeft: `${g.depth * GROUP_INDENT_STEP_PX}px` }}>{g.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        {users.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Persona</span>
            <Select
              value={value.userId || ALL}
              onValueChange={(v) => onChange({ ...value, userId: !v || v === ALL ? '' : v })}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Persona">
                  {selectedUser ? labelUser(selectedUser) : value.userId ? 'Persona no encontrada' : 'Todas las personas'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-xs">
                  Todas las personas
                </SelectItem>
                {visibleUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id} className="text-xs">
                    {labelUser(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface TeamFilterUrlButtonProps {
  scopeFilterOptions: ScopeFilterOptions;
  currentUserId: string;
  currentGroupId: string;
  /** Claves de la URL (por defecto `userId` y `groupId`). */
  paramKeys?: { user?: string; group?: string };
}

function TeamFilterUrlButtonInner({
  scopeFilterOptions,
  currentUserId,
  currentGroupId,
  paramKeys = {},
}: TeamFilterUrlButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const userKey = paramKeys.user ?? 'userId';
  const groupKey = paramKeys.group ?? 'groupId';

  const onChange = useCallback(
    (next: ScopeFilterState) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of [
        [userKey, next.userId],
        [groupKey, next.groupId],
      ] as const) {
        if (val) params.set(key, val);
        else params.delete(key);
      }
      // El rol ya no filtra: un enlace viejo que lo traiga no lo arrastra.
      params.delete('roleKey');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, userKey, groupKey],
  );

  return (
    <TeamFilterButton
      scopeFilterOptions={scopeFilterOptions}
      value={{ userId: currentUserId, groupId: currentGroupId }}
      onChange={onChange}
    />
  );
}

/** «Equipo» para las pantallas que filtran en el servidor por la URL. */
export function TeamFilterUrlButton(props: TeamFilterUrlButtonProps) {
  if (!props.scopeFilterOptions.showScopeFilters) return null;
  return (
    <Suspense>
      <TeamFilterUrlButtonInner {...props} />
    </Suspense>
  );
}
