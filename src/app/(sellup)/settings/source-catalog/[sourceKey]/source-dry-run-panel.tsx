'use client';

import { useState, useTransition } from 'react';
import { FlaskConical, Loader2 } from "@/icons";
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { runSourceDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeDryRunReport } from '@/modules/source-catalog/source-credential-actions';
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

// ─── Report display ───────────────────────────────────────────────────────────

function DryRunReportView({ report }: { report: SafeDryRunReport }) {
  const s = report.summary;
  const hasSamples = report.sampleItems.length > 0 || report.filteredSamples.length > 0;

  return (
    <div className="space-y-4">
      <PanelSummary>
        <PanelSummaryItem label="Leídos" value={s.recordsRead} />
        <PanelSummaryItem label="Normalizados" value={s.normalizedCount} />
        <PanelSummaryItem label="Aceptados" value={s.acceptedDraftsCount} />
        <PanelSummaryItem label="Filtrados" value={s.filteredOutCount} />
        <PanelSummaryItem label="Baja prioridad" value={s.lowPriorityCount} />
        <PanelSummaryItem label="Sin RFC" value={s.noTaxIdCount} />
        <PanelSummaryItem label="Errores" value={s.errorsCount} />
        <PanelSummaryItem
          label="Origen de la credencial"
          value={report.connectionSource === 'vault/resolver' ? 'Vault' : 'Env local'}
        />
      </PanelSummary>

      <PanelWarnings warnings={report.warnings} />

      {hasSamples && (
        <PanelSamples>
          <PanelSampleList title="Muestra aceptados" count={report.sampleItems.length}>
            {report.sampleItems.map((item, i) => (
              <PanelSampleItem key={i}>
                <span className="font-medium text-foreground">{item.name ?? '—'}</span>
                {item.city && <span className="ml-2 text-muted-foreground">· {item.city}</span>}
                {item.activity && <p className="mt-0.5 truncate text-muted-foreground">{item.activity}</p>}
                <p className="mt-0.5 text-success">{item.qualityReason}</p>
              </PanelSampleItem>
            ))}
          </PanelSampleList>
          <PanelSampleList title="Muestra filtrados" count={report.filteredSamples.length}>
            {report.filteredSamples.map((item, i) => (
              <PanelSampleItem key={i}>
                <span className="font-medium text-foreground">{item.name ?? '—'}</span>
                {item.city && <span className="ml-2 text-muted-foreground">· {item.city}</span>}
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
    <SourcePanel
      icon={FlaskConical}
      title="Dry-run de fuente"
      description="Prueba controlada usando la credencial guardada. No crea candidatos ni lotes."
    >
      <p className="text-sm text-muted-foreground">
        Ejecuta una extracción mínima de muestra directamente desde la API de la fuente,
        usando el token almacenado en Vault. Solo lectura — sin writes a Supabase, sin HubSpot.
      </p>

      {!isAdmin && (
        <AdminOnlyNotice>Solo administradores pueden ejecutar dry-runs de fuente.</AdminOnlyNotice>
      )}

      {isAdmin && !hasStoredCredential && (
        <Alert variant="warning">
          Configura y verifica la credencial de API antes de ejecutar el dry-run.
        </Alert>
      )}

      {canRun && (
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
        {report && <DryRunReportView report={report} />}
      </PanelRunResult>

      <PanelDisclaimer>
        No escribe en Supabase. No crea candidatos. El token nunca se muestra ni se registra.
      </PanelDisclaimer>
    </SourcePanel>
  );
}
