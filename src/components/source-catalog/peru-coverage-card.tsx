/**
 * Read-only coverage card for Peru SUNAT + Migo sources.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   - Never renders API keys or raw payloads.
 *   - Never calls Migo API, SUNAT web, Tavily, or any LLM.
 *   - Never initiates imports or writes to any table.
 *   - Migo configured = 'unknown' renders as "no verificable desde este contexto".
 */

import type { PeruSourceCoverageSummary } from '@/server/services/peru-source-coverage-summary';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ---------------------------------------------------------------------------
// Pure display helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function formatMigoConfigured(configured: boolean | 'unknown'): string {
  if (configured === true) return 'Conectado';
  if (configured === false) return 'No conectado';
  return 'No verificable desde este contexto';
}

export function formatCoveragePercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

export function formatLoadedRows(rows: number): string {
  return rows.toLocaleString('es-PE');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/30 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-xs font-medium text-foreground text-right tabular-nums">{value}</dd>
    </div>
  );
}

function GuardrailItem({ text }: { text: string }) {
  return (
    <li className="flex gap-2 text-xs text-muted-foreground">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/50" />
      {text}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Props =
  | { summary: PeruSourceCoverageSummary; error?: undefined }
  | { summary?: undefined; error: true };

export function PeruCoverageCard({ summary, error }: Props) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Cobertura Perú — SUNAT + Migo" />
        <p className="text-sm text-muted-foreground">
          No fue posible cargar la cobertura Perú en este momento.
        </p>
      </SurfaceCard>
    );
  }

  const { sunat, migo } = summary;
  const migoLabel = formatMigoConfigured(migo.configured);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Cobertura Perú — SUNAT + Migo"
        description="Indicador de solo lectura. Los datos se actualizan al cargar el próximo lote SUNAT."
      />

      <div className="space-y-6">
        {/* SUNAT block */}
        <section aria-labelledby="peru-sunat-heading">
          <h3
            id="peru-sunat-heading"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3"
          >
            SUNAT Padrón Reducido
          </h3>
          <dl className="divide-y divide-border/20">
            <FieldRow label="Filas cargadas" value={formatLoadedRows(sunat.loadedRows)} />
            <FieldRow label="Cobertura estimada" value={formatCoveragePercent(sunat.coveragePercent)} />
            <FieldRow label="Próximo offset recomendado" value={formatLoadedRows(sunat.nextRecommendedOffset)} />
            <FieldRow label="ACTIVO + HABIDO" value={formatLoadedRows(sunat.activeHabidoRows)} />
            <FieldRow label="ACTIVO + NO HABIDO" value={formatLoadedRows(sunat.activeNotHabidoRows)} />
            <FieldRow label="INACTIVO + HABIDO" value={formatLoadedRows(sunat.inactiveHabidoRows)} />
            <FieldRow label="INACTIVO + NO HABIDO" value={formatLoadedRows(sunat.inactiveNotHabidoRows)} />
          </dl>
        </section>

        {/* Migo block */}
        <section aria-labelledby="peru-migo-heading">
          <h3
            id="peru-migo-heading"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3"
          >
            Migo API Perú
          </h3>
          <dl className="divide-y divide-border/20">
            <FieldRow label="Rol" value="Validación legal complementaria" />
            <FieldRow label="Configuración" value={migoLabel} />
          </dl>
        </section>

        {/* Guardrails block */}
        <section aria-labelledby="peru-guardrails-heading">
          <h3
            id="peru-guardrails-heading"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3"
          >
            Guardrails
          </h3>
          <ul className="space-y-1.5">
            <GuardrailItem text="SUNAT no se procesa en Vercel." />
            <GuardrailItem text="Migo no hace discovery." />
            <GuardrailItem text="Migo no entrega CIIU oficial." />
            <GuardrailItem text="Migo no entrega sector oficial." />
            <GuardrailItem text="Sector Perú se mantiene inferido por web/IA." />
          </ul>
        </section>
      </div>
    </SurfaceCard>
  );
}
