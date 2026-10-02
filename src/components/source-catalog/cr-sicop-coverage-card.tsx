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
// Main card
// ---------------------------------------------------------------------------

interface CrSicopCoverageCardProps {
  summary?: SicopSourceCoverageSummary;
  error?: boolean;
}

const CARD_TITLE = 'Cobertura SICOP Costa Rica';

export function CrSicopCoverageCard({ summary, error }: CrSicopCoverageCardProps) {
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
          Identifica empresas costarricenses que aparecen como proveedoras en compras públicas. Señal comercial de priorización.
        </p>
      </CoverageSignalSummary>

      <CoverageFieldGroup title="Carga piloto">
        <CoverageFieldRow label="Proveedores cargados" value={formatSicopLoadedRows(summary.loadedRows)} />
        <CoverageFieldRow label="Estado de cobertura" value={formatSicopCoverageStatus(summary.coverageStatus)} />
        <CoverageFieldRow label="Tipo de señal" value="Señal procurement / B2G" />
        <CoverageFieldRow label="Fuente del indicador" value={formatSicopCoverageSource(summary.coverageSource)} />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Dataset piloto">
        <CoverageFieldRow label="Dataset" value={SICOP_PILOT_BREAKDOWN.dataset} />
        <CoverageFieldRow label="Año cargado" value={formatSicopYears(SICOP_PILOT_BREAKDOWN.years)} />
        <CoverageFieldRow
          label="Filas procesadas"
          value={SICOP_PILOT_BREAKDOWN.processedRows.toLocaleString('es-CR')}
        />
        <CoverageFieldRow
          label="Filas totales en dataset"
          value={SICOP_PILOT_BREAKDOWN.sourceFileRows.toLocaleString('es-CR')}
        />
        <CoverageFieldRow label="Identificadores válidos" value={`${SICOP_PILOT_BREAKDOWN.validIdentifiers}`} />
        <CoverageFieldRow label="Omitidos (no empresa)" value={`${SICOP_PILOT_BREAKDOWN.skippedNonCompany}`} />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Clasificación">
        <CoverageFieldRow label="CIIU oficial" value="No disponible — no se inventa" />
        <CoverageFieldRow label="Fuente fiscal / tributaria" value="No — no es fuente fiscal" />
        <CoverageFieldRow label="Fuente legal / registral" value="No — no es fuente legal" />
        <CoverageFieldRow label="Valida cédula jurídica" value="No — no reemplaza Hacienda CR" />
      </CoverageFieldGroup>

      <CoverageSection title="Limitaciones">
        <CoverageBulletList>
          <CoverageBullet>No representa el universo completo de SICOP.</CoverageBullet>
          <CoverageBullet>Solo usa una muestra de 1.000 filas del dataset Ofertas 2024.</CoverageBullet>
          <CoverageBullet>No es snapshot completo — muestra piloto controlada.</CoverageBullet>
          <CoverageBullet>No es fuente legal ni tributaria.</CoverageBullet>
          <CoverageBullet>No valida cédula jurídica.</CoverageBullet>
          <CoverageBullet>No reemplaza Hacienda Costa Rica.</CoverageBullet>
          <CoverageBullet>No contiene CIIU oficial.</CoverageBullet>
        </CoverageBulletList>
      </CoverageSection>

      <CoverageStatusNotice title="Estado operativo">
        Hay piloto local disponible con 160 proveedores. Se requiere carga amplia y operativización
        para marcarla como fuente conectada. No existe post-approval Costa Rica activo.
      </CoverageStatusNotice>

      <CoverageSourceReason reason={formatSicopCoverageSourceReason(summary.coverageSourceReason)} />
    </CoverageCard>
  );
}
