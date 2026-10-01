'use client';

import { useState, useTransition } from 'react';
import {
  FlaskConical,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  Zap,
  Search,
  Building2,
} from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { runChileCompraDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeChileCompraDryRunReport } from '@/modules/source-catalog/source-credential-actions';

// ─── Health check view ────────────────────────────────────────────────────────

function HealthCheckView({
  healthCheck,
}: {
  healthCheck: NonNullable<SafeChileCompraDryRunReport['healthCheck']>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/10 px-4 py-3">
      <Zap className="h-4 w-4 text-success shrink-0" />
      <div className="text-xs">
        <p className="font-medium text-success">
          API Compra Ágil V2 — conectada
        </p>
        {healthCheck.compraAgilFound !== undefined && (
          <p className="text-muted-foreground mt-0.5">
            Ítems Compra Ágil disponibles:{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {healthCheck.compraAgilFound.toLocaleString('es-CL')}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Compra Ágil discovery view ───────────────────────────────────────────────

function CompraAgilItemsView({
  items,
}: {
  items: NonNullable<SafeChileCompraDryRunReport['compraAgilItems']>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        Procesos Compra Ágil ({items.length})
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 min-w-0 font-medium text-foreground" title={item.titulo ?? undefined}>{item.titulo}</span>
              <Badge variant="neutral" className="tabular-nums">
                {item.suppliersExtracted} prov.
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              {item.organismo && <span>{item.organismo}</span>}
              {item.region && <span>· {item.region}</span>}
              {item.estado && (
                <Badge variant="neutral">{item.estado}</Badge>
              )}
              <span className="font-mono text-xs">{item.codigo}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Accepted/low-priority samples ───────────────────────────────────────────

function AcceptedSamplesTable({
  items,
}: {
  items: SafeChileCompraDryRunReport['acceptedSamples'];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        Proveedores aceptados ICP ({items.length})
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            {item.region && (
              <span className="text-muted-foreground ml-2">· {item.region}</span>
            )}
            {item.procurementCategoryName && (
              <span className="text-muted-foreground ml-2 italic">
                · {item.procurementCategoryName.slice(0, 60)}
              </span>
            )}
            {item.icpMatch && item.icpMatchKeyword && (
              <Badge variant="positive" className="ml-2 align-middle">
                ICP: {item.icpMatchKeyword}
              </Badge>
            )}
            <p className="text-success mt-0.5">{item.qualityReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LowPrioritySamplesTable({
  items,
}: {
  items: SafeChileCompraDryRunReport['lowPrioritySamples'];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        Baja prioridad ({items.length})
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            <p className="text-warning mt-0.5">{item.qualityReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Supplier lookups view ────────────────────────────────────────────────────

function SupplierLookupsView({
  lookups,
}: {
  lookups: NonNullable<SafeChileCompraDryRunReport['supplierLookups']>;
}) {
  if (lookups.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        Lookup por RUT ({lookups.length})
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {lookups.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="font-mono text-muted-foreground">{item.rutFormatted}</span>
              {item.found ? (
                <Badge variant="positive">encontrado</Badge>
              ) : (
                <Badge variant="neutral">no encontrado</Badge>
              )}
            </div>
            {item.found && item.supplierName && (
              <p className="text-foreground font-medium mt-1">{item.supplierName}</p>
            )}
            {item.found && item.supplierCode && (
              <p className="text-muted-foreground mt-0.5">
                Código: <span className="break-all font-mono">{item.supplierCode}</span>
                {item.ordersCount !== undefined && (
                  <> · Órdenes: <span className="tabular-nums">{item.ordersCount}</span></>
                )}
              </p>
            )}
            {item.error && <p className="text-destructive mt-0.5">{item.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Summary row ──────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ─── Report view ──────────────────────────────────────────────────────────────

function ChileCompraReportView({ report }: { report: SafeChileCompraDryRunReport }) {
  const [showSamples, setShowSamples] = useState(false);
  const s = report.summary;
  const hasSamples =
    report.acceptedSamples.length > 0 || report.lowPrioritySamples.length > 0;

  return (
    <div className="space-y-4">
      {report.dryRunMode === 'health_check' && report.healthCheck && (
        <HealthCheckView healthCheck={report.healthCheck} />
      )}

      {report.dryRunMode === 'compra_agil_discovery' && (
        <>
          {s.normalizedCount > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 sm:grid-cols-4">
              <SummaryRow label="Procesos CA" value={s.recordsRead} />
              <SummaryRow label="Proveedores" value={s.normalizedCount} />
              <SummaryRow label="Aceptados ICP" value={s.acceptedDraftsCount} />
              <SummaryRow label="Baja prioridad" value={s.lowPriorityCount} />
            </dl>
          )}
          {report.compraAgilItems && (
            <CompraAgilItemsView items={report.compraAgilItems} />
          )}
        </>
      )}

      {report.dryRunMode === 'supplier_signal' && report.supplierLookups && (
        <SupplierLookupsView lookups={report.supplierLookups} />
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
        <span>
          Origen credencial:{' '}
          <strong className="text-foreground">
            {report.credentialSource === 'vault'
              ? 'Vault (ticket configurado)'
              : report.credentialSource === 'env_development'
                ? 'Variable de entorno (desarrollo)'
                : 'Sin ticket — API requiere credencial'}
          </strong>
        </span>
      </div>

      {report.qualitySummary.credentialInstructions && (
        <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-primary">Instrucciones de ticket ChileCompra</p>
          <p className="text-xs text-muted-foreground">
            {report.qualitySummary.credentialInstructions}
          </p>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 space-y-0.5">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning">{w}</p>
          ))}
        </div>
      )}

      {hasSamples && (
        <div>
          <button
            type="button"
            onClick={() => setShowSamples((v) => !v)}
            className="flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {showSamples ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showSamples ? 'Ocultar muestras' : `Ver muestras (${s.acceptedDraftsCount + s.lowPriorityCount})`}
          </button>
          {showSamples && (
            <div className="space-y-4 mt-3">
              <AcceptedSamplesTable items={report.acceptedSamples} />
              <LowPrioritySamplesTable items={report.lowPrioritySamples} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        <span>
          Ejecutado:{' '}
          {new Intl.DateTimeFormat('es-CL', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(report.executedAt))}
        </span>
        <span className="break-all font-mono">
          {report.sourceKey} · {report.dryRunMode}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  isAdmin: boolean;
}

export function ChileCompraDryRunPanel({ isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<SafeChileCompraDryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRun() {
    setReport(null);
    setError(null);
    startTransition(async () => {
      const result = await runChileCompraDryRunAction();
      if (result.ok && result.report) {
        setReport(result.report);
      } else {
        setError(result.error ?? 'Error al ejecutar el dry-run.');
      }
    });
  }

  return (
    <SurfaceCard>
      <div className="mb-5 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
          <FlaskConical className="h-4 w-4" />
        </span>
        <SurfaceCardHeader
          title="Dry-run ChileCompra"
          description="Valida el ticket y detecta proveedores B2G activos en Mercado Público."
          className="mb-0 min-w-0 flex-1 flex-wrap"
        />
      </div>

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          ChileCompra se usa para detectar procesos de Compra Ágil relacionados con
          keywords ICP y extraer proveedores con señal B2G. Esta fuente complementa
          cl_res: RES aporta RUT + razón social, ChileCompra agrega señal de compra
          pública activa.
        </p>

        <div className="space-y-1.5 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-xs text-muted-foreground">
          <p className="flex items-start gap-1.5">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <strong className="text-foreground">Compra Ágil V2</strong> — busca por keywords
              ICP (capacitación, software, formación, tecnología) en{' '}
              <code className="text-xs">api2.mercadopublico.cl/v2/compra-agil</code>.
              Extrae proveedores_cotizando como señal B2G directa.
            </span>
          </p>
          <p className="flex items-start gap-1.5">
            <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              Autenticación V2: header <code className="text-xs">ticket</code> (no query param).
              BuscarProveedor v1 disponible como validación secundaria por RUT.
            </span>
          </p>
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            Para discovery productivo, combinar con RUTs de cl_res.
            El dry-run usa keywords ICP por defecto.
          </p>
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            Flujo B2G: cl_res → RUT → BuscarProveedor → CódigoProveedor → señal completa.
          </p>
        </div>

        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo administradores pueden ejecutar dry-runs de fuente.
          </div>
        )}

        {isAdmin && (
          <Button type="button" variant="outline" size="sm" onClick={handleRun} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Ejecutando…
              </>
            ) : (
              <>
                <FlaskConical className="h-3.5 w-3.5" />
                Ejecutar dry-run
              </>
            )}
          </Button>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-semibold tracking-tight text-foreground">Dry-run completado</span>
            </div>
            <ChileCompraReportView report={report} />
          </div>
        )}

        <div className="flex items-start gap-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No escribe en Supabase. No crea candidatos. No crea lotes. No sincroniza HubSpot.
        </div>
      </div>
    </SurfaceCard>
  );
}
