'use client';

/**
 * Actividad de HubSpot en las fichas de SellUp (dueña 17-11: «en Actividad debería
 * estar trayendo la actividad de la empresa»): notas, llamadas, reuniones, tareas,
 * correos y negocios, la más reciente primero. Sólo lectura.
 */

import * as React from 'react';
import {
  Activity,
  Briefcase,
  Calendar,
  ClipboardCheck,
  ExternalLink,
  Mail,
  PhoneCall,
  RefreshCw,
  StickyNote,
} from '@/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/feedback/spinner';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Timeline, TimelineItem, type TimelineTone } from '@/components/data-display';
import { formatInAppZone } from '@/lib/format-date';
import { fetchHubSpotActivity } from '@/modules/hubspot-lookup/client';
import type { HubSpotActivityEntry, HubSpotActivityKind, HubSpotActivityLookupResult } from '@/modules/hubspot-lookup/types';

export type HubSpotActivityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | Exclude<HubSpotActivityLookupResult, never>;

/** Lee la actividad una vez por registro (y al pedir «Reintentar»). */
export function useHubSpotActivity(kind: 'company' | 'contact', hubspotId: string | null | undefined) {
  const [attempt, setAttempt] = React.useState(0);
  // La respuesta recuerda para qué pedido llegó: si cambió el registro (o se reintentó),
  // se ve «leyendo» sin poner estado a mano dentro del efecto.
  const key = hubspotId ? `${kind}:${hubspotId}:${attempt}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; result: HubSpotActivityLookupResult } | null>(null);

  React.useEffect(() => {
    if (!key || !hubspotId) return;
    const controller = new AbortController();
    fetchHubSpotActivity(kind, hubspotId, controller.signal)
      .then((result) => setLoaded({ key, result }))
      .catch(() => {
        // Abortada: otra ficha o se cerró.
      });
    return () => controller.abort();
  }, [kind, hubspotId, key]);

  const state: HubSpotActivityState = !key ? { status: 'idle' } : loaded?.key === key ? loaded.result : { status: 'loading' };
  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

const KIND_ICON: Record<HubSpotActivityKind, React.ComponentType<{ className?: string }>> = {
  note: StickyNote,
  call: PhoneCall,
  meeting: Calendar,
  task: ClipboardCheck,
  email: Mail,
  deal: Briefcase,
};

const KIND_LABEL: Record<HubSpotActivityKind, string> = {
  note: 'Nota',
  call: 'Llamada',
  meeting: 'Reunión',
  task: 'Tarea',
  email: 'Correo',
  deal: 'Negocio',
};

const KIND_TONE: Record<HubSpotActivityKind, TimelineTone> = {
  note: 'default',
  call: 'primary',
  meeting: 'info',
  task: 'warning',
  email: 'default',
  deal: 'positive',
};

export function formatActivityDate(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  return formatInAppZone(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'es-CO');
}

export function HubSpotActivityIcon({ kind, className }: { kind: HubSpotActivityKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={className} />;
}

export function hubspotActivityTone(kind: HubSpotActivityKind): TimelineTone {
  return KIND_TONE[kind];
}

/** Una línea de actividad de HubSpot (para mezclarla con otras en el Resumen). */
export function HubSpotActivityTimelineItem({ item, showBody = true }: { item: HubSpotActivityEntry; showBody?: boolean }) {
  const subtitle = [KIND_LABEL[item.kind], ...item.details, item.ownerName].filter(Boolean).join(' · ');
  return (
    <TimelineItem
      icon={<HubSpotActivityIcon kind={item.kind} />}
      tone={KIND_TONE[item.kind]}
      title={item.title}
      time={formatActivityDate(item.occurredAt)}
      description={subtitle}
    >
      {showBody && item.body ? (
        <p className="whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">{item.body}</p>
      ) : null}
    </TimelineItem>
  );
}

const MISSING_NOTE: Partial<Record<HubSpotActivityKind, string>> = {
  email: 'Los correos de HubSpot no se ven aquí: la conexión no tiene permiso para leerlos.',
};

interface HubSpotActivitySectionProps {
  state: HubSpotActivityState;
  onRetry: () => void;
  /** Enlace a la ficha en HubSpot, para ver todo allá. */
  hubspotUrl?: string | null;
  /** Sin Company ID: la empresa no está vinculada a HubSpot. */
  notLinkedHint?: string;
}

/** La sección «Actividad en HubSpot» completa (pestaña Actividad). */
export function HubSpotActivitySection({ state, onRetry, hubspotUrl, notLinkedHint }: HubSpotActivitySectionProps) {
  const action = hubspotUrl ? (
    <a
      href={hubspotUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      Ver en HubSpot <ExternalLink className="h-3 w-3" />
    </a>
  ) : undefined;

  return (
    <DrawerSection
      title="Actividad en HubSpot"
      icon={Activity}
      hint="Notas, llamadas, reuniones, tareas y negocios registrados en HubSpot."
      action={action}
    >
      <HubSpotActivityBody state={state} onRetry={onRetry} notLinkedHint={notLinkedHint} />
    </DrawerSection>
  );
}

function HubSpotActivityBody({ state, onRetry, notLinkedHint }: Omit<HubSpotActivitySectionProps, 'hubspotUrl'>) {
  if (state.status === 'idle') {
    return (
      <EmptyState
        variant="plain"
        icon={Activity}
        title="Sin vínculo con HubSpot"
        description={notLinkedHint ?? 'Esta empresa todavía no está vinculada a HubSpot.'}
      />
    );
  }
  if (state.status === 'loading') {
    return (
      <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner size="xs" decorative />
        Leyendo la actividad en HubSpot…
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <EmptyState
        variant="plain"
        icon={Activity}
        title={state.reason === 'not_connected' ? 'HubSpot no está conectado' : 'HubSpot no respondió'}
        description={
          state.reason === 'not_connected'
            ? 'Conecta HubSpot en Integraciones para ver su actividad aquí.'
            : 'No pudimos leer la actividad. Lo de SellUp sigue disponible.'
        }
        action={
          state.reason === 'unavailable' ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" /> Reintentar
            </Button>
          ) : undefined
        }
      />
    );
  }
  const notes = state.missingKinds.map((k) => MISSING_NOTE[k]).filter(Boolean);
  return (
    <div className="space-y-3">
      {state.items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={Activity}
          title="Sin actividad en HubSpot"
          description="Nadie ha registrado notas, llamadas, reuniones, tareas ni negocios todavía."
        />
      ) : (
        <Timeline>
          {state.items.map((item) => (
            <HubSpotActivityTimelineItem key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </Timeline>
      )}
      {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join(' ')}</p>}
    </div>
  );
}
