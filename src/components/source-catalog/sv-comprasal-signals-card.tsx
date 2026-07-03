/**
 * Read-only signals card for COMPRASAL El Salvador (sv_comprasal).
 *
 * Displays weak signal summary from source_company_signals.
 * sv_comprasal is a weak B2G procurement signal — NOT a legal registry,
 * NOT a tax authority, does NOT validate NIT/NRC.
 * No post-approval. No automatic matching. Human review required.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   noComprasalApiRuntime    : never fetches from comprasal.gob.sv at render time
 *   noRawDataDisplay         : never shows raw_data fields
 *   noTaxIdDisplay           : never shows NIT / NRC fields
 *   noPostApprovalClaim      : does not claim post-approval is active
 *   noAutoMatchingClaim      : does not claim automatic matching exists
 *   noValidatedCopy          : never uses "validado", "verificado", "identidad fiscal"
 *   noConnectedCopy          : never uses "conectado" for operational flow
 *
 * Hito: Centroamérica.7E.3
 */

import type { SvComprasalSignalsSummary } from '@/server/services/sv-comprasal-signals-summary';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ─── Pure display helpers (exported for unit tests) ──────────────────────────

export function formatSvTotalSignals(count: number): string {
  if (count === 0) return 'Sin señales persistidas';
  return `${count.toLocaleString('es-SV')} señales persistidas`;
}

export function formatSvSourceYears(years: number[]): string {
  if (!years || years.length === 0) return 'No disponible';
  return years.join(', ');
}

export function formatSvLatestImportedAt(iso: string | null): string {
  if (!iso) return 'No disponible';
  try {
    return new Date(iso).toLocaleDateString('es-SV', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function isSvFiscalSource(summary: SvComprasalSignalsSummary): boolean {
  return summary.isFiscalSource;
}

export function isSvPostApprovalConnected(summary: SvComprasalSignalsSummary): boolean {
  return summary.postApprovalConnected;
}

export function isSvAutoMatchingEnabled(summary: SvComprasalSignalsSummary): boolean {
  return summary.automaticMatchingEnabled;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

// ─── Main card ───────────────────────────────────────────────────────────────

interface SvComprasalSignalsCardProps {
  summary?: SvComprasalSignalsSummary;
  error?: boolean;
}

export function SvComprasalSignalsCard({ summary, error }: SvComprasalSignalsCardProps) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Señales COMPRASAL El Salvador" />
        <p className="text-sm text-muted-foreground">
          No se pudo cargar el resumen de señales. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const hasSignals = summary.totalSignals > 0;

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Señales COMPRASAL El Salvador" />

      {/* Tipo de señal */}
      <div className="mb-4 rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Tipo de señal
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Señal débil
          </span>
          <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            Solo nombre
          </span>
          <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            Revisión humana requerida
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          COMPRASAL aporta señales comerciales B2G de proveedores adjudicados en compras públicas
          de El Salvador, pero no expone NIT ni NRC. Estas señales requieren revisión humana
          antes de asociarse a una cuenta.
        </p>
      </div>

      {/* Métricas de señales */}
      <dl className="divide-y divide-border/20">
        <SectionTitle>Señales persistidas</SectionTitle>

        <FieldRow
          label="Total de señales"
          value={formatSvTotalSignals(summary.totalSignals)}
        />
        <FieldRow
          label="Años cubiertos"
          value={formatSvSourceYears(summary.sourceYears)}
        />
        <FieldRow
          label="Última importación"
          value={formatSvLatestImportedAt(summary.latestImportedAt)}
        />
        <FieldRow
          label="País"
          value="El Salvador (SV)"
        />
        <FieldRow
          label="Tipo de señal"
          value="Procurement B2G"
        />
        <FieldRow
          label="Fuente del indicador"
          value={summary.dataSource === 'live_database' ? 'base de datos en vivo' : 'fallback auditado'}
        />

        <SectionTitle>Clasificación de señal</SectionTitle>

        <FieldRow label="Fuerza de señal" value="Débil — solo por nombre (weak_name_only)" />
        <FieldRow label="Modo de matching" value="Revisión manual requerida (name_only_review_required)" />
        <FieldRow label="Revisión humana" value="Sí — obligatoria antes de asociar" />
        <FieldRow label="Fuente fiscal / tributaria" value="No — no es fuente fiscal" />
        <FieldRow label="Valida NIT El Salvador" value="No — no expone NIT" />
        <FieldRow label="Valida NRC El Salvador" value="No — no expone NRC" />
        <FieldRow label="Reemplaza Ministerio de Hacienda" value="No" />
        <FieldRow label="Reemplaza CNR / Registro de Comercio" value="No" />
        <FieldRow label="Post-approval conectado" value="No — no conectada a flujos automáticos" />
        <FieldRow label="Matching automático" value="No — requiere revisión humana" />
      </dl>

      {/* Limitaciones */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Limitaciones
        </p>
        <ul className="space-y-1.5">
          <LimitationRow>No valida NIT ni NRC. No expone identificadores fiscales públicos.</LimitationRow>
          <LimitationRow>No reemplaza Ministerio de Hacienda El Salvador.</LimitationRow>
          <LimitationRow>No reemplaza CNR / Registro de Comercio de El Salvador.</LimitationRow>
          <LimitationRow>No es fuente legal ni tributaria.</LimitationRow>
          <LimitationRow>No conectada a post-approval automático.</LimitationRow>
          <LimitationRow>No permite matching automático por nombre.</LimitationRow>
          <LimitationRow>Usar como contexto comercial, no como validación legal ni fiscal.</LimitationRow>
        </ul>
      </div>

      {/* Estado operativo */}
      <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">
          Estado operativo
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {hasSignals
            ? `${summary.totalSignals} señales comerciales B2G persistidas en Source Company Signals. `
            : 'Sin señales persistidas aún. '}
          No conectada a post-approval automático. La fuente permanece en{' '}
          <span className="font-medium">eligible_not_connected</span>{' '}
          hasta que se operativice un flujo de enriquecimiento con revisión humana.
          {' '}No es fuente legal. No es fuente fiscal. No valida NIT. No valida NRC.
          {' '}No reemplaza Ministerio de Hacienda El Salvador ni CNR.
        </p>
      </div>

      {summary.dataSourceReason && (
        <p className="mt-3 text-[11px] text-muted-foreground/60">
          Motivo: lectura dinámica no disponible
        </p>
      )}
    </SurfaceCard>
  );
}
