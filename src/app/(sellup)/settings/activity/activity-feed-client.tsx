'use client';

import { useState, useTransition, useCallback, useRef } from 'react';
import {
  Activity,
  Users,
  Link2,
  Cpu,
  Search,
  ChevronDown,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
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
  return new Date(iso).toLocaleDateString('es-CO', { month: 'short', day: 'numeric' });
}

function displayName(user: { email: string; full_name: string | null } | null): string {
  if (!user) return '—';
  return user.full_name?.trim() || user.email;
}

// ─── Sub-components ──────────────────────────────────────────────

// Design Refresh v2: el icono de categoría lleva un tinte sutil por fuente.
// Así el color señala la categoría sin necesidad del badge uppercase repetido.
const SOURCE_ICON_TINT: Record<AdminActivitySource, string> = {
  users: 'bg-primary/10 text-primary',
  integrations: 'bg-warning/10 text-warning',
  ai: 'bg-info/10 text-info',
};

function SourceIcon({ source }: { source: AdminActivitySource }) {
  const iconClass = 'h-3 w-3';
  if (source === 'users') return <Users className={iconClass} aria-hidden="true" />;
  if (source === 'integrations') return <Link2 className={iconClass} aria-hidden="true" />;
  return <Cpu className={iconClass} aria-hidden="true" />;
}

function UserSelector({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; email: string; full_name: string | null }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter((u) => {
    const q = query.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.full_name?.toLowerCase().includes(q) ?? false)
    );
  });

  const selected = options.find((u) => u.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 min-w-44 max-w-64 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-xs text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-muted"
      >
        <span className="truncate">
          {value === 'all'
            ? 'Todos los usuarios'
            : (selected?.full_name?.trim() || selected?.email || 'Usuario')}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => { setOpen(false); setQuery(''); }}
          />
          <div className="absolute left-0 top-9 z-20 w-72 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-drawer">
            <div className="p-2">
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-subtle px-2.5 py-1.5 transition-colors focus-within:border-primary">
                <Search className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar usuario…"
                  aria-label="Buscar usuario"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <ul className="max-h-56 overflow-y-auto pb-1">
              {query === '' && (
                <li>
                  <button
                    type="button"
                    onClick={() => { onChange('all'); setOpen(false); setQuery(''); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none ${value === 'all' ? 'font-medium text-primary' : 'text-foreground'}`}
                  >
                    <Users className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    Todos los usuarios
                  </button>
                </li>
              )}
              {filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(u.id); setOpen(false); setQuery(''); }}
                    className={`flex w-full min-w-0 flex-col px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none ${value === u.id ? 'bg-primary/10' : ''}`}
                  >
                    <span className={`w-full truncate text-xs font-medium ${value === u.id ? 'text-primary' : 'text-foreground'}`}>
                      {u.full_name?.trim() || u.email}
                    </span>
                    {u.full_name && (
                      <span className="w-full truncate text-xs text-muted-foreground">{u.email}</span>
                    )}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Sin resultados
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

const SOURCE_TABS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'users', label: 'Usuarios' },
  { key: 'integrations', label: 'Integraciones' },
  { key: 'ai', label: 'IA' },
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

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Actividad de la plataforma"
          description="Historial de acciones administrativas, integraciones y configuración de IA."
          backHref="/settings"
        />
      )}
      {embedded && (
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Actividad administrativa reciente
        </h2>
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

        {/* Source tabs */}
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-tab-track p-0.5">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleSourceChange(tab.key)}
              aria-pressed={sourceFilter === tab.key}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${
                sourceFilter === tab.key
                  ? 'bg-primary text-primary-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

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
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {/* ── Activity list ──────────────────────────────────── */}
      <SurfaceCard noPadding className="overflow-hidden">
        {events.length === 0 && !isPending ? (
          <EmptyState
            variant="plain"
            icon={Activity}
            title="Sin eventos registrados"
            description={
              search
                ? 'Intenta con otros términos de búsqueda.'
                : 'No hay actividad disponible para los filtros seleccionados.'
            }
          />
        ) : (
          <ul className={`divide-y divide-border/50 transition-opacity duration-200 ${isPending ? 'opacity-60' : ''}`}>
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-muted">
                {/* Source icon — tinte por categoría (reemplaza el badge de fila) */}
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${SOURCE_ICON_TINT[event.source]}`}>
                  <SourceIcon source={event.source} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">{event.label}</span>
                  </div>

                  {/* Description */}
                  {event.description && (
                    <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{event.description}</p>
                  )}

                  {/* Actor / Target */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
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
                </div>

                <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTime(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
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
              {isLoadingMore ? 'Cargando…' : 'Cargar más eventos'}
            </Button>
          </div>
        )}
      </SurfaceCard>

      <p className="text-xs text-muted-foreground">
        {context.isAdmin
          ? 'Vista de administrador — actividad de toda la plataforma.'
          : context.isManager
          ? 'Vista de líder — actividad de tu equipo según el organigrama.'
          : 'Mostrando tu actividad en la plataforma.'}
      </p>
    </div>
  );
}
