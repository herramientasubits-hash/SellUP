'use client';

import { useState, useTransition } from 'react';
import { FlaskConical, Loader2, Search } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { runChileCompraDryRunAction } from '@/modules/source-catalog/source-credential-actions';
import type { SafeChileCompraDryRunReport } from '@/modules/source-catalog/source-credential-actions';
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

// ─── Health check view ────────────────────────────────────────────────────────

function HealthCheckView({
  healthCheck,
}: {
  healthCheck: NonNullable<SafeChileCompraDryRunReport['healthCheck']>;
}) {
  return (
    <Alert variant="success">
      <AlertTitle>API Compra Ágil V2 — conectada</AlertTitle>
      {healthCheck.compraAgilFound !== undefined && (
        <AlertDescription className="text-xs">
          Ítems Compra Ágil disponibles:{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {healthCheck.compraAgilFound.toLocaleString('es-CL')}
          </span>
        </AlertDescription>
      )}
    </Alert>
  );
}

// ─── Compra Ágil discovery view ───────────────────────────────────────────────

function CompraAgilItemsView({
  items,
}: {
  items: NonNullable<SafeChileCompraDryRunReport['compraAgilItems']>;
}) {
  return (
    <PanelSampleList title="Procesos Compra Ágil" count={items.length}>
      {items.map((item, i) => (
        <PanelSampleItem key={i}>
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 min-w-0 font-medium text-foreground" title={item.titulo ?? undefined}>
              {item.titulo}
            </span>
            <Badge variant="neutral" className="tabular-nums">
              {item.suppliersExtracted} prov.
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            {item.organismo && <span>{item.organismo}</span>}
            {item.region && <span>· {item.region}</span>}
            {item.estado && <Badge variant="neutral">{item.estado}</Badge>}
            <span className="font-mono text-xs">{item.codigo}</span>
          </div>
        </PanelSampleItem>
      ))}
    </PanelSampleList>
  );
}

// ─── Supplier lookups view ────────────────────────────────────────────────────

function SupplierLookupsView({
  lookups,
}: {
  lookups: NonNullable<SafeChileCompraDryRunReport['supplierLookups']>;
}) {
  return (
    <PanelSampleList title="Lookup por RUT" count={lookups.length}>
      {lookups.map((item, i) => (
        <PanelSampleItem key={i}>
          <div className="flex flex-wrap items-center gap-2">
            <Search aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="font-mono text-muted-foreground">{item.rutFormatted}</span>
            {item.found ? (
              <Badge variant="positive">encontrado</Badge>
            ) : (
              <Badge variant="neutral">no encontrado</Badge>
            )}
          </div>
          {item.found && item.supplierName && (
            <p className="mt-1 font-medium text-foreground">{item.supplierName}</p>
          )}
          {item.found && item.supplierCode && (
            <p className="mt-0.5 text-muted-foreground">
              Código: <span className="break-all font-mono">{item.supplierCode}</span>
              {item.ordersCount !== undefined && (
                <> · Órdenes: <span className="tabular-nums">{item.ordersCount}</span></>
              )}
            </p>
          )}
          {item.error && <p className="mt-0.5 text-destructive">{item.error}</p>}
        </PanelSampleItem>
      ))}
    </PanelSampleList>
  );
}

// ─── Report view ──────────────────────────────────────────────────────────────

const CREDENTIAL_SOURCE_LABEL: Record<string, string> = {
  vault: 'Vault (ticket configurado)',
  env_development: 'Variable de entorno (desarrollo)',
};

function ChileCompraReportView({ report }: { report: SafeChileCompraDryRunReport }) {
  const s = report.summary;
  const hasSamples =
    report.acceptedSamples.length > 0 || report.lowPrioritySamples.length > 0;
  const showDiscoverySummary = report.dryRunMode === 'compra_agil_discovery' && s.normalizedCount > 0;

  return (
    <div className="space-y-4">
      {report.dryRunMode === 'health_check' && report.healthCheck && (
        <HealthCheckView healthCheck={report.healthCheck} />
      )}

      <PanelSummary>
        {showDiscoverySummary && (
          <>
            <PanelSummaryItem label="Procesos CA" value={s.recordsRead} />
            <PanelSummaryItem label="Proveedores" value={s.normalizedCount} />
            <PanelSummaryItem label="Aceptados ICP" value={s.acceptedDraftsCount} />
            <PanelSummaryItem label="Baja prioridad" value={s.lowPriorityCount} />
          </>
        )}
        <PanelSummaryItem
          wide
          label="Origen de la credencial"
          value={CREDENTIAL_SOURCE_LABEL[report.credentialSource] ?? 'Sin ticket — API requiere credencial'}
        />
      </PanelSummary>

      {report.dryRunMode === 'compra_agil_discovery' && report.compraAgilItems && (
        <CompraAgilItemsView items={report.compraAgilItems} />
      )}

      {report.dryRunMode === 'supplier_signal' && report.supplierLookups && (
        <SupplierLookupsView lookups={report.supplierLookups} />
      )}

      {report.qualitySummary.credentialInstructions && (
        <Alert variant="info">
          <AlertTitle>Instrucciones de ticket ChileCompra</AlertTitle>
          <AlertDescription className="text-xs">
            {report.qualitySummary.credentialInstructions}
          </AlertDescription>
        </Alert>
      )}

      <PanelWarnings warnings={report.warnings} />

      {hasSamples && (
        <PanelSamples showLabel={`Ver muestras (${s.acceptedDraftsCount + s.lowPriorityCount})`}>
          <PanelSampleList title="Proveedores aceptados ICP" count={report.acceptedSamples.length}>
            {report.acceptedSamples.map((item, i) => (
              <PanelSampleItem key={i}>
                <span className="font-medium text-foreground">{item.name ?? '—'}</span>
                {item.region && <span className="ml-2 text-muted-foreground">· {item.region}</span>}
                {item.procurementCategoryName && (
                  <span className="ml-2 italic text-muted-foreground">
                    · {item.procurementCategoryName.slice(0, 60)}
                  </span>
                )}
                {item.icpMatch && item.icpMatchKeyword && (
                  <Badge variant="positive" className="ml-2 align-middle">
                    ICP: {item.icpMatchKeyword}
                  </Badge>
                )}
                <p className="mt-0.5 text-success">{item.qualityReason}</p>
              </PanelSampleItem>
            ))}
          </PanelSampleList>
          <PanelSampleList title="Baja prioridad" count={report.lowPrioritySamples.length}>
            {report.lowPrioritySamples.map((item, i) => (
              <PanelSampleItem key={i}>
                <span className="font-medium text-foreground">{item.name ?? '—'}</span>
                <p className="mt-0.5 text-warning">{item.qualityReason}</p>
              </PanelSampleItem>
            ))}
          </PanelSampleList>
        </PanelSamples>
      )}

      <PanelRunFooter
        executedAt={report.executedAt}
        locale="es-CL"
        trailing={`${report.sourceKey} · ${report.dryRunMode}`}
      />
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
    <SourcePanel
      icon={FlaskConical}
      title="Dry-run ChileCompra"
      description="Valida el ticket y detecta proveedores B2G activos en Mercado Público."
    >
      <p className="text-sm text-muted-foreground">
        ChileCompra se usa para detectar procesos de Compra Ágil relacionados con
        keywords ICP y extraer proveedores con señal B2G. Esta fuente complementa
        cl_res: RES aporta RUT + razón social, ChileCompra agrega señal de compra
        pública activa.
      </p>

      <Alert variant="info">
        <AlertTitle>Cómo funciona esta prueba</AlertTitle>
        <AlertDescription className="text-xs">
          <ul className="space-y-1">
            <li>
              <strong className="text-foreground">Compra Ágil V2</strong> — busca por keywords
              ICP (capacitación, software, formación, tecnología) en{' '}
              <code className="text-xs">api2.mercadopublico.cl/v2/compra-agil</code>.
              Extrae proveedores_cotizando como señal B2G directa.
            </li>
            <li>
              Autenticación V2: header <code className="text-xs">ticket</code> (no query param).
              BuscarProveedor v1 disponible como validación secundaria por RUT.
            </li>
            <li>
              Para discovery productivo, combinar con RUTs de cl_res.
              El dry-run usa keywords ICP por defecto.
            </li>
            <li>Flujo B2G: cl_res → RUT → BuscarProveedor → CódigoProveedor → señal completa.</li>
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
        {report && <ChileCompraReportView report={report} />}
      </PanelRunResult>

      <PanelDisclaimer>
        No escribe en Supabase. No crea candidatos. No crea lotes. No sincroniza HubSpot.
      </PanelDisclaimer>
    </SourcePanel>
  );
}
