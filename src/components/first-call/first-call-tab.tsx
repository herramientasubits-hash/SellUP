import { PhoneCall } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import type { FirstCallState } from '@/modules/speech/actions';
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
}

/** ¿La ficha sigue vigente? Entonces un paquete nuevo no paga otra investigación. */
export function hasFreshBrief(state: FirstCallState, nowMs: number = Date.now()): boolean {
  const brief = state.brief;
  return (
    !!brief &&
    (brief.status === 'sufficient' || brief.status === 'partial') &&
    !!brief.expiresAt &&
    Date.parse(brief.expiresAt) > nowMs
  );
}

export function FirstCallTab({ accountId, state, contacts, canMoveToReady, archived, defaultContactId = null }: FirstCallTabProps) {
  const fresh = hasFreshBrief(state);
  const enabled = state.enabled && !archived;
  const active = state.packs.filter((p) => p.status !== 'discarded' && p.status !== 'failed');
  const closed = state.packs.filter((p) => p.status === 'discarded' || p.status === 'failed');
  const launcher = enabled ? (
    <FirstCallLauncher accountId={accountId} contacts={contacts} hasFreshBrief={fresh} defaultContactId={defaultContactId} />
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

  const cardProps = { accountId, contacts, hasFreshBrief: fresh, canMoveToReady, enabled };
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

/** Contactos para elegir decisor: primero los que deciden o llevan talento y formación. */
export function toFirstCallContactOptions(
  contacts: ReadonlyArray<{ id: string; full_name: string; job_title: string | null; role_in_account: string | null; contact_status: string }>,
): FirstCallContactOption[] {
  const priority = (role: string | null) =>
    role === 'decision_maker' || role === 'economic_buyer' ? 0 : role === 'hr_leader' || role === 'learning_leader' ? 1 : 2;
  return contacts
    .filter((c) => c.contact_status === 'active')
    .map((c, index) => ({ c, index }))
    .sort((a, b) => priority(a.c.role_in_account) - priority(b.c.role_in_account) || a.index - b.index)
    .map(({ c }) => ({ id: c.id, name: c.full_name, title: c.job_title }));
}
