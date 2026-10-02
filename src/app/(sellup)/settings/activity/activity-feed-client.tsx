'use client';

import { formatInAppZone } from '@/lib/format-date';
import { useState, useTransition, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  Users,
  Link2,
  Cpu,
  Search,
  Loader2,
  ChevronRight,
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Timeline, TimelineItem, type TimelineTone } from '@/components/data-display';
import { Spinner } from '@/components/feedback/spinner';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { SegmentedControl } from '@/components/selection/segmented-control';
import { Heading } from '@/components/typography';
import { getPlatformActivity } from '@/modules/system-status/activity-actions';
import type {
  ActivityViewerContext,
  PlatformActivityEvent,
  AdminActivitySource,
} from '@/modules/system-status/types';

// ─── Types ────────────────────────────────────────────────────────

interface Props {
  context: ActivityViewerContext;
  initialEvents: PlatformActivityEvent[];
  initialHasMore: boolean;
  /** Cuando es true oculta el PageHeader (usado dentro de system-status) */
  embedded?: boolean;
}

type SourceFilter = AdminActivitySource | 'all';

// ─── Helpers ─────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days}d`;
  return formatInAppZone(iso, { month: 'short', day: 'numeric' }, 'es-CO');
}

function displayName(user: { email: string; full_name: string | null } | null): string {
  if (!user) return '—';
  return user.full_name?.trim() || user.email;
}

// ─── Sub-components ──────────────────────────────────────────────

// Design Refresh v2: el icono de categoría lleva un tinte sutil por fuente.
// Así el color señala la categoría sin necesidad del badge uppercase repetido.
const SOURCE_TONE: Record<AdminActivitySource, TimelineTone> = {
  users: 'primary',
  integrations: 'warning',
  ai: 'default',
};

function SourceIcon({ source }: { source: AdminActivitySource }) {
  const iconClass = 'h-3 w-3';
  if (source === 'users') return <Users className={iconClass} aria-hidden="true" />;
  if (source === 'integrations') return <Link2 className={iconClass} aria-hidden="true" />;
  return <Cpu className={iconClass} aria-hidden="true" />;
}

const ALL_USERS_ID = 'all';
const ALL_USERS_LABEL = 'Todos los usuarios';

interface UserSelectorProps {
  value: string;
  options: { id: string; email: string; full_name: string | null }[];
  onChange: (id: string) => void;
}

/**
 * De quién se ve la actividad. El buscador del desplegable compara contra el
 * valor de cada opción, así que el valor es «nombre · correo» (legible y único
 * por el correo) y aquí se traduce de vuelta al id de la persona.
 */
function UserSelector({ value, options, onChange }: UserSelectorProps) {
  const entries = useMemo(
    () => [
      { id: ALL_USERS_ID, key: ALL_USERS_LABEL, label: ALL_USERS_LABEL, description: undefined },
      ...options.map((user) => {
        const name = user.full_name?.trim();
        return {
          id: user.id,
          key: name ? `${name} · ${user.email}` : user.email,
          label: name || user.email,
          description: name ? user.email : undefined,
        };
      }),
    ],
    [options],
  );

  const selectedKey = entries.find((entry) => entry.id === value)?.key ?? ALL_USERS_LABEL;

  return (
    <SearchableSelect
      compact
      className="h-8 w-auto min-w-44 max-w-64 text-xs"
      contentClassName="w-72"
      options={entries.map((entry) => ({
        value: entry.key,
        label: entry.label,
        description: entry.description,
      }))}
      value={selectedKey}
      onValueChange={(key) => {
        const entry = entries.find((candidate) => candidate.key === key);
        if (entry) onChange(entry.id);
      }}
      placeholder={ALL_USERS_LABEL}
      searchPlaceholder="Buscar usuario…"
      emptyMessage="Nadie coincide con tu búsqueda."
    />
  );
}

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'users', label: 'Usuarios' },
  { value: 'integrations', label: 'Integraciones' },
  { value: 'ai', label: 'IA' },
];

// ─── Main component ───────────────────────────────────────────────

export function ActivityFeedClient({ context, initialEvents, initialHasMore, embedded = false }: Props) {
  const [events, setEvents] = useState<PlatformActivityEvent[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(0);

  const reload = useCallback(
    (opts: {
      userId?: string;
      source?: SourceFilter;
      search?: string;
      append?: boolean;
    }) => {
      const isAppend = opts.append ?? false;
      const currentOffset = isAppend ? offsetRef.current : 0;
      if (!isAppend) offsetRef.current = 0;

      const filter = {
        userId: opts.userId !== 'all' ? opts.userId : undefined,
        source: (opts.source ?? 'all') as SourceFilter,
        search: opts.search,
        limit: 30,
        offset: currentOffset,
      };

      if (isAppend) {
        setIsLoadingMore(true);
        getPlatformActivity(filter).then((res) => {
          setEvents((prev) => [...prev, ...res.events]);
          setHasMore(res.hasMore);
          offsetRef.current = currentOffset + res.events.length;
          setIsLoadingMore(false);
        });
      } else {
        startTransition(async () => {
          const res = await getPlatformActivity(filter);
          setEvents(res.events);
          setHasMore(res.hasMore);
          offsetRef.current = res.events.length;
        });
      }
    },
    [],
  );

  const handleUserChange = (id: string) => {
    setSelectedUser(id);
    reload({ userId: id, source: sourceFilter, search });
  };

  const handleSourceChange = (source: SourceFilter) => {
    setSourceFilter(source);
    reload({ userId: selectedUser, source, search });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      reload({ userId: selectedUser, source: sourceFilter, search: value });
    }, 350);
  };

  const handleLoadMore = () => {
    reload({ userId: selectedUser, source: sourceFilter, search, append: true });
  };

  const showUserSelector =
    context.isAdmin || context.isManager;

  // De quién es la actividad que se ve: va en la cabecera, antes de leer la lista.
  const scopeNote = context.isAdmin
    ? 'Ves la actividad de toda la plataforma.'
    : context.isManager
      ? 'Ves la actividad de tu equipo.'
      : 'Ves tu propia actividad.';

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Actividad de la plataforma"
          description={`Quién hizo qué y cuándo. ${scopeNote}`}
        />
      )}
      {embedded && (
        <Heading level={6} as="h2">
          Actividad administrativa reciente
        </Heading>
      )}

      {/* ── Filters ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* User selector */}
        {showUserSelector && (
          <UserSelector
            value={selectedUser}
            options={context.allowedUsers}
            onChange={handleUserChange}
          />
        )}

        {/* Tipo de actividad */}
        <SegmentedControl
          size="sm"
          ariaLabel="Filtrar por tipo de actividad"
          className="w-fit max-w-full overflow-x-auto"
          options={SOURCE_OPTIONS}
          value={sourceFilter}
          onChange={(next) => handleSourceChange(next as SourceFilter)}
        />

        {/* Search */}
        <div className="relative w-full sm:w-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            inputSize="sm"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar en actividad…"
            aria-label="Buscar en actividad"
            className="pl-8"
          />
        </div>

        {/* Loading indicator */}
        {isPending && (
          <Spinner size="sm" label="Cargando actividad" />
        )}
      </div>

      {/* ── Activity list ──────────────────────────────────── */}
      <SurfaceCard noPadding className="overflow-hidden">
        {events.length === 0 && !isPending ? (
          <EmptyState
            variant="plain"
            icon={Activity}
            title={search ? 'Nada coincide con tu búsqueda' : 'No hay actividad con estos filtros'}
            description={
              search
                ? 'Prueba con otra palabra o borra la búsqueda.'
                : 'Elige «Todo» o cambia de persona para ver más actividad.'
            }
          />
        ) : (
          <Timeline
            className={`px-5 py-4 transition-opacity duration-200 ${isPending ? 'opacity-60' : ''}`}
          >
            {events.map((event) => (
              <TimelineItem
                key={event.id}
                tone={SOURCE_TONE[event.source]}
                icon={<SourceIcon source={event.source} />}
                title={<span className="break-words">{event.label}</span>}
                time={formatRelativeTime(event.created_at)}
                description={
                  event.description ? (
                    <span className="break-words">{event.description}</span>
                  ) : undefined
                }
              >
                {/* Actor / Target */}
                {(event.actor || event.target) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {event.actor && (
                      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <span className="font-medium text-muted-foreground">Por:</span>
                        {displayName(event.actor)}
                      </span>
                    )}
                    {event.target && (
                      <>
                        {event.actor && (
                          <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
                        )}
                        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <span className="font-medium text-muted-foreground">Sobre:</span>
                          {displayName(event.target)}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </TimelineItem>
            ))}
          </Timeline>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="border-t border-border/50 p-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="w-full"
            >
              {isLoadingMore ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              {isLoadingMore ? 'Cargando…' : 'Ver actividad anterior'}
            </Button>
          </div>
        )}
      </SurfaceCard>

      {embedded && <p className="text-xs text-muted-foreground">{scopeNote}</p>}
    </div>
  );
}
