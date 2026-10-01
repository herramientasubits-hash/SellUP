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
import { Landmark, type LucideIcon } from "@/icons";
import { Badge } from '@/components/ui/badge';
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

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">{title}</h3>
      <dl className="divide-y divide-border/50">{children}</dl>
    </section>
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

// ─── Main card ───────────────────────────────────────────────────────────────

interface SvComprasalSignalsCardProps {
  summary?: SvComprasalSignalsSummary;
  error?: boolean;
}

export function SvComprasalSignalsCard({ summary, error }: SvComprasalSignalsCardProps) {
  if (error || !summary) {
    return (
      <SurfaceCard>
        <CoverageCardHeader icon={Landmark} title="Señales COMPRASAL El Salvador" />
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudo cargar el resumen de señales. Verifique la configuración del servicio.
        </p>
      </SurfaceCard>
    );
  }

  const hasSignals = summary.totalSignals > 0;

  return (
    <SurfaceCard>
      <CoverageCardHeader icon={Landmark} title="Señales COMPRASAL El Salvador" />

      <div className="space-y-5">
        {/* Tipo de señal */}
        <div className="rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Tipo de señal</h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Badge variant="warning">Señal débil</Badge>
            <Badge variant="neutral">Solo nombre</Badge>
            <Badge variant="neutral">Revisión humana requerida</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            COMPRASAL aporta señales comerciales B2G de proveedores adjudicados en compras públicas
            de El Salvador, pero no expone NIT ni NRC. Estas señales requieren revisión humana
            antes de asociarse a una cuenta.
          </p>
        </div>

        {/* Métricas de señales */}
        <FieldGroup title="Señales persistidas">
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
        </FieldGroup>

        <FieldGroup title="Clasificación de señal">
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
        </FieldGroup>

        {/* Limitaciones */}
        <div>
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Limitaciones</h3>
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
        <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3">
          <h3 className="mb-1 text-sm font-semibold tracking-tight text-foreground">Estado operativo</h3>
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
          <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
            Motivo: lectura dinámica no disponible
          </p>
        )}
      </div>
    </SurfaceCard>
  );
}
