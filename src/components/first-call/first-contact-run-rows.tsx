'use client';

/**
 * Las preparaciones del Agente 3 dentro del Centro de procesos (dueña 18-10: «que
 * pueda minimizarlo como el Agente 1 y quede en el Centro de procesos»). Con su
 * avance en vivo mientras corren; terminadas, llevan a la pestaña «Primer contacto».
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, PhoneCall } from '@/icons';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/typography';
import { cn } from '@/lib/utils';
import { firstCallHref } from '@/modules/speech/first-call-links';
import { fetchFirstContactLive, getFirstContactRunsStore, requestOpenFirstContactPanel } from '@/modules/speech/first-contact-runs-client';
import type { FirstContactRun } from '@/modules/speech/first-contact-runs-store';
import { FIRST_CONTACT_STAGE_PERCENT, firstContactDoneToast } from '@/modules/speech/first-contact-wizard';
import { RESEARCH_PROGRESS_LABELS, type ResearchProgressStage } from '@/server/agents/first-call/types';

const POLL_MS = 4_000;

/** El avance de cada preparación en curso y el cierre de las desligadas (tras recargar). */
function useFirstContactLive(runs: readonly FirstContactRun[]): Record<string, ResearchProgressStage | null> {
  const [live, setLive] = React.useState<Record<string, ResearchProgressStage | null>>({});
  const active = runs.filter((r) => r.status === 'running');
  const key = active.map((r) => `${r.id}:${r.accountId}:${r.detached ? 1 : 0}`).join(',');

  React.useEffect(() => {
    if (key.length === 0) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const store = getFirstContactRunsStore();
      store?.expireStaleDetached();
      try {
        // Una sola consulta para todas las que siguen en curso.
        const live = await fetchFirstContactLive(
          active.map((run) => ({
            runId: run.id,
            accountId: run.accountId,
            sinceIso: run.detached ? new Date(run.startedAtMs).toISOString() : null,
          })),
        );
        if (!cancelled) setLive((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(live).map(([id, l]) => [id, l.stage])) }));
        for (const run of active) {
          const packs = live[run.id]?.packStatuses;
          if (run.detached && packs && packs.length >= Math.max(1, run.expected)) {
            store?.settleDetached(run.id, { status: packs.some((s) => s !== 'failed') ? 'succeeded' : 'failed', packStatuses: packs, message: packs.some((s) => s !== 'failed') ? null : 'No pudimos escribir la preparación. Vuelve a intentarlo.' });
          }
        }
      } catch {
        // Sin red un momento: se reintenta en el siguiente ciclo.
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // La clave manda: `active` se reconstruye en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return live;
}

const TONE = {
  running: 'bg-primary/10 text-primary',
  succeeded: 'bg-success/15 text-success',
  failed: 'bg-destructive/10 text-destructive',
} as const;

const ICON = { running: PhoneCall, succeeded: CheckCircle2, failed: AlertCircle } as const;

export function FirstContactRunRows({ runs, onNavigate }: { runs: readonly FirstContactRun[]; onNavigate: () => void }) {
  const live = useFirstContactLive(runs);
  const router = useRouter();
  return (
    <>
      {runs.map((run) => {
        const Icon = ICON[run.status];
        const stage = live[run.id] ?? null;
        const percent = stage ? FIRST_CONTACT_STAGE_PERCENT[stage] : 5;
        const title = `Primer contacto · ${run.accountName}`;
        const meta =
          run.status === 'running'
            ? stage
              ? RESEARCH_PROGRESS_LABELS[stage]
              : 'Preparando el primer contacto…'
            : run.status === 'succeeded'
              ? firstContactDoneToast(run.packStatuses, run.title).description
              : run.message ?? 'No se pudo preparar.';
        return (
          <li key={run.id} className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0" data-testid="first-contact-run-row">
            <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', TONE[run.status])}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <Text size="sm" weight="medium" truncate title={title}>
                {title}
              </Text>
              {run.status === 'running' ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <Text size="xs" tone="secondary" truncate title={meta}>
                      {meta}
                    </Text>
                    <Text size="xs" weight="medium" tabular className="shrink-0">
                      {percent}%
                    </Text>
                  </div>
                  <Progress value={percent} aria-label={`Avance: ${title}`} className="h-1.5" />
                </>
              ) : (
                <Text size="xs" tone={run.status === 'failed' ? 'negative' : 'secondary'} className="line-clamp-2" title={meta}>
                  {meta}
                </Text>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 self-center"
              aria-label={`${run.status === 'running' ? 'Abrir' : 'Ver'} ${title}`}
              onClick={() => {
                onNavigate();
                // En curso: el panel de Rumbo con el avance. Terminada: su página.
                if (run.status === 'running') requestOpenFirstContactPanel(run.accountId, run.accountName);
                else router.push(firstCallHref(run.accountId));
              }}
            >
              {run.status === 'running' ? 'Abrir' : 'Ver'}
            </Button>
          </li>
        );
      })}
    </>
  );
}
