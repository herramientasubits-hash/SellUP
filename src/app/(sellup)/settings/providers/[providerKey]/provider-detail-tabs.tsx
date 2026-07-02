'use client';

import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  getProviderOperationalContext,
  getProviderConfigSummary,
  OPERATIONAL_TYPE_LABEL,
  OPERATIONAL_TYPE_BADGE,
} from '@/modules/budgets/provider-operational-type';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { BudgetRule } from '@/modules/usage-tracking/types';
import type {
  ProviderUsageLogRow,
  ProviderSyncLogRow,
} from '@/modules/budgets/provider-detail-queries';

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmt(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Quota display state (mirrors budget-providers-table) ─────────────────────

type QuotaDisplayState = 'api_synced' | 'manual' | 'manual_required' | 'sync_error_partial' | 'none';

function deriveQuotaDisplayState(row: AdminProviderBudgetRow): QuotaDisplayState {
  const hasAllowance =
    row.providerMonthlyCreditsAllowance != null || row.providerMonthlyUsdAllowance != null;
  if (row.quotaSource === 'api_synced') return 'api_synced';
  if (row.quotaSource === 'manual') return 'manual';
  if (row.quotaSource === 'sync_error')
    return hasAllowance ? 'sync_error_partial' : 'manual_required';
  return 'none';
}

const QUOTA_BADGE: Record<QuotaDisplayState, { label: string; className: string }> = {
  api_synced:         { label: 'API synced',         className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  manual:             { label: 'Manual',             className: 'border-su-brand/30 bg-su-brand-soft text-su-brand' },
  manual_required:    { label: 'Manual requerido',   className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  sync_error_partial: { label: 'Sync no disponible', className: 'border-border/40 bg-muted/20 text-muted-foreground/70' },
  none:               { label: 'No configurado',     className: 'border-border/30 bg-muted/20 text-muted-foreground/60' },
};

function QuotaBadge({ state }: { state: QuotaDisplayState }) {
  const { label, className } = QUOTA_BADGE[state];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

// ─── Stat block ───────────────────────────────────────────────────────────────

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

// ─── Tab: Resumen ─────────────────────────────────────────────────────────────

function TabResumen({ row }: { row: AdminProviderBudgetRow }) {
  const ms: MeasurementStatus = row.measurementStatus;
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const quotaState = deriveQuotaDisplayState(row);
  const isNotMeasured = ms === 'not_measured';
  const isIAProvider = opType === 'ia';

  const consumo = isNotMeasured
    ? '—'
    : fmt(
        row.consumedCredits > 0 ? row.consumedCredits : null,
        row.consumedUsd > 0 ? row.consumedUsd : null,
      ) || '0 cr';

  const allowance = fmt(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const available = fmt(row.providerCreditsAvailable, row.providerUsdAvailable);

  return (
    <div className="space-y-4">
      {/* Estado y tipo */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <p className="text-base font-semibold text-foreground">Estado operativo</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <StatBlock
              label="Tipo"
              value={OPERATIONAL_TYPE_LABEL[opType]}
            />
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Medición
              </p>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${msBadge.className}`}
              >
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Fuente cuota
              </p>
              <QuotaBadge state={quotaState} />
            </div>
            <StatBlock
              label="Configuración"
              value={getProviderConfigSummary(row.providerKey)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            {getProviderOperationalContext(row.providerKey)}
          </p>
        </div>
      </SurfaceCard>

      {/* Consumo y cuota del mes */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <p className="text-base font-semibold text-foreground">Período actual</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <StatBlock
              label="Consumo del mes"
              value={isNotMeasured ? 'No aplica' : consumo}
            />
            <StatBlock
              label="Cuota / Presupuesto"
              value={isNotMeasured ? 'No aplica' : allowance}
              sub={
                quotaState === 'api_synced' && row.quotaSyncedAt
                  ? `Sync: ${fmtDateShort(row.quotaSyncedAt)}`
                  : undefined
              }
            />
            <StatBlock
              label="Disponible"
              value={
                isNotMeasured
                  ? 'No aplica'
                  : available === '—'
                    ? 'Sin configurar'
                    : available
              }
            />
            {row.creditsRemainingExternal != null && (
              <StatBlock
                label="Créditos externos"
                value={`${row.creditsRemainingExternal.toLocaleString()} cr`}
                sub="Reportado por proveedor"
              />
            )}
            {row.usdCostMtd != null && (
              <StatBlock
                label="Costo MTD (API)"
                value={`$${row.usdCostMtd.toFixed(2)}`}
                sub="Mes hasta hoy"
              />
            )}
          </div>

          {/* Notas por proveedor */}
          {quotaState === 'manual_required' && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {row.providerKey === 'anthropic'
                  ? 'Presupuesto USD manual requerido. El costo API requiere credencial Admin para automatizar.'
                  : 'Cuota manual requerida. Sync API no disponible con la credencial actual.'}
              </p>
            </div>
          )}
          {isNotMeasured && (
            <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Este proveedor no está siendo medido como consumo directo desde SellUp.
                {row.providerKey === 'samu_ia' &&
                  ' Para medirlo se requeriría instrumentación de logs en el flujo post-reunión.'}
              </p>
            </div>
          )}
          {isIAProvider && !isNotMeasured && (
            <p className="text-[11px] text-muted-foreground/60">
              Modelos, tarifas y configuración LLM disponibles en{' '}
              <Link
                href="/settings/providers?tab=ia"
                className="text-su-brand hover:underline font-medium"
              >
                Configuración IA →
              </Link>
            </p>
          )}
        </div>
      </SurfaceCard>

      {/* Última actividad */}
      {row.latestBudgetCheckLog && (
        <SurfaceCard>
          <div className="p-6 space-y-3">
            <p className="text-base font-semibold text-foreground">Última evaluación de presupuesto</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 text-sm">
              <StatBlock
                label="Operación"
                value={row.latestBudgetCheckLog.operationKey ?? 'General'}
              />
              <StatBlock
                label="Créditos usados"
                value={
                  row.latestBudgetCheckLog.creditsUsed != null
                    ? `${row.latestBudgetCheckLog.creditsUsed.toLocaleString()} cr`
                    : '—'
                }
              />
              <StatBlock
                label="Fecha"
                value={fmtDateShort(row.latestBudgetCheckLog.createdAt)}
              />
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}

// ─── Tab: Presupuesto y reglas ─────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
  global: 'Global',
  user: 'Usuario',
  group: 'Grupo',
  role: 'Rol',
};

const ON_EXCEED_LABELS: Record<string, string> = {
  alert: 'Alertar',
  block: 'Bloquear',
  require_approval: 'Requiere aprobación',
};

function TabPresupuesto({
  row,
  activeRules,
}: {
  row: AdminProviderBudgetRow;
  activeRules: BudgetRule[];
}) {
  const quotaState = deriveQuotaDisplayState(row);
  const isNotMeasured = row.measurementStatus === 'not_measured';

  return (
    <div className="space-y-4">
      {/* Cuota y disponibilidad */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <p className="text-base font-semibold text-foreground">Cuota del proveedor</p>
          {isNotMeasured ? (
            <p className="text-sm text-muted-foreground">No aplica para este proveedor.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Fuente
                  </p>
                  <QuotaBadge state={quotaState} />
                </div>
                <StatBlock
                  label="Créditos mensuales"
                  value={
                    row.providerMonthlyCreditsAllowance != null
                      ? `${row.providerMonthlyCreditsAllowance.toLocaleString()} cr`
                      : 'No configurado'
                  }
                />
                <StatBlock
                  label="Presupuesto USD"
                  value={
                    row.providerMonthlyUsdAllowance != null
                      ? `$${row.providerMonthlyUsdAllowance.toFixed(2)}`
                      : 'No configurado'
                  }
                />
                <StatBlock
                  label="Créditos disponibles"
                  value={
                    row.providerCreditsAvailable != null
                      ? `${row.providerCreditsAvailable.toLocaleString()} cr`
                      : '—'
                  }
                />
                <StatBlock
                  label="USD disponible"
                  value={
                    row.providerUsdAvailable != null
                      ? `$${row.providerUsdAvailable.toFixed(2)}`
                      : '—'
                  }
                />
                {row.quotaSyncedAt && (
                  <StatBlock
                    label="Última sync"
                    value={fmtDateShort(row.quotaSyncedAt)}
                  />
                )}
              </div>
              {row.quotaSyncError && (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <p className="text-xs text-amber-600 dark:text-amber-400">{row.quotaSyncError}</p>
                </div>
              )}
              <div className="pt-1">
                <Link href="/settings/providers">
                  <Button variant="outline" size="sm" className="text-xs">
                    Configurar cuota en tabla →
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </SurfaceCard>

      {/* Reglas activas */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-foreground">
              Reglas activas
              {activeRules.length > 0 && (
                <span className="ml-2 text-[10px] font-medium rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-muted-foreground">
                  {activeRules.length}
                </span>
              )}
            </p>
            <Link href="/settings/budget-credits/rules">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                Gestionar reglas →
              </Button>
            </Link>
          </div>

          {activeRules.length === 0 ? (
            <EmptyState message="No hay reglas configuradas para este proveedor." />
          ) : (
            <div className="space-y-2">
              {activeRules.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 text-xs"
                >
                  <StatBlock
                    label="Alcance"
                    value={SCOPE_LABELS[rule.scope_type] ?? rule.scope_type}
                  />
                  <StatBlock
                    label="Período"
                    value={rule.period_type === 'monthly' ? 'Mensual' : rule.period_type}
                  />
                  <StatBlock
                    label="Límite"
                    value={fmt(rule.limit_credits, rule.limit_usd)}
                  />
                  <StatBlock
                    label="Si excede"
                    value={ON_EXCEED_LABELS[rule.on_exceed] ?? rule.on_exceed}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}

// ─── Tab: Uso y logs ──────────────────────────────────────────────────────────

function TabLogs({
  usageLogs,
  syncLogs,
  providerKey,
}: {
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  providerKey: string;
}) {
  const hasSyncLogs = ['tavily', 'lusha', 'apollo', 'anthropic'].includes(providerKey);

  return (
    <div className="space-y-4">
      {/* Usage logs */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <p className="text-base font-semibold text-foreground">Actividad reciente (provider_usage_logs)</p>
          {usageLogs.length === 0 ? (
            <EmptyState
              message="No hay actividad reciente para este proveedor."
              sub="Los registros aparecen después de la primera ejecución desde SellUp."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Fecha</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Operación</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Créditos</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Costo USD</th>
                    <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {usageLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/10">
                      <td className="py-2 pr-4 text-muted-foreground/70 whitespace-nowrap">
                        {fmtDateShort(log.createdAt)}
                      </td>
                      <td className="py-2 pr-4 text-foreground">
                        {log.operationKey ?? '—'}
                      </td>
                      <td className="py-2 pr-4 text-foreground">
                        {log.creditsUsed != null ? `${log.creditsUsed.toLocaleString()} cr` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-foreground">
                        {log.estimatedCostUsd != null ? `$${log.estimatedCostUsd.toFixed(4)}` : '—'}
                      </td>
                      <td className="py-2 text-muted-foreground/70 capitalize">
                        {log.status ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Sync logs */}
      {hasSyncLogs && (
        <SurfaceCard>
          <div className="p-6 space-y-4">
            <p className="text-base font-semibold text-foreground">Historial de sincronización (tool_quota_sync_logs)</p>
            {syncLogs.length === 0 ? (
              <EmptyState
                message="No hay sincronizaciones registradas."
                sub="Ejecuta un sync desde la tabla de proveedores para registrar actividad."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Fecha</th>
                      <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Estado</th>
                      <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Fuente</th>
                      <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">HTTP</th>
                      <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Créditos externos</th>
                      <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Costo MTD</th>
                      <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {syncLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/10">
                        <td className="py-2 pr-4 text-muted-foreground/70 whitespace-nowrap">
                          {fmtDate(log.syncedAt)}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                              log.syncStatus === 'success'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-destructive/30 bg-destructive/10 text-destructive'
                            }`}
                          >
                            {log.syncStatus ?? '—'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground/70">
                          {log.source ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground/70">
                          {log.httpStatus ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-foreground">
                          {log.creditsRemainingExternal != null
                            ? `${log.creditsRemainingExternal.toLocaleString()} cr`
                            : '—'}
                        </td>
                        <td className="py-2 pr-4 text-foreground">
                          {log.usdCostMtd != null ? `$${log.usdCostMtd.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 text-destructive text-[10px] max-w-[200px] truncate">
                          {log.errorMessage ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  row: AdminProviderBudgetRow;
  activeRules: BudgetRule[];
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
}

export function ProviderDetailTabs({ row, activeRules, usageLogs, syncLogs }: Props) {
  return (
    <Tabs defaultValue="resumen" className="space-y-6">
      <TabsList className="bg-muted/50">
        <TabsTrigger value="resumen">Resumen</TabsTrigger>
        <TabsTrigger value="presupuesto">Presupuesto y reglas</TabsTrigger>
        <TabsTrigger value="logs">Uso y logs</TabsTrigger>
      </TabsList>

      <TabsContent value="resumen">
        <TabResumen row={row} />
      </TabsContent>

      <TabsContent value="presupuesto">
        <TabPresupuesto row={row} activeRules={activeRules} />
      </TabsContent>

      <TabsContent value="logs">
        <TabLogs
          usageLogs={usageLogs}
          syncLogs={syncLogs}
          providerKey={row.providerKey}
        />
      </TabsContent>
    </Tabs>
  );
}
