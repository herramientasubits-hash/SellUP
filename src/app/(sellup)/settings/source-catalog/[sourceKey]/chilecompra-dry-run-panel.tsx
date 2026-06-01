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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { runChileCompraDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeChileCompraDryRunReport } from '@/modules/source-catalog/source-credential-actions';

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

// ─── Accepted samples ─────────────────────────────────────────────────────────

function AcceptedSamplesTable({
  items,
}: {
  items: SafeChileCompraDryRunReport['acceptedSamples'];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Aceptados ICP ({items.length})
      </p>
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 overflow-hidden">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            {item.city && (
              <span className="text-muted-foreground ml-2">· {item.city}</span>
            )}
            {item.region && (
              <span className="text-muted-foreground ml-2">· {item.region}</span>
            )}
            {item.procurementCategoryName && (
              <span className="text-muted-foreground ml-2">
                · {item.procurementCategoryName}
              </span>
            )}
            {item.icpMatch && item.icpMatchKeyword && (
              <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                ICP: {item.icpMatchKeyword}
              </span>
            )}
            <p className="text-emerald-600 dark:text-emerald-400 mt-0.5">{item.qualityReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Low priority samples ─────────────────────────────────────────────────────

function LowPrioritySamplesTable({
  items,
}: {
  items: SafeChileCompraDryRunReport['lowPrioritySamples'];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Baja prioridad ({items.length})
      </p>
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 overflow-hidden">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            {item.procurementCategoryName && (
              <span className="text-muted-foreground ml-2">
                · {item.procurementCategoryName}
              </span>
            )}
            <p className="text-amber-600 dark:text-amber-400 mt-0.5">{item.qualityReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Filtered samples ─────────────────────────────────────────────────────────

function FilteredSamplesTable({
  items,
}: {
  items: SafeChileCompraDryRunReport['filteredSamples'];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Filtrados ({items.length})
      </p>
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 overflow-hidden">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            <p className="text-muted-foreground mt-0.5">{item.filterReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Report view ──────────────────────────────────────────────────────────────

function ChileCompraReportView({ report }: { report: SafeChileCompraDryRunReport }) {
  const [showSamples, setShowSamples] = useState(false);
  const s = report.summary;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <SummaryRow label="Leídos" value={s.recordsRead} />
        <SummaryRow label="Normalizados" value={s.normalizedCount} />
        <SummaryRow label="Aceptados ICP" value={s.acceptedDraftsCount} />
        <SummaryRow label="Baja prioridad" value={s.lowPriorityCount} />
        <SummaryRow label="Filtrados" value={s.filteredOutCount} />
        <SummaryRow label="Sin RUT" value={s.missingRutCount} />
        <SummaryRow label="Sin categoría" value={s.missingCategoryCount} />
        <SummaryRow label="Match ICP" value={s.icpMatchCount} />
      </dl>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span>
          Origen credencial:{' '}
          <strong className="text-foreground">
            {report.credentialSource === 'vault'
              ? 'Vault (ticket configurado)'
              : report.credentialSource === 'env_development'
                ? 'Variable de entorno (desarrollo)'
                : 'Sin ticket — OCDS público'}
          </strong>
        </span>
      </div>

      {report.qualitySummary.credentialInstructions && (
        <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-su-brand">Instrucciones de ticket ChileCompra</p>
          <p className="text-xs text-muted-foreground">
            {report.qualitySummary.credentialInstructions}
          </p>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-0.5">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {(report.acceptedSamples.length > 0 ||
        report.lowPrioritySamples.length > 0 ||
        report.filteredSamples.length > 0) && (
        <div>
          <button
            type="button"
            onClick={() => setShowSamples((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showSamples ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showSamples ? 'Ocultar muestras' : 'Ver muestras'}
          </button>
          {showSamples && (
            <div className="space-y-4 mt-3">
              <AcceptedSamplesTable items={report.acceptedSamples} />
              <LowPrioritySamplesTable items={report.lowPrioritySamples} />
              <FilteredSamplesTable items={report.filteredSamples} />
            </div>
          )}
        </div>
      )}

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
          {report.sourceKey} · {report.countryCode}
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
        description="Prueba controlada sobre ChileCompra. No crea candidatos ni lotes."
      />

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Conecta con la API pública de Mercado Público Chile (OCDS) para identificar proveedores
          del Estado con señal de compra pública. Filtra por categorías ICP UBITS usando
          keywords UNSPSC. Solo lectura — sin writes a Supabase, sin HubSpot.
        </p>

        <div className="space-y-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            El endpoint OCDS de ChileCompra puede requerir ticket de API (gratuito por email).
            Si el dry-run reporta &quot;requires_ticket&quot;, ver instrucciones en el resultado.
          </p>
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-su-brand" />
            Señal B2G: solo empresas proveedoras del Estado chileno. Complementa cl_res que
            aporta RUT + razón social sin sector.
          </p>
          <p className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            RUT + categoría UNSPSC disponibles en contratos adjudicados.
          </p>
          <p className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            ICP UBITS filtrado por keywords: capacitación, formación, software, tecnología,
            consultoría, RRHH, e-learning, desarrollo organizacional.
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
