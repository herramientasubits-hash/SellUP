/**
 * Read-only coverage card for Peru SUNAT + Migo sources.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   - Never renders API keys or raw payloads.
 *   - Never calls Migo API, SUNAT web, Tavily, or any LLM.
 *   - Never initiates imports or writes to any table.
 *   - Migo configured = 'unknown' renders as "no verificable desde este contexto".
 */

import type {
  CoverageSource,
  CoverageSourceReason,
  PeruSourceCoverageSummary,
} from '@/server/services/peru-source-coverage-summary';
import { Building2 } from "@/icons";
import {
  CoverageBullet,
  CoverageBulletList,
  CoverageCard,
  CoverageCardError,
  CoverageFieldGroup,
  CoverageFieldRow,
  CoverageSection,
} from '@/components/source-catalog/coverage-card';

// ---------------------------------------------------------------------------
// Pure display helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function formatMigoConfigured(configured: boolean | 'unknown'): string {
  if (configured === true) return 'Conectado';
  if (configured === false) return 'No conectado';
  return 'No verificable desde este contexto';
}

export function formatCoverageSource(source: CoverageSource): string {
  return source === 'live_database' ? 'base de datos en vivo' : 'fallback auditado';
}

/**
 * Discreet, secret-free explanation for an audited fallback. Returns null when
 * there is nothing safe to show. Never exposes raw errors, URLs, keys, or
 * payloads — every reason collapses to the same neutral, user-facing phrase.
 */
export function formatCoverageSourceReason(
  reason: CoverageSourceReason | undefined,
): string | null {
  if (!reason) return null;
  return 'lectura dinámica no disponible';
}

export function formatCoveragePercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

export function formatLoadedRows(rows: number): string {
  return rows.toLocaleString('es-PE');
}

/** "750.000 de 2.317.298 filas RUC-20 auditadas." */
export function formatLoadedSnapshotDetail(loadedRows: number, auditedTotal: number): string {
  return `${formatLoadedRows(loadedRows)} de ${formatLoadedRows(auditedTotal)} filas RUC-20 auditadas.`;
}

/** "136.099 de 851.883 RUC-20 ACTIVO + HABIDO auditados." */
export function formatActiveHabidoDetail(activeHabidoRows: number, auditedActiveHabido: number): string {
  return `${formatLoadedRows(activeHabidoRows)} de ${formatLoadedRows(auditedActiveHabido)} RUC-20 ACTIVO + HABIDO auditados.`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Props =
  | { summary: PeruSourceCoverageSummary; error?: undefined }
  | { summary?: undefined; error: true };

const CARD_TITLE = 'Cobertura Perú — SUNAT + Migo';

export function PeruCoverageCard({ summary, error }: Props) {
  if (error || !summary) {
    return (
      <CoverageCardError
        icon={Building2}
        title={CARD_TITLE}
        message="No fue posible cargar la cobertura Perú en este momento."
      />
    );
  }

  const { sunat, migo } = summary;
  const sunatSourceReason = formatCoverageSourceReason(sunat.coverageSourceReason);

  return (
    <CoverageCard
      icon={Building2}
      title={CARD_TITLE}
      description="Indicador de solo lectura. Los datos se actualizan al cargar el próximo lote SUNAT."
    >
      <div>
        <CoverageFieldGroup title="SUNAT Padrón Reducido">
          <CoverageFieldRow label="Filas cargadas" value={formatLoadedRows(sunat.loadedRows)} />
          <CoverageFieldRow
            label="Cobertura snapshot RUC-20"
            value={formatCoveragePercent(sunat.loadedRowsCoveragePercent)}
            detail={formatLoadedSnapshotDetail(sunat.loadedRows, sunat.auditedTotalRuc20Rows)}
          />
          <CoverageFieldRow
            label="ACTIVO + HABIDO cargados"
            value={formatCoveragePercent(sunat.activeHabidoCoveragePercent)}
            detail={formatActiveHabidoDetail(sunat.activeHabidoRows, sunat.auditedActiveHabidoRuc20Rows)}
          />
          <CoverageFieldRow
            label="Próximo offset recomendado"
            value={formatLoadedRows(sunat.nextRecommendedOffset)}
          />
          <CoverageFieldRow label="ACTIVO + HABIDO" value={formatLoadedRows(sunat.activeHabidoRows)} />
          <CoverageFieldRow label="ACTIVO + NO HABIDO" value={formatLoadedRows(sunat.activeNotHabidoRows)} />
          <CoverageFieldRow label="INACTIVO + HABIDO" value={formatLoadedRows(sunat.inactiveHabidoRows)} />
          <CoverageFieldRow label="INACTIVO + NO HABIDO" value={formatLoadedRows(sunat.inactiveNotHabidoRows)} />
        </CoverageFieldGroup>
        <p className="mt-2 text-xs text-muted-foreground">
          Fuente del indicador: {formatCoverageSource(sunat.coverageSource)}
        </p>
        {sunatSourceReason && (
          <p className="mt-0.5 text-xs text-muted-foreground">Motivo: {sunatSourceReason}</p>
        )}
      </div>

      <CoverageFieldGroup title="Migo API Perú">
        <CoverageFieldRow label="Rol" value="Validación legal complementaria" />
        <CoverageFieldRow label="Configuración" value={formatMigoConfigured(migo.configured)} />
      </CoverageFieldGroup>

      <CoverageSection title="Guardrails">
        <CoverageBulletList>
          <CoverageBullet tone="caution">SUNAT no se procesa en Vercel.</CoverageBullet>
          <CoverageBullet tone="caution">Migo no hace discovery.</CoverageBullet>
          <CoverageBullet tone="caution">Migo no entrega CIIU oficial.</CoverageBullet>
          <CoverageBullet tone="caution">Migo no entrega sector oficial.</CoverageBullet>
          <CoverageBullet tone="caution">Sector Perú se mantiene inferido por web/IA.</CoverageBullet>
        </CoverageBulletList>
      </CoverageSection>
    </CoverageCard>
  );
}
