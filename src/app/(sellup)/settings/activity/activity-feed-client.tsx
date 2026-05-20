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

function SourceBadge({ source }: { source: AdminActivitySource }) {
  const map: Record<AdminActivitySource, { label: string; classes: string }> = {
    users: {
      label: 'Usuarios',
      classes: 'border-su-brand/20 bg-su-brand-soft text-su-brand',
    },
    integrations: {
      label: 'Integraciones',
      classes: 'border-amber-500/20 bg-amber-500/10 text-amber-500',
    },
    ai: {
      label: 'IA',
      classes: 'border-violet-500/20 bg-violet-500/10 text-violet-500',
    },
  };
  const cfg = map[source];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
}

function SourceIcon({ source }: { source: AdminActivitySource }) {
  const iconClass = 'h-3 w-3 text-muted-foreground';
  if (source === 'users') return <Users className={iconClass} />;
  if (source === 'integrations') return <Link2 className={iconClass} />;
  return <Cpu className={iconClass} />;
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
        className="flex h-8 min-w-[180px] max-w-[260px] items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 text-xs text-foreground transition-colors hover:border-su-brand/40 hover:bg-su-brand-soft/30"
      >
        <span className="truncate">
          {value === 'all'
            ? 'Todos los usuarios'
            : (selected?.full_name?.trim() || selected?.email || 'Usuario')}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => { setOpen(false); setQuery(''); }}
          />
          <div className="absolute left-0 top-9 z-20 w-72 rounded-xl border border-border/60 bg-card shadow-md">
            <div className="p-2">
              <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5">
                <Search className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar usuario…"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
            <ul className="max-h-56 overflow-y-auto pb-1">
              {query === '' && (
                <li>
                  <button
                    type="button"
                    onClick={() => { onChange('all'); setOpen(false); setQuery(''); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/40 ${value === 'all' ? 'text-su-brand font-medium' : 'text-foreground'}`}
                  >
                    <Users className="h-3 w-3 text-muted-foreground" />
                    Todos los usuarios
                  </button>
                </li>
              )}
              {filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(u.id); setOpen(false); setQuery(''); }}
                    className={`flex w-full flex-col px-3 py-2 text-left transition-colors hover:bg-muted/40 ${value === u.id ? 'bg-su-brand-soft/40' : ''}`}
                  >
                    <span className={`text-xs font-medium ${value === u.id ? 'text-su-brand' : 'text-foreground'}`}>
                      {u.full_name?.trim() || u.email}
                    </span>
                    {u.full_name && (
                      <span className="text-[10px] text-muted-foreground">{u.email}</span>
                    )}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground/60">
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
        />
      )}
      {embedded && (
        <h2 className="text-base font-semibold text-foreground">
          Actividad administrativa reciente
        </h2>
      )}

      {/* ── Filters ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* User selector */}
        {showUserSelector && (
          <UserSelector
            value={selectedUser}
            options={context.allowedUsers}
            onChange={handleUserChange}
          />
        )}

        {/* Source tabs */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-card p-0.5">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleSourceChange(tab.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                sourceFilter === tab.key
                  ? 'bg-su-brand text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5 transition-colors focus-within:border-su-brand/40">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar en actividad…"
            className="w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Loading indicator */}
        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
        )}
      </div>

      {/* ── Activity list ──────────────────────────────────── */}
      <SurfaceCard noPadding>
        {events.length === 0 && !isPending ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Sin eventos registrados</p>
            <p className="text-xs text-muted-foreground/60">
              {search
                ? 'Intenta con otros términos de búsqueda.'
                : 'No hay actividad disponible para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/20">
                {/* Source icon */}
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/40">
                  <SourceIcon source={event.source} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{event.label}</span>
                    <SourceBadge source={event.source} />
                  </div>

                  {/* Description */}
                  {event.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
                  )}

                  {/* Actor / Target */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {event.actor && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                        <span className="font-medium text-muted-foreground/90">Por:</span>
                        {displayName(event.actor)}
                      </span>
                    )}
                    {event.target && (
                      <>
                        {event.actor && (
                          <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                        )}
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                          <span className="font-medium text-muted-foreground/90">Sobre:</span>
                          {displayName(event.target)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <span className="shrink-0 text-[10px] text-muted-foreground/50 mt-0.5">
                  {formatRelativeTime(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="border-t border-border/40 p-4">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/50 bg-muted/20 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              {isLoadingMore ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {isLoadingMore ? 'Cargando…' : 'Cargar más eventos'}
            </button>
          </div>
        )}
      </SurfaceCard>

      <p className="text-[11px] text-muted-foreground/50">
        {context.isAdmin
          ? 'Vista de administrador — actividad de toda la plataforma.'
          : context.isManager
          ? 'Vista de líder — actividad de tu equipo según el organigrama.'
          : 'Mostrando tu actividad en la plataforma.'}
      </p>
    </div>
  );
}
