'use client';

/**
 * Una búsqueda del Agente IA abierta en el drawer desde el Centro de procesos.
 *
 * Mientras corre (o espera turno) se ve el MISMO loader que al generarla
 * (`SubmittingPanel`): titular en vivo, barra por etapas y segundos reales.
 * Cuando termina, el mismo hueco pasa a decir cómo acabó, con el lote. Sólo
 * necesita el id de la corrida: funciona aunque la conversación ya no exista
 * (se cerró el chat o se recargó la página).
 */

import Link from 'next/link';
import { AlertCircle, CheckCircle2, Search } from '@/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useAgentRuns } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import { AGENT_RUNS_TRAY_COPY, describeAgentRun } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray-copy';
import { SubmittingPanel } from './wizard-execution-panels';

export const AGENT_RUN_VIEW_COPY = {
  missingTitle: 'Esta búsqueda ya no está en la lista',
  missingDescription: 'Se quitó del Centro de procesos. Puedes verla en el historial de búsquedas.',
  succeededTitle: 'Búsqueda terminada',
  failedTitle: 'La búsqueda no se completó',
  newSearch: 'Nueva búsqueda',
} as const;

type AgentRunDrawerViewProps = {
  clientRequestId: string;
  onNewSearch: () => void;
  /** Al ir al lote se cierra el drawer, como «Ver lote» del final de la conversación. */
  onClose: () => void;
};

export function AgentRunDrawerView({ clientRequestId, onNewSearch, onClose }: AgentRunDrawerViewProps) {
  const run = useAgentRuns().find((item) => item.clientRequestId === clientRequestId);

  if (run && (run.status === 'running' || run.status === 'queued')) {
    return <SubmittingPanel clientRequestId={run.clientRequestId} startedAtMs={run.startedAtMs ?? run.createdAtMs} />;
  }

  const newSearch = (
    <Button variant="outline" size="sm" onClick={onNewSearch}>
      {AGENT_RUN_VIEW_COPY.newSearch}
    </Button>
  );

  if (!run) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center px-4" data-testid="agent-run-view" data-run-status="missing">
        <EmptyState
          variant="plain"
          icon={Search}
          title={AGENT_RUN_VIEW_COPY.missingTitle}
          description={AGENT_RUN_VIEW_COPY.missingDescription}
          action={newSearch}
        />
      </div>
    );
  }

  const view = describeAgentRun(run, null);
  const succeeded = run.status === 'succeeded';

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-4" data-testid="agent-run-view" data-run-status={run.status}>
      <EmptyState
        variant="plain"
        icon={succeeded ? CheckCircle2 : AlertCircle}
        title={succeeded ? AGENT_RUN_VIEW_COPY.succeededTitle : AGENT_RUN_VIEW_COPY.failedTitle}
        description={`${run.title} · ${view.error ?? view.description}`}
        action={
          <div className="flex items-center justify-center gap-2">
            {view.showLink && run.redirectPath && (
              <Button asChild size="sm">
                <Link href={run.redirectPath} onClick={onClose}>
                  {AGENT_RUNS_TRAY_COPY.openBatch}
                </Link>
              </Button>
            )}
            {newSearch}
          </div>
        }
      />
    </div>
  );
}
