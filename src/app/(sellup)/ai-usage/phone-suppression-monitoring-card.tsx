// Agente 2A — /ai-usage: tarjeta de SUPRESIONES NO EVALUABLES
// (APOLLO-PHONE-CACHE-1b, FIX 5)
//
// Superficie de solo lectura sobre el resumen agregado de
// `phone-suppression-monitoring-core.ts`. Muestra CONTEOS y una fecha: nunca
// teléfono, email, nombre, LinkedIn, person id, candidato ni cuenta — el resumen
// que recibe ya no los contiene, y esta tarjeta no añade ninguna lectura propia.
//
// Vive en /ai-usage porque es la pantalla de admin donde ya se leen métricas de
// proveedor desde `provider_usage_logs`, con el mismo gate de rol. Reutiliza
// SurfaceCard / SurfaceCardHeader y los tokens del sistema (sin colores
// hardcodeados), así que Light/Dark salen del tema como en el resto de la página.
//
// La presentación (`PhoneSuppressionNotEvaluableCard`) es sincrónica y sin estado
// para poder renderizarse en test con un resumen sintético; el panel asíncrono
// solo le pasa el dato.

import type { ReactNode } from 'react';
import { formatInAppZone } from '@/lib/format-date';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Lock } from '@/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Heading } from '@/components/typography';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getPhoneSuppressionNotEvaluableSummary } from '@/modules/contact-enrichment/phone-suppression-monitoring-queries';
import type { PhoneSuppressionNotEvaluableSummary } from '@/modules/contact-enrichment/phone-suppression-monitoring-core';

const CARD_TITLE = 'Verificaciones de privacidad incompletas';

const CARD_DESCRIPTION =
  'Veces que SellUp no pudo comprobar si un teléfono estaba marcado como borrado, porque faltaba el identificador de la persona o de la empresa. Nunca se compara por nombre, correo ni teléfono.';

const NO_CASES = 'Sin casos';

function formatDateTime(isoDate: string | null): string {
  if (!isoDate) return NO_CASES;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return NO_CASES;
  return formatInAppZone(parsed, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }, 'es-ES');
}

function formatCount(value: number): string {
  return value.toLocaleString('es-ES');
}

/** Un grupo de cifras con su título: lista de definiciones, sin marco propio. */
function FigureGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <Heading level={6} as="h3" className="mb-3 text-sm">
        {title}
      </Heading>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{children}</dl>
    </section>
  );
}

function Figure({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 text-base font-semibold tabular-nums ${
          emphasis ? 'text-warning' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Presentación pura. `summary === null` = sin permisos (no es un cero: un cero
 * diría "no hay casos", que es una afirmación distinta).
 */
export function PhoneSuppressionNotEvaluableCard({
  summary,
}: {
  summary: PhoneSuppressionNotEvaluableSummary | null;
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title={CARD_TITLE} description={CARD_DESCRIPTION} />

      {summary === null ? (
        <EmptyState
          variant="plain"
          icon={Lock}
          title="No tienes permiso para ver estas verificaciones"
          description="Pide acceso a una persona administradora."
        />
      ) : (
        <div className="space-y-4">
          <FigureGroup title="Cuántas">
            <Figure
              label="Últimas 24 h"
              value={formatCount(summary.total_24h)}
              emphasis={summary.total_24h > 0}
            />
            <Figure
              label="Últimos 7 días"
              value={formatCount(summary.total_7d)}
              emphasis={summary.total_7d > 0}
            />
            <Figure label="Último caso" value={formatDateTime(summary.last_seen_at)} />
          </FigureGroup>

          <FigureGroup title="En qué momento (7 días)">
            <Figure label="Al pedir el teléfono" value={formatCount(summary.by_phase_7d.start)} />
            <Figure
              label="Al recibir la respuesta"
              value={formatCount(summary.by_phase_7d.webhook)}
              emphasis={summary.by_phase_7d.webhook > 0}
            />
            <Figure
              label="Al recuperar pendientes"
              value={formatCount(summary.by_phase_7d.recovery)}
              emphasis={summary.by_phase_7d.recovery > 0}
            />
          </FigureGroup>

          <FigureGroup title="Qué faltaba (7 días)">
            <Figure
              label="Identificador de la persona"
              value={formatCount(summary.by_state_7d.not_evaluable_missing_provider_person_id)}
            />
            <Figure
              label="Identificador de la empresa"
              value={formatCount(summary.by_state_7d.not_evaluable_missing_account_id)}
            />
          </FigureGroup>

          {summary.unclassified_phase_7d > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {formatCount(summary.unclassified_phase_7d)} caso(s) sin momento reconocible. Se
              cuentan en el total pero no en el desglose.
            </p>
          )}

          {summary.read_truncated && (
            <Alert variant="warning">
              <AlertDescription>
                Hay más casos de los que se pueden contar de una vez: estas cifras son un mínimo,
                no el total del periodo.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}

/** Panel asíncrono: lee el resumen y lo entrega a la presentación. */
export async function PhoneSuppressionNotEvaluablePanel() {
  const summary = await getPhoneSuppressionNotEvaluableSummary();
  return <PhoneSuppressionNotEvaluableCard summary={summary} />;
}

/** Fallback de <Suspense> mientras se lee el resumen. */
export function PhoneSuppressionNotEvaluablePanelSkeleton() {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title={CARD_TITLE} description={CARD_DESCRIPTION} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
    </SurfaceCard>
  );
}
