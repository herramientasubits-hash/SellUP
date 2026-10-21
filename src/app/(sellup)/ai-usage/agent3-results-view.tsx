// Agente 3 (Rumbo) · la vista de los resultados del primer contacto (sin lectura de datos).
//
// Qué se preparó, qué se usó y qué pasó («La usé»), por enfoque, canal y país. Es lo
// mismo que aprende el redactor para recomendar el enfoque (ver approach-results.ts).
// Sólo lectura, sin dinero: lo ve quien ve la página. Mismo patrón que el panel del
// Agente 1: cada corte en su tabla, sin cajas dentro de cajas.

import { PhoneCall, Target } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoHint } from '@/components/shared/info-hint';
import { MetricCard } from '@/components/shared/metric-card';
import { TableShell } from '@/components/data-display';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FIRST_CONTACT_OUTCOME_LABELS, FIRST_CONTACT_OUTCOMES } from '@/server/agents/first-call/approaches';
import { PROVEN_MIN_USES, type ApproachResultGroup, type ApproachResultStats, type ApproachResultsDashboard } from '@/server/agents/first-call/approach-results';
import { formatCount } from './usage-labels';

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)} %`;
}

/** Con pocos resultados la tasa es ruido: se muestra, pero apagada. */
function RateCell({ stats }: { stats: ApproachResultStats }) {
  const solid = stats.withOutcome >= PROVEN_MIN_USES;
  return (
    <TableCell className={solid ? 'text-right font-medium tabular-nums text-foreground' : 'text-right tabular-nums text-muted-foreground'}>
      {formatRate(stats.positiveRate)}
    </TableCell>
  );
}

interface ResultsTableProps<K extends string> {
  title: string;
  description: string;
  /** Encabezado de la primera columna («Enfoque», «Canal», «País»). */
  dimension: string;
  groups: ApproachResultGroup<K>[];
}

function ResultsTable<K extends string>({ title, description, dimension, groups }: ResultsTableProps<K>) {
  return (
    <TableShell title={title} description={description} empty={groups.length === 0}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="text-left">
              {dimension}
            </TableHead>
            <TableHead scope="col" className="text-right">Preparadas</TableHead>
            <TableHead scope="col" className="text-right">Usadas</TableHead>
            {FIRST_CONTACT_OUTCOMES.map((outcome) => (
              <TableHead key={outcome} scope="col" className="text-right">
                {FIRST_CONTACT_OUTCOME_LABELS[outcome]}
              </TableHead>
            ))}
            <TableHead scope="col" className="text-right">Abrió conversación</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <TableRow key={group.key}>
              <TableCell className="font-medium text-foreground">{group.label}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{formatCount(group.stats.prepared)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{formatCount(group.stats.used)}</TableCell>
              {FIRST_CONTACT_OUTCOMES.map((outcome) => (
                <TableCell key={outcome} className="text-right tabular-nums text-muted-foreground">
                  {formatCount(group.stats.outcomes[outcome])}
                </TableCell>
              ))}
              <RateCell stats={group.stats} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

export function Agent3ResultsPanelSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}

/** La vista del tablero (sin lectura de datos: se prueba sola). */
export function Agent3ResultsView({ dashboard }: { dashboard: ApproachResultsDashboard }) {
  const { total, byApproach, byChannel, byCountry } = dashboard;
  if (total.prepared === 0) {
    return (
      <EmptyState
        icon={PhoneCall}
        title="Rumbo no preparó primeros contactos en este periodo"
        description="Elige un periodo más amplio o quita el filtro de país."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section aria-label="Resultados del primer contacto" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard compact title="Preparadas" description="que se pueden usar" value={formatCount(total.prepared)} />
        <MetricCard compact title="Usadas" description="marcadas con «La usé»" value={formatCount(total.used)} />
        <MetricCard
          compact
          title="Reuniones"
          description="agendadas en el primer contacto"
          value={formatCount(total.outcomes.meeting_booked)}
          tone="positive"
        />
        <MetricCard
          compact
          title="Abrió conversación"
          description="reunión o interés, sobre los resultados"
          value={formatRate(total.positiveRate)}
          hint="Reunión agendada o interesado, sobre las usadas con resultado. «No es la persona» no cuenta: habla de a quién se contactó, no de cómo."
        />
      </section>

      {total.used === 0 && (
        <EmptyState
          variant="plain"
          icon={Target}
          title="Todavía nadie marcó «La usé»"
          description="Cuando el equipo diga qué pasó con cada contacto, aquí se verá qué enfoque, canal y país abren más conversaciones, y Rumbo lo usará para recomendar."
        />
      )}

      <ResultsTable
        title="Por enfoque"
        dimension="Enfoque"
        description={`El de la versión que se usó (si aún no se usó, el de la principal). Con ${PROVEN_MIN_USES} o más resultados, Rumbo lo tiene en cuenta al recomendar.`}
        groups={byApproach}
      />
      <ResultsTable title="Por canal" dimension="Canal" description="Llamada, correo, WhatsApp o LinkedIn." groups={byChannel} />
      <ResultsTable title="Por país" dimension="País" description="El país de la empresa." groups={byCountry} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <InfoHint>
          Rumbo recomienda un enfoque distinto al del manual sólo cuando, en ese país y canal (o en todos los países, si ahí faltan datos), tiene al
          menos {PROVEN_MIN_USES} resultados y le gana al del manual. En Perú y cuando no hay decisor manda la regla del manual.
        </InfoHint>
        Las tasas con menos de {PROVEN_MIN_USES} resultados se ven apagadas: todavía son poca muestra.
      </p>
    </div>
  );
}
