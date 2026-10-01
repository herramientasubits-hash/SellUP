/**
 * Read-only coverage card for República Dominicana DGCP procurement snapshot.
 *
 * DGCP = señal procurement / B2G.
 * NOT a legal registry. NOT a tax authority. Does NOT validate RNC. Does NOT replace DGII.
 * Does NOT provide CIIU. Pilot sample only — NOT a complete snapshot.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   noDgcpApiRuntime       : never fetches from dgcp.gob.do at render time
 *   noDgiiRuntime          : never fetches from dgii.gov.do
 *   noLlmCalls             : no Tavily, LLM, or external enrichment
 *   noCiiuInvented         : CIIU is not available — not invented
 *   noPilotRepresentedFull : never represents pilot as complete_snapshot
 *   noFiscalClaim          : never claims DGCP is a fiscal/legal source
 */

import type {
  DgcpCoverageSource,
  DgcpCoverageSourceReason,
  DgcpSourceCoverageSummary,
} from '@/server/services/rd-dgcp-source-coverage-summary';
import { Landmark, type LucideIcon } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ---------------------------------------------------------------------------
// Pure display helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function formatDgcpCoverageSource(source: DgcpCoverageSource): string {
  return source === 'live_database' ? 'base de datos en vivo' : 'fallback auditado';
}

export function formatDgcpCoverageSourceReason(
  reason: DgcpCoverageSourceReason | undefined,
): string | null {
  if (!reason) return null;
  return 'lectura dinámica no disponible';
}

export function formatDgcpLoadedRows(count: number): string {
  return `${count.toLocaleString('es-DO')} proveedores`;
}

export function formatDgcpCoverageStatus(
  status: 'pilot_sample' | 'partial_snapshot',
): string {
  return status === 'pilot_sample' ? 'Muestra piloto (pilot_sample)' : 'Snapshot parcial';
}

export function isDgcpCompleteSnapshot(status: string): boolean {
  return status === 'complete_snapshot';
}

export function isDgcpProcurementSignal(summary: DgcpSourceCoverageSummary): boolean {
  return summary.isProcurementSignalOnly === true;
}

export function isDgcpFiscalSource(summary: DgcpSourceCoverageSummary): boolean {
  return summary.isFiscalSource;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({ label, value }: { label: string; value: string }) {
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

function LimitationRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
      {children}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

interface RdDgcpCoverageCardProps {
  summary?: DgcpSourceCoverageSummary;
  error?: boolean;
}

export function RdDgcpCoverageCard({ summary, error }: RdDgcpCoverageCardProps) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <CoverageCardHeader icon={Landmark} title="Cobertura DGCP República Dominicana" />
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudo cargar el resumen de cobertura. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const sourceReasonLabel = formatDgcpCoverageSourceReason(summary.coverageSourceReason);

  return (
    <SurfaceCard>
      <CoverageCardHeader icon={Landmark} title="Cobertura DGCP República Dominicana" />

      <div className="space-y-5">
        {/* Señal tipo */}
        <div className="rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
          <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">Tipo de señal</h3>
          <p className="text-sm font-medium text-foreground">Procurement B2G</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Identifica empresas dominicanas que han vendido al Estado. Señal comercial de priorización.
          </p>
        </div>

        <FieldGroup title="Carga piloto">
          <FieldRow
            label="Proveedores cargados"
            value={formatDgcpLoadedRows(summary.loadedRows)}
          />
          <FieldRow
            label="Estado de cobertura"
            value={formatDgcpCoverageStatus(summary.coverageStatus)}
          />
          <FieldRow
            label="Tipo de señal"
            value="Señal procurement / B2G"
          />
          <FieldRow
            label="Fuente del indicador"
            value={formatDgcpCoverageSource(summary.coverageSource)}
          />
        </FieldGroup>

        <FieldGroup title="Clasificación">
          <FieldRow
            label="CIIU oficial"
            value="No disponible — no se inventa"
          />
          <FieldRow
            label="Fuente fiscal / tributaria"
            value="No — no es fuente fiscal"
          />
          <FieldRow
            label="Fuente legal / registral"
            value="No — no es fuente legal"
          />
          <FieldRow
            label="Valida RNC"
            value="No — no reemplaza DGII"
          />
        </FieldGroup>

        {/* Limitaciones explícitas */}
        <div>
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Limitaciones</h3>
          <ul className="space-y-1.5">
            <LimitationRow>No representa el universo completo de proveedores DGCP.</LimitationRow>
            <LimitationRow>No es snapshot completo — muestra piloto controlada.</LimitationRow>
            <LimitationRow>No valida RNC.</LimitationRow>
            <LimitationRow>No reemplaza DGII ni la base RNC.</LimitationRow>
            <LimitationRow>No contiene CIIU oficial.</LimitationRow>
            <LimitationRow>Solo se usa si existe match local por RNC en source_company_snapshots.</LimitationRow>
          </ul>
        </div>

        {/* Estado operativo */}
        <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3">
          <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">Estado operativo</h3>
          <p className="text-xs text-muted-foreground">
            Hay piloto local disponible. Se requiere carga amplia y operativización para marcarla como fuente conectada completa.
            El post-approval puede usar match local si existe el RNC en snapshots.
          </p>
        </div>

        {sourceReasonLabel && (
          <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
            Motivo: {sourceReasonLabel}
          </p>
        )}
      </div>
    </SurfaceCard>
  );
}
