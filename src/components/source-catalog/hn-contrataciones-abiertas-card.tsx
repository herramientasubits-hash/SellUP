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

import { Landmark, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCell({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1 rounded-lg border border-border/60 bg-surface-subtle px-3 py-2.5">
      <dt className="text-xs font-medium leading-snug text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${highlight ? 'text-success' : 'text-foreground'}`}>
        {value}
      </dd>
    </div>
  );
}

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

function GuardrailRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-warning">
      <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
      {children}
    </li>
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

// ─── Section A: Snapshot persistido ──────────────────────────────────────────

function SnapshotSection({ coverage }: { coverage: HnContratacionesCoverageSummary | null }) {
  const hasData = coverage !== null && coverage.coverageSource === 'live_database';
  const loadedRows = coverage?.loadedRows ?? 0;
  const sourceYear = coverage?.sourceYear ?? null;
  const pilotScope = coverage?.pilotScope ?? true;
  const humanReviewRequired = coverage?.humanReviewRequired ?? true;
  const refreshedAt = coverage?.refreshedAt ?? null;

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Snapshot persistido</h3>

      {hasData ? (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricCell label="Proveedores cargados" value={loadedRows} highlight />
            {sourceYear !== null && (
              <MetricCell label="Año fuente" value={sourceYear} />
            )}
            <MetricCell label="Piloto" value={pilotScope ? 'Sí' : 'No'} />
          </dl>

          <dl className="mb-4 divide-y divide-border/50">
            <FieldRow label="Estado de cobertura" value="Snapshot parcial" />
            <FieldRow label="Tipo de cobertura" value="Señal procurement" />
            {sourceYear !== null && (
              <FieldRow label="Año fuente" value={String(sourceYear)} />
            )}
            <FieldRow label="Piloto controlado" value={pilotScope ? 'Sí' : 'No'} />
            {refreshedAt && (
              <FieldRow label="Última actualización" value={new Date(refreshedAt).toLocaleDateString('es-HN')} />
            )}
          </dl>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {loadedRows} proveedores con RTN y señal de persona jurídica fueron cargados
            en el snapshot piloto{sourceYear !== null ? ` ${sourceYear}` : ''}. La fuente permanece como señal
            procurement con revisión humana obligatoria.
          </p>
        </>
      ) : (
        coverage === null ? (
          <div className="space-y-2">
            <div aria-hidden="true" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
            <p className="text-xs text-muted-foreground">Cargando cobertura…</p>
          </div>
        ) : (
          <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive">
            No se pudo leer el resumen de cobertura. El snapshot piloto fue aplicado exitosamente (8C.4B.2B) pero los datos no están disponibles en este momento.
          </p>
        )
      )}

      {/* Guardrails invariantes */}
      <ul className="mt-3 space-y-1">
        {humanReviewRequired && (
          <GuardrailRow>Revisión humana requerida antes de cualquier uso en flujos automáticos.</GuardrailRow>
        )}
        <GuardrailRow>Post-approval: no habilitado (post_approval_enabled = false).</GuardrailRow>
        <GuardrailRow>Matching automático: no habilitado — no crea accounts ni prospect_candidates.</GuardrailRow>
        <GuardrailRow>No reemplaza SAR Honduras ni Registro Mercantil.</GuardrailRow>
      </ul>
    </section>
  );
}

// ─── Section B: Validación técnica previa ────────────────────────────────────

function DryRunSection() {
  const m = HN_DRY_RUN_METRICS;
  const rtnCoverage = formatHnRtnCoverage(m.validRtn, m.hnRtnSeen);

  return (
    <section className="border-t border-border/50 pt-5">
      <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">Validación técnica previa</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        El dry-run 2025 procesó {m.linesRead} líneas y detectó {m.uniqueValidRtn} RTN únicos válidos.
        Estas métricas corresponden a la validación técnica previa y <strong>no</strong> al snapshot persistido.
      </p>

      <dl className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricCell label="Líneas leídas" value={m.linesRead} />
        <MetricCell label="Suppliers / tenderers" value={m.supplierOrTendererSeen} />
        <MetricCell label="RTN únicos válidos" value={m.uniqueValidRtn} />
        <MetricCell label="Riesgo persona natural" value={m.naturalPersonRisk} />
      </dl>

      <p className="text-xs text-muted-foreground">
        Cobertura RTN:{' '}
        <span className="font-semibold tabular-nums text-foreground">{rtnCoverage}</span> de proveedores
        con HN-RTN tuvieron RTN válido. RTN inválidos: {m.invalidRtn}. Legacy scheme ignorado:{' '}
        {m.legacySchemeIgnored}.
      </p>
    </section>
  );
}

// ─── Main card ───────────────────────────────────────────────────────────────

export function HnContratacionesAbiertasCard({ coverage }: HnContratacionesAbiertasCardProps) {
  return (
    <SurfaceCard>
      <CoverageCardHeader
        icon={Landmark}
        title="Portal de Contrataciones Abiertas Honduras"
        description="Señal procurement B2G. Post-approval no habilitado. Revisión humana requerida."
      />

      <div className="space-y-5">
        {/* Status badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="positive">Snapshot parcial</Badge>
          <Badge variant="positive">Read-only snapshot</Badge>
          <Badge variant="warning">Revisión humana requerida</Badge>
          <Badge variant="neutral">Post-approval no habilitado</Badge>
        </div>

        <SnapshotSection coverage={coverage} />

        <DryRunSection />

        {/* Limitaciones */}
        <section className="border-t border-border/50 pt-5">
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Limitaciones</h3>
          <ul className="space-y-1.5">
            <LimitationRow>No valida identidad fiscal completa. RTN sin cruce con SAR Honduras.</LimitationRow>
            <LimitationRow>No reemplaza SAR Honduras (Servicio de Administración de Rentas).</LimitationRow>
            <LimitationRow>No reemplaza Registro Mercantil de Honduras.</LimitationRow>
            <LimitationRow>Puede mezclar personas naturales y jurídicas — revisión humana obligatoria.</LimitationRow>
            <LimitationRow>Sin post-approval — no conectada a flujos automáticos.</LimitationRow>
            <LimitationRow>Sin matching automático — no crea cuentas ni candidatos.</LimitationRow>
            <LimitationRow>Snapshot piloto parcial — no representa cobertura completa del universo anual.</LimitationRow>
          </ul>
        </section>
      </div>
    </SurfaceCard>
  );
}
