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
// Main card
// ---------------------------------------------------------------------------

interface RdDgcpCoverageCardProps {
  summary?: DgcpSourceCoverageSummary;
  error?: boolean;
}

const CARD_TITLE = 'Cobertura DGCP República Dominicana';

export function RdDgcpCoverageCard({ summary, error }: RdDgcpCoverageCardProps) {
  if (error || !summary) {
    return (
      <CoverageCardError
        icon={Landmark}
        title={CARD_TITLE}
        message="No se pudo cargar el resumen de cobertura. Revisa la configuración del servicio."
      />
    );
  }

  return (
    <CoverageCard icon={Landmark} title={CARD_TITLE}>
      <CoverageSignalSummary title="Tipo de señal">
        <p className="text-sm font-medium text-foreground">Procurement B2G</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Identifica empresas dominicanas que han vendido al Estado. Señal comercial de priorización.
        </p>
      </CoverageSignalSummary>

      <CoverageFieldGroup title="Carga piloto">
        <CoverageFieldRow label="Proveedores cargados" value={formatDgcpLoadedRows(summary.loadedRows)} />
        <CoverageFieldRow label="Estado de cobertura" value={formatDgcpCoverageStatus(summary.coverageStatus)} />
        <CoverageFieldRow label="Tipo de señal" value="Señal procurement / B2G" />
        <CoverageFieldRow label="Fuente del indicador" value={formatDgcpCoverageSource(summary.coverageSource)} />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Clasificación">
        <CoverageFieldRow label="CIIU oficial" value="No disponible — no se inventa" />
        <CoverageFieldRow label="Fuente fiscal / tributaria" value="No — no es fuente fiscal" />
        <CoverageFieldRow label="Fuente legal / registral" value="No — no es fuente legal" />
        <CoverageFieldRow label="Valida RNC" value="No — no reemplaza DGII" />
      </CoverageFieldGroup>

      <CoverageSection title="Limitaciones">
        <CoverageBulletList>
          <CoverageBullet>No representa el universo completo de proveedores DGCP.</CoverageBullet>
          <CoverageBullet>No es snapshot completo — muestra piloto controlada.</CoverageBullet>
          <CoverageBullet>No valida RNC.</CoverageBullet>
          <CoverageBullet>No reemplaza DGII ni la base RNC.</CoverageBullet>
          <CoverageBullet>No contiene CIIU oficial.</CoverageBullet>
          <CoverageBullet>Solo se usa si existe match local por RNC en source_company_snapshots.</CoverageBullet>
        </CoverageBulletList>
      </CoverageSection>

      <CoverageStatusNotice title="Estado operativo">
        Hay piloto local disponible. Se requiere carga amplia y operativización para marcarla como fuente conectada completa.
        El post-approval puede usar match local si existe el RNC en snapshots.
      </CoverageStatusNotice>

      <CoverageSourceReason reason={formatDgcpCoverageSourceReason(summary.coverageSourceReason)} />
    </CoverageCard>
  );
}
