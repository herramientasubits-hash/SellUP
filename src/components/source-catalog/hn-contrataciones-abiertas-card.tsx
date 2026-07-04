/**
 * Read-only dry-run summary card for Portal de Contrataciones Abiertas Honduras
 * (hn_contrataciones_abiertas).
 *
 * Displays technical dry-run metrics from the 2025 OCDS validation run.
 * This source is NOT connected to persistence — no snapshots, no post-approval,
 * no matching, no account creation.
 *
 * Guardrails (display only — no I/O, no DB writes, no API calls):
 *   noPersistenceClaim      : does not claim snapshots are active
 *   noPostApprovalClaim     : does not claim post-approval is active
 *   noAutoMatchingClaim     : does not claim automatic matching exists
 *   noFiscalValidationClaim : does not claim RTN validates fiscal identity
 *   noSarReplacementClaim   : does not claim to replace SAR Honduras
 *   noRegistroMercantilClaim: does not claim to replace Registro Mercantil
 *   noAccountCreationClaim  : does not claim to create accounts or candidates
 *
 * Hito: Centroamérica.8C.2
 */

import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ─── Dry-run metrics (fixed from 2025 real run) ───────────────────────────────

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

export function isHnPersisted(): boolean {
  return false;
}

export function isHnFiscalSource(): boolean {
  return false;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCell({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2.5 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${highlight ? 'text-violet-600 dark:text-violet-400' : 'text-foreground'}`}>
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

function LimitationRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-muted-foreground">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
      {children}
    </li>
  );
}

// ─── Main card ───────────────────────────────────────────────────────────────

export function HnContratacionesAbiertasCard() {
  const m = HN_DRY_RUN_METRICS;
  const rtnCoverage = formatHnRtnCoverage(m.validRtn, m.hnRtnSeen);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Dry-run técnico — Portal de Contrataciones Abiertas Honduras"
        description="Métricas del dry-run OCDS 2025. Sin escritura en DB. Sin snapshots. Sin post-approval."
      />

      {/* Estado visible */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
          Dry-run validado
        </span>
        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          Sin persistencia
        </span>
        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          RTN con riesgo persona natural
        </span>
      </div>

      {/* Métricas del dry-run */}
      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Métricas dry-run 2025
        </p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCell label="Líneas leídas" value={m.linesRead} />
          <MetricCell label="Parties vistas" value={m.partiesSeen} />
          <MetricCell label="Suppliers / tenderers" value={m.supplierOrTendererSeen} />
          <MetricCell label="Con HN-RTN" value={m.hnRtnSeen} />
          <MetricCell label="RTN válidos" value={m.validRtn} highlight />
        </dl>
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCell label="RTN únicos válidos" value={m.uniqueValidRtn} highlight />
          <MetricCell label="Persona jurídica (señal)" value={m.likelyLegalEntity} />
          <MetricCell label="Riesgo persona natural" value={m.naturalPersonRisk} />
          <MetricCell label="Legacy scheme ignorado" value={m.legacySchemeIgnored} />
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cobertura RTN: <span className="font-semibold tabular-nums text-foreground">{rtnCoverage}</span> de proveedores con HN-RTN tuvieron RTN válido.
          RTN inválidos: {m.invalidRtn}. Legacy scheme ignorado: {m.legacySchemeIgnored}.
        </p>
      </div>

      {/* Clasificación de señal */}
      <dl className="divide-y divide-border/20 mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Clasificación de señal
        </p>
        <FieldRow label="País" value="Honduras (HN)" />
        <FieldRow label="Tipo" value="Procurement B2G · OCDS" />
        <FieldRow label="Fuente" value="OCP Data Registry / ONCAE Honduras" />
        <FieldRow label="Identificador" value="RTN (Registro Tributario Nacional)" />
        <FieldRow label="Cobertura RTN validado" value={`${m.validRtn} de ${m.hnRtnSeen} con HN-RTN (${rtnCoverage})`} />
        <FieldRow label="RTN únicos válidos" value={String(m.uniqueValidRtn)} />
        <FieldRow label="Riesgo persona natural" value={`${m.naturalPersonRisk} de ${m.supplierOrTendererSeen} proveedores`} />
        <FieldRow label="Fuente fiscal / tributaria" value="No — no reemplaza SAR Honduras" />
        <FieldRow label="Valida identidad fiscal" value="No — RTN sin cruce SAR" />
        <FieldRow label="Reemplaza SAR Honduras" value="No" />
        <FieldRow label="Reemplaza Registro Mercantil" value="No" />
        <FieldRow label="Post-approval conectado" value="No — sin persistencia activa" />
        <FieldRow label="Matching automático" value="No — sin flujo automático" />
        <FieldRow label="Crea accounts" value="No" />
        <FieldRow label="Crea prospect_candidates" value="No" />
        <FieldRow label="Escribe source_company_snapshots" value="No" />
        <FieldRow label="Escribe source_company_signals" value="No" />
      </dl>

      {/* Limitaciones */}
      <div className="mb-5">
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
          <LimitationRow>Dry-run técnico sobre 300 líneas — no representa cobertura completa del feed anual.</LimitationRow>
        </ul>
      </div>

      {/* Siguiente paso */}
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400 mb-1">
          Siguiente paso recomendado
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Snapshot controlado por año usando el feed OCP Registry, con filtros de RTN válido
          y exclusión de riesgo persona natural. Requiere aprobación de scope antes de habilitar
          escritura en <span className="font-mono">source_company_snapshots</span>.
          No activar post-approval ni matching automático hasta validación completa.
        </p>
      </div>
    </SurfaceCard>
  );
}
