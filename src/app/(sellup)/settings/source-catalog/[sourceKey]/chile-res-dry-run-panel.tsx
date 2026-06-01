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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { runClResDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeClResDryRunReport } from '@/modules/source-catalog/source-credential-actions';

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

// ─── Sample tables ────────────────────────────────────────────────────────────

function AcceptedSamplesTable({ items }: { items: SafeClResDryRunReport['acceptedSamples'] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Muestra aceptados ({items.length})
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
            <p className="text-emerald-600 dark:text-emerald-400 mt-0.5">{item.qualityReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilteredSamplesTable({ items }: { items: SafeClResDryRunReport['filteredSamples'] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Muestra filtrados ({items.length})
      </p>
      <div className="rounded-lg border border-border/40 divide-y divide-border/30 overflow-hidden">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{item.name ?? '—'}</span>
            {item.tipoActuacion && (
              <span className="text-muted-foreground ml-2">· {item.tipoActuacion}</span>
            )}
            <p className="text-amber-600 dark:text-amber-400 mt-0.5">{item.filterReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Report view ──────────────────────────────────────────────────────────────

function ClResDryRunReportView({ report }: { report: SafeClResDryRunReport }) {
  const [showSamples, setShowSamples] = useState(false);
  const s = report.summary;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <SummaryRow label="Leídos" value={s.recordsRead} />
        <SummaryRow label="Normalizados" value={s.normalizedCount} />
        <SummaryRow label="Aceptados" value={s.acceptedDraftsCount} />
        <SummaryRow label="Filtrados" value={s.filteredOutCount} />
        <SummaryRow label="Sin RUT" value={s.missingRutCount} />
        <SummaryRow label="Sin sector" value={s.noSectorDataCount} />
        <SummaryRow label="Con capital" value={s.capitalAvailableCount} />
        <SummaryRow label="Errores" value={s.errorsCount} />
      </dl>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span>
          Origen credencial:{' '}
          <strong className="text-foreground">No requiere</strong> — acceso público CKAN datos.gob.cl
        </span>
      </div>

      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-0.5">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {(report.acceptedSamples.length > 0 || report.filteredSamples.length > 0) && (
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
              <FilteredSamplesTable items={report.filteredSamples} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2">
        <span>
          Ejecutado:{' '}
          {new Intl.DateTimeFormat('es-CO', {
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

export function ChileResDryRunPanel({ isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<SafeClResDryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRun() {
    setReport(null);
    setError(null);

    startTransition(async () => {
      const result = await runClResDryRunAction();
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
        title="Dry-run de fuente"
        description="Ejecuta una prueba controlada contra RES Chile / datos.gob.cl. No crea candidatos ni lotes."
      />

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Extrae una muestra del Registro de Empresas y Sociedades desde la CKAN API pública de Chile.
          Solo lectura — sin writes a Supabase, sin HubSpot, sin credencial requerida.
        </p>

        <div className="space-y-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            RES Chile no incluye giro/actividad económica ni CIIU. Todos los registros salen con sector desconocido.
          </p>
          <p className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            La fuente usa RUT como identificador estable.
          </p>
          <p className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            El estado activo se infiere desde el tipo de actuación (CONSTITUCIÓN = activo candidato).
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
            <ClResDryRunReportView report={report} />
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
