'use client';

/**
 * Todos los datos de HubSpot de una empresa o de un contacto (dueña 17-11, FNL Laboratory:
 * «tiene que mostrar todo de esta empresa… y también de los contactos»). Los mismos grupos
 * que la ficha de HubSpot (información de la empresa, calificación, enriquecimiento,
 * validación de datos…), sólo con lo que tiene dato y con un buscador para encontrar uno.
 * Sólo lectura.
 */

import * as React from 'react';
import { Database, ExternalLink, RefreshCw, Search } from '@/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/feedback/spinner';
import { DrawerSection } from '@/components/shared/drawer-section';
import { formatInAppZone } from '@/lib/format-date';
import { fetchHubSpotProperties } from '@/modules/hubspot-lookup/client';
import { filterPropertySections } from '@/server/integrations/hubspot-lookup/hubspot-properties-core';
import type { HubSpotPropertiesLookupResult, HubSpotPropertyEntry } from '@/modules/hubspot-lookup/types';

export { HUBSPOT_DATA_TAB } from '@/modules/hubspot-lookup/types';

export type HubSpotPropertiesState = { status: 'idle' } | { status: 'loading' } | HubSpotPropertiesLookupResult;

/** Lee los datos una vez por registro mientras `enabled` (p. ej. al abrir la pestaña). */
export function useHubSpotProperties(kind: 'company' | 'contact', hubspotId: string | null | undefined, enabled = true) {
  const [attempt, setAttempt] = React.useState(0);
  const key = enabled && hubspotId ? `${kind}:${hubspotId}:${attempt}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; result: HubSpotPropertiesLookupResult } | null>(null);

  React.useEffect(() => {
    if (!key || !hubspotId) return;
    const controller = new AbortController();
    fetchHubSpotProperties(kind, hubspotId, controller.signal)
      .then((result) => setLoaded({ key, result }))
      .catch(() => {
        // Abortada: otra ficha o se cerró.
      });
    return () => controller.abort();
  }, [kind, hubspotId, key]);

  const state: HubSpotPropertiesState = !key ? { status: 'idle' } : loaded?.key === key ? loaded.result : { status: 'loading' };
  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

interface HubSpotPropertiesSectionProps {
  kind: 'company' | 'contact';
  state: HubSpotPropertiesState;
  onRetry: () => void;
  hubspotUrl?: string | null;
}

const NOUN: Record<'company' | 'contact', string> = { company: 'esta empresa', contact: 'este contacto' };

export function HubSpotPropertiesSection({ kind, state, onRetry, hubspotUrl }: HubSpotPropertiesSectionProps) {
  const [query, setQuery] = React.useState('');
  const sections = React.useMemo(() => (state.status === 'ok' ? state.sections : []), [state]);
  const visible = React.useMemo(() => filterPropertySections(sections, query), [sections, query]);
  const total = sections.reduce((sum, s) => sum + s.entries.length, 0);

  const header = (
    <div className="flex flex-wrap items-center gap-2" data-slot="hubspot-properties-toolbar">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar un dato (p. ej. teléfono, área, NIT)…"
          aria-label="Buscar un dato de HubSpot"
          inputSize="sm"
          className="pl-8"
          disabled={state.status !== 'ok' || total === 0}
        />
      </div>
      {state.status === 'ok' && total > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">{total} datos</span>
      )}
      {hubspotUrl && (
        <a
          href={hubspotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          Ver en HubSpot <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );

  if (state.status === 'idle') {
    return (
      <EmptyState
        variant="plain"
        icon={Database}
        title="Sin vínculo con HubSpot"
        description={`${kind === 'company' ? 'Esta empresa' : 'Este contacto'} todavía no está vinculado a HubSpot.`}
      />
    );
  }
  if (state.status === 'loading') {
    return (
      <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner size="xs" decorative /> Leyendo todos los datos en HubSpot…
      </div>
    );
  }
  if (state.status === 'not_found') {
    return (
      <EmptyState
        variant="plain"
        icon={Database}
        title="No está en HubSpot"
        description="Puede que lo hayan borrado o fusionado con otro registro en HubSpot."
      />
    );
  }
  if (state.status === 'unavailable') {
    return (
      <EmptyState
        variant="plain"
        icon={Database}
        title={state.reason === 'not_connected' ? 'HubSpot no está conectado' : 'HubSpot no respondió'}
        description={
          state.reason === 'not_connected'
            ? 'Conecta HubSpot en Integraciones para ver sus datos aquí.'
            : 'No pudimos leer los datos en HubSpot. Inténtalo de nuevo en un momento.'
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

  return (
    <div className="space-y-4" data-testid="hubspot-properties">
      {header}
      {total === 0 ? (
        <EmptyState variant="plain" icon={Database} title="Sin datos" description={`HubSpot no tiene datos de ${NOUN[kind]}.`} />
      ) : visible.length === 0 ? (
        <EmptyState variant="plain" icon={Search} title="Ningún dato coincide" description="Prueba con otra palabra." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((section) => (
            <DrawerSection key={section.name} title={section.label} icon={Database}>
              <dl className="space-y-3">
                {section.entries.map((entry) => (
                  <PropertyRow key={entry.name} entry={entry} />
                ))}
              </dl>
            </DrawerSection>
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyRow({ entry }: { entry: HubSpotPropertyEntry }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <dt className="min-w-[140px] max-w-[45%] shrink-0 break-words text-xs text-muted-foreground">{entry.label}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-line break-words text-sm text-foreground sm:text-right">
        <PropertyValue entry={entry} />
      </dd>
    </div>
  );
}

const LINK_CLASS =
  'break-all rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

function PropertyValue({ entry }: { entry: HubSpotPropertyEntry }) {
  switch (entry.kind) {
    case 'url':
      return (
        <a href={entry.value} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          {entry.value.replace(/^https?:\/\/(www\.)?/i, '')}
        </a>
      );
    case 'email':
      return (
        <a href={`mailto:${entry.value}`} className={LINK_CLASS}>
          {entry.value}
        </a>
      );
    case 'phone':
      return (
        <a href={`tel:${entry.value.replace(/[^\d+]/g, '')}`} className={`${LINK_CLASS} tabular-nums`}>
          {entry.value}
        </a>
      );
    case 'date':
      // Una fecha sin hora de HubSpot es medianoche UTC: en hora local caería el día anterior.
      return (
        <span className="tabular-nums">
          {new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(entry.value))}
        </span>
      );
    case 'datetime':
      return (
        <span className="tabular-nums">
          {formatInAppZone(entry.value, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'es-CO')}
        </span>
      );
    case 'number':
      return <span className="tabular-nums">{formatNumber(entry.value)}</span>;
    default:
      return <>{entry.value}</>;
  }
}

function formatNumber(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n) : raw;
}
