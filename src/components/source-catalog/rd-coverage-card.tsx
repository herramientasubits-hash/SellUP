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
import { Building2 } from "@/icons";
import {
  CoverageCard,
  CoverageCardError,
  CoverageFieldGroup,
  CoverageFieldRow,
  CoverageSourceReason,
} from '@/components/source-catalog/coverage-card';

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
// Main card
// ---------------------------------------------------------------------------

interface RdCoverageCardProps {
  summary?: RdSourceCoverageSummary;
  error?: boolean;
}

const CARD_TITLE = 'Cobertura DGII República Dominicana';

export function RdCoverageCard({ summary, error }: RdCoverageCardProps) {
  if (error || !summary) {
    return (
      <CoverageCardError
        icon={Building2}
        title={CARD_TITLE}
        message="No se pudo cargar el resumen de cobertura. Revisa la configuración del servicio."
      />
    );
  }

  return (
    <CoverageCard icon={Building2} title={CARD_TITLE}>
      <CoverageFieldGroup title="Padrón RNC cargado">
        <CoverageFieldRow
          label="RNC jurídicos cargados"
          value={`${formatRdLoadedRnc(summary.loadedRnc)} empresas`}
        />
        <CoverageFieldRow label="Cobertura snapshot" value={formatRdCoverageStatus(summary.coverageStatus)} />
        <CoverageFieldRow label="Fuente del indicador" value={formatRdCoverageSource(summary.coverageSource)} />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Identificadores fuera de scope">
        <CoverageFieldRow label="Cédulas/personas físicas persistidas" value="0" />
        <CoverageFieldRow
          label="Cédulas descartadas (fuera de scope)"
          value={formatRdOutOfScope(summary.outOfScopeIdentifiers)}
        />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Clasificación económica">
        <CoverageFieldRow label="Actividad económica" value="Texto libre DGII" />
        <CoverageFieldRow label="CIIU oficial" value="No disponible para MVP" />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Notas">
        <CoverageFieldRow label="Incluye personas físicas" value="No — solo RNC jurídicos (9 dígitos)" />
        <CoverageFieldRow
          label="Sector oficial"
          value="No disponible — usar actividad económica texto libre"
        />
      </CoverageFieldGroup>

      <CoverageSourceReason reason={formatRdCoverageSourceReason(summary.coverageSourceReason)} />
    </CoverageCard>
  );
}
