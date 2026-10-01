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
import { Building2, type LucideIcon } from 'lucide-react';
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
    <div className="grid grid-cols-2 items-baseline gap-x-4 py-2">
      <dt className="min-w-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function CoverageCardHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40"
      >
        <Icon className="h-4 w-4" />
      </span>
      <SurfaceCardHeader
        title={title}
        description={description}
        actions={actions}
        className="mb-0 min-w-0 flex-1 flex-wrap"
      />
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">{title}</h3>
      <dl className="divide-y divide-border/50">{children}</dl>
    </section>
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
        <CoverageCardHeader icon={Building2} title="Cobertura DGII República Dominicana" />
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudo cargar el resumen de cobertura. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const sourceLabel = formatRdCoverageSource(summary.coverageSource);
  const sourceReasonLabel = formatRdCoverageSourceReason(summary.coverageSourceReason);

  return (
    <SurfaceCard>
      <CoverageCardHeader icon={Building2} title="Cobertura DGII República Dominicana" />

      <div className="space-y-5">
        <FieldGroup title="Padrón RNC cargado">
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
        </FieldGroup>

        <FieldGroup title="Identificadores fuera de scope">
          <FieldRow
            label="Cédulas/personas físicas persistidas"
            value="0"
          />
          <FieldRow
            label="Cédulas descartadas (fuera de scope)"
            value={formatRdOutOfScope(summary.outOfScopeIdentifiers)}
          />
        </FieldGroup>

        <FieldGroup title="Clasificación económica">
          <FieldRow
            label="Actividad económica"
            value="Texto libre DGII"
          />
          <FieldRow
            label="CIIU oficial"
            value="No disponible para MVP"
          />
        </FieldGroup>

        <FieldGroup title="Notas">
          <FieldRow
            label="Incluye personas físicas"
            value="No — solo RNC jurídicos (9 dígitos)"
          />
          <FieldRow
            label="Sector oficial"
            value="No disponible — usar actividad económica texto libre"
          />
        </FieldGroup>

        {sourceReasonLabel && (
          <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
            Motivo: {sourceReasonLabel}
          </p>
        )}
      </div>
    </SurfaceCard>
  );
}
