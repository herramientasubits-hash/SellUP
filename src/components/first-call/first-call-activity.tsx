import { PhoneCall, Rumbo } from '@/icons';
import { formatInAppZone } from '@/lib/format-date';
import { Timeline, TimelineItem } from '@/components/data-display';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import type { FirstCallState } from '@/modules/speech/actions';
import { buildFirstCallEvents } from '@/modules/speech/first-call-activity';

function formatDateTime(iso: string): string {
  return formatInAppZone(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'es-CO');
}

interface FirstCallActivityProps {
  state: FirstCallState;
  /**
   * `runs`: sólo lo que el agente ejecutó (pestaña «Agentes»).
   * `events`: también lo que la persona hizo con el resultado (pestaña «Actividad»).
   */
  kind: 'runs' | 'events';
  title?: string;
}

/** La historia del Agente 3 en una empresa. No pinta nada si el agente no ha hecho nada. */
export function FirstCallActivity({ state, kind, title = 'Rumbo · Primer contacto' }: FirstCallActivityProps) {
  const events = buildFirstCallEvents(state.brief, state.packs).filter((e) => kind === 'events' || e.kind === 'run');
  if (events.length === 0) return null;
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title={title}
        description={
          kind === 'runs'
            ? 'Cada investigación y cada preparación de llamada, de lo más reciente a lo más antiguo.'
            : 'Lo que el agente hizo y lo que se hizo con su resultado.'
        }
      />
      <Timeline>
        {events.map((event) => (
          <TimelineItem
            key={event.id}
            tone={event.tone}
            icon={event.kind === 'run' ? <Rumbo /> : <PhoneCall />}
            title={event.title}
            time={formatDateTime(event.at)}
            description={event.description ?? undefined}
          />
        ))}
      </Timeline>
    </SurfaceCard>
  );
}
