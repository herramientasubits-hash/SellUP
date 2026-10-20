'use client';

/**
 * Las búsquedas de contactos con Rumbo dentro del Centro de procesos (dueña 20-10: «que la
 * búsqueda quede en el centro de procesos, como con empresas»). Con su etapa real mientras
 * corren; terminadas, llevan a «Por revisar».
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, UserSearch } from '@/icons';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/typography';
import { cn } from '@/lib/utils';
import {
  CONTACT_SEARCH_REVIEW_HREF,
  getContactSearchRunsStore,
  useContactSearchProgress,
} from '@/modules/contact-enrichment/contact-search-runs-client';
import type { ContactSearchRun } from '@/modules/contact-enrichment/contact-search-runs-store';

const TONE = {
  running: 'bg-primary/10 text-primary',
  succeeded: 'bg-success/15 text-success',
  failed: 'bg-destructive/10 text-destructive',
} as const;

const ICON = { running: UserSearch, succeeded: CheckCircle2, failed: AlertCircle } as const;

/** Qué dice la fila de una búsqueda terminada. */
export function contactSearchRunSummary(run: ContactSearchRun): string {
  if (run.status === 'failed') return run.message ?? 'No se pudo hacer la búsqueda.';
  if (run.message) return run.message;
  if (run.found === null) return 'Terminó: lo encontrado está en «Por revisar».';
  if (run.found === 0) return 'No encontró contactos nuevos.';
  return run.found === 1 ? '1 contacto para revisar.' : `${run.found} contactos para revisar.`;
}

function ContactSearchRunRow({ run, onView }: { run: ContactSearchRun; onView: () => void }) {
  const running = run.status === 'running';
  const progress = useContactSearchProgress(run.requestId, running);
  const Icon = ICON[run.status];
  const title = `Buscar contactos · ${run.companyName}`;
  const meta = running ? progress.label : contactSearchRunSummary(run);
  return (
    <li className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0" data-testid="contact-search-run-row">
      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', TONE[run.status])}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <Text size="sm" weight="medium" truncate title={title}>
          {title}
        </Text>
        {running ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <Text size="xs" tone="secondary" truncate title={meta}>
                {meta}
              </Text>
              <Text size="xs" weight="medium" tabular className="shrink-0">
                {progress.percent}%
              </Text>
            </div>
            <Progress value={progress.percent} aria-label={`Avance: ${title}`} className="h-1.5" />
          </>
        ) : (
          <Text size="xs" tone={run.status === 'failed' ? 'negative' : 'secondary'} className="line-clamp-2" title={meta}>
            {meta}
          </Text>
        )}
      </div>
      {!running && run.status === 'succeeded' && (
        <Button size="sm" variant="outline" className="shrink-0 self-center" aria-label={`Ver en Por revisar: ${run.companyName}`} onClick={onView}>
          Ver
        </Button>
      )}
    </li>
  );
}

export function ContactSearchRunRows({ runs, onNavigate }: { runs: readonly ContactSearchRun[]; onNavigate: () => void }) {
  const router = useRouter();
  const hasDetached = runs.some((run) => run.status === 'running' && run.detached);
  // Tras recargar, una búsqueda desligada se da por cerrada al pasar el tope de una invocación.
  React.useEffect(() => {
    if (!hasDetached) return undefined;
    const store = getContactSearchRunsStore();
    store?.expireStaleDetached();
    const timer = setInterval(() => store?.expireStaleDetached(), 30_000);
    return () => clearInterval(timer);
  }, [hasDetached]);
  return (
    <>
      {runs.map((run) => (
        <ContactSearchRunRow
          key={run.id}
          run={run}
          onView={() => {
            onNavigate();
            router.push(CONTACT_SEARCH_REVIEW_HREF);
          }}
        />
      ))}
    </>
  );
}
