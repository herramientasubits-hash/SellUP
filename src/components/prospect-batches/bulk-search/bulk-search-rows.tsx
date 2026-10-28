'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Layers, Pause, Play, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/typography';
import { cn } from '@/lib/utils';
import {
  BULK_SEARCH_STARTED_EVENT,
  controlBulkSearchViaRoute,
  listBulkSearchesViaRoute,
  runBulkSearchRoundViaRoute,
} from '@/modules/prospect-batches/bulk-search/bulk-search-client';
import {
  bulkDisplayState,
  bulkProgressPercent,
  bulkSearchesForTray,
  bulkSearchSummary,
  nextDriverStep,
  type BulkDisplayState,
} from '@/modules/prospect-batches/bulk-search/bulk-search-display';
import type { BulkSearchView } from '@/modules/prospect-batches/bulk-search/bulk-search-view';

const TONE: Record<BulkDisplayState, string> = {
  searching: 'bg-primary/10 text-primary',
  paused_away: 'bg-muted text-muted-foreground',
  paused_by_user: 'bg-muted text-muted-foreground',
  completed: 'bg-success/15 text-success',
  exhausted: 'bg-success/15 text-success',
  budget_capped: 'bg-warning/15 text-warning',
  cancelled: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
};

const credits = (value: number) => Math.round(value).toLocaleString('es-CO');

/** La hora, renovada cada medio minuto: «en pausa porque saliste» depende de ella. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * El conductor de las búsquedas masivas de Growth (GROWTH-BULK-SEARCH-1 · PR 4),
 * montado en el Centro de procesos: mientras SellUp esté abierto pide la
 * siguiente ronda; si se cierra, la búsqueda se queda «en pausa porque saliste»
 * y retoma sola al volver. Dos pestañas abiertas no lanzan la misma ronda: el
 * servidor tiene el lease y a la segunda le responde «espera».
 *
 * Para quien no es Growth (o con la bandera apagada) la lista responde que no:
 * no pinta nada y no vuelve a preguntar.
 */
export function BulkSearchRows({
  onActiveChange,
  onVisibleChange,
  onNavigate,
}: {
  /** Hay una en curso: cuenta en el resumen y en el punto del Centro de procesos. */
  onActiveChange?: (active: boolean) => void;
  /** Hay filas que pintar (el Centro de procesos deja de estar vacío). */
  onVisibleChange?: (visible: boolean) => void;
  onNavigate?: () => void;
}) {
  const [searches, setSearches] = React.useState<BulkSearchView[]>([]);
  const [driving, setDriving] = React.useState<ReadonlySet<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const enabledRef = React.useRef(true);
  const aliveRef = React.useRef(true);
  const drivingRef = React.useRef(new Set<string>());
  const now = useNow();

  const upsert = React.useCallback((view: BulkSearchView) => {
    setSearches((current) => {
      const others = current.filter((search) => search.id !== view.id);
      return [view, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const drive = React.useCallback(
    async (id: string) => {
      if (drivingRef.current.has(id) || !aliveRef.current) return;
      drivingRef.current.add(id);
      setDriving(new Set(drivingRef.current));
      setError(null);
      try {
        while (aliveRef.current) {
          const response = await runBulkSearchRoundViaRoute(id);
          if (!response.ok) {
            if ('message' in response) setError(response.message);
            break;
          }
          upsert(response.search);
          const step = nextDriverStep(response);
          if (step.kind === 'stop') break;
          if (step.kind === 'wait') await sleep(step.ms);
        }
      } finally {
        drivingRef.current.delete(id);
        if (aliveRef.current) setDriving(new Set(drivingRef.current));
      }
    },
    [upsert],
  );

  const refresh = React.useCallback(async () => {
    if (!enabledRef.current) return;
    const response = await listBulkSearchesViaRoute();
    if (!aliveRef.current) return;
    if (!response.ok) {
      // 404 (bandera apagada) o 403 (no es Growth): no hay nada que conducir.
      if (!('code' in response) || response.code === 'FORBIDDEN') enabledRef.current = false;
      return;
    }
    setSearches(response.searches);
    for (const search of response.searches) {
      if (search.status === 'running') void drive(search.id);
    }
  }, [drive]);

  React.useEffect(() => {
    aliveRef.current = true;
    // Fuera del cuerpo del efecto: la primera lectura llega como cualquier otra.
    const first = setTimeout(() => void refresh(), 0);
    const onStarted = () => {
      enabledRef.current = true;
      void refresh();
    };
    // Al volver a la pestaña se retoma lo que quedó en pausa por salir.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener(BULK_SEARCH_STARTED_EVENT, onStarted);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      aliveRef.current = false;
      clearTimeout(first);
      window.removeEventListener(BULK_SEARCH_STARTED_EVENT, onStarted);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const visible = bulkSearchesForTray(searches, now);
  const active = visible.some((search) => search.status === 'running');
  React.useEffect(() => onActiveChange?.(active), [active, onActiveChange]);
  React.useEffect(() => onVisibleChange?.(visible.length > 0), [visible.length, onVisibleChange]);

  const control = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    const response = await controlBulkSearchViaRoute(id, action);
    if (!response.ok) {
      setError('message' in response ? response.message : 'No se pudo cambiar la búsqueda.');
      return;
    }
    upsert(response.search);
    if (action === 'resume') void drive(id);
  };

  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((search) => (
        <BulkSearchRow
          key={search.id}
          search={search}
          state={bulkDisplayState(search, now, driving.has(search.id))}
          onControl={(action) => control(search.id, action)}
          onNavigate={onNavigate}
        />
      ))}
      {error && (
        <li className="px-4 py-2" role="status">
          <Text size="xs" tone="negative">
            {error}
          </Text>
        </li>
      )}
    </>
  );
}

export function BulkSearchRow({
  search,
  state,
  onControl,
  onNavigate,
  viewHref = '/accounts?tab=busquedas',
  extraAction,
}: {
  search: BulkSearchView;
  state: BulkDisplayState;
  onControl: (action: 'pause' | 'resume' | 'cancel') => void;
  onNavigate?: () => void;
  /** Adónde lleva «Ver» (en Growth, a «Por revisar»). */
  viewHref?: string;
  /** Una acción más al pie (en Growth, «Asignar a…»). */
  extraAction?: React.ReactNode;
}) {
  const live = search.status === 'running' || search.status === 'paused';
  const Icon = state === 'failed' ? AlertCircle : live ? Layers : CheckCircle2;
  const title = `Búsqueda masiva · ${search.label}`;
  const percent = bulkProgressPercent(search);
  const summary = bulkSearchSummary(search, state);
  return (
    <li className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0" data-testid="bulk-search-row">
      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', TONE[state])}>
        <Icon className={cn('size-4', state === 'searching' && 'animate-su-pulse')} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <Text size="sm" weight="medium" truncate title={title}>
          {title}
        </Text>
        <Text size="xs" tone={state === 'failed' ? 'negative' : 'secondary'} className="line-clamp-2" title={summary}>
          {summary}
        </Text>
        <Progress value={percent} aria-label={`Avance: ${title}`} className="h-1.5" />
        <div className="flex items-center justify-between gap-2">
          <Text size="xs" tone="muted" tabular>
            {credits(search.creditsUsed)} de {credits(search.creditCap)} créditos
          </Text>
          <div className="-mr-2 flex shrink-0 items-center gap-1">
            {search.status === 'running' && (
              <Button size="icon-xs" variant="ghost" aria-label={`Pausar: ${title}`} title="Pausar" onClick={() => onControl('pause')}>
                <Pause />
              </Button>
            )}
            {search.status === 'paused' && (
              <Button size="icon-xs" variant="ghost" aria-label={`Continuar: ${title}`} title="Continuar" onClick={() => onControl('resume')}>
                <Play />
              </Button>
            )}
            {live && (
              <Button size="icon-xs" variant="ghost" aria-label={`Cancelar: ${title}`} title="Cancelar" onClick={() => onControl('cancel')}>
                <X />
              </Button>
            )}
            {extraAction}
            {search.deliveredCount > 0 && (
              <Button size="xs" variant="outline" asChild>
                <Link href={viewHref} onClick={onNavigate}>
                  Ver
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
