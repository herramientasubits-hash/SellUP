'use client';

import { useState, useTransition } from 'react';
import { FlaskConical, Loader2, ShieldCheck, ExternalLink, Inbox } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/forms/field';
import { NumberField } from '@/components/forms/number-field';
import {
  runChileCompraOcdsHealthCheckAction,
  runChileCompraOcdsDryRunAction,
} from '@/modules/source-catalog/source-credential-actions';
import type {
  ChileCompraOcdsHealthCheckReport,
  ChileCompraOcdsDryRunReport,
} from '@/server/source-catalog/connectors/chilecompra-ocds/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AdminOnlyNotice,
  PanelDisclaimer,
  PanelSummary,
  PanelSummaryItem,
  PanelWarnings,
  SourcePanel,
} from './source-panel-parts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const CURRENT_MONTH = now.getMonth() + 1;

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  const formatted = new Intl.NumberFormat('es-CL').format(amount);
  return currency ? `${formatted} ${currency}` : formatted;
}

// ─── Health-check result ────────────────────────────────────────────────────────

function HealthCheckResult({ report }: { report: ChileCompraOcdsHealthCheckReport }) {
  if (report.status !== 'operational') {
    return (
      <Alert variant="destructive">
        No se pudo consultar la fuente OCDS. {report.error}. No se escribió ningún dato.
      </Alert>
    );
  }
  return (
    <div className="space-y-3">
      <Alert variant="success">
        <AlertTitle>
          Fuente operativa. {report.totalMonthProcesses ?? 0} procesos en {report.month}/{report.year}.
        </AlertTitle>
        <AlertDescription className="text-xs">{report.message}</AlertDescription>
      </Alert>
      <PanelSummary>
        <PanelSummaryItem label="Total mes" value={report.totalMonthProcesses ?? '—'} />
        <PanelSummaryItem label="Limit" value={report.limit} />
        <PanelSummaryItem label="Offset" value={report.offset} />
        <PanelSummaryItem label="Escrituras" value={report.writes_performed} />
        {report.firstOcids.length > 0 && (
          <PanelSummaryItem
            wide
            mono
            label="Primeros ocid"
            value={
              <ul className="space-y-0.5 text-muted-foreground">
                {report.firstOcids.map((ocid) => (
                  <li key={ocid} className="truncate">{ocid}</li>
                ))}
              </ul>
            }
          />
        )}
      </PanelSummary>
    </div>
  );
}

// ─── Dry-run result ──────────────────────────────────────────────────────────────

function DryRunResult({ report }: { report: ChileCompraOcdsDryRunReport }) {
  const s = report.summary;

  if (report.items.length === 0) {
    // Distinguir "el mes no trae procesos" de "hay procesos pero todos los
    // detalles fallaron al normalizarse" (p. ej. tender id mal construido).
    const listedButDetailsFailed = s.listed_count > 0;
    return (
      <div className="space-y-3">
        <EmptyState
          variant="plain"
          icon={Inbox}
          title={
            listedButDetailsFailed
              ? 'Se encontraron procesos, pero no fue posible normalizar los detalles.'
              : 'No se encontraron procesos para el mes consultado.'
          }
        />
        <PanelWarnings warnings={report.warnings} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PanelSummary columns={5}>
        <PanelSummaryItem label="Muestra" value={s.requested_sample_size} />
        <PanelSummaryItem label="Listados" value={s.listed_count} />
        <PanelSummaryItem label="Detalles OK" value={s.details_success} />
        <PanelSummaryItem label="Detalles fallidos" value={s.details_failed} />
        <PanelSummaryItem label="Total mes" value={s.total_month_processes ?? '—'} />
        <PanelSummaryItem label="Adjudicados" value={s.awarded_count} />
        <PanelSummaryItem label="Proveedores" value={s.suppliers_detected_count} />
        <PanelSummaryItem label="Compradores únicos" value={s.unique_buyers_count} />
        <PanelSummaryItem label="Proveedores únicos" value={s.unique_suppliers_count} />
        <PanelSummaryItem label="Escrituras" value={s.writes_performed} />
      </PanelSummary>

      <PanelWarnings warnings={report.warnings} />

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <Table className="min-w-[760px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">ocid</TableHead>
              <TableHead scope="col">Título</TableHead>
              <TableHead scope="col">Comprador</TableHead>
              <TableHead scope="col">RUT comprador</TableHead>
              <TableHead scope="col" className="text-right">Monto</TableHead>
              <TableHead scope="col">Estado</TableHead>
              <TableHead scope="col">UNSPSC</TableHead>
              <TableHead scope="col">Proveedor adjudicado</TableHead>
              <TableHead scope="col">Fuente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.items.map((item) => (
              <TableRow key={item.ocid} className="[&>td]:align-top">
                <TableCell className="font-mono text-xs text-muted-foreground">{item.ocid}</TableCell>
                <TableCell className="whitespace-normal text-foreground">{item.tender_title ?? '—'}</TableCell>
                <TableCell className="whitespace-normal text-foreground">{item.buyer_name ?? '—'}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{item.buyer_rut ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-foreground">
                  {formatAmount(item.tender_value_amount, item.tender_value_currency)}
                </TableCell>
                <TableCell className="text-muted-foreground">{item.tender_status ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs whitespace-normal text-muted-foreground">
                  {item.unspsc_codes.length > 0 ? item.unspsc_codes.join(', ') : '—'}
                </TableCell>
                <TableCell className="whitespace-normal text-foreground">
                  {item.awarded_supplier_name ?? '—'}
                  {item.awarded_supplier_rut && (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      ({item.awarded_supplier_rut})
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    Ver
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">{report.message}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  isAdmin: boolean;
}

export function ChileCompraOcdsDryRunPanel({ isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [runningMode, setRunningMode] = useState<'health' | 'dryrun' | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [sampleSize, setSampleSize] = useState(5);

  const [healthReport, setHealthReport] = useState<ChileCompraOcdsHealthCheckReport | null>(null);
  const [dryReport, setDryReport] = useState<ChileCompraOcdsDryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleHealthCheck() {
    setError(null);
    setHealthReport(null);
    setRunningMode('health');
    startTransition(async () => {
      const result = await runChileCompraOcdsHealthCheckAction({ year, month, limit: 5 });
      if (result.report) {
        setHealthReport(result.report);
      } else {
        setError(result.error ?? 'No se pudo consultar la fuente OCDS. No se escribió ningún dato.');
      }
      setRunningMode(null);
    });
  }

  function handleDryRun() {
    setError(null);
    setDryReport(null);
    setRunningMode('dryrun');
    startTransition(async () => {
      const result = await runChileCompraOcdsDryRunAction({ year, month, sampleSize });
      if (result.ok && result.report) {
        setDryReport(result.report);
      } else {
        setError(result.error ?? 'No se pudo consultar la fuente OCDS. No se escribió ningún dato.');
      }
      setRunningMode(null);
    });
  }

  return (
    <SourcePanel
      icon={FlaskConical}
      title="ChileCompra OCDS — Vista read-only"
      description="Datos abiertos de compras públicas de Chile (OCDS). Señal B2G — no escribe datos ni genera prospectos."
    >
      <Alert variant="warning">
        Fuente pública abierta, sin credenciales. No escribe datos en SellUp ni genera prospectos automáticamente.
      </Alert>

      {/* Qué mes consultar y cuántos procesos traer */}
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Año" className="w-32">
          <NumberField
            size="sm"
            value={year}
            min={2000}
            max={2100}
            onValueChange={(value) => setYear(value ?? 0)}
          />
        </Field>
        <Field label="Mes" className="w-28">
          <NumberField
            size="sm"
            value={month}
            min={1}
            max={12}
            onValueChange={(value) => setMonth(value ?? 0)}
          />
        </Field>
        <Field label="Muestra" description="Máximo 20 procesos." className="w-36">
          <NumberField
            size="sm"
            value={sampleSize}
            min={1}
            max={20}
            onValueChange={(value) => setSampleSize(value ?? 0)}
          />
        </Field>
      </div>

      {!isAdmin && (
        <AdminOnlyNotice>Solo administradores pueden ejecutar verificaciones de fuente.</AdminOnlyNotice>
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleHealthCheck} disabled={isPending}>
            {isPending && runningMode === 'health' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Verificando…
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5" />
                Verificar fuente
              </>
            )}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleDryRun} disabled={isPending}>
            {isPending && runningMode === 'dryrun' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Previsualizando…
              </>
            ) : (
              <>
                <FlaskConical className="h-3.5 w-3.5" />
                Previsualizar procesos
              </>
            )}
          </Button>
        </div>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}

      {healthReport && <HealthCheckResult report={healthReport} />}
      {dryReport && <DryRunResult report={dryReport} />}

      <PanelDisclaimer>
        No escribe en Supabase. No crea cuentas, candidatos ni oportunidades. No toca el connector ChileCompra legacy.
      </PanelDisclaimer>
    </SourcePanel>
  );
}
