'use client';

import { useState, useTransition } from 'react';
import {
  FlaskConical,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  runChileCompraOcdsHealthCheckAction,
  runChileCompraOcdsDryRunAction,
} from '@/modules/source-catalog/source-credential-actions';
import type {
  ChileCompraOcdsHealthCheckReport,
  ChileCompraOcdsDryRunReport,
} from '@/server/source-catalog/connectors/chilecompra-ocds/types';

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
      <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No se pudo consultar la fuente OCDS. {report.error}. No se escribió ningún dato.
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-success/20 bg-success/10 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        Fuente operativa. {report.totalMonthProcesses ?? 0} procesos en {report.month}/{report.year}.
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="mb-0.5 text-xs font-medium text-muted-foreground">Total mes</dt>
          <dd className="tabular-nums text-foreground">{report.totalMonthProcesses ?? '—'}</dd>
        </div>
        <div>
          <dt className="mb-0.5 text-xs font-medium text-muted-foreground">Limit</dt>
          <dd className="tabular-nums text-foreground">{report.limit}</dd>
        </div>
        <div>
          <dt className="mb-0.5 text-xs font-medium text-muted-foreground">Offset</dt>
          <dd className="tabular-nums text-foreground">{report.offset}</dd>
        </div>
        <div>
          <dt className="mb-0.5 text-xs font-medium text-muted-foreground">Escrituras</dt>
          <dd className="tabular-nums text-foreground">{report.writes_performed}</dd>
        </div>
      </dl>
      {report.firstOcids.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-foreground">
            Primeros ocid
          </p>
          <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
            {report.firstOcids.map((ocid) => (
              <li key={ocid} className="truncate">{ocid}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{report.message}</p>
    </div>
  );
}

// ─── Dry-run result ──────────────────────────────────────────────────────────────

function SummaryCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function DryRunResult({ report }: { report: ChileCompraOcdsDryRunReport }) {
  const s = report.summary;

  if (report.items.length === 0) {
    // Distinguir "el mes no trae procesos" de "hay procesos pero todos los
    // detalles fallaron al normalizarse" (p. ej. tender id mal construido).
    const listedButDetailsFailed = s.listed_count > 0;
    return (
      <div className="space-y-3">
        <EmptyState
          icon={Inbox}
          className="p-6"
          title={
            listedButDetailsFailed
              ? 'Se encontraron procesos, pero no fue posible normalizar los detalles.'
              : 'No se encontraron procesos para el mes consultado.'
          }
        />
        {report.warnings.map((w, i) => (
          <p key={i} className="text-xs text-warning">{w}</p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 sm:grid-cols-5">
        <SummaryCell label="Muestra" value={s.requested_sample_size} />
        <SummaryCell label="Listados" value={s.listed_count} />
        <SummaryCell label="Detalles OK" value={s.details_success} />
        <SummaryCell label="Detalles fallidos" value={s.details_failed} />
        <SummaryCell label="Total mes" value={s.total_month_processes ?? '—'} />
        <SummaryCell label="Adjudicados" value={s.awarded_count} />
        <SummaryCell label="Proveedores" value={s.suppliers_detected_count} />
        <SummaryCell label="Compradores únicos" value={s.unique_buyers_count} />
        <SummaryCell label="Proveedores únicos" value={s.unique_suppliers_count} />
        <SummaryCell label="Escrituras" value={s.writes_performed} />
      </dl>

      {report.warnings.length > 0 && (
        <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 space-y-0.5">
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning">{w}</p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-surface-subtle text-left text-xs text-muted-foreground">
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">ocid</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">Título</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">Comprador</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">RUT comprador</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">Monto</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">Estado</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">UNSPSC</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">Proveedor adjudicado</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">Fuente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {report.items.map((item) => (
              <tr key={item.ocid} className="align-top transition-colors hover:bg-surface-muted">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.ocid}</td>
                <td className="px-3 py-2 text-foreground">{item.tender_title ?? '—'}</td>
                <td className="px-3 py-2 text-foreground">{item.buyer_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{item.buyer_rut ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">
                  {formatAmount(item.tender_value_amount, item.tender_value_currency)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{item.tender_status ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {item.unspsc_codes.length > 0 ? item.unspsc_codes.join(', ') : '—'}
                </td>
                <td className="px-3 py-2 text-foreground">
                  {item.awarded_supplier_name ?? '—'}
                  {item.awarded_supplier_rut && (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      ({item.awarded_supplier_rut})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    Ver
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <SurfaceCard>
      <div className="mb-5 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
          <FlaskConical className="h-4 w-4" />
        </span>
        <SurfaceCardHeader
          title="ChileCompra OCDS — Vista read-only"
          description="Datos abiertos de compras públicas de Chile (OCDS). Señal B2G — no escribe datos ni genera prospectos."
          className="mb-0 min-w-0 flex-1 flex-wrap"
        />
      </div>

      <div className="space-y-4">
        {/* Advertencia visible */}
        <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Fuente pública abierta, sin credenciales. No escribe datos en SellUp ni genera prospectos automáticamente.
        </div>

        {/* Controles año/mes/muestra */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-foreground">Año</span>
            <Input
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(e) => setYear(Number(e.target.value))}
              inputSize="sm"
              className="w-24 tabular-nums"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-foreground">Mes</span>
            <Input
              type="number"
              value={month}
              min={1}
              max={12}
              onChange={(e) => setMonth(Number(e.target.value))}
              inputSize="sm"
              className="w-20 tabular-nums"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-foreground">Muestra (máx 20)</span>
            <Input
              type="number"
              value={sampleSize}
              min={1}
              max={20}
              onChange={(e) => setSampleSize(Number(e.target.value))}
              inputSize="sm"
              className="w-24 tabular-nums"
            />
          </label>
        </div>

        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo administradores pueden ejecutar verificaciones de fuente.
          </div>
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

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {healthReport && <HealthCheckResult report={healthReport} />}
        {dryReport && <DryRunResult report={dryReport} />}

        <div className="flex items-start gap-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No escribe en Supabase. No crea cuentas, candidatos ni oportunidades. No toca el connector ChileCompra legacy.
        </div>
      </div>
    </SurfaceCard>
  );
}
