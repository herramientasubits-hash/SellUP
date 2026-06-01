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
  Building2,
  Search,
} from 'lucide-react';
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
    <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
      <Building2 className="h-4 w-4 text-emerald-500 shrink-0" />
      <div className="text-xs">
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          API conectada — BuscarComprador OK
        </p>
        <p className="text-muted-foreground mt-0.5">
          Organismos compradores leídos:{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {healthCheck.buyersFound.toLocaleString('es-CL')}
          </span>
        </p>
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
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Lookup por RUT ({lookups.length})
      </p>
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 overflow-hidden">
        {lookups.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="font-mono text-muted-foreground">{item.rutFormatted}</span>
              {item.found ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  encontrado
                </span>
              ) : (
                <span className="rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  no encontrado
                </span>
              )}
            </div>
            {item.found && item.supplierName && (
              <p className="text-foreground font-medium mt-1">{item.supplierName}</p>
            )}
            {item.found && item.supplierCode && (
              <p className="text-muted-foreground mt-0.5">
                Código: <span className="font-mono">{item.supplierCode}</span>
                {item.ordersCount !== undefined && (
                  <> · Órdenes de compra: <span className="tabular-nums">{item.ordersCount}</span></>
                )}
              </p>
            )}
            {item.error && (
              <p className="text-destructive mt-0.5">{item.error}</p>
            )}
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
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

// ─── Report view ──────────────────────────────────────────────────────────────

function ChileCompraReportView({ report }: { report: SafeChileCompraDryRunReport }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="space-y-4">
      {/* Health check result */}
      {report.dryRunMode === 'health_check' && report.healthCheck && (
        <HealthCheckView healthCheck={report.healthCheck} />
      )}

      {/* Supplier lookups */}
      {report.dryRunMode === 'supplier_signal' && report.supplierLookups && (
        <SupplierLookupsView lookups={report.supplierLookups} />
      )}

      {/* Credential source */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
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

      {/* Credential instructions */}
      {report.qualitySummary.credentialInstructions && (
        <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-su-brand">Instrucciones de ticket ChileCompra</p>
          <p className="text-xs text-muted-foreground">
            {report.qualitySummary.credentialInstructions}
          </p>
        </div>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-0.5">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {/* Summary stats — mostrar solo si hay datos */}
      {report.summary.errorsCount > 0 && (
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDetails ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {showDetails ? 'Ocultar detalles' : `Ver detalles (${report.summary.errorsCount} errores)`}
        </button>
      )}
      {showDetails && (
        <dl className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          <SummaryRow label="Errores" value={report.summary.errorsCount} />
        </dl>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2">
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
        <span className="font-mono">
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
      <SurfaceCardHeader
        title="Dry-run ChileCompra"
        description="Valida el ticket y conectividad con Mercado Público. No crea candidatos ni lotes."
      />

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Valida el ticket y permite verificar si empresas con RUT conocido existen como proveedores
          de Mercado Público. Esta fuente complementa RES: cl_res aporta RUT + razón social,
          ChileCompra agrega señal B2G (licitaciones y órdenes de compra).
        </p>

        <div className="space-y-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-su-brand" />
            El dry-run ejecuta un health check usando BuscarComprador para confirmar que
            el ticket es válido y la API responde.
          </p>
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            Para discovery productivo, ChileCompra debe combinarse con RUTs de cl_res.
            Esta fuente no opera de forma masiva independiente.
          </p>
          <p className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            Endpoints oficiales: BuscarProveedor · BuscarComprador · licitaciones · órdenes de compra.
          </p>
          <p className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            Flujo productivo: cl_res → RUT → BuscarProveedor → CódigoProveedor → señal B2G.
          </p>
        </div>

        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo administradores pueden ejecutar dry-runs de fuente.
          </div>
        )}

        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRun}
            disabled={isPending}
          >
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
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium text-foreground">Dry-run completado</span>
            </div>
            <ChileCompraReportView report={report} />
          </div>
        )}

        <div className="flex items-center gap-1.5 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          No escribe en Supabase. No crea candidatos. No crea lotes. No sincroniza HubSpot.
        </div>
      </div>
    </SurfaceCard>
  );
}
