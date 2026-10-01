/**
 * Card for Portal de Contrataciones Abiertas Honduras (hn_contrataciones_abiertas).
 *
 * Displays two distinct sections:
 *   A. Snapshot persistido   — datos dinámicos desde source_coverage_summaries
 *   B. Validación técnica previa — métricas del dry-run 2025 (históricas, fijas)
 *
 * Guardrails (display only — no I/O, no DB writes, no API calls):
 *   noPersistenceClaim         : does NOT claim the source has no snapshots
 *   noPostApprovalClaim        : does NOT claim post-approval is active
 *   noAutoMatchingClaim        : does NOT claim automatic matching exists
 *   noFiscalValidationClaim    : does NOT claim RTN validates fiscal identity
 *   noSarReplacementClaim      : does NOT claim to replace SAR Honduras
 *   noRegistroMercantilClaim   : does NOT claim to replace Registro Mercantil
 *   noAccountCreationClaim     : does NOT claim to create accounts or candidates
 *   noHardcodedSnapshotCount   : snapshot row count comes from coverage prop, not hardcoded
 *
 * Hito: Centroamérica.8C.4C
 */

import { formatInAppZone } from '@/lib/format-date';
import { Landmark } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CoverageBullet,
  CoverageBulletList,
  CoverageCard,
  CoverageFieldRow,
  CoverageMetric,
  CoverageMetricGrid,
  CoverageSection,
} from '@/components/source-catalog/coverage-card';
import type { HnContratacionesCoverageSummary } from '@/server/services/hn-contrataciones-coverage-summary';

// ─── Dry-run metrics (historical, from 2025 real run) ─────────────────────────

export const HN_DRY_RUN_METRICS = {
  linesRead: 300,
  partiesSeen: 950,
  supplierOrTendererSeen: 194,
  hnRtnSeen: 185,
  validRtn: 176,
  invalidRtn: 9,
  legacySchemeIgnored: 9,
  uniqueValidRtn: 99,
  likelyLegalEntity: 66,
  naturalPersonRisk: 33,
} as const;

// ─── Pure display helpers (exported for unit tests) ──────────────────────────

export function formatHnRtnCoverage(valid: number, seen: number): string {
  if (seen === 0) return '0%';
  return `${Math.round((valid / seen) * 100)}%`;
}

export function isHnPostApprovalConnected(): boolean {
  return false;
}

export function isHnAutoMatchingEnabled(): boolean {
  return false;
}

/** Returns true because the snapshot pilot was applied successfully (8C.4B.2B). */
export function isHnPersisted(): boolean {
  return true;
}

export function isHnFiscalSource(): boolean {
  return false;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HnContratacionesAbiertasCardProps {
  /**
   * Coverage summary from source_coverage_summaries.
   * Pass null when not yet loaded or unavailable — card shows safe fallback.
   */
  coverage: HnContratacionesCoverageSummary | null;
}

// ─── Section A: Snapshot persistido ──────────────────────────────────────────

function SnapshotSection({ coverage }: { coverage: HnContratacionesCoverageSummary | null }) {
  const hasData = coverage !== null && coverage.coverageSource === 'live_database';
  const loadedRows = coverage?.loadedRows ?? 0;
  const sourceYear = coverage?.sourceYear ?? null;
  const pilotScope = coverage?.pilotScope ?? true;
  const humanReviewRequired = coverage?.humanReviewRequired ?? true;
  const refreshedAt = coverage?.refreshedAt ?? null;

  return (
    <CoverageSection title="Snapshot persistido">
      {hasData ? (
        <>
          <CoverageMetricGrid className="mb-4 sm:grid-cols-3">
            <CoverageMetric label="Proveedores cargados" value={loadedRows} highlight />
            {sourceYear !== null && <CoverageMetric label="Año fuente" value={sourceYear} />}
            <CoverageMetric label="Piloto" value={pilotScope ? 'Sí' : 'No'} />
          </CoverageMetricGrid>

          <dl className="mb-4 divide-y divide-border/50">
            <CoverageFieldRow label="Estado de cobertura" value="Snapshot parcial" />
            <CoverageFieldRow label="Tipo de cobertura" value="Señal procurement" />
            {sourceYear !== null && <CoverageFieldRow label="Año fuente" value={String(sourceYear)} />}
            <CoverageFieldRow label="Piloto controlado" value={pilotScope ? 'Sí' : 'No'} />
            {refreshedAt && (
              <CoverageFieldRow label="Última actualización" value={formatInAppZone(refreshedAt, {}, 'es-HN')} />
            )}
          </dl>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {loadedRows} proveedores con RTN y señal de persona jurídica fueron cargados
            en el snapshot piloto{sourceYear !== null ? ` ${sourceYear}` : ''}. La fuente permanece como señal
            procurement con revisión humana obligatoria.
          </p>
        </>
      ) : coverage === null ? (
        <div className="space-y-2">
          <div aria-hidden="true" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
          <p className="text-xs text-muted-foreground">Cargando cobertura…</p>
        </div>
      ) : (
        <Alert variant="destructive">
          <AlertDescription className="text-xs leading-relaxed">
            No se pudo leer el resumen de cobertura. El snapshot piloto fue aplicado exitosamente (8C.4B.2B) pero los datos no están disponibles en este momento.
          </AlertDescription>
        </Alert>
      )}

      {/* Guardrails invariantes */}
      <CoverageBulletList className="mt-3 space-y-1">
        {humanReviewRequired && (
          <CoverageBullet tone="warning">Revisión humana requerida antes de cualquier uso en flujos automáticos.</CoverageBullet>
        )}
        <CoverageBullet tone="warning">Post-approval: no habilitado (post_approval_enabled = false).</CoverageBullet>
        <CoverageBullet tone="warning">Matching automático: no habilitado — no crea accounts ni prospect_candidates.</CoverageBullet>
        <CoverageBullet tone="warning">No reemplaza SAR Honduras ni Registro Mercantil.</CoverageBullet>
      </CoverageBulletList>
    </CoverageSection>
  );
}

// ─── Section B: Validación técnica previa ────────────────────────────────────

function DryRunSection() {
  const m = HN_DRY_RUN_METRICS;
  const rtnCoverage = formatHnRtnCoverage(m.validRtn, m.hnRtnSeen);

  return (
    <CoverageSection
      divided
      title="Validación técnica previa"
      description={
        <>
          El dry-run 2025 procesó {m.linesRead} líneas y detectó {m.uniqueValidRtn} RTN únicos válidos.
          Estas métricas corresponden a la validación técnica previa y <strong>no</strong> al snapshot persistido.
        </>
      }
    >
      <CoverageMetricGrid className="mb-3 lg:grid-cols-4">
        <CoverageMetric label="Líneas leídas" value={m.linesRead} />
        <CoverageMetric label="Suppliers / tenderers" value={m.supplierOrTendererSeen} />
        <CoverageMetric label="RTN únicos válidos" value={m.uniqueValidRtn} />
        <CoverageMetric label="Riesgo persona natural" value={m.naturalPersonRisk} />
      </CoverageMetricGrid>

      <p className="text-xs text-muted-foreground">
        Cobertura RTN:{' '}
        <span className="font-semibold tabular-nums text-foreground">{rtnCoverage}</span> de proveedores
        con HN-RTN tuvieron RTN válido. RTN inválidos: {m.invalidRtn}. Legacy scheme ignorado:{' '}
        {m.legacySchemeIgnored}.
      </p>
    </CoverageSection>
  );
}

// ─── Main card ───────────────────────────────────────────────────────────────

export function HnContratacionesAbiertasCard({ coverage }: HnContratacionesAbiertasCardProps) {
  return (
    <CoverageCard
      icon={Landmark}
      title="Portal de Contrataciones Abiertas Honduras"
      description="Señal procurement B2G. Post-approval no habilitado. Revisión humana requerida."
    >
      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="positive">Snapshot parcial</Badge>
        <Badge variant="positive">Read-only snapshot</Badge>
        <Badge variant="warning">Revisión humana requerida</Badge>
        <Badge variant="neutral">Post-approval no habilitado</Badge>
      </div>

      <SnapshotSection coverage={coverage} />

      <DryRunSection />

      <CoverageSection divided title="Limitaciones">
        <CoverageBulletList>
          <CoverageBullet>No valida identidad fiscal completa. RTN sin cruce con SAR Honduras.</CoverageBullet>
          <CoverageBullet>No reemplaza SAR Honduras (Servicio de Administración de Rentas).</CoverageBullet>
          <CoverageBullet>No reemplaza Registro Mercantil de Honduras.</CoverageBullet>
          <CoverageBullet>Puede mezclar personas naturales y jurídicas — revisión humana obligatoria.</CoverageBullet>
          <CoverageBullet>Sin post-approval — no conectada a flujos automáticos.</CoverageBullet>
          <CoverageBullet>Sin matching automático — no crea cuentas ni candidatos.</CoverageBullet>
          <CoverageBullet>Snapshot piloto parcial — no representa cobertura completa del universo anual.</CoverageBullet>
        </CoverageBulletList>
      </CoverageSection>
    </CoverageCard>
  );
}
