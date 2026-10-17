'use client';

import * as React from 'react';
import { Archive, Brain, ChevronDown, PhoneCall, Table2, Users } from '@/icons';
import { formatInAppZone } from '@/lib/format-date';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, type StatusType } from '@/components/data-display';
import { SurfaceCard } from '@/components/shared/surface-card';
import type { FirstCallState } from '@/modules/speech/actions';
import { isBriefFresh } from '@/modules/speech/first-call-state';
import { buildCoverage, missingSelection, type CoverageRow } from '@/modules/speech/first-contact-wizard';
import {
  FIRST_CALL_CHANNELS,
  FIRST_CALL_CHANNEL_LABELS,
  type FirstCallChannel,
  type FirstCallPack,
  type FirstCallPackStatus,
} from '@/server/agents/first-call/types';
import { FirstCallLauncher, type FirstCallContactOption, type FirstContactLaunchRequest } from './first-call-launcher';
import { FirstCallPackCard } from './first-call-pack-card';
import type { FirstContactOutcome } from '@/server/agents/first-call/approaches';
import { ResearchBriefDetails } from './research-brief-view';

interface FirstCallTabProps {
  accountId: string;
  accountName?: string;
  state: FirstCallState;
  contacts: readonly FirstCallContactOption[];
  canMoveToReady: boolean;
  archived: boolean;
  /** Decisor ya elegido (llega desde la ficha del contacto). */
  defaultContactId?: string | null;
  /** Tras un cambio (usar, descartar, otra versión). Sin él se refresca la ruta (página completa). */
  onChanged?: () => void;
  /** Dentro del panel lateral de la empresa: el agente lo abre quien monta el panel. */
  onRequestFirstContact?: (request: FirstContactLaunchRequest) => void;
  /** País de la empresa: cada preparación sugiere cuándo contactar en su hora. */
  countryCode?: string | null;
}

/** ¿La ficha sigue vigente? Entonces una preparación nueva no paga otra investigación. */
export function hasFreshBrief(state: FirstCallState, nowMs: number = Date.now()): boolean {
  return isBriefFresh(state.brief, nowMs);
}

const CELL_STATUS: Record<FirstCallPackStatus, { status: StatusType; label: string }> = {
  draft: { status: 'info', label: 'Lista' },
  needs_review: { status: 'warning', label: 'Revisar' },
  used: { status: 'completed', label: 'Usada' },
  discarded: { status: 'inactive', label: 'Descartada' },
  failed: { status: 'error', label: 'Falló' },
};

/** Con resultado marcado, la celda dice qué pasó en vez de «Usada». */
const OUTCOME_CELL: Record<FirstContactOutcome, { status: StatusType; label: string }> = {
  meeting_booked: { status: 'completed', label: 'Reunión' },
  interested: { status: 'info', label: 'Interesado' },
  not_now: { status: 'warning', label: 'No por ahora' },
  wrong_person: { status: 'inactive', label: 'Otra persona' },
  no_answer: { status: 'inactive', label: 'Sin respuesta' },
};

function formatDay(iso: string): string {
  return formatInAppZone(iso, { day: '2-digit', month: 'short', year: 'numeric' }, 'es-CO');
}

/** Una sección plegable de la pestaña (misma forma que las etapas del Pipeline). */
function Section({
  title,
  meta,
  icon: Icon,
  defaultOpen,
  children,
  testId,
}: {
  title: string;
  meta?: React.ReactNode;
  icon: typeof PhoneCall;
  defaultOpen: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <details open={defaultOpen} className="group/section rounded-2xl border border-border/60 bg-card shadow-card" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {meta && <span className="block text-xs text-muted-foreground">{meta}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border/60 px-4 py-4">{children}</div>
    </details>
  );
}

/** Lo hecho y lo que falta: decisor × canal. Una celda vacía prepara justo eso. */
function CoverageGrid({
  rows,
  renderMissing,
}: {
  rows: readonly CoverageRow[];
  renderMissing: (row: CoverageRow, channel: FirstCallChannel) => React.ReactNode;
}) {
  return (
    <Table containerClassName="overflow-x-auto" className="min-w-[32rem]" aria-label="Preparaciones por decisor y canal">
      <TableHeader>
        <TableRow>
          <TableHead>Decisor</TableHead>
          {FIRST_CALL_CHANNELS.map((c) => (
            <TableHead key={c}>{FIRST_CALL_CHANNEL_LABELS[c]}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.contactId ?? 'sin-decisor'}>
            <TableCell>
              <span className="block font-medium text-foreground">{row.name}</span>
              {row.title && <span className="block text-xs text-muted-foreground">{row.title}</span>}
            </TableCell>
            {FIRST_CALL_CHANNELS.map((channel) => {
              const cell = row.cells[channel];
              return (
                <TableCell key={channel}>
                  {cell ? (
                    <a href={`#pack-${cell.id}`} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                      {cell.outcome ? (
                        <StatusBadge status={OUTCOME_CELL[cell.outcome.result].status} label={OUTCOME_CELL[cell.outcome.result].label} />
                      ) : (
                        <StatusBadge status={CELL_STATUS[cell.status].status} label={CELL_STATUS[cell.status].label} />
                      )}
                    </a>
                  ) : (
                    renderMissing(row, channel)
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Preparaciones de un decisor, la más reciente primero. */
function groupByTarget(packs: readonly FirstCallPack[]): Array<{ key: string; name: string; title: string | null; packs: FirstCallPack[] }> {
  const groups = new Map<string, { key: string; name: string; title: string | null; packs: FirstCallPack[] }>();
  for (const pack of [...packs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    const key = pack.contactId ?? 'sin-decisor';
    if (!groups.has(key)) groups.set(key, { key, name: pack.contactId ? pack.targetName ?? 'Contacto' : 'Sin decisor', title: pack.targetTitle, packs: [] });
    groups.get(key)!.packs.push(pack);
  }
  return [...groups.values()];
}

/**
 * «Primer contacto»: la investigación y las preparaciones de la empresa en un solo
 * lugar. Arriba lo que hay y las acciones; luego la investigación, la cobertura
 * (decisor × canal, con lo que falta) y las preparaciones agrupadas por decisor.
 */
export function FirstCallTab({
  accountId,
  accountName,
  state,
  contacts,
  canMoveToReady,
  archived,
  defaultContactId = null,
  onChanged,
  onRequestFirstContact,
  countryCode = null,
}: FirstCallTabProps) {
  const fresh = hasFreshBrief(state);
  const enabled = state.enabled && !archived;
  const brief = state.brief;
  const active = state.packs.filter((p) => p.status !== 'discarded' && p.status !== 'failed');
  const closed = state.packs.filter((p) => p.status === 'discarded' || p.status === 'failed');
  const coverage = React.useMemo(() => buildCoverage(state.packs, contacts), [state.packs, contacts]);
  const missing = React.useMemo(() => missingSelection(coverage), [coverage]);
  const launcherBase = { accountId, accountName, contacts, hasFreshBrief: fresh, onDone: onChanged, onRequestOpen: onRequestFirstContact };

  const mainLauncher = enabled ? <FirstCallLauncher {...launcherBase} defaultContactId={defaultContactId} /> : null;
  const hasBrief = !!brief && brief.status !== 'running' && !(brief.status === 'failed' && brief.facts.length === 0);

  if (!hasBrief && state.packs.length === 0) {
    const running = brief?.status === 'running';
    return (
      <EmptyState
        icon={PhoneCall}
        title={running ? 'Investigando esta empresa…' : 'Todavía no hay un primer contacto preparado'}
        description={
          running
            ? 'El agente está leyendo su sitio oficial y sus noticias. Recarga en un momento.'
            : enabled
              ? 'Elige a quién contactar y por qué canales: el agente investiga la empresa y escribe qué decirle a cada decisor, con la fuente de cada dato.'
              : 'Cuando el Agente 3 esté activado podrás preparar aquí el primer contacto con esta empresa.'
        }
        action={running ? undefined : mainLauncher ?? undefined}
      />
    );
  }

  const expired = !!brief && !fresh;
  const groups = groupByTarget(active);
  const cardProps = { accountId, accountName, contacts, hasFreshBrief: fresh, canMoveToReady, enabled, onChanged, onRequestFirstContact, countryCode };

  return (
    <div className="space-y-4" data-testid="first-contact-tab">
      <SurfaceCard className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">Primer contacto</p>
            <p className="text-xs text-muted-foreground">
              {hasBrief && brief
                ? `Investigada el ${formatDay(brief.completedAt ?? brief.createdAt)} · ${brief.facts.filter((f) => f.sourceKind !== 'sellup').length} datos con fuente · ${brief.sources.length} fuentes${expired ? ' · vencida' : ''}`
                : 'Sin investigación vigente'}
              {` · ${active.length === 1 ? '1 preparación' : `${active.length} preparaciones`}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasBrief && brief && (
              <StatusBadge
                status={brief.status === 'sufficient' ? 'completed' : 'warning'}
                label={brief.status === 'sufficient' ? 'Suficiente para contactar' : 'Investigación parcial'}
              />
            )}
          </div>
        </div>
        {hasBrief && brief?.summary && <p className="text-sm leading-relaxed text-foreground">{brief.summary}</p>}
        {enabled && (
          <div className="flex flex-wrap justify-end gap-2">
            {missing && (
              <FirstCallLauncher
                {...launcherBase}
                variant="outline"
                label="Preparar lo que falta"
                initialSelection={{ contactIds: missing.contactIds, channels: missing.channels }}
              />
            )}
            {mainLauncher}
          </div>
        )}
      </SurfaceCard>

      {hasBrief && brief && (
        <Section
          title="Investigación de la empresa"
          meta={`Qué hace, tamaño, qué le pasa ahora, talento${brief.hypotheses.length > 0 ? ` · ${brief.hypotheses.length} hipótesis para UBITS` : ''}`}
          icon={Brain}
          defaultOpen={state.packs.length === 0}
          testId="first-contact-research"
        >
          <ResearchBriefDetails brief={brief} compact />
        </Section>
      )}

      {coverage.length > 0 && (
        <Section
          title="Lo preparado y lo que falta"
          meta="Cada decisor por canal. «Preparar» en una celda vacía prepara justo eso."
          icon={Table2}
          defaultOpen
          testId="first-contact-coverage"
        >
          <CoverageGrid
            rows={coverage}
            renderMissing={(row, channel) =>
              enabled && row.contactId !== null ? (
                <FirstCallLauncher
                  {...launcherBase}
                  variant="ghost"
                  label="Preparar"
                  initialSelection={{ contactIds: [row.contactId], channels: [channel] }}
                />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )
            }
          />
        </Section>
      )}

      {groups.map((group) => (
        <Section
          key={group.key}
          title={group.title ? `${group.name} · ${group.title}` : group.name}
          meta={`${group.packs.length === 1 ? '1 preparación' : `${group.packs.length} preparaciones`}: ${[...new Set(group.packs.map((p) => FIRST_CALL_CHANNEL_LABELS[p.channel]))].join(', ')}`}
          icon={Users}
          defaultOpen={groups.length === 1 || group.key === (defaultContactId ?? '')}
          testId={`first-contact-group-${group.key}`}
        >
          <div className="space-y-4">
            {group.packs.map((pack) => (
              <div key={pack.id} id={`pack-${pack.id}`} className={cn('scroll-mt-4')}>
                <FirstCallPackCard pack={pack} grouped {...cardProps} />
              </div>
            ))}
          </div>
        </Section>
      ))}

      {closed.length > 0 && (
        <Section
          title={closed.length === 1 ? '1 preparación descartada o fallida' : `${closed.length} preparaciones descartadas o fallidas`}
          icon={Archive}
          defaultOpen={false}
        >
          <div className="space-y-4">
            {closed.map((pack) => (
              <div key={pack.id} id={`pack-${pack.id}`}>
                <FirstCallPackCard pack={pack} {...cardProps} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export { toFirstCallContactOptions } from '@/modules/speech/first-call-contacts';
