'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Plus, Pencil, Power, Trash2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import type { AiProviderDetailResult } from '@/modules/ai-config/provider-ai-detail-queries';
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
import { toggleBudgetRuleStatus, archiveBudgetRule } from '@/modules/budgets/rule-actions';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/provider-detail-queries';
import type {
  ProviderUsageLogRow,
  ProviderSyncLogRow,
} from '@/modules/budgets/provider-detail-queries';
import { ProviderAllowanceDrawer } from '@/app/(sellup)/settings/budget-credits/provider-allowance-drawer';
import { CreateDrawer, EditDrawer } from '@/app/(sellup)/settings/budget-credits/rules/budget-rules-client';

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
              Modelos, tarifas y estado de conexión disponibles en la pestaña{' '}
              <span className="font-medium text-foreground">Modelos y tarifas</span>.
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

const ON_EXCEED_LABELS: Record<string, string> = {
  alert: 'Alertar',
  block: 'Bloquear',
  require_approval: 'Requiere aprobación',
};

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
  custom: 'Personalizado',
};

function formatLimit(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function getQuotaButtonLabel(providerKey: string, row: AdminProviderBudgetRow): string | null {
  if (row.measurementStatus === 'not_measured') return null;
  const hasAllowance =
    row.providerMonthlyCreditsAllowance != null || row.providerMonthlyUsdAllowance != null;
  switch (providerKey) {
    case 'tavily':
    case 'lusha':
      return 'Editar cuota';
    case 'apollo':
      return hasAllowance ? 'Editar cuota manual' : 'Configurar cuota manual';
    case 'anthropic':
      return hasAllowance ? 'Editar presupuesto USD' : 'Configurar presupuesto USD';
    case 'openai':
    case 'gemini':
      return 'Configurar presupuesto';
    default:
      return hasAllowance ? 'Editar cuota' : 'Configurar cuota';
  }
}

// ─── Provider rules section ───────────────────────────────────────────────────

function ProviderRulesSection({
  rules,
  options,
  providerKey,
  isNotMeasured,
  onRefresh,
}: {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
  providerKey: string;
  isNotMeasured: boolean;
  onRefresh: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<BudgetRuleRow | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<BudgetRuleRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    onRefresh();
  }

  async function handleArchive(rule: BudgetRuleRow) {
    setArchiving(rule.id);
    setArchiveError(null);
    const result = await archiveBudgetRule(rule.id);
    setArchiving(null);
    if (!result.success) {
      setArchiveError(result.error ?? 'Error al eliminar la regla.');
      return;
    }
    setConfirmArchive(null);
    onRefresh();
  }

  if (isNotMeasured) {
    return (
      <SurfaceCard>
        <div className="p-6">
          <p className="text-base font-semibold text-foreground mb-2">Reglas de presupuesto</p>
          <p className="text-sm text-muted-foreground">
            Las reglas no aplican para este proveedor en esta fase.
          </p>
        </div>
      </SurfaceCard>
    );
  }

  return (
    <>
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-foreground">Reglas de presupuesto</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Estas reglas aplican a este proveedor. Aún no bloquean ejecuciones salvo que la regla lo indique en fases futuras.
              </p>
            </div>
            <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5" />
              Crear regla
            </Button>
          </div>

          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 py-10 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                No hay reglas configuradas para este proveedor.
              </p>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                Crear primera regla
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {['Alcance', 'Límite', 'Período', 'Si excede', 'Estado', 'Acciones'].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {rules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {rule.scopeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground text-xs">
                        {formatLimit(rule.limit_credits, rule.limit_usd)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {PERIOD_LABELS[rule.period_type] ?? rule.period_type}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {ON_EXCEED_LABELS[rule.on_exceed] ?? rule.on_exceed}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                            rule.is_active
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                              : 'border-border/40 bg-muted/30 text-muted-foreground'
                          }`}
                        >
                          {rule.is_active ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => setEditRule(rule)}
                          >
                            <Pencil className="h-3 w-3" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            disabled={toggling === rule.id}
                            onClick={() => handleToggle(rule)}
                          >
                            <Power className="h-3 w-3" />
                            {rule.is_active ? 'Desactivar' : 'Activar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                            disabled={archiving === rule.id}
                            onClick={() => setConfirmArchive(rule)}
                          >
                            <Trash2 className="h-3 w-3" />
                            Eliminar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Archive confirmation */}
      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmArchive(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border/60 bg-card shadow-lg p-6 space-y-4 mx-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">¿Eliminar esta regla?</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                La regla ({confirmArchive.scopeLabel}) dejará de aplicarse.
              </p>
            </div>
            {archiveError && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {archiveError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setConfirmArchive(null); setArchiveError(null); }}
                disabled={archiving === confirmArchive.id}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={archiving === confirmArchive.id}
                onClick={() => handleArchive(confirmArchive)}
              >
                {archiving === confirmArchive.id ? 'Eliminando...' : 'Eliminar regla'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <CreateDrawer
        options={options}
        open={showCreate}
        onOpenChange={setShowCreate}
        defaultProviderKey={providerKey}
        onSuccess={onRefresh}
      />
      <EditDrawer
        rule={editRule}
        open={!!editRule}
        onOpenChange={(v) => { if (!v) setEditRule(null); }}
        onSuccess={onRefresh}
      />
    </>
  );
}

// ─── TabPresupuesto ────────────────────────────────────────────────────────────

function TabPresupuesto({
  row,
  allRules,
  options,
  onRefresh,
}: {
  row: AdminProviderBudgetRow;
  allRules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
  onRefresh: () => void;
}) {
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const quotaState = deriveQuotaDisplayState(row);
  const isNotMeasured = row.measurementStatus === 'not_measured';
  const quotaButtonLabel = getQuotaButtonLabel(row.providerKey, row);

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
              {quotaButtonLabel && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setAllowanceOpen(true)}
                  >
                    {quotaButtonLabel}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SurfaceCard>

      {/* Reglas de presupuesto */}
      <ProviderRulesSection
        rules={allRules}
        options={options}
        providerKey={row.providerKey}
        isNotMeasured={isNotMeasured}
        onRefresh={onRefresh}
      />

      <ProviderAllowanceDrawer
        provider={row}
        open={allowanceOpen}
        onClose={() => setAllowanceOpen(false)}
        onSaved={() => { setAllowanceOpen(false); onRefresh(); }}
      />
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

// ─── Tab: Modelos y tarifas ───────────────────────────────────────────────────

const CONNECTION_BADGE: Record<string, { label: string; className: string }> = {
  connected:      { label: 'Conectado',          className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  not_tested:     { label: 'Sin probar',          className: 'border-border/40 bg-muted/20 text-muted-foreground/70' },
  not_configured: { label: 'Pendiente conexión',  className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  error:          { label: 'Error de conexión',   className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

const MODEL_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active:   { label: 'Activo',   className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  inactive: { label: 'Inactivo', className: 'border-border/40 bg-muted/20 text-muted-foreground/60' },
};

function fmtDateShortLocal(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtTokens(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

function fmtPrice(val: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(val);
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const badge = CONNECTION_BADGE[status] ?? {
    label: status,
    className: 'border-border/40 bg-muted/20 text-muted-foreground/60',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

function TabModelosYTarifas({ aiDetail }: { aiDetail: AiProviderDetailResult }) {
  const { models, isActiveProviderGlobal, activeModelKey, connectionStatus, providerStatus, providerKey } = aiDetail;

  const providerStatusBadge = isActiveProviderGlobal
    ? { label: 'Activo global', className: 'border-su-brand/30 bg-su-brand-soft text-su-brand' }
    : { label: 'No activo global', className: 'border-border/40 bg-muted/20 text-muted-foreground/60' };

  const hasModels = models.length > 0;

  return (
    <div className="space-y-4">
      {/* Configuración activa */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <p className="text-base font-semibold text-foreground">Configuración activa</p>
          <p className="text-[11px] text-muted-foreground/70">
            Esta configuración controla qué proveedor/modelo LLM usa SellUp por defecto.
          </p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Proveedor global
              </p>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${providerStatusBadge.className}`}
              >
                {providerStatusBadge.label}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Conexión
              </p>
              <ConnectionStatusBadge status={connectionStatus} />
            </div>
            <StatBlock
              label="Estado del proveedor"
              value={providerStatus === 'active' ? 'Activo' : providerStatus === 'inactive' ? 'Inactivo' : providerStatus}
            />
          </div>

          {/* Modelo activo global */}
          <div className="rounded-md border border-border/30 bg-muted/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">
              Modelo activo global
            </p>
            {isActiveProviderGlobal && activeModelKey ? (
              <p className="text-sm font-medium text-foreground font-mono">{activeModelKey}</p>
            ) : isActiveProviderGlobal ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">Sin modelo activo configurado para este proveedor.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Este proveedor no es el modelo activo del sistema.</p>
            )}
          </div>

          {/* Anthropic-specific note */}
          {providerKey === 'anthropic' && (
            <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Claude se mide principalmente en USD/tokens. El presupuesto mensual se configura manualmente en SellUp.
              </p>
            </div>
          )}

          {/* Not connected note */}
          {connectionStatus === 'not_configured' && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Proveedor preparado, pendiente de conexión. Configura la API key en Configuración IA.
              </p>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Tabla de modelos */}
      <SurfaceCard>
        <div className="p-6 space-y-4">
          <p className="text-base font-semibold text-foreground">Modelos disponibles</p>
          {!hasModels ? (
            <EmptyState message="No hay modelos configurados para este proveedor." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Modelo</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Estado</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Context window</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Input / 1M tokens</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Output / 1M tokens</th>
                    <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Vigente desde</th>
                    <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 whitespace-nowrap">Activo global</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {models.map((model) => {
                    const statusBadge =
                      MODEL_STATUS_BADGE[model.status] ??
                      MODEL_STATUS_BADGE.inactive;
                    return (
                      <tr key={model.id} className="hover:bg-muted/10">
                        <td className="py-2 pr-4">
                          <span className="font-mono text-foreground">{model.modelKey}</span>
                          {model.displayName !== model.modelKey && (
                            <span className="ml-1 text-muted-foreground/60">({model.displayName})</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge.className}`}
                          >
                            {statusBadge.label}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground/70">
                          {fmtTokens(model.contextWindow)}
                        </td>
                        <td className="py-2 pr-4 text-foreground">
                          {model.latestPricing
                            ? fmtPrice(model.latestPricing.inputPerMillion, model.latestPricing.currency)
                            : <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="py-2 pr-4 text-foreground">
                          {model.latestPricing
                            ? fmtPrice(model.latestPricing.outputPerMillion, model.latestPricing.currency)
                            : <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground/70 whitespace-nowrap">
                          {model.latestPricing ? fmtDateShortLocal(model.latestPricing.effectiveFrom) : '—'}
                        </td>
                        <td className="py-2 text-center">
                          {model.isActiveGlobalModel ? (
                            <span className="inline-flex items-center rounded-full border border-su-brand/30 bg-su-brand-soft px-2 py-0.5 text-[10px] font-medium text-su-brand">
                              Activo
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tarifas note + CTA */}
          <div className="flex items-center justify-between border-t border-border/30 pt-3">
            <p className="text-[11px] text-muted-foreground/60">
              Las tarifas se usan para estimar costos de IA y pueden actualizarse desde Configuración IA.
            </p>
            <Link href="/settings/providers?tab=ia">
              <Button variant="ghost" size="sm" className="text-xs text-su-brand hover:text-su-brand">
                Editar tarifas en Configuración IA →
              </Button>
            </Link>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  row: AdminProviderBudgetRow;
  allRules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  aiDetail?: AiProviderDetailResult | null;
  initialTab?: string;
}

export function ProviderDetailTabs({ row, allRules, options, usageLogs, syncLogs, aiDetail, initialTab }: Props) {
  const showAiTab = !!aiDetail;
  const router = useRouter();
  const pathname = usePathname();

  const VALID_TABS = showAiTab
    ? ['resumen', 'modelos', 'presupuesto', 'logs']
    : ['resumen', 'presupuesto', 'logs'];
  const resolvedInitial = initialTab && VALID_TABS.includes(initialTab) ? initialTab : 'resumen';
  const [activeTab, setActiveTab] = useState(resolvedInitial);

  function handleTabChange(value: string) {
    setActiveTab(value);
    router.replace(`${pathname}?tab=${value}`, { scroll: false });
  }

  function refreshBudgetTab() {
    setActiveTab('presupuesto');
    router.replace(`${pathname}?tab=presupuesto`, { scroll: false });
    router.refresh();
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
      <TabsList className="bg-muted/50">
        <TabsTrigger value="resumen">Resumen</TabsTrigger>
        {showAiTab && (
          <TabsTrigger value="modelos">Modelos y tarifas</TabsTrigger>
        )}
        <TabsTrigger value="presupuesto">Presupuesto y reglas</TabsTrigger>
        <TabsTrigger value="logs">Uso y logs</TabsTrigger>
      </TabsList>

      <TabsContent value="resumen">
        <TabResumen row={row} />
      </TabsContent>

      {showAiTab && (
        <TabsContent value="modelos">
          <TabModelosYTarifas aiDetail={aiDetail!} />
        </TabsContent>
      )}

      <TabsContent value="presupuesto">
        <TabPresupuesto row={row} allRules={allRules} options={options} onRefresh={refreshBudgetTab} />
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
