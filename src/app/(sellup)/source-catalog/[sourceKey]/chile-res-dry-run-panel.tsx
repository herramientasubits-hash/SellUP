'use client';

import { useState, useTransition } from 'react';
import { FlaskConical, Loader2 } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { runClResDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeClResDryRunReport } from '@/modules/source-catalog/source-credential-actions';
import {
  AdminOnlyNotice,
  PanelDisclaimer,
  PanelRunFooter,
  PanelRunResult,
  PanelSampleItem,
  PanelSampleList,
  PanelSamples,
  PanelSummary,
  PanelSummaryItem,
  PanelWarnings,
  SourcePanel,
} from './source-panel-parts';

// ─── Report view ──────────────────────────────────────────────────────────────

function ClResDryRunReportView({ report }: { report: SafeClResDryRunReport }) {
  const s = report.summary;
  const hasSamples = report.acceptedSamples.length > 0 || report.filteredSamples.length > 0;

  return (
    <div className="space-y-4">
      <PanelSummary>
        <PanelSummaryItem label="Leídos" value={s.recordsRead} />
        <PanelSummaryItem label="Normalizados" value={s.normalizedCount} />
        <PanelSummaryItem label="Aceptados" value={s.acceptedDraftsCount} />
        <PanelSummaryItem label="Filtrados" value={s.filteredOutCount} />
        <PanelSummaryItem label="Sin RUT" value={s.missingRutCount} />
        <PanelSummaryItem label="Sin sector" value={s.noSectorDataCount} />
        <PanelSummaryItem label="Con capital" value={s.capitalAvailableCount} />
        <PanelSummaryItem label="Errores" value={s.errorsCount} />
        <PanelSummaryItem
          wide
          label="Origen de la credencial"
          value="No requiere — acceso público CKAN datos.gob.cl"
        />
      </PanelSummary>

      <PanelWarnings warnings={report.warnings} />

      {hasSamples && (
        <PanelSamples>
          <PanelSampleList title="Muestra aceptados" count={report.acceptedSamples.length}>
            {report.acceptedSamples.map((item, i) => (
              <PanelSampleItem key={i}>
                <span className="font-medium text-foreground">{item.name ?? '—'}</span>
                {item.city && <span className="ml-2 text-muted-foreground">· {item.city}</span>}
                {item.region && <span className="ml-2 text-muted-foreground">· {item.region}</span>}
                <p className="mt-0.5 text-success">{item.qualityReason}</p>
              </PanelSampleItem>
            ))}
          </PanelSampleList>
          <PanelSampleList title="Muestra filtrados" count={report.filteredSamples.length}>
            {report.filteredSamples.map((item, i) => (
              <PanelSampleItem key={i}>
                <span className="font-medium text-foreground">{item.name ?? '—'}</span>
                {item.tipoActuacion && (
                  <span className="ml-2 text-muted-foreground">· {item.tipoActuacion}</span>
                )}
                <p className="mt-0.5 text-warning">{item.filterReason}</p>
              </PanelSampleItem>
            ))}
          </PanelSampleList>
        </PanelSamples>
      )}

      <PanelRunFooter executedAt={report.executedAt} trailing={`${report.sourceKey} · ${report.countryCode}`} />
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
    <SourcePanel
      icon={FlaskConical}
      title="Dry-run de fuente"
      description="Ejecuta una prueba controlada contra RES Chile / datos.gob.cl. No crea candidatos ni lotes."
    >
      <p className="text-sm text-muted-foreground">
        Extrae una muestra del Registro de Empresas y Sociedades desde la CKAN API pública de Chile.
        Solo lectura — sin writes a Supabase, sin HubSpot, sin credencial requerida.
      </p>

      <Alert variant="warning">
        <AlertTitle>Sin sector ni actividad económica</AlertTitle>
        <AlertDescription className="text-xs">
          <ul className="space-y-1">
            <li>RES Chile no incluye giro/actividad económica ni CIIU. Todos los registros salen con sector desconocido.</li>
            <li>La fuente usa RUT como identificador estable.</li>
            <li>El estado activo se infiere desde el tipo de actuación (CONSTITUCIÓN = activo candidato).</li>
          </ul>
        </AlertDescription>
      </Alert>

      {!isAdmin && (
        <AdminOnlyNotice>Solo administradores pueden ejecutar dry-runs de fuente.</AdminOnlyNotice>
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

      <PanelRunResult error={error} successTitle="Dry-run completado">
        {report && <ClResDryRunReportView report={report} />}
      </PanelRunResult>

      <PanelDisclaimer>
        No escribe en Supabase. No crea candidatos. No crea lotes. No sincroniza HubSpot.
      </PanelDisclaimer>
    </SourcePanel>
  );
}
