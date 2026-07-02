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

function LimitationRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-muted-foreground">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
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
        <SurfaceCardHeader title="Cobertura DGCP República Dominicana" />
        <p className="text-sm text-muted-foreground">
          No se pudo cargar el resumen de cobertura. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const sourceReasonLabel = formatDgcpCoverageSourceReason(summary.coverageSourceReason);

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Cobertura DGCP República Dominicana" />

      {/* Señal tipo */}
      <div className="mb-4 rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Tipo de señal
        </p>
        <p className="text-sm font-medium text-foreground">Procurement B2G</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Identifica empresas dominicanas que han vendido al Estado. Señal comercial de priorización.
        </p>
      </div>

      <dl className="divide-y divide-border/20">
        <SectionTitle>Carga piloto</SectionTitle>

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

        <SectionTitle>Clasificación</SectionTitle>

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
      </dl>

      {/* Limitaciones explícitas */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Limitaciones
        </p>
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
      <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">
          Estado operativo
        </p>
        <p className="text-xs text-muted-foreground">
          Hay piloto local disponible. Se requiere carga amplia y operativización para marcarla como fuente conectada completa.
          El post-approval puede usar match local si existe el RNC en snapshots.
        </p>
      </div>

      {sourceReasonLabel && (
        <p className="mt-3 text-[11px] text-muted-foreground/60">
          Motivo: {sourceReasonLabel}
        </p>
      )}
    </SurfaceCard>
  );
}
