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
    <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2.5 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${highlight ? 'text-teal-600 dark:text-teal-400' : 'text-foreground'}`}>
        {value}
      </dd>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/30 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-xs font-medium text-foreground text-right">{value}</dd>
    </div>
  );
}

function GuardrailRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-amber-600 dark:text-amber-400">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/60" />
      {children}
    </li>
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

// ─── Section A: Snapshot persistido ──────────────────────────────────────────

function SnapshotSection({ coverage }: { coverage: HnContratacionesCoverageSummary | null }) {
  const hasData = coverage !== null && coverage.coverageSource === 'live_database';
  const loadedRows = coverage?.loadedRows ?? 0;
  const sourceYear = coverage?.sourceYear ?? null;
  const pilotScope = coverage?.pilotScope ?? true;
  const humanReviewRequired = coverage?.humanReviewRequired ?? true;
  const refreshedAt = coverage?.refreshedAt ?? null;

  return (
    <div className="mb-6">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Snapshot persistido
      </p>

      {hasData ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricCell label="Proveedores cargados" value={loadedRows} highlight />
            {sourceYear !== null && (
              <MetricCell label="Año fuente" value={sourceYear} />
            )}
            <MetricCell label="Piloto" value={pilotScope ? 'Sí' : 'No'} />
          </div>

          <dl className="divide-y divide-border/20 mb-4">
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
        <div className="rounded-lg border border-border/30 bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {coverage === null
              ? 'Cargando cobertura…'
              : 'No se pudo leer el resumen de cobertura. El snapshot piloto fue aplicado exitosamente (8C.4B.2B) pero los datos no están disponibles en este momento.'}
          </p>
        </div>
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
    </div>
  );
}

// ─── Section B: Validación técnica previa ────────────────────────────────────

function DryRunSection() {
  const m = HN_DRY_RUN_METRICS;
  const rtnCoverage = formatHnRtnCoverage(m.validRtn, m.hnRtnSeen);

  return (
    <div className="border-t border-border/30 pt-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Validación técnica previa
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        El dry-run 2025 procesó {m.linesRead} líneas y detectó {m.uniqueValidRtn} RTN únicos válidos.
        Estas métricas corresponden a la validación técnica previa y <strong>no</strong> al snapshot persistido.
      </p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 mb-2">
        <MetricCell label="Líneas leídas" value={m.linesRead} />
        <MetricCell label="Suppliers / tenderers" value={m.supplierOrTendererSeen} />
        <MetricCell label="RTN únicos válidos" value={m.uniqueValidRtn} />
        <MetricCell label="Riesgo persona natural" value={m.naturalPersonRisk} />
      </dl>

      <p className="text-[11px] text-muted-foreground">
        Cobertura RTN:{' '}
        <span className="font-semibold tabular-nums text-foreground">{rtnCoverage}</span> de proveedores
        con HN-RTN tuvieron RTN válido. RTN inválidos: {m.invalidRtn}. Legacy scheme ignorado:{' '}
        {m.legacySchemeIgnored}.
      </p>
    </div>
  );
}

// ─── Main card ───────────────────────────────────────────────────────────────

export function HnContratacionesAbiertasCard({ coverage }: HnContratacionesAbiertasCardProps) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Portal de Contrataciones Abiertas Honduras"
        description="Señal procurement B2G. Post-approval no habilitado. Revisión humana requerida."
      />

      {/* Status badges */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-medium text-teal-600 dark:text-teal-400">
          Snapshot parcial
        </span>
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-medium text-teal-600 dark:text-teal-400">
          Read-only snapshot
        </span>
        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          Revisión humana requerida
        </span>
        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          Post-approval no habilitado
        </span>
      </div>

      <SnapshotSection coverage={coverage} />

      <DryRunSection />

      {/* Limitaciones */}
      <div className="mt-5 border-t border-border/30 pt-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Limitaciones
        </p>
        <ul className="space-y-1.5">
          <LimitationRow>No valida identidad fiscal completa. RTN sin cruce con SAR Honduras.</LimitationRow>
          <LimitationRow>No reemplaza SAR Honduras (Servicio de Administración de Rentas).</LimitationRow>
          <LimitationRow>No reemplaza Registro Mercantil de Honduras.</LimitationRow>
          <LimitationRow>Puede mezclar personas naturales y jurídicas — revisión humana obligatoria.</LimitationRow>
          <LimitationRow>Sin post-approval — no conectada a flujos automáticos.</LimitationRow>
          <LimitationRow>Sin matching automático — no crea cuentas ni candidatos.</LimitationRow>
          <LimitationRow>Snapshot piloto parcial — no representa cobertura completa del universo anual.</LimitationRow>
        </ul>
      </div>
    </SurfaceCard>
  );
}
