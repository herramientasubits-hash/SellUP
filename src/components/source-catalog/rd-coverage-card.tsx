/**
 * Read-only coverage card for República Dominicana DGII RNC snapshot.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   - Never renders API keys or raw payloads.
 *   - Never calls dgii.gov.do, Tavily, any LLM, or SUNAT.
 *   - Never initiates imports or writes to any table.
 *   - CIIU shown as "No disponible para MVP" — never inferred.
 *   - Cédulas/personas físicas shown as 0 — out of scope by design.
 */

import type {
  RdCoverageSource,
  RdCoverageSourceReason,
  RdSourceCoverageSummary,
} from '@/server/services/rd-source-coverage-summary';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ---------------------------------------------------------------------------
// Pure display helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function formatRdCoverageSource(source: RdCoverageSource): string {
  return source === 'live_database' ? 'base de datos en vivo' : 'fallback auditado';
}

export function formatRdCoverageSourceReason(
  reason: RdCoverageSourceReason | undefined,
): string | null {
  if (!reason) return null;
  return 'lectura dinámica no disponible';
}

export function formatRdLoadedRnc(count: number): string {
  return count.toLocaleString('es-DO');
}

export function formatRdOutOfScope(count: number): string {
  return count.toLocaleString('es-DO');
}

export function formatRdCoverageStatus(status: 'complete_snapshot' | 'partial_snapshot'): string {
  return status === 'complete_snapshot' ? 'Snapshot completo (100.0%)' : 'Snapshot parcial';
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 mt-4 first:mt-0">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

interface RdCoverageCardProps {
  summary?: RdSourceCoverageSummary;
  error?: boolean;
}

export function RdCoverageCard({ summary, error }: RdCoverageCardProps) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Cobertura DGII República Dominicana" />
        <p className="text-sm text-muted-foreground">
          No se pudo cargar el resumen de cobertura. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const sourceLabel = formatRdCoverageSource(summary.coverageSource);
  const sourceReasonLabel = formatRdCoverageSourceReason(summary.coverageSourceReason);

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Cobertura DGII República Dominicana" />

      <dl className="divide-y divide-border/20">
        <SectionTitle>Padrón RNC cargado</SectionTitle>

        <FieldRow
          label="RNC jurídicos cargados"
          value={`${formatRdLoadedRnc(summary.loadedRnc)} empresas`}
        />
        <FieldRow
          label="Cobertura snapshot"
          value={formatRdCoverageStatus(summary.coverageStatus)}
        />
        <FieldRow
          label="Fuente del indicador"
          value={sourceLabel}
        />

        <SectionTitle>Identificadores fuera de scope</SectionTitle>

        <FieldRow
          label="Cédulas/personas físicas persistidas"
          value="0"
        />
        <FieldRow
          label="Cédulas descartadas (fuera de scope)"
          value={formatRdOutOfScope(summary.outOfScopeIdentifiers)}
        />

        <SectionTitle>Clasificación económica</SectionTitle>

        <FieldRow
          label="Actividad económica"
          value="Texto libre DGII"
        />
        <FieldRow
          label="CIIU oficial"
          value="No disponible para MVP"
        />

        <SectionTitle>Notas</SectionTitle>

        <FieldRow
          label="Incluye personas físicas"
          value="No — solo RNC jurídicos (9 dígitos)"
        />
        <FieldRow
          label="Sector oficial"
          value="No disponible — usar actividad económica texto libre"
        />
      </dl>

      {sourceReasonLabel && (
        <p className="mt-3 text-[11px] text-muted-foreground/60">
          Motivo: {sourceReasonLabel}
        </p>
      )}
    </SurfaceCard>
  );
}
