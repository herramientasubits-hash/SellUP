/**
 * Read-only coverage card for Costa Rica SICOP procurement snapshot.
 *
 * SICOP = señal procurement B2G.
 * NOT a legal registry. NOT a tax authority. Does NOT validate cédula jurídica.
 * Does NOT replace Hacienda CR. Does NOT provide CIIU. Pilot sample only — NOT a complete snapshot.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   noSicopApiRuntime      : never fetches from sicop.go.cr or datos.go.cr at render time
 *   noHaciendaRuntime      : never fetches from api.hacienda.go.cr
 *   noLlmCalls             : no Tavily, LLM, or external enrichment
 *   noCiiuInvented         : CIIU is not available — not invented
 *   noPilotRepresentedFull : never represents pilot as complete_snapshot
 *   noCedulaValidation     : does not validate cédula jurídica
 */

import type {
  SicopCoverageSource,
  SicopCoverageSourceReason,
  SicopSourceCoverageSummary,
} from '@/server/services/cr-sicop-source-coverage-summary';
import { Landmark, type LucideIcon } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ---------------------------------------------------------------------------
// Audited breakdown constants — Centroamérica.4B pilot load
// ---------------------------------------------------------------------------

export const SICOP_PILOT_BREAKDOWN = {
  dataset: 'ofertas_2024',
  processedRows: 1_000,
  sourceFileRows: 565_864,
  validIdentifiers: 906,
  skippedNonCompany: 94,
  years: [2024],
} as const;

// ---------------------------------------------------------------------------
// Pure display helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function formatSicopCoverageSource(source: SicopCoverageSource): string {
  return source === 'live_database' ? 'base de datos en vivo' : 'fallback auditado';
}

export function formatSicopCoverageSourceReason(
  reason: SicopCoverageSourceReason | undefined,
): string | null {
  if (!reason) return null;
  return 'lectura dinámica no disponible';
}

export function formatSicopLoadedRows(count: number): string {
  return `${count.toLocaleString('es-CR')} proveedores`;
}

export function formatSicopCoverageStatus(status: 'pilot_sample'): string {
  return 'Muestra piloto (pilot_sample)';
}

export function isSicopCompleteSnapshot(status: string): boolean {
  return status === 'complete_snapshot';
}

export function isSicopProcurementSignal(summary: SicopSourceCoverageSummary): boolean {
  return summary.isProcurementSignalOnly === true;
}

export function isSicopFiscalSource(summary: SicopSourceCoverageSummary): boolean {
  return summary.isFiscalSource;
}

export function formatSicopYears(years: readonly number[]): string {
  return years.join(', ');
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

interface CrSicopCoverageCardProps {
  summary?: SicopSourceCoverageSummary;
  error?: boolean;
}

export function CrSicopCoverageCard({ summary, error }: CrSicopCoverageCardProps) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <CoverageCardHeader icon={Landmark} title="Cobertura SICOP Costa Rica" />
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudo cargar el resumen de cobertura. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const sourceReasonLabel = formatSicopCoverageSourceReason(summary.coverageSourceReason);

  return (
    <SurfaceCard>
      <CoverageCardHeader icon={Landmark} title="Cobertura SICOP Costa Rica" />

      <div className="space-y-5">
        {/* Señal tipo */}
        <div className="rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
          <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">Tipo de señal</h3>
          <p className="text-sm font-medium text-foreground">Procurement B2G</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Identifica empresas costarricenses que aparecen como proveedoras en compras públicas. Señal comercial de priorización.
          </p>
        </div>

        <FieldGroup title="Carga piloto">
          <FieldRow
            label="Proveedores cargados"
            value={formatSicopLoadedRows(summary.loadedRows)}
          />
          <FieldRow
            label="Estado de cobertura"
            value={formatSicopCoverageStatus(summary.coverageStatus)}
          />
          <FieldRow
            label="Tipo de señal"
            value="Señal procurement / B2G"
          />
          <FieldRow
            label="Fuente del indicador"
            value={formatSicopCoverageSource(summary.coverageSource)}
          />
        </FieldGroup>

        <FieldGroup title="Dataset piloto">
          <FieldRow
            label="Dataset"
            value={SICOP_PILOT_BREAKDOWN.dataset}
          />
          <FieldRow
            label="Año cargado"
            value={formatSicopYears(SICOP_PILOT_BREAKDOWN.years)}
          />
          <FieldRow
            label="Filas procesadas"
            value={SICOP_PILOT_BREAKDOWN.processedRows.toLocaleString('es-CR')}
          />
          <FieldRow
            label="Filas totales en dataset"
            value={SICOP_PILOT_BREAKDOWN.sourceFileRows.toLocaleString('es-CR')}
          />
          <FieldRow
            label="Identificadores válidos"
            value={`${SICOP_PILOT_BREAKDOWN.validIdentifiers}`}
          />
          <FieldRow
            label="Omitidos (no empresa)"
            value={`${SICOP_PILOT_BREAKDOWN.skippedNonCompany}`}
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
            label="Valida cédula jurídica"
            value="No — no reemplaza Hacienda CR"
          />
        </FieldGroup>

        {/* Limitaciones explícitas */}
        <div>
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Limitaciones</h3>
          <ul className="space-y-1.5">
            <LimitationRow>No representa el universo completo de SICOP.</LimitationRow>
            <LimitationRow>Solo usa una muestra de 1.000 filas del dataset Ofertas 2024.</LimitationRow>
            <LimitationRow>No es snapshot completo — muestra piloto controlada.</LimitationRow>
            <LimitationRow>No es fuente legal ni tributaria.</LimitationRow>
            <LimitationRow>No valida cédula jurídica.</LimitationRow>
            <LimitationRow>No reemplaza Hacienda Costa Rica.</LimitationRow>
            <LimitationRow>No contiene CIIU oficial.</LimitationRow>
          </ul>
        </div>

        {/* Estado operativo */}
        <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3">
          <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">Estado operativo</h3>
          <p className="text-xs text-muted-foreground">
            Hay piloto local disponible con 160 proveedores. Se requiere carga amplia y operativización
            para marcarla como fuente conectada. No existe post-approval Costa Rica activo.
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
