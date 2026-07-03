/**
 * Read-only coverage card for PanamaCompra Convenio Marco procurement snapshot.
 *
 * PanamaCompra Convenio Marco = señal procurement B2G.
 * NOT a legal registry. NOT a tax authority. Does NOT validate RUC Panamá.
 * Does NOT replace DGI Panamá. Does NOT replace Registro Público.
 * Does NOT cover all public procurement in Panama. Pilot sample only — NOT a complete snapshot.
 * No post-approval Panamá activo.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   noPanamaCompraApiRuntime  : never fetches from panamacompra.gob.pa at render time
 *   noDgiRuntime              : never fetches from DGI Panamá
 *   noRegistroPublicoRuntime  : never fetches from Registro Público Panamá
 *   noLlmCalls                : no Tavily, LLM, or external enrichment
 *   noPilotRepresentedFull    : never represents pilot as complete_snapshot
 *   noRucValidation           : does not validate RUC Panamá
 *   noPostApprovalClaim       : does not claim post-approval is active
 */

import type {
  PaCoverageSource,
  PaCoverageSourceReason,
  PaPanamaCompraConvenioCoverageSummary,
} from '@/server/services/pa-panamacompra-convenio-source-coverage-summary';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ---------------------------------------------------------------------------
// Pure display helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function formatPaCoverageSource(source: PaCoverageSource): string {
  return source === 'live_database' ? 'base de datos en vivo' : 'fallback auditado';
}

export function formatPaCoverageSourceReason(
  reason: PaCoverageSourceReason | undefined,
): string | null {
  if (!reason) return null;
  return 'lectura dinámica no disponible';
}

export function formatPaLoadedRows(count: number): string {
  return `${count.toLocaleString('es-PA')} proveedores`;
}

export function formatPaCoverageStatus(status: 'pilot_sample' | 'partial_snapshot'): string {
  if (status === 'partial_snapshot') return 'Snapshot parcial operativo (partial_snapshot)';
  return 'Muestra piloto (pilot_sample)';
}

export function isPaCompleteSnapshot(status: string): boolean {
  return status === 'complete_snapshot';
}

export function isPaProcurementSignal(summary: PaPanamaCompraConvenioCoverageSummary): boolean {
  return summary.isProcurementSignalOnly === true;
}

export function isPaFiscalSource(summary: PaPanamaCompraConvenioCoverageSummary): boolean {
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

interface PaPanamaCompraConvenioCoverageCardProps {
  summary?: PaPanamaCompraConvenioCoverageSummary;
  error?: boolean;
}

export function PaPanamaCompraConvenioCoverageCard({
  summary,
  error,
}: PaPanamaCompraConvenioCoverageCardProps) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Cobertura PanamaCompra Convenio Marco" />
        <p className="text-sm text-muted-foreground">
          No se pudo cargar el resumen de cobertura. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const sourceReasonLabel = formatPaCoverageSourceReason(summary.coverageSourceReason);
  const bd = summary.breakdown;

  const conveniosRead = bd?.convenios_read != null ? String(bd.convenios_read) : 'No reportado';
  const providersFound = bd?.providers_found != null ? bd.providers_found.toLocaleString('es-PA') : 'No reportado';
  const uniqueProviders = bd?.unique_providers != null ? bd.unique_providers.toLocaleString('es-PA') : 'No reportado';
  const providersWithRuc = bd?.providers_with_ruc != null ? String(bd.providers_with_ruc) : 'No disponible';
  const snapshotsBuilt = bd?.snapshots_built != null ? bd.snapshots_built.toLocaleString('es-PA') : 'No reportado';
  const coverageScope = bd?.coverage_scope ?? 'convenio_marco';

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Cobertura PanamaCompra Convenio Marco" />

      {/* Señal tipo */}
      <div className="mb-4 rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Tipo de señal
        </p>
        <p className="text-sm font-medium text-foreground">Procurement B2G</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Identifica empresas panameñas que aparecen como proveedoras en Convenio Marco. Señal comercial de priorización.
        </p>
      </div>

      <dl className="divide-y divide-border/20">
        <SectionTitle>{summary.coverageStatus === 'partial_snapshot' ? 'Carga operativa' : 'Carga piloto'}</SectionTitle>

        <FieldRow
          label="Proveedores cargados"
          value={formatPaLoadedRows(summary.loadedRows)}
        />
        <FieldRow
          label="Estado de cobertura"
          value={formatPaCoverageStatus(summary.coverageStatus)}
        />
        <FieldRow
          label="Tipo de señal"
          value="Señal procurement / B2G"
        />
        <FieldRow
          label="Alcance"
          value={coverageScope === 'convenio_marco' ? 'Convenio Marco' : coverageScope}
        />
        <FieldRow
          label="Fuente del indicador"
          value={formatPaCoverageSource(summary.coverageSource)}
        />
        {summary.refreshSource && (
          <FieldRow
            label="Fuente de carga"
            value={summary.refreshSource}
          />
        )}

        <SectionTitle>{summary.coverageStatus === 'partial_snapshot' ? 'Breakdown operativo' : 'Breakdown piloto'}</SectionTitle>

        <FieldRow label="Convenios leídos" value={conveniosRead} />
        <FieldRow label="Proveedores encontrados" value={providersFound} />
        <FieldRow label="Proveedores únicos" value={uniqueProviders} />
        <FieldRow label="Proveedores con RUC" value={providersWithRuc} />
        <FieldRow label="Snapshots construidos" value={snapshotsBuilt} />

        <SectionTitle>Clasificación</SectionTitle>

        <FieldRow label="Fuente fiscal / tributaria" value="No — no es fuente fiscal" />
        <FieldRow label="Fuente legal / registral" value="No — no es fuente legal" />
        <FieldRow label="Valida RUC Panamá" value="No — no reemplaza DGI Panamá" />
        <FieldRow label="Reemplaza DGI Panamá" value="No" />
        <FieldRow label="Reemplaza Registro Público" value="No" />
        <FieldRow label="Cubre toda la contratación pública" value="No — solo Convenio Marco" />
      </dl>

      {/* Limitaciones explícitas */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Limitaciones
        </p>
        <ul className="space-y-1.5">
          {bd?.limitations && bd.limitations.length > 0
            ? bd.limitations.map((lim, i) => (
                <LimitationRow key={i}>{lim}</LimitationRow>
              ))
            : (
              <>
                <LimitationRow>Muestra piloto de proveedores de Convenio Marco solamente.</LimitationRow>
                <LimitationRow>No cubre adjudicaciones generales de PanamaCompra.</LimitationRow>
                <LimitationRow>No cubre todos los proveedores del Estado panameño.</LimitationRow>
                <LimitationRow>No es fuente legal ni tributaria para Panamá.</LimitationRow>
                <LimitationRow>No valida RUC Panamá ni reemplaza DGI Panamá.</LimitationRow>
                <LimitationRow>No reemplaza Registro Público de Panamá.</LimitationRow>
                <LimitationRow>CIIU no disponible en PanamaCompra — no se inventa.</LimitationRow>
              </>
            )}
        </ul>
      </div>

      {/* Estado operativo */}
      <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">
          Estado operativo
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.coverageStatus === 'partial_snapshot'
            ? 'Snapshot operativo parcial cargado. No existe post-approval Panamá activo. La fuente permanece en '
            : 'Muestra piloto disponible. No existe post-approval Panamá activo. La fuente permanece en '}
          <span className="font-medium">eligible_not_connected</span>{' '}
          hasta que se operativice el flujo de enriquecimiento local.
          {' '}No es fuente legal. No es fuente tributaria. No valida RUC. No reemplaza DGI Panamá. No reemplaza Registro Público.
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
