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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { runSourceDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeDryRunReport } from '@/modules/source-catalog/source-credential-actions';

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

// ─── Sample items ─────────────────────────────────────────────────────────────

function SampleItemsTable({ items }: { items: SafeDryRunReport['sampleItems'] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        Muestra aceptados ({items.length})
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            {item.city && (
              <span className="text-muted-foreground ml-2">· {item.city}</span>
            )}
            {item.activity && (
              <p className="text-muted-foreground mt-0.5 truncate">{item.activity}</p>
            )}
            <p className="text-success mt-0.5">{item.qualityReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilteredSamplesTable({ items }: { items: SafeDryRunReport['filteredSamples'] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        Muestra filtrados ({items.length})
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            {item.city && (
              <span className="text-muted-foreground ml-2">· {item.city}</span>
            )}
            <p className="text-warning mt-0.5">{item.filterReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Report display ───────────────────────────────────────────────────────────

function DryRunReportView({ report }: { report: SafeDryRunReport }) {
  const [showSamples, setShowSamples] = useState(false);
  const s = report.summary;

  return (
    <div className="space-y-4">
      {/* Summary grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 sm:grid-cols-4">
        <SummaryRow label="Leídos" value={s.recordsRead} />
        <SummaryRow label="Normalizados" value={s.normalizedCount} />
        <SummaryRow label="Aceptados" value={s.acceptedDraftsCount} />
        <SummaryRow label="Filtrados" value={s.filteredOutCount} />
        <SummaryRow label="Baja prio." value={s.lowPriorityCount} />
        <SummaryRow label="Sin RFC" value={s.noTaxIdCount} />
        <SummaryRow label="Errores" value={s.errorsCount} />
        <SummaryRow label="Origen cred." value={report.connectionSource === 'vault/resolver' ? 'Vault' : 'Env local'} />
      </dl>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 space-y-0.5">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning">{w}</p>
          ))}
        </div>
      )}

      {/* Samples toggle */}
      {(report.sampleItems.length > 0 || report.filteredSamples.length > 0) && (
        <div>
          <button
            type="button"
            onClick={() => setShowSamples((v) => !v)}
            className="flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {showSamples ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showSamples ? 'Ocultar muestras' : 'Ver muestras'}
          </button>
          {showSamples && (
            <div className="space-y-4 mt-3">
              <SampleItemsTable items={report.sampleItems} />
              <FilteredSamplesTable items={report.filteredSamples} />
            </div>
          )}
        </div>
      )}

      {/* Timestamp + connection source */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        <span>
          Ejecutado: {new Intl.DateTimeFormat('es-CO', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          }).format(new Date(report.executedAt))}
        </span>
        <span className="break-all font-mono">{report.sourceKey} · {report.countryCode}</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  sourceKey: string;
  hasStoredCredential: boolean;
  isAdmin: boolean;
}

export function SourceDryRunPanel({ sourceKey, hasStoredCredential, isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<SafeDryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRun() {
    setReport(null);
    setError(null);

    startTransition(async () => {
      const result = await runSourceDryRunAction(sourceKey);
      if (result.ok && result.report) {
        setReport(result.report);
      } else {
        setError(result.error ?? 'Error al ejecutar el dry-run.');
      }
    });
  }

  const canRun = isAdmin && hasStoredCredential;

  return (
    <SurfaceCard>
      <div className="mb-5 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
          <FlaskConical className="h-4 w-4" />
        </span>
        <SurfaceCardHeader
          title="Dry-run de fuente"
          description="Prueba controlada usando la credencial guardada. No crea candidatos ni lotes."
          className="mb-0 min-w-0 flex-1 flex-wrap"
        />
      </div>

      <div className="space-y-4">
        {/* Description */}
        <p className="text-sm text-muted-foreground">
          Ejecuta una extracción mínima de muestra directamente desde la API de la fuente,
          usando el token almacenado en Vault. Solo lectura — sin writes a Supabase, sin HubSpot.
        </p>

        {/* Guard states */}
        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo administradores pueden ejecutar dry-runs de fuente.
          </div>
        )}

        {isAdmin && !hasStoredCredential && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-xs text-warning">
            <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Configura y verifica la credencial de API antes de ejecutar el dry-run.
          </div>
        )}

        {/* Action */}
        {canRun && (
          <Button
            type="button"
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

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Success */}
        {report && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-semibold tracking-tight text-foreground">Dry-run completado</span>
            </div>
            <DryRunReportView report={report} />
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No escribe en Supabase. No crea candidatos. El token nunca se muestra ni se registra.
        </div>
      </div>
    </SurfaceCard>
  );
}
