import { PhoneCall } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import type { FirstCallState } from '@/modules/speech/actions';
import { isBriefFresh } from '@/modules/speech/first-call-state';
import { FirstCallLauncher, type FirstCallContactOption } from './first-call-launcher';
import { FirstCallPackCard } from './first-call-pack-card';

interface FirstCallTabProps {
  accountId: string;
  state: FirstCallState;
  contacts: readonly FirstCallContactOption[];
  canMoveToReady: boolean;
  archived: boolean;
  /** Decisor ya elegido (llega desde la ficha del contacto). */
  defaultContactId?: string | null;
  /** Tras un cambio (usar, descartar, rehacer). Sin él se refresca la ruta (página completa). */
  onChanged?: () => void;
}

/** ¿La ficha sigue vigente? Entonces un paquete nuevo no paga otra investigación. */
export function hasFreshBrief(state: FirstCallState, nowMs: number = Date.now()): boolean {
  return isBriefFresh(state.brief, nowMs);
}

export function FirstCallTab({ accountId, state, contacts, canMoveToReady, archived, defaultContactId = null, onChanged }: FirstCallTabProps) {
  const fresh = hasFreshBrief(state);
  const enabled = state.enabled && !archived;
  const active = state.packs.filter((p) => p.status !== 'discarded' && p.status !== 'failed');
  const closed = state.packs.filter((p) => p.status === 'discarded' || p.status === 'failed');
  const launcher = enabled ? (
    <FirstCallLauncher
      accountId={accountId}
      contacts={contacts}
      hasFreshBrief={fresh}
      defaultContactId={defaultContactId}
      onDone={onChanged}
    />
  ) : null;

  if (state.packs.length === 0) {
    return (
      <EmptyState
        icon={PhoneCall}
        title="Todavía no hay una preparación de llamada"
        description={
          enabled
            ? 'Elige a quién vas a llamar y por qué canal: el agente investiga la empresa y te deja el guion, el mensaje corto, las preguntas y las respuestas a objeciones.'
            : 'Cuando el Agente 3 esté activado podrás preparar aquí la primera llamada a esta empresa.'
        }
        action={launcher ?? undefined}
      />
    );
  }

  const cardProps = { accountId, contacts, hasFreshBrief: fresh, canMoveToReady, enabled, onChanged };
  return (
    <div className="space-y-4">
      {launcher && <div className="flex justify-end">{launcher}</div>}
      {active.map((pack) => (
        <FirstCallPackCard key={pack.id} pack={pack} {...cardProps} />
      ))}
      {closed.length > 0 && (
        <details className="rounded-2xl border border-border/60 bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {closed.length === 1 ? '1 preparación descartada o fallida' : `${closed.length} preparaciones descartadas o fallidas`}
          </summary>
          <div className="mt-4 space-y-4">
            {closed.map((pack) => (
              <FirstCallPackCard key={pack.id} pack={pack} {...cardProps} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export { toFirstCallContactOptions } from '@/modules/speech/first-call-contacts';
