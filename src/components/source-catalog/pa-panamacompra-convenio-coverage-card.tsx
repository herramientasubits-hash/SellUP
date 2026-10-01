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
import { Landmark } from "@/icons";
import {
  CoverageBullet,
  CoverageBulletList,
  CoverageCard,
  CoverageCardError,
  CoverageFieldGroup,
  CoverageFieldRow,
  CoverageSection,
  CoverageSignalSummary,
  CoverageSourceReason,
  CoverageStatusNotice,
} from '@/components/source-catalog/coverage-card';

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
// Main card
// ---------------------------------------------------------------------------

interface PaPanamaCompraConvenioCoverageCardProps {
  summary?: PaPanamaCompraConvenioCoverageSummary;
  error?: boolean;
}

const CARD_TITLE = 'Cobertura PanamaCompra Convenio Marco';

export function PaPanamaCompraConvenioCoverageCard({
  summary,
  error,
}: PaPanamaCompraConvenioCoverageCardProps) {
  if (error || !summary) {
    return (
      <CoverageCardError
        icon={Landmark}
        title={CARD_TITLE}
        message="No se pudo cargar el resumen de cobertura. Revisa la configuración del servicio."
      />
    );
  }

  const bd = summary.breakdown;
  const isPartialSnapshot = summary.coverageStatus === 'partial_snapshot';

  const conveniosRead = bd?.convenios_read != null ? String(bd.convenios_read) : 'No reportado';
  const providersFound = bd?.providers_found != null ? bd.providers_found.toLocaleString('es-PA') : 'No reportado';
  const uniqueProviders = bd?.unique_providers != null ? bd.unique_providers.toLocaleString('es-PA') : 'No reportado';
  const providersWithRuc = bd?.providers_with_ruc != null ? String(bd.providers_with_ruc) : 'No disponible';
  const snapshotsBuilt = bd?.snapshots_built != null ? bd.snapshots_built.toLocaleString('es-PA') : 'No reportado';
  const coverageScope = bd?.coverage_scope ?? 'convenio_marco';

  return (
    <CoverageCard icon={Landmark} title={CARD_TITLE}>
      <CoverageSignalSummary title="Tipo de señal">
        <p className="text-sm font-medium text-foreground">Procurement B2G</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Identifica empresas panameñas que aparecen como proveedoras en Convenio Marco. Señal comercial de priorización.
        </p>
      </CoverageSignalSummary>

      <CoverageFieldGroup title={isPartialSnapshot ? 'Carga operativa' : 'Carga piloto'}>
        <CoverageFieldRow label="Proveedores cargados" value={formatPaLoadedRows(summary.loadedRows)} />
        <CoverageFieldRow label="Estado de cobertura" value={formatPaCoverageStatus(summary.coverageStatus)} />
        <CoverageFieldRow label="Tipo de señal" value="Señal procurement / B2G" />
        <CoverageFieldRow
          label="Alcance"
          value={coverageScope === 'convenio_marco' ? 'Convenio Marco' : coverageScope}
        />
        <CoverageFieldRow label="Fuente del indicador" value={formatPaCoverageSource(summary.coverageSource)} />
        {summary.refreshSource && <CoverageFieldRow label="Fuente de carga" value={summary.refreshSource} />}
      </CoverageFieldGroup>

      <CoverageFieldGroup title={isPartialSnapshot ? 'Breakdown operativo' : 'Breakdown piloto'}>
        <CoverageFieldRow label="Convenios leídos" value={conveniosRead} />
        <CoverageFieldRow label="Proveedores encontrados" value={providersFound} />
        <CoverageFieldRow label="Proveedores únicos" value={uniqueProviders} />
        <CoverageFieldRow label="Proveedores con RUC" value={providersWithRuc} />
        <CoverageFieldRow label="Snapshots construidos" value={snapshotsBuilt} />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Clasificación">
        <CoverageFieldRow label="Fuente fiscal / tributaria" value="No — no es fuente fiscal" />
        <CoverageFieldRow label="Fuente legal / registral" value="No — no es fuente legal" />
        <CoverageFieldRow label="Valida RUC Panamá" value="No — no reemplaza DGI Panamá" />
        <CoverageFieldRow label="Reemplaza DGI Panamá" value="No" />
        <CoverageFieldRow label="Reemplaza Registro Público" value="No" />
        <CoverageFieldRow label="Cubre toda la contratación pública" value="No — solo Convenio Marco" />
      </CoverageFieldGroup>

      <CoverageSection title="Limitaciones">
        <CoverageBulletList>
          {bd?.limitations && bd.limitations.length > 0 ? (
            bd.limitations.map((lim, i) => <CoverageBullet key={i}>{lim}</CoverageBullet>)
          ) : (
            <>
              <CoverageBullet>Muestra piloto de proveedores de Convenio Marco solamente.</CoverageBullet>
              <CoverageBullet>No cubre adjudicaciones generales de PanamaCompra.</CoverageBullet>
              <CoverageBullet>No cubre todos los proveedores del Estado panameño.</CoverageBullet>
              <CoverageBullet>No es fuente legal ni tributaria para Panamá.</CoverageBullet>
              <CoverageBullet>No valida RUC Panamá ni reemplaza DGI Panamá.</CoverageBullet>
              <CoverageBullet>No reemplaza Registro Público de Panamá.</CoverageBullet>
              <CoverageBullet>CIIU no disponible en PanamaCompra — no se inventa.</CoverageBullet>
            </>
          )}
        </CoverageBulletList>
      </CoverageSection>

      <CoverageStatusNotice title="Estado operativo">
        {isPartialSnapshot
          ? 'Snapshot operativo parcial cargado. No existe post-approval Panamá activo. La fuente permanece en '
          : 'Muestra piloto disponible. No existe post-approval Panamá activo. La fuente permanece en '}
        <span className="font-medium">eligible_not_connected</span>{' '}
        hasta que se operativice el flujo de enriquecimiento local.
        {' '}No es fuente legal. No es fuente tributaria. No valida RUC. No reemplaza DGI Panamá. No reemplaza Registro Público.
      </CoverageStatusNotice>

      <CoverageSourceReason reason={formatPaCoverageSourceReason(summary.coverageSourceReason)} />
    </CoverageCard>
  );
}
