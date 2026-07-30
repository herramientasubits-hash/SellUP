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

import { ShieldAlert, Info } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getPhoneSuppressionNotEvaluableSummary } from '@/modules/contact-enrichment/phone-suppression-monitoring-queries';
import type { PhoneSuppressionNotEvaluableSummary } from '@/modules/contact-enrichment/phone-suppression-monitoring-core';

const CARD_TITLE = 'Supresiones no evaluables';

const CARD_DESCRIPTION =
  'Casos donde SellUp no pudo verificar tombstone porque faltaba Apollo person id o account id. No se usa matching por nombre/email/teléfono.';

function formatDateTime(isoDate: string | null): string {
  if (!isoDate) return 'Sin eventos';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return 'Sin eventos';
  return parsed.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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
    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-sm ${
          emphasis ? 'font-semibold text-amber-500' : 'text-foreground'
        }`}
      >
        {value}
      </p>
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
      <SurfaceCardHeader
        title={CARD_TITLE}
        description={CARD_DESCRIPTION}
        actions={
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </div>
        }
      />

      {summary === null ? (
        <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Sin permisos para ver el monitoreo de supresiones.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Figure
              label="Últimas 24 h"
              value={summary.total_24h.toLocaleString('es-ES')}
              emphasis={summary.total_24h > 0}
            />
            <Figure
              label="Últimos 7 días"
              value={summary.total_7d.toLocaleString('es-ES')}
              emphasis={summary.total_7d > 0}
            />
            <Figure label="Último evento" value={formatDateTime(summary.last_seen_at)} />
            <Figure
              label="Sin Apollo person id"
              value={summary.by_state_7d.not_evaluable_missing_provider_person_id.toLocaleString(
                'es-ES',
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Figure
              label="Fase start (7 d)"
              value={summary.by_phase_7d.start.toLocaleString('es-ES')}
            />
            <Figure
              label="Fase webhook (7 d)"
              value={summary.by_phase_7d.webhook.toLocaleString('es-ES')}
              emphasis={summary.by_phase_7d.webhook > 0}
            />
            <Figure
              label="Fase recovery (7 d)"
              value={summary.by_phase_7d.recovery.toLocaleString('es-ES')}
              emphasis={summary.by_phase_7d.recovery > 0}
            />
            <Figure
              label="Sin account id"
              value={summary.by_state_7d.not_evaluable_missing_account_id.toLocaleString(
                'es-ES',
              )}
            />
          </div>

          {summary.unclassified_phase_7d > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {summary.unclassified_phase_7d.toLocaleString('es-ES')} evento(s) sin
                fase reconocible. Se cuentan en el total pero no en el desglose.
              </p>
            </div>
          )}

          {summary.read_truncated && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-[11px] leading-relaxed text-amber-500">
                La lectura alcanzó el tope de filas: los conteos son un mínimo, no el
                total de la ventana.
              </p>
            </div>
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
      <div className="animate-pulse grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg border border-border/40 bg-muted/20" />
        ))}
      </div>
    </SurfaceCard>
  );
}
