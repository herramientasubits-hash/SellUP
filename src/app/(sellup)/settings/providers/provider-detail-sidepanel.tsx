'use client';

import { useState, useEffect, useCallback, useTransition, useRef, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import {
  Activity, Settings, BarChart2, DollarSign, TrendingUp, ScrollText,
  ChevronDown, Cpu, Zap, Database, Bot, Plus, Pencil, Power, Trash2,
  Loader2, Lock, Check, ChevronDownIcon,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import type { BudgetScopeType, BudgetPeriodType, BudgetOnExceed } from '@/modules/usage-tracking/types';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
  MEASUREMENT_STATUS_DESCRIPTION,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  getProviderOperationalContext,
  OPERATIONAL_TYPE_LABEL,
  OPERATIONAL_TYPE_BADGE,
} from '@/modules/budgets/provider-operational-type';
import { parseBudgetCheck, SCOPE_LABEL } from '@/modules/budgets';
import { toggleBudgetRuleStatus, archiveBudgetRule } from '@/modules/budgets/rule-actions';
import { ProviderAllowanceDrawer } from '@/app/(sellup)/settings/budget-credits/provider-allowance-drawer';
import {
  CreateDrawer,
  EditDrawer,
} from '@/app/(sellup)/settings/budget-credits/rules/budget-rules-client';
import {
  loadProviderDetailForPanel,
  testAiProviderConnectionForPanel,
  updateAiProviderCredentialForPanel,
  disconnectAiProviderForPanel,
  loadProspectingProviderConnectionForPanel,
  testProspectingProviderConnectionForPanel,
  updateProspectingProviderCredentialForPanel,
  disconnectProspectingProviderForPanel,
  type SidepanelDetailData,
  type AiConnectionPanelState,
  type ProspectingConnectionPanelState,
} from './provider-detail-actions';
import { loadProviderConsumptionForWorkspace } from './provider-consumption-actions';
import type {
  ProviderConsumptionSnapshot,
  UsageFilters,
  ConsumptionErrorStage,
} from './provider-consumption-types';
import type { FilterUser, FilterGroup } from '@/modules/ai-usage/queries';
import type { ProviderUsageLogRow, ProviderSyncLogRow } from '@/modules/budgets/provider-detail-queries';
import type {
  ProviderOperationBreakdownRow,
  ProviderUserConsumptionBreakdownRow,
} from './provider-consumption-types';
import { getProviderOperationLabel } from '@/modules/budgets/operation-labels';
import { DataTable } from '@/components/data-table';
import {
  resolveCostDisplay,
  resolveRemainingCostDisplay,
  toCostTruth,
} from '@/modules/usage-tracking/cost-display';
import { CostValue } from '@/components/shared/cost-value';
import { summarizeProviderEffectiveness } from './provider-effectiveness-summary';

// ── Rule display constants ────────────────────────────────────────────────────

const PERIOD_LABELS: Record<BudgetPeriodType, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
  custom: 'Personalizado',
};

const ON_EXCEED_LABELS: Record<BudgetOnExceed, string> = {
  alert: 'Alertar',
  block: 'Bloquear',
  require_approval: 'Req. aprobación',
};

const SCOPE_SECTION_LABEL: Record<BudgetScopeType, string> = {
  global: 'Globales',
  role: 'Por rol',
  group: 'Por grupo',
  user: 'Por usuario',
};

function formatLimit(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

/** Truthful "consumido" label — a positive/zero USD subtotal with unknown cost truth renders with a '+'/"Costo desconocido" marker instead of a bare exact number. */
function deriveConsumedInfo(
  credits: number | null,
  usd: number,
  hasUnknownCost: boolean,
): { label: string; description?: string } {
  const usdDisplay =
    usd > 0 || hasUnknownCost
      ? resolveCostDisplay({
          valueUsd: usd,
          costTruth: toCostTruth(hasUnknownCost),
          formatUsd: (v) => `$${v.toFixed(2)}`,
        })
      : null;

  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usdDisplay) parts.push(usdDisplay.label);

  const label = parts.join(' · ') || '—';
  return { label, description: usdDisplay?.description ?? undefined };
}

/** Truthful "disponible por regla" label — remaining USD under unknown cost truth is not a reliable lower bound, so it renders as "Indeterminado" instead of an exact number. */
function deriveRemainingInfo(
  remainingCredits: number | null,
  remainingUsd: number | null,
  hasUnknownCost: boolean,
): { label: string; description?: string } {
  if (remainingUsd == null) return { label: formatAmount(remainingCredits, remainingUsd) };
  const usdDisplay = resolveRemainingCostDisplay(remainingUsd, toCostTruth(hasUnknownCost), (v) => `$${v.toFixed(2)}`);

  const parts: string[] = [];
  if (remainingCredits != null && remainingCredits > 0) parts.push(`${remainingCredits.toLocaleString()} cr`);
  parts.push(usdDisplay.label);

  return { label: parts.join(' · '), description: usdDisplay.description ?? undefined };
}

function formatAllowance(credits: number | null, usd: number | null): string {
  if (credits === null && usd === null) return 'No configurado';
  const parts: string[] = [];
  if (credits !== null) parts.push(`${credits.toLocaleString()} cr`);
  if (usd !== null) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/30 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground/60 font-medium shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-xs text-foreground text-right">{value}</span>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-0">
      {children}
    </div>
  );
}

function ProgressiveNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft px-4 py-3">
      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{children}</p>
    </div>
  );
}

function LoadingPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-6 flex items-center justify-center gap-2">
      <Loader2 className="h-3.5 w-3.5 text-muted-foreground/50 animate-spin" />
      <p className="text-xs text-muted-foreground/60">{label}</p>
    </div>
  );
}

function EmptyBlock({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-5 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
      {sub && <p className="text-[10px] text-muted-foreground/50 mt-1">{sub}</p>}
    </div>
  );
}

// Single consolidated empty state for the whole consumption snapshot (Q3F-9G
// Problema B) — replaces the KPI cards, operation breakdown, user breakdown
// and recent-operations blocks with one message instead of four separate
// empties, so a zero-consumption filter combination reads as one clear signal.
function GlobalConsumptionEmptyBlock() {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-6 text-center space-y-1">
      <p className="text-xs font-medium text-foreground">Sin consumo registrado</p>
      <p className="text-[10px] text-muted-foreground/60">
        No encontramos consumo de este proveedor para los filtros seleccionados.
      </p>
      <p className="text-[10px] text-muted-foreground/50">
        Ajusta los filtros para consultar otro período, usuario o contexto.
      </p>
    </div>
  );
}

// Operation breakdown cardinality is the number of distinct operation_key
// values for the provider/scope (a handful), never per-log rows. A page size
// far above that keeps every row on a single page so the shared DataTable does
// not surface interactive pagination for this compact block.
const OPERATION_BREAKDOWN_PAGE_SIZE = 100;

// UI-only percentage format for the "% consumo" column: light administrative
// precision (one decimal), integers rendered without a trailing ".0". Does not
// alter creditsPercentage in the DTO.
function formatOperationPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

// "Consumo por usuario" page size (Q3F-9 frozen contract).
const USER_CONSUMPTION_PAGE_SIZE = 25;

// Identity display matrix for the "Usuario" column (Q3F-9). Never surfaces a
// raw UUID; falls back to explicit copy when identity cannot be resolved.
function userConsumptionIdentity(
  row: ProviderUserConsumptionBreakdownRow,
): { primary: string; secondary: string | null } {
  if (row.userId === null) {
    return { primary: 'Sin usuario identificado', secondary: 'Consumo sin atribución de usuario' };
  }
  if (row.fullName && row.email) return { primary: row.fullName, secondary: row.email };
  if (row.fullName) return { primary: row.fullName, secondary: null };
  if (row.email) return { primary: row.email, secondary: null };
  return { primary: 'Usuario no disponible', secondary: null };
}

// ── Shared type (used by TabResumen and main component) ───────────────────────

export type SidepanelInitialTab = 'resumen' | 'configuracion' | 'consumo' | 'presupuesto' | 'efectividad' | 'logs';

// ── Tab: Resumen ──────────────────────────────────────────────────────────────

function TabResumen({
  row,
  ms,
  usageLogs,
  syncLogs,
  providerRules,
  loadingDetail,
  onNavigate,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  providerRules: BudgetRuleRow[];
  loadingDetail: boolean;
  onNavigate: (tab: SidepanelInitialTab) => void;
}) {
  const opType = getProviderOperationalType(row.providerKey);
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  // Sync signal: prefer syncLogs[0] over row fields
  const latestSyncLog = syncLogs[0] ?? null;
  const syncedAt = latestSyncLog
    ? formatDateShort(latestSyncLog.syncedAt)
    : row.quotaSyncedAt
      ? formatDateShort(row.quotaSyncedAt)
      : row.latestBudgetCheckLog?.createdAt
        ? formatDateShort(row.latestBudgetCheckLog.createdAt)
        : null;

  // Consumo
  const consumed = (() => {
    if (ms !== 'active') return { label: '—' };
    const info = deriveConsumedInfo(row.consumedCredits, row.consumedUsd, row.hasUnknownCost);
    return info.label === '—' ? { label: '0 cr' } : info;
  })();

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const hasQuota = row.providerMonthlyCreditsAllowance != null || row.providerMonthlyUsdAllowance != null;

  // Progress bar: only when credits quota exists
  const progressPct = hasQuota && row.providerMonthlyCreditsAllowance != null && row.consumedCredits != null
    ? Math.min(100, Math.round((row.consumedCredits / row.providerMonthlyCreditsAllowance) * 100))
    : null;

  // Actividad reciente: uso logs primero, fallback a budget check logs
  const recentOps = usageLogs.slice(0, 3);
  const budgetFallback = usageLogs.length === 0 ? (row.recentBudgetCheckLogs ?? []).slice(0, 3) : [];
  const totalOps = usageLogs.length;
  const errorCount = usageLogs.filter(
    (l) => l.status != null && (l.status.toLowerCase().includes('error') || l.status.toLowerCase().includes('fail')),
  ).length;
  const successRate = totalOps > 0 ? Math.round(((totalOps - errorCount) / totalOps) * 100) : null;

  // Salud del proveedor
  const syncOk = latestSyncLog
    ? latestSyncLog.syncStatus === 'success'
    : row.quotaSyncedAt != null && !row.quotaSyncError;
  const syncSignal: 'ok' | 'error' | 'none' = latestSyncLog
    ? (latestSyncLog.syncStatus === 'success' ? 'ok' : 'error')
    : row.quotaSyncedAt
      ? (row.quotaSyncError ? 'error' : 'ok')
      : row.quotaSyncError
        ? 'error'
        : 'none';
  const syncErrorMsg = latestSyncLog?.errorMessage ?? row.quotaSyncError ?? null;

  // Próximas acciones
  const actions: { label: string; tab: SidepanelInitialTab; variant: 'warn' | 'info' }[] = [];
  if (ms !== 'not_measured') {
    if (syncSignal === 'error' || row.quotaSyncError) {
      actions.push({ label: 'Revisar logs de sync', tab: 'logs', variant: 'warn' });
    }
    if (!hasQuota) {
      actions.push({ label: 'Configurar cuota', tab: 'presupuesto', variant: 'warn' });
    }
    if (providerRules.length === 0) {
      actions.push({ label: 'Crear regla de presupuesto', tab: 'presupuesto', variant: 'info' });
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Estado operativo */}
      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard>
          <InfoRow
            label="Tipo"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]}
              </span>
            }
          />
          <InfoRow
            label="Estado"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            }
          />
          <InfoRow
            label="Contexto"
            value={<span className="text-muted-foreground">{getProviderOperationalContext(row.providerKey)}</span>}
          />
          {syncedAt && (
            <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />
          )}
          {row.quotaSyncError && (
            <InfoRow
              label="Error de sync"
              value={<span className="text-destructive text-[10px] leading-relaxed">{row.quotaSyncError}</span>}
            />
          )}
        </SectionCard>

        {/* 2. Consumo y presupuesto */}
        <SectionCard>
          <InfoRow label="Consumo del mes" value={<span title={consumed.description}>{consumed.label}</span>} />
          <InfoRow label="Cuota configurada" value={hasQuota ? allowance : <span className="text-muted-foreground/50">Sin cuota configurada</span>} />
          {row.activeRules > 0 && (
            <InfoRow label="Reglas activas" value={`${row.activeRules} regla${row.activeRules !== 1 ? 's' : ''}`} />
          )}
          {row.providerCreditsAvailable != null && (
            <InfoRow
              label="Disponible (API)"
              value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
            />
          )}
          {row.usdCostMtd != null && (
            <InfoRow label="Costo MTD" value={`$${row.usdCostMtd.toFixed(4)}`} />
          )}
          {progressPct !== null && (
            <div className="pt-1.5 pb-0.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 mb-1">
                <span>Uso del presupuesto</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    progressPct >= 90 ? 'bg-destructive' : progressPct >= 70 ? 'bg-amber-500' : 'bg-su-brand'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* 3. Actividad reciente */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Actividad reciente</p>
        {loadingDetail ? (
          <LoadingPlaceholder label="Cargando actividad..." />
        ) : ms === 'not_measured' ? (
          <EmptyBlock message="Este proveedor no genera actividad medida en SellUp." />
        ) : recentOps.length > 0 ? (
          <div className="space-y-1.5">
            {recentOps.map((log) => {
              const isError = log.status != null && (log.status.toLowerCase().includes('error') || log.status.toLowerCase().includes('fail'));
              return (
                <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 flex items-center gap-3">
                  <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${isError ? 'bg-destructive' : 'bg-emerald-500'}`} />
                  <span className="text-xs text-foreground truncate flex-1">
                    {log.operationKey ?? 'operación general'}
                  </span>
                  {log.creditsUsed != null && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      {log.creditsUsed.toLocaleString()} cr
                    </span>
                  )}
                  {log.estimatedCostUsd != null && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      ${log.estimatedCostUsd.toFixed(4)}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {formatDateShort(log.createdAt)}
                  </span>
                </div>
              );
            })}
            {successRate !== null && (
              <p className="text-[10px] text-muted-foreground/50 px-1">
                Tasa de éxito: {successRate}% ({totalOps - errorCount}/{totalOps} ops)
              </p>
            )}
          </div>
        ) : budgetFallback.length > 0 ? (
          <div className="space-y-1.5">
            {budgetFallback.map((log) => {
              const outcome = parseBudgetCheck(log.budgetCheck)?.outcome;
              const isError = outcome === 'technical_error' || outcome === 'would_block';
              return (
                <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 flex items-center gap-3">
                  <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${isError ? 'bg-destructive' : 'bg-emerald-500'}`} />
                  <span className="text-xs text-foreground truncate flex-1">
                    {log.operationKey ?? 'operación general'}
                  </span>
                  {log.creditsUsed != null && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      {log.creditsUsed.toLocaleString()} cr
                    </span>
                  )}
                  {log.estimatedCostUsd != null && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      ${log.estimatedCostUsd.toFixed(4)}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {formatDateShort(log.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyBlock
            message="Sin operaciones registradas aún."
            sub="Los datos aparecen después de la primera ejecución."
          />
        )}
      </div>

      {/* 4. Salud del proveedor */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Salud del proveedor</p>
        <SectionCard>
          <InfoRow
            label="Estado sync"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                syncSignal === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : syncSignal === 'error'
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-border/40 bg-muted/30 text-muted-foreground/60'
              }`}>
                {syncSignal === 'ok' ? 'OK' : syncSignal === 'error' ? 'Error' : 'Sin registro'}
              </span>
            }
          />
          {syncedAt && (
            <InfoRow label="Fecha sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />
          )}
          {syncErrorMsg && (
            <InfoRow
              label="Error"
              value={
                <span className="text-destructive text-[10px] leading-relaxed line-clamp-2">
                  {syncErrorMsg}
                </span>
              }
            />
          )}
          {latestSyncLog?.creditsRemainingExternal != null && (
            <InfoRow
              label="Créditos externos"
              value={`${latestSyncLog.creditsRemainingExternal.toLocaleString()} cr`}
            />
          )}
        </SectionCard>
      </div>

      {/* 5. Próximas acciones */}
      {actions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Acciones sugeridas</p>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.tab + action.label}
                type="button"
                onClick={() => onNavigate(action.tab)}
                className={`inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  action.variant === 'warn'
                    ? 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                    : 'border-su-brand/20 bg-su-brand-soft text-su-brand hover:bg-su-brand-soft/80'
                }`}
              >
                {action.label} →
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/40 px-1">Sin acciones críticas por ahora.</p>
      )}
    </div>
  );
}

// ── Tab: Configuración — helpers ──────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-muted-foreground/50">{icon}</span>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">{label}</p>
    </div>
  );
}

function ReadOnlyToggle({ label, checked, note }: { label: string; checked: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border/30 last:border-0">
      <div className="min-w-0">
        <span className="text-xs text-foreground">{label}</span>
        {note && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{note}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/40">Solo lectura</span>
        <Switch checked={checked} disabled className="opacity-50 cursor-not-allowed" />
      </div>
    </div>
  );
}

function ConfigAccordion({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-foreground hover:bg-muted/20 transition-colors rounded-lg"
      >
        <span className="font-medium">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-border/30">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Tab: Configuración — estado de conexión helpers ──────────────────────────

const CONNECTION_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  connected:      { label: 'Conectado',      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  not_tested:     { label: 'Sin probar',     cls: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  not_configured: { label: 'No configurado', cls: 'border-border/40 bg-muted/30 text-muted-foreground/60' },
  error:          { label: 'Error',          cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
  disconnected:   { label: 'Desconectado',   cls: 'border-border/40 bg-muted/30 text-muted-foreground/60' },
};

function ConnectionStatusBadge({ status }: { status: string }) {
  const cfg = CONNECTION_STATUS_BADGE[status] ?? { label: status, cls: 'border-border/40 bg-muted/30 text-muted-foreground/60' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function InlineFeedback({ feedback }: { feedback: { ok: boolean; msg: string } | null }) {
  if (!feedback) return null;
  return (
    <p className={`text-xs mt-2 px-1 ${feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
      {feedback.msg}
    </p>
  );
}

// ── Tab: Configuración IA ─────────────────────────────────────────────────────

function TabConfiguracionIA({
  row,
  ms,
  initialConnState,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  initialConnState?: AiConnectionPanelState | null;
}) {
  const router = useRouter();
  const [connState, setConnState] = useState<AiConnectionPanelState | null>(
    initialConnState ?? null,
  );
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  // Sync when server re-renders with fresh initial state (after router.refresh())
  useEffect(() => {
    setConnState(initialConnState ?? null);
  }, [initialConnState]);

  const handleTest = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await testAiProviderConnectionForPanel(row.providerKey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Conexión verificada' : 'Error al probar') });
      router.refresh();
    });
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setFeedback(null);
    startTransition(async () => {
      const r = await updateAiProviderCredentialForPanel(row.providerKey, trimmed);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Credencial guardada' : 'Error al guardar') });
      setApiKeyInput('');
      if (r.ok) setShowKeyForm(false);
      router.refresh();
    });
  };

  const handleDisconnect = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await disconnectAiProviderForPanel(row.providerKey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Desconectado' : 'Error al desconectar') });
      setShowDisconnectConfirm(false);
      router.refresh();
    });
  };

  const measurementUnit = row.providerMonthlyCreditsAllowance != null ? 'Créditos'
    : row.providerMonthlyUsdAllowance != null ? 'USD'
    : 'No definida';
  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  return (
    <div className="space-y-5">
      {/* Conexión */}
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Conexión" />
        <div className="space-y-2">
            <SectionCard>
              <InfoRow
                label="Estado"
                value={<ConnectionStatusBadge status={connState?.connectionStatus ?? 'not_configured'} />}
              />
              <InfoRow
                label="Credencial"
                value={
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3 shrink-0" />
                    {connState?.hasCredential ? 'Credencial almacenada' : 'Sin credencial'}
                  </span>
                }
              />
              {connState?.lastTestedAt && (
                <InfoRow label="Última prueba" value={<span className="text-muted-foreground">{formatDateShort(connState.lastTestedAt)}</span>} />
              )}
              {connState?.lastConnectionError && (
                <InfoRow label="Error" value={<span className="text-destructive text-[10px] leading-relaxed">{connState.lastConnectionError}</span>} />
              )}
            </SectionCard>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={isPending || !connState?.hasCredential} onClick={handleTest} className="h-7 text-xs">
                {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                Probar conexión
              </Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => { setShowKeyForm((v) => !v); setShowDisconnectConfirm(false); }} className="h-7 text-xs">
                <Lock className="h-3 w-3 mr-1" />
                Actualizar API key
              </Button>
              {connState?.hasCredential && (
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => { setShowDisconnectConfirm((v) => !v); setShowKeyForm(false); }} className="h-7 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60">
                  <Power className="h-3 w-3 mr-1" />
                  Desconectar
                </Button>
              )}
            </div>

            {showKeyForm && (
              <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-2">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium">Nueva API key</p>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-••••••••"
                  className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-su-brand/40"
                  autoComplete="new-password"
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={isPending || !apiKeyInput.trim()} onClick={handleSaveKey} className="h-7 text-xs">
                    {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Guardar API key
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowKeyForm(false); setApiKeyInput(''); }} className="h-7 text-xs">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {showDisconnectConfirm && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-2">
                <p className="text-xs text-foreground">¿Confirmar desconexión del proveedor?</p>
                <p className="text-[10px] text-muted-foreground/70">Se eliminarán las credenciales. Esta acción no se puede deshacer.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={isPending} onClick={handleDisconnect} className="h-7 text-xs">
                    {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Confirmar desconexión
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowDisconnectConfirm(false)} className="h-7 text-xs">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            <InlineFeedback feedback={feedback} />
          </div>
      </div>

      {/* Modelos y tarifas */}
      <div>
        <SectionHeader icon={<Cpu className="h-3.5 w-3.5" />} label="Modelos y tarifas" />
        <div className="space-y-2">
          <SectionCard>
            <InfoRow label="Proveedor" value={<span className="text-muted-foreground capitalize">{row.providerKey}</span>} />
            <InfoRow label="Tipo operativo" value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]} · LLM
              </span>
            } />
            <InfoRow label="Modelo activo" value={
              <span className="text-muted-foreground/60 text-[10px]">Pendiente de conectar en este workspace</span>
            } />
          </SectionCard>
          <ConfigAccordion label="Gestionar modelos y tarifas">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
              La gestión detallada de modelos, tarifas y precios se conectará progresivamente dentro del workspace del proveedor.
            </p>
          </ConfigAccordion>
        </div>
      </div>

      {/* Medición y consumo */}
      <div>
        <SectionHeader icon={<Database className="h-3.5 w-3.5" />} label="Medición y consumo" />
        <SectionCard>
          <InfoRow label="Modo de medición" value={MEASUREMENT_STATUS_LABEL[ms]} />
          <InfoRow label="Unidad" value={<span className="text-muted-foreground">{measurementUnit}</span>} />
          <InfoRow label="Fuente" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
          <ReadOnlyToggle label="Participa en reportes de consumo" checked={ms === 'active'} note="Activo cuando hay registros de uso medidos" />
        </SectionCard>
      </div>

      {/* Uso operativo */}
      <div>
        <SectionHeader icon={<Bot className="h-3.5 w-3.5" />} label="Uso operativo" />
        <SectionCard>
          <ReadOnlyToggle label="Habilitado para agentes" checked={ms === 'active' || ms === 'connected'} note="Pendiente de configurar por agente" />
        </SectionCard>
        <p className="text-[10px] text-muted-foreground/40 mt-2 px-1 leading-relaxed">
          La configuración por agente se conectará progresivamente dentro de este workspace.
        </p>
      </div>
    </div>
  );
}

// ── Tab: Configuración no IA ──────────────────────────────────────────────────

const OPERATIONAL_USE_MAP: Record<string, string> = {
  tavily:  'Búsqueda web y señales externas en prospección y enriquecimiento',
  lusha:   'Enriquecimiento de contactos (teléfono, email verificado)',
  apollo:  'Prospección de cuentas y enriquecimiento de contactos',
  samu_ia: 'Post-reunión — no medido directamente desde SellUp',
};

const MODULES_MAP: Record<string, string> = {
  tavily: 'Agente 1, Prospección',
  lusha:  'Agente 2A, Enriquecimiento',
  apollo: 'Agente 1, Agente 2A, Enriquecimiento',
};

const API_KEY_NOTES: Record<string, { where: string; tips: string }> = {
  apollo: {
    where: 'En app.apollo.io → Settings → Integrations → API Keys.',
    tips:  'Se requiere plan Professional o superior para acceso a People Search.',
  },
  lusha: {
    where: 'En dashboard.lusha.com → Integrations → API.',
    tips:  'Asegúrate de activar los permisos de Person Enrichment.',
  },
  tavily: {
    where: 'En app.tavily.com → API Keys.',
    tips:  'Cada test de conexión consume 1 crédito de Tavily.',
  },
};

function TabConfiguracionNoIA({
  row,
  ms,
  initialConnState,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  initialConnState?: ProspectingConnectionPanelState | null;
}) {
  const router = useRouter();
  const pkey = row.providerKey.toLowerCase();
  const isProspecting = pkey === 'apollo' || pkey === 'lusha';

  const [connState, setConnState] = useState<ProspectingConnectionPanelState | null>(
    initialConnState ?? null,
  );
  const [loadingConn, setLoadingConn] = useState(isProspecting ? false : true);
  const [connLoadError, setConnLoadError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  // Sync when server re-renders with fresh state (after router.refresh())
  useEffect(() => {
    if (initialConnState) {
      setConnState(initialConnState);
      setLoadingConn(false);
      setConnLoadError(false);
    }
  }, [initialConnState]);

  const loadConn = useCallback(async () => {
    setLoadingConn(true);
    setConnLoadError(false);
    try {
      const s = await loadProspectingProviderConnectionForPanel(pkey);
      setConnState(s);
    } catch {
      setConnLoadError(true);
    } finally {
      setLoadingConn(false);
    }
  }, [pkey]);

  // Only fetch on mount for non-prospecting providers (e.g. tavily)
  useEffect(() => {
    if (!isProspecting) void loadConn();
  }, [loadConn, isProspecting]);

  // After mutations: server-refresh for apollo/lusha, direct reload for others
  const refreshConn = useCallback(() => {
    if (isProspecting) {
      router.refresh();
    } else {
      void loadConn();
    }
  }, [isProspecting, router, loadConn]);

  const handleTest = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await testProspectingProviderConnectionForPanel(pkey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Conexión verificada' : 'Error al probar') });
      refreshConn();
    });
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setFeedback(null);
    startTransition(async () => {
      const r = await updateProspectingProviderCredentialForPanel(pkey, trimmed);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Credencial guardada' : 'Error al guardar') });
      setApiKeyInput('');
      if (r.ok) setShowKeyForm(false);
      refreshConn();
    });
  };

  const handleDisconnect = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await disconnectProspectingProviderForPanel(pkey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Desconectado' : 'Error al desconectar') });
      setShowDisconnectConfirm(false);
      refreshConn();
    });
  };

  const supported = connState?.supported !== false;
  const hasCredential = connState?.credentialsStatus === 'stored';

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const consumed = ms === 'active'
    ? (() => {
        const info = deriveConsumedInfo(row.consumedCredits, row.consumedUsd, row.hasUnknownCost);
        return info.label === '—' ? { label: '0 cr' } : info;
      })()
    : { label: '—' };
  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  const operationalUse = OPERATIONAL_USE_MAP[pkey] ?? 'Uso operativo pendiente de documentar';
  const modules = MODULES_MAP[pkey] ?? 'Pendiente de mapear';
  const apiNotes = API_KEY_NOTES[pkey];

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  return (
    <div className="space-y-5">
      {/* Conexión */}
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Conexión" />
        {loadingConn ? (
          <LoadingPlaceholder label="Cargando estado de conexión..." />
        ) : connLoadError || connState?.loadErrorMsg ? (
          <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-4 space-y-2">
            <p className="text-xs text-muted-foreground">{connState?.loadErrorMsg ?? 'No fue posible cargar el estado de conexión.'}</p>
            <Button size="sm" variant="outline" onClick={() => void loadConn()} className="h-7 text-xs">
              Reintentar
            </Button>
          </div>
        ) : !supported ? (
          <ProgressiveNote>
            Configuración progresiva — este proveedor estará disponible en una próxima versión del workspace.
          </ProgressiveNote>
        ) : (
          <div className="space-y-2">
            <SectionCard>
              <InfoRow
                label="Estado de conexión"
                value={<ConnectionStatusBadge status={connState?.connectionStatus ?? 'not_configured'} />}
              />
              <InfoRow
                label="Credencial"
                value={
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3 shrink-0" />
                    {hasCredential ? 'Credencial almacenada' : 'Sin credencial'}
                  </span>
                }
              />
              {connState?.lastTestedAt && (
                <InfoRow label="Última prueba" value={<span className="text-muted-foreground">{formatDateShort(connState.lastTestedAt)}</span>} />
              )}
              {connState?.lastConnectedAt && (
                <InfoRow label="Última conexión" value={<span className="text-muted-foreground">{formatDateShort(connState.lastConnectedAt)}</span>} />
              )}
              {connState?.lastConnectionError && (
                <InfoRow label="Error" value={<span className="text-destructive text-[10px] leading-relaxed">{connState.lastConnectionError}</span>} />
              )}
            </SectionCard>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={isPending || !hasCredential} onClick={handleTest} className="h-7 text-xs">
                {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                Probar conexión
              </Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => { setShowKeyForm((v) => !v); setShowDisconnectConfirm(false); }} className="h-7 text-xs">
                <Lock className="h-3 w-3 mr-1" />
                Actualizar API key
              </Button>
              {hasCredential && (
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => { setShowDisconnectConfirm((v) => !v); setShowKeyForm(false); }} className="h-7 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60">
                  <Power className="h-3 w-3 mr-1" />
                  Desconectar
                </Button>
              )}
            </div>

            {showKeyForm && (
              <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-2">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium">Nueva API key</p>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-su-brand/40"
                  autoComplete="new-password"
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={isPending || !apiKeyInput.trim()} onClick={handleSaveKey} className="h-7 text-xs">
                    {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Guardar API key
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowKeyForm(false); setApiKeyInput(''); }} className="h-7 text-xs">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {showDisconnectConfirm && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-2">
                <p className="text-xs text-foreground">¿Confirmar desconexión?</p>
                <p className="text-[10px] text-muted-foreground/70">Se eliminarán las credenciales almacenadas.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={isPending} onClick={handleDisconnect} className="h-7 text-xs">
                    {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Confirmar desconexión
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowDisconnectConfirm(false)} className="h-7 text-xs">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            <InlineFeedback feedback={feedback} />
          </div>
        )}
      </div>

      {/* Descripción y uso */}
      <div>
        <SectionHeader icon={<Bot className="h-3.5 w-3.5" />} label="Descripción y uso en SellUp" />
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-1">
          <p className="text-xs text-foreground leading-relaxed">{operationalUse}</p>
          <p className="text-[10px] text-muted-foreground/50">Módulos: {modules}</p>
        </div>
      </div>

      {/* Estado operativo */}
      <div>
        <SectionHeader icon={<Zap className="h-3.5 w-3.5" />} label="Estado operativo" />
        <SectionCard>
          <InfoRow label="Tipo operativo" value={
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
              {OPERATIONAL_TYPE_LABEL[opType]}
            </span>
          } />
          <InfoRow label="Estado de medición" value={
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
              {MEASUREMENT_STATUS_LABEL[ms]}
            </span>
          } />
          <InfoRow label="Consumo del mes" value={<span title={consumed.description}>{consumed.label}</span>} />
          <InfoRow label="Cuota configurada" value={allowance} />
          <InfoRow label="Fuente de cuota" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
          {syncedAt && <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />}
          {row.quotaSyncError && (
            <InfoRow label="Error sync" value={<span className="text-destructive text-[10px]">{row.quotaSyncError}</span>} />
          )}
        </SectionCard>
      </div>

      {/* Notas de configuración */}
      <div>
        <SectionHeader icon={<Settings className="h-3.5 w-3.5" />} label="Notas de configuración" />
        <div className="space-y-2">
          {apiNotes && (
            <>
              <ConfigAccordion label="Dónde obtener la API key">
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">{apiNotes.where}</p>
              </ConfigAccordion>
              <ConfigAccordion label="Recomendaciones de configuración">
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">{apiNotes.tips}</p>
              </ConfigAccordion>
            </>
          )}
          <ConfigAccordion label="Configuración avanzada por agente">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
              La configuración avanzada por agente se conectará progresivamente dentro del workspace del proveedor.
            </p>
          </ConfigAccordion>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Configuración (dispatcher) ──────────────────────────────────────────

function TabConfiguracion({
  row,
  ms,
  initialConnState,
  aiInitialConnState,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  initialConnState?: ProspectingConnectionPanelState | null;
  aiInitialConnState?: AiConnectionPanelState | null;
}) {
  const opType = getProviderOperationalType(row.providerKey);
  return opType === 'ia'
    ? <TabConfiguracionIA row={row} ms={ms} initialConnState={aiInitialConnState} />
    : <TabConfiguracionNoIA row={row} ms={ms} initialConnState={initialConnState} />;
}

// ── Tab: Consumo ──────────────────────────────────────────────────────────────

const CONSUMPTION_PERIOD_OPTIONS = [
  { value: 'current_month', label: 'Mes actual' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'all', label: 'Todo el período' },
] as const;

const CONSUMPTION_KPI_LABEL: Record<NonNullable<UsageFilters['period']>, string> = {
  current_month: 'Consumo del mes',
  '7d': 'Consumo · últimos 7 días',
  '30d': 'Consumo · últimos 30 días',
  all: 'Consumo acumulado',
};

const CONSUMPTION_AGENT_DISPLAY: Record<string, string> = {
  prospect_generation: 'Generación de prospectos',
  account_intelligence: 'Inteligencia de cuenta',
  commercial_speech: 'Speech comercial',
  post_meeting_followup: 'Seguimiento post-reunión',
  contact_enrichment: 'Enriquecimiento de contactos',
};

function labelConsumptionAgent(key: string, name: string | null) {
  return CONSUMPTION_AGENT_DISPLAY[key] ?? name ?? key;
}

// Display matrix for the Usuario filter (Q3F-9G Paso 10): fullName is
// preferred, email is the fallback, and the raw internal_users.id never
// reaches the UI — an id-only user shows a readable placeholder instead.
function consumptionUserIdentity(u: FilterUser): { primary: string; secondary: string | null } {
  if (u.full_name && u.email) return { primary: u.full_name, secondary: u.email };
  if (u.full_name) return { primary: u.full_name, secondary: null };
  if (u.email) return { primary: u.email, secondary: null };
  return { primary: 'Usuario no disponible', secondary: null };
}

function labelConsumptionUser(u: FilterUser) {
  return consumptionUserIdentity(u).primary;
}

const CONSUMPTION_GROUP_INDENT_PX = 16;

function consumptionDescendantGroupIds(rootId: string, groups: FilterGroup[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.parent_group_id) continue;
    const arr = childrenByParent.get(g.parent_group_id) ?? [];
    arr.push(g.id);
    childrenByParent.set(g.parent_group_id, arr);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const childId of childrenByParent.get(id) ?? []) stack.push(childId);
  }
  return result;
}

// Presentation-only signal (Q3F-9G Paso 14): true when the snapshot carries
// any real activity, regardless of which block it shows up in. Deliberately
// ignores per-row hasUnknownCost — an unknown-cost flag with zero underlying
// calls/credits/rows must not read as "there is data".
function hasProviderConsumptionData(snapshot: ProviderConsumptionSnapshot): boolean {
  return (
    snapshot.totalCalls > 0 ||
    (snapshot.totalCredits ?? 0) > 0 ||
    snapshot.totalCostUsd > 0 ||
    snapshot.successCalls > 0 ||
    snapshot.errorCalls > 0 ||
    snapshot.operationBreakdown.length > 0 ||
    snapshot.userConsumption.length > 0 ||
    snapshot.recentLogs.length > 0
  );
}

// Searchable Usuario filter (Q3F-9G Paso 9). Local Command + Popover pattern
// (not the shared forms/searchable-select.tsx) because that component filters
// cmdk's own CommandItem `value`, which here must stay the user id for
// selection — searching by fullName/email needs a manually filtered list, so
// filtering is done here and `shouldFilter` is turned off on <Command>.
function ConsumptionUserFilter({
  users,
  selectedUserId,
  onSelect,
}: {
  users: FilterUser[];
  selectedUserId: string | null;
  onSelect: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedUser = selectedUserId ? users.find((u) => u.id === selectedUserId) : undefined;
  const triggerLabel = selectedUser ? labelConsumptionUser(selectedUser) : 'Todos los usuarios';

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = normalizedQuery
    ? users.filter((u) => {
        const identity = consumptionUserIdentity(u);
        const haystack = `${identity.primary} ${identity.secondary ?? ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : users;
  const noMatches = normalizedQuery.length > 0 && filteredUsers.length === 0;

  function choose(userId: string | null) {
    onSelect(userId);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 w-[160px] justify-between rounded-lg border-input bg-transparent px-2 font-normal text-[11px] hover:bg-accent dark:bg-input/30 dark:hover:bg-input/50"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-(--anchor-width) max-w-(--available-width) p-0 rounded-xl border shadow-md"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar usuario..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[280px] overflow-y-auto">
            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => choose(null)} className="text-xs">
                <span className="flex-1">Todos los usuarios</span>
                {!selectedUserId && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
              </CommandItem>
            </CommandGroup>
            {noMatches ? (
              <div className="py-4 text-center">
                <p className="text-xs text-foreground">No encontramos usuarios</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Prueba con otro nombre o correo.
                </p>
              </div>
            ) : (
              <CommandGroup>
                {filteredUsers.map((u) => {
                  const identity = consumptionUserIdentity(u);
                  return (
                    <CommandItem
                      key={u.id}
                      value={u.id}
                      onSelect={() => choose(u.id)}
                      className="flex flex-col items-start text-xs"
                    >
                      <div className="flex items-center w-full">
                        <span className="flex-1 truncate">{identity.primary}</span>
                        {selectedUserId === u.id && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                      </div>
                      {identity.secondary && (
                        <span className="text-[10px] text-muted-foreground/60 leading-tight">
                          {identity.secondary}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TabConsumo({
  row,
  ms,
  providerKey,
  isActive,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  providerKey: string;
  isActive: boolean;
}) {
  const [filters, setFilters] = useState<UsageFilters>({ period: 'current_month' });
  const [snapshot, setSnapshot] = useState<ProviderConsumptionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diagnosticStage, setDiagnosticStage] = useState<ConsumptionErrorStage | null>(null);
  const [isPending, startTransition] = useTransition();
  const seqRef = useRef(0);

  const STAGE_LABEL: Record<ConsumptionErrorStage, string> = {
    provider_stats: 'Métricas de consumo',
    operation_stats: 'Distribución por operación',
    recent_logs: 'Operaciones recientes',
    user_consumption: 'Consumo por usuario',
    filter_options: 'Opciones de filtro',
    mapping: 'Preparación de datos',
  };

  const loadConsumptionSnapshot = useCallback(() => {
    const seq = ++seqRef.current;
    startTransition(async () => {
      try {
        const result = await loadProviderConsumptionForWorkspace(providerKey, filters);
        if (seq !== seqRef.current) return;
        if (result.ok) {
          setSnapshot(result.snapshot);
          setLoadError(null);
          setDiagnosticStage(null);
        } else {
          setLoadError('No fue posible cargar el consumo de este proveedor.');
          setDiagnosticStage(result.errorStage);
        }
      } catch {
        if (seq === seqRef.current) {
          setLoadError('No fue posible cargar el consumo de este proveedor.');
          setDiagnosticStage(null);
        }
      }
    });
  }, [providerKey, filters]);

  useEffect(() => {
    if (!isActive) return;
    loadConsumptionSnapshot();
  }, [isActive, loadConsumptionSnapshot]);

  const options = snapshot?.filterOptions;
  const period = filters.period ?? 'current_month';
  const kpiLabel = CONSUMPTION_KPI_LABEL[period];

  const filteredCredits = snapshot?.totalCredits ?? null;
  const filteredCost = snapshot?.totalCostUsd ?? 0;
  const totalCalls = snapshot?.totalCalls ?? 0;
  const successCalls = snapshot?.successCalls ?? 0;
  const errorCalls = snapshot?.errorCalls ?? 0;

  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;

  const recentLogs = snapshot?.recentLogs ?? [];
  const recentOps = recentLogs.slice(0, 5);
  const visibleCount = Math.min(5, recentLogs.length);
  const operationBreakdown = snapshot?.operationBreakdown ?? [];
  const userConsumption = snapshot?.userConsumption ?? [];

  // Distribución por operación → shared DataTable (Foundation § 10; AGENTS.md
  // prohibits raw <Table>). Columns are provider-aware because the operation
  // label depends on providerKey. Sorting is disabled so the query's
  // deterministic order (total_credits DESC, total_calls DESC, operation_key
  // ASC) is preserved verbatim.
  const operationColumns = useMemo<ColumnDef<ProviderOperationBreakdownRow, unknown>[]>(
    () => [
      {
        id: 'operationKey',
        accessorKey: 'operationKey',
        header: () => <>Operación</>,
        enableSorting: false,
        size: 220,
        cell: ({ row }) => (
          <span className="block text-foreground leading-snug">
            {getProviderOperationLabel(providerKey, row.original.operationKey)}
          </span>
        ),
      },
      {
        id: 'totalCalls',
        accessorKey: 'totalCalls',
        header: () => <div className="text-right">Operaciones</div>,
        enableSorting: false,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-foreground whitespace-nowrap">
            {row.original.totalCalls.toLocaleString()}
          </div>
        ),
      },
      {
        id: 'totalCredits',
        accessorKey: 'totalCredits',
        header: () => <div className="text-right">Créditos</div>,
        enableSorting: false,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-foreground whitespace-nowrap">
            {row.original.totalCredits.toLocaleString()} cr
          </div>
        ),
      },
      {
        id: 'creditsPercentage',
        accessorKey: 'creditsPercentage',
        header: () => <div className="text-right">% consumo</div>,
        enableSorting: false,
        size: 100,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground/70 whitespace-nowrap">
            {formatOperationPercent(row.original.creditsPercentage)}
          </div>
        ),
      },
      {
        id: 'totalCostUsd',
        accessorKey: 'totalCostUsd',
        header: () => <div className="text-right">Costo estimado</div>,
        enableSorting: false,
        size: 120,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground/70 whitespace-nowrap">
            {row.original.totalCostUsd === 0 && !row.original.hasUnknownCost ? (
              '—'
            ) : (
              <CostValue
                display={resolveCostDisplay({
                  valueUsd: row.original.totalCostUsd,
                  costTruth: toCostTruth(row.original.hasUnknownCost),
                  formatUsd: (v) => `$${v.toFixed(4)}`,
                })}
              />
            )}
          </div>
        ),
      },
    ],
    [providerKey],
  );

  // Consumo por usuario → shared DataTable (Foundation § 10; AGENTS.md
  // prohibits raw <Table>). Sorting disabled so the query's deterministic
  // order (credits DESC, cost DESC, calls DESC, identity ASC) is preserved.
  const userColumns = useMemo<ColumnDef<ProviderUserConsumptionBreakdownRow, unknown>[]>(
    () => [
      {
        id: 'user',
        header: () => <>Usuario</>,
        enableSorting: false,
        size: 220,
        cell: ({ row }) => {
          const { primary, secondary } = userConsumptionIdentity(row.original);
          return (
            <div className="leading-snug">
              <span className="block text-foreground">{primary}</span>
              {secondary && (
                <span className="block text-[10px] text-muted-foreground/60">{secondary}</span>
              )}
            </div>
          );
        },
      },
      {
        id: 'totalCalls',
        accessorKey: 'totalCalls',
        header: () => <div className="text-right">Operaciones</div>,
        enableSorting: false,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-foreground whitespace-nowrap">
            {row.original.totalCalls.toLocaleString()}
          </div>
        ),
      },
      {
        id: 'totalCredits',
        accessorKey: 'totalCredits',
        header: () => <div className="text-right">Créditos</div>,
        enableSorting: false,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-foreground whitespace-nowrap">
            {row.original.totalCredits.toLocaleString()} cr
          </div>
        ),
      },
      {
        id: 'totalCostUsd',
        accessorKey: 'totalCostUsd',
        header: () => <div className="text-right">Costo estimado</div>,
        enableSorting: false,
        size: 120,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground/70 whitespace-nowrap">
            {row.original.totalCostUsd === 0 && !row.original.hasUnknownCost ? (
              '—'
            ) : (
              <CostValue
                display={resolveCostDisplay({
                  valueUsd: row.original.totalCostUsd,
                  costTruth: toCostTruth(row.original.hasUnknownCost),
                  formatUsd: (v) => `$${v.toFixed(4)}`,
                })}
              />
            )}
          </div>
        ),
      },
      {
        id: 'lastActivityAt',
        accessorKey: 'lastActivityAt',
        header: () => <div className="text-right">Última actividad</div>,
        enableSorting: false,
        size: 130,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground/70 whitespace-nowrap">
            {row.original.lastActivityAt ? formatDateShort(row.original.lastActivityAt) : '—'}
          </div>
        ),
      },
    ],
    [],
  );

  // Client-side user scoping: filter visible users by selected role ∩ group
  const groupScope = filters.groupId
    ? consumptionDescendantGroupIds(filters.groupId, options?.groups ?? [])
    : null;

  const visibleUsers = (options?.users ?? []).filter((u) => {
    if (filters.role && u.role_key !== filters.role) return false;
    if (groupScope && (!u.group_id || !groupScope.has(u.group_id))) return false;
    return true;
  });

  function setFilter(key: keyof UsageFilters, value: string | null) {
    setFilters((prev) => {
      const next = { ...prev };
      if (!value || value === 'all') {
        delete next[key];
      } else {
        (next as Record<string, string>)[key] = value;
      }
      return next;
    });
  }

  function onRoleChange(value: string | null) {
    setFilters((prev) => {
      const next: UsageFilters = { ...prev };
      if (!value || value === 'all') {
        delete next.role;
      } else {
        next.role = value;
        const u = (options?.users ?? []).find((u) => u.id === next.user);
        if (u && u.role_key !== next.role) delete next.user;
      }
      return next;
    });
  }

  function onGroupChange(value: string | null) {
    setFilters((prev) => {
      const next: UsageFilters = { ...prev };
      if (!value || value === 'all') {
        delete next.groupId;
      } else {
        next.groupId = value;
        const scope = consumptionDescendantGroupIds(value, options?.groups ?? []);
        const u = (options?.users ?? []).find((u) => u.id === next.user);
        if (u && (!u.group_id || !scope.has(u.group_id))) delete next.user;
      }
      return next;
    });
  }

  const groupNameMap = new Map((options?.groups ?? []).map((g) => [g.id, g.name]));

  // Q3F-9G Paso 14/15: one consolidated empty state instead of four separate
  // ones when the filtered snapshot carries no activity at all. Gated behind
  // "snapshot loaded successfully" so it never fires during loading or on a
  // query failure (Paso 18 — failure keeps the error containment above).
  const hasConsumptionData = snapshot ? hasProviderConsumptionData(snapshot) : false;
  const showGlobalEmpty = !isPending && !loadError && !!snapshot && !hasConsumptionData;

  return (
    <div className="space-y-4">
      {/* Error contenido — no tumba el sidepanel */}
      {loadError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-4 space-y-2">
          <p className="text-xs text-foreground">{loadError}</p>
          {diagnosticStage && (
            <p className="text-[10px] text-muted-foreground/70">
              No se pudo cargar: {STAGE_LABEL[diagnosticStage]}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70">Puedes reintentar sin cerrar el workspace.</p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => { if (isActive) loadConsumptionSnapshot(); }}
          >
            Reintentar
          </Button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5">
        {/* Período */}
        <Select value={period} onValueChange={(v) => setFilter('period', v)}>
          <SelectTrigger className="h-7 w-[140px] text-[11px]">
            <SelectValue>
              {CONSUMPTION_PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CONSUMPTION_PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Rol */}
        {(options?.roles ?? []).length > 0 && (
          <Select value={filters.role ?? 'all'} onValueChange={onRoleChange}>
            <SelectTrigger className="h-7 w-[150px] text-[11px]">
              <SelectValue placeholder="Rol">
                {filters.role
                  ? (options?.roles.find((r) => r.key === filters.role)?.label ?? filters.role)
                  : 'Todos los roles'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los roles</SelectItem>
              {(options?.roles ?? []).map((r) => (
                <SelectItem key={r.key} value={r.key} className="text-xs">{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Grupo */}
        {(options?.groups ?? []).length > 0 && (
          <Select value={filters.groupId ?? 'all'} onValueChange={onGroupChange}>
            <SelectTrigger className="h-7 w-[160px] text-[11px]">
              <SelectValue placeholder="Grupo">
                {filters.groupId
                  ? (groupNameMap.get(filters.groupId) ?? filters.groupId)
                  : 'Todos los grupos'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los grupos</SelectItem>
              {(options?.groups ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id} className="text-xs">
                  <span style={{ paddingLeft: `${g.depth * CONSUMPTION_GROUP_INDENT_PX}px` }}>
                    {g.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Usuario */}
        {(options?.users ?? []).length > 0 && (
          <ConsumptionUserFilter
            users={visibleUsers}
            selectedUserId={filters.user ?? null}
            onSelect={(userId) => setFilter('user', userId)}
          />
        )}

        {/* Agente */}
        {(options?.agents ?? []).length > 0 && (
          <Select value={filters.agent ?? 'all'} onValueChange={(v) => setFilter('agent', v)}>
            <SelectTrigger className="h-7 w-[180px] text-[11px]">
              <SelectValue placeholder="Agente">
                {filters.agent
                  ? labelConsumptionAgent(
                      filters.agent,
                      options?.agents.find((a) => a.key === filters.agent)?.name ?? null,
                    )
                  : 'Todos los agentes'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los agentes</SelectItem>
              {(options?.agents ?? []).map((a) => (
                <SelectItem key={a.key} value={a.key} className="text-xs">
                  {labelConsumptionAgent(a.key, a.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Estado */}
        {(options?.statuses ?? []).length > 0 && (
          <Select value={filters.status ?? 'all'} onValueChange={(v) => setFilter('status', v)}>
            <SelectTrigger className="h-7 w-[130px] text-[11px]">
              <SelectValue placeholder="Estado">
                {filters.status ? filters.status.replace(/_/g, ' ') : 'Todos los estados'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los estados</SelectItem>
              {(options?.statuses ?? []).map((s) => (
                <SelectItem key={s} value={s} className="text-xs capitalize">
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Q3F-9G Problema B: one consolidated empty state instead of KPI +
          Distribución + Consumo por usuario each showing their own empty. */}
      {showGlobalEmpty ? (
        <GlobalConsumptionEmptyBlock />
      ) : (
        <>
          {/* KPI — consumo filtrado */}
          <SectionCard>
            {isPending ? (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="h-3 w-3 text-muted-foreground/50 animate-spin" />
                <span className="text-xs text-muted-foreground/60">Calculando...</span>
              </div>
            ) : (
              <div className="py-1 space-y-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{kpiLabel}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">Créditos consumidos</p>
                    <p className="text-xs font-medium text-foreground">
                      {filteredCredits != null ? filteredCredits.toLocaleString() + ' cr' : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">Costo estimado</p>
                    <p className="text-xs font-medium text-foreground">
                      {filteredCost === 0 && !(snapshot?.hasUnknownCost ?? false) ? (
                        '—'
                      ) : (
                        <CostValue
                          display={resolveCostDisplay({
                            valueUsd: filteredCost,
                            costTruth: toCostTruth(snapshot?.hasUnknownCost ?? false),
                            formatUsd: (v) => `$${v.toFixed(4)}`,
                          })}
                        />
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">Operaciones</p>
                    <p className="text-xs font-medium text-foreground">{totalCalls.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">Exitosas</p>
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{successCalls.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">Con error</p>
                    <p className={`text-xs font-medium ${errorCalls > 0 ? 'text-destructive' : 'text-foreground'}`}>
                      {errorCalls.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {row.quotaSyncedAt && (
              <InfoRow
                label="Cuota disponible (API)"
                value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
              />
            )}
          </SectionCard>

          {/* Distribución por operación — misma scope que el KPI de arriba */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">
              Distribución por operación
            </p>
            {isPending ? (
              <LoadingPlaceholder label="Calculando distribución..." />
            ) : operationBreakdown.length === 0 ? (
              <EmptyBlock
                message="Sin consumo por operación"
                sub="No hay operaciones registradas para los filtros seleccionados."
              />
            ) : (
              <DataTable
                columns={operationColumns}
                data={operationBreakdown}
                getRowId={(op) => op.operationKey}
                hideToolbar
                enableColumnReorder={false}
                initialPageSize={OPERATION_BREAKDOWN_PAGE_SIZE}
                className="text-xs"
              />
            )}
          </div>

          {/* Consumo por usuario — misma scope que el KPI de arriba (Q3F-9) */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">
              Consumo por usuario
            </p>
            {isPending ? (
              <LoadingPlaceholder label="Calculando consumo por usuario..." />
            ) : userConsumption.length === 0 ? (
              <EmptyBlock
                message="Sin consumo por usuario"
                sub="No hay usuarios con consumo registrado para los filtros seleccionados."
              />
            ) : (
              <DataTable
                columns={userColumns}
                data={userConsumption}
                getRowId={(u) => u.userId ?? '__unattributed__'}
                hideToolbar
                enableColumnReorder={false}
                initialPageSize={USER_CONSUMPTION_PAGE_SIZE}
                className="text-xs"
              />
            )}
          </div>
        </>
      )}

      {/* Reglas de consumo — estáticas, no cambian con filtros analíticos */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Reglas de consumo</p>
        <SectionCard>
          {hasGlobalRule ? (
            <>
              <InfoRow
                label="Límite global"
                value={formatAmount(row.globalLimitCredits, row.globalLimitUsd)}
              />
              <InfoRow
                label="Disponible por regla"
                value={(() => {
                  const remaining = deriveRemainingInfo(row.remainingCredits, row.remainingUsd, row.hasUnknownCost);
                  return <span title={remaining.description}>{remaining.label}</span>;
                })()}
              />
            </>
          ) : (
            <div className="py-1">
              <p className="text-xs text-foreground">Sin regla global</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                Pueden aplicar reglas por rol, grupo o usuario.
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Operaciones recientes — oculto durante el empty global (Problema B);
          empty parcial propio cuando sí hay consumo pero sin logs recientes
          (Problema C). */}
      {ms === 'active' && !showGlobalEmpty && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Operaciones recientes</p>
            {recentLogs.length > 0 && (
              <p className="text-[10px] text-muted-foreground/50">
                Últimas {visibleCount} de {recentLogs.length} cargadas
              </p>
            )}
          </div>
          {isPending ? (
            <LoadingPlaceholder label="Cargando operaciones..." />
          ) : recentOps.length === 0 ? (
            <EmptyBlock
              message="Sin operaciones recientes"
              sub="No hay operaciones registradas para los filtros seleccionados."
            />
          ) : (
            <div className="space-y-1.5">
              {recentOps.map((log) => (
                <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 flex items-center gap-3">
                  <span className="text-xs text-foreground truncate flex-1">
                    {getProviderOperationLabel(providerKey, log.operationKey ?? '')}
                  </span>
                  {log.creditsUsed != null && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      {log.creditsUsed.toLocaleString()} cr
                    </span>
                  )}
                  {log.estimatedCostUsd != null && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      ${log.estimatedCostUsd.toFixed(4)}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-auto">
                    {formatDateShort(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Presupuesto y reglas ─────────────────────────────────────────────────

const RULE_SCOPES: BudgetScopeType[] = ['global', 'role', 'group', 'user'];

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

function ProviderRulesInline({
  rules,
  formOptions,
  providerKey,
  isNotMeasured,
  onRefresh,
}: {
  rules: BudgetRuleRow[];
  formOptions: import('@/modules/budgets/rule-queries').BudgetRuleFormOptions | null;
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
  const [, startTransition] = useTransition();

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
      <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
        <p className="text-xs text-muted-foreground">Las reglas no aplican para este proveedor.</p>
      </div>
    );
  }

  const activeRules = rules.filter((r) => r.is_active);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Reglas de presupuesto</p>
          {formOptions && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setShowCreate(true)}>
              <Plus className="h-3 w-3" />
              Crear regla
            </Button>
          )}
        </div>

        <Tabs defaultValue="global">
          <TabsList className="w-full grid grid-cols-4 h-auto">
            {RULE_SCOPES.map((s) => (
              <TabsTrigger key={s} value={s} className="text-[10px] py-1.5">
                {SCOPE_SECTION_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
          {RULE_SCOPES.map((s) => {
            const scopeRules = rules.filter((r) => r.scope_type === s);
            return (
              <TabsContent key={s} value={s}>
                {scopeRules.length === 0 ? (
                  <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4 mt-2 text-center">
                    <p className="text-xs text-muted-foreground">
                      Sin reglas configuradas para este alcance.
                    </p>
                    {formOptions && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-6 px-3 text-[10px]"
                        onClick={() => setShowCreate(true)}
                      >
                        Crear primera regla
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5 mt-2">
                    {scopeRules.map((rule) => (
                      <div key={rule.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-foreground truncate">{rule.scopeLabel}</span>
                            <span
                              className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                                rule.is_active
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : 'border-border/40 bg-muted/30 text-muted-foreground/60'
                              }`}
                            >
                              {rule.is_active ? 'Activa' : 'Inactiva'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/30 transition-colors"
                              onClick={() => setEditRule(rule)}
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/30 transition-colors"
                              disabled={toggling === rule.id}
                              onClick={() => handleToggle(rule)}
                            >
                              <Power className="h-2.5 w-2.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-destructive/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              disabled={archiving === rule.id}
                              onClick={() => setConfirmArchive(rule)}
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
                          <span>{formatLimit(rule.limit_credits, rule.limit_usd)}</span>
                          <span>{PERIOD_LABELS[rule.period_type]}</span>
                          <span className="ml-auto">{ON_EXCEED_LABELS[rule.on_exceed]}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>

        {activeRules.length === 0 && rules.length === 0 && !formOptions && (
          <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft px-4 py-3 mt-1">
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
              La creación de reglas se conectará directamente en este panel de forma progresiva.
            </p>
          </div>
        )}
      </div>

      {/* Archive confirmation inline */}
      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmArchive(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border/60 bg-card shadow-lg p-5 space-y-4 mx-4">
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
            <div className="flex items-center justify-end gap-2">
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

      {formOptions && (
        <>
          <CreateDrawer
            options={formOptions}
            open={showCreate}
            onOpenChange={setShowCreate}
            defaultProviderKey={providerKey}
            onSuccess={() => { setShowCreate(false); startTransition(onRefresh); }}
          />
          <EditDrawer
            rule={editRule}
            open={!!editRule}
            onOpenChange={(v) => { if (!v) setEditRule(null); }}
            onSuccess={() => { setEditRule(null); startTransition(onRefresh); }}
          />
        </>
      )}
    </>
  );
}

function TabPresupuesto({
  row,
  providerRules,
  formOptions,
  loading,
  onRefresh,
  onConfigureAllowance,
}: {
  row: AdminProviderBudgetRow;
  providerRules: BudgetRuleRow[];
  formOptions: import('@/modules/budgets/rule-queries').BudgetRuleFormOptions | null;
  loading: boolean;
  onRefresh: () => void;
  onConfigureAllowance: (row: AdminProviderBudgetRow) => void;
}) {
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [, startTransition] = useTransition();
  const quotaButtonLabel = getQuotaButtonLabel(row.providerKey, row);
  const isNotMeasured = row.measurementStatus === 'not_measured';
  const allowance = formatAllowance(
    row.providerMonthlyCreditsAllowance,
    row.providerMonthlyUsdAllowance,
  );

  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  return (
    <div className="space-y-4">
      {/* Cuota del proveedor */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Cuota del proveedor</p>
        {isNotMeasured ? (
          <EmptyBlock message="Este proveedor no tiene cuota de medición configurada." />
        ) : (
          <SectionCard>
            <InfoRow label="Fuente" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
            <InfoRow
              label="Créditos mensuales"
              value={row.providerMonthlyCreditsAllowance != null
                ? `${row.providerMonthlyCreditsAllowance.toLocaleString()} cr`
                : 'No configurado'}
            />
            <InfoRow
              label="Presupuesto USD"
              value={row.providerMonthlyUsdAllowance != null
                ? `$${row.providerMonthlyUsdAllowance.toFixed(2)}`
                : 'No configurado'}
            />
            {row.providerCreditsAvailable != null && (
              <InfoRow
                label="Créditos disponibles"
                value={`${row.providerCreditsAvailable.toLocaleString()} cr`}
              />
            )}
            {row.quotaSyncedAt && (
              <InfoRow label="Última sync" value={<span className="text-muted-foreground">{formatDateShort(row.quotaSyncedAt)}</span>} />
            )}
            {row.quotaSyncError && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 mt-2">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{row.quotaSyncError}</p>
              </div>
            )}
          </SectionCard>
        )}

        {!isNotMeasured && quotaButtonLabel && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setAllowanceOpen(true)}
          >
            {quotaButtonLabel}
          </Button>
        )}
      </div>

      {/* Reglas */}
      {loading ? (
        <LoadingPlaceholder label="Cargando reglas..." />
      ) : (
        <ProviderRulesInline
          rules={providerRules}
          formOptions={formOptions}
          providerKey={row.providerKey}
          isNotMeasured={isNotMeasured}
          onRefresh={onRefresh}
        />
      )}

      <ProviderAllowanceDrawer
        provider={row}
        open={allowanceOpen}
        onClose={() => setAllowanceOpen(false)}
        onSaved={() => {
          setAllowanceOpen(false);
          startTransition(() => { window.location.reload(); });
        }}
      />
    </div>
  );
}

// ── Tab: Efectividad ──────────────────────────────────────────────────────────

function TabEfectividad({
  row,
  usageLogs,
  syncLogs,
  loading,
}: {
  row: AdminProviderBudgetRow;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  loading: boolean;
}) {
  const {
    observedLogCount,
    technicalSuccessCount,
    technicalFailureCount,
    technicalSuccessRate,
    isCappedWindow,
    knownCostSubtotalUsd,
    hasUnknownCost,
    hasSufficientRecentEvidence,
  } = useMemo(() => summarizeProviderEffectiveness(usageLogs), [usageLogs]);

  const latestSync = syncLogs[0];
  const syncOk = latestSync?.syncStatus === 'success';

  const costMtd = row.usdCostMtd;

  const windowCaption = isCappedWindow
    ? `últimas ${observedLogCount} ops`
    : `${observedLogCount} ops registrada${observedLogCount === 1 ? '' : 's'}`;
  const windowSuffix = isCappedWindow ? 'últimas ops' : 'ops registradas';

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        {/* Resultado técnico reciente */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Resultado técnico reciente</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            Proporción de éxito técnico en los logs recientes registrados.
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : technicalSuccessRate != null ? (
            <p className="text-sm font-medium text-foreground">
              {technicalSuccessRate}%
              <span className="text-[10px] text-muted-foreground/60 ml-1.5 font-normal">
                ({technicalSuccessCount} / {observedLogCount} {windowSuffix})
              </span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic">Sin datos suficientes</p>
          )}
        </div>

        {/* Costo registrado */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Costo registrado</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            {costMtd != null
              ? 'Costo estimado del mes en curso, según catálogo del proveedor.'
              : 'Costo estimado de las operaciones recientes registradas.'}
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : costMtd != null ? (
            <p className="text-sm font-medium text-foreground">${costMtd.toFixed(4)} MTD (API)</p>
          ) : knownCostSubtotalUsd > 0 || hasUnknownCost ? (
            <p className="text-sm font-medium text-foreground">
              <CostValue
                display={resolveCostDisplay({
                  valueUsd: knownCostSubtotalUsd,
                  costTruth: toCostTruth(hasUnknownCost),
                  formatUsd: (v) => `$${v.toFixed(4)}`,
                })}
              />
              <span className="text-[10px] text-muted-foreground/60 ml-1.5 font-normal">
                {windowCaption}
              </span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic">Sin datos suficientes</p>
          )}
        </div>

        {/* Fallos técnicos recientes */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Fallos técnicos recientes</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            Errores y límites de proveedor en los logs recientes registrados.
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : hasSufficientRecentEvidence ? (
            <p className="text-sm font-medium text-foreground">
              {technicalFailureCount}
              <span className="text-[10px] text-muted-foreground/60 ml-1.5 font-normal">
                fallo{technicalFailureCount !== 1 ? 's' : ''} en {windowCaption}
              </span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic">Sin datos suficientes</p>
          )}
        </div>

        {/* Disponibilidad del proveedor */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Disponibilidad del proveedor</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            Estado basado en última sincronización.
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : latestSync ? (
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  syncOk
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
                }`}
              >
                {syncOk ? 'OK' : 'Error'}
              </span>
              <span className="text-[10px] text-muted-foreground/60">{formatDateShort(latestSync.syncedAt)}</span>
            </div>
          ) : row.quotaSyncedAt ? (
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              OK
            </span>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic">Sin datos de sync</p>
          )}
        </div>
      </div>

      {!loading && !hasSufficientRecentEvidence && (
        <ProgressiveNote>
          Aún no hay operaciones registradas para resumir el comportamiento técnico reciente de este proveedor.
        </ProgressiveNote>
      )}
    </div>
  );
}

// ── Tab: Logs y auditoría ─────────────────────────────────────────────────────

const OUTCOME_BADGE: Record<string, { label: string; className: string }> = {
  allowed:         { label: 'Permitido',        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  alerted:         { label: 'Alerta',           className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  would_block:     { label: 'Habría bloqueado', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  technical_error: { label: 'Error técnico',    className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  missing_user:    { label: 'Sin usuario',      className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  unknown:         { label: 'Desconocido',      className: 'border-border/40 bg-muted/30 text-muted-foreground' },
};

const SYNC_CAPABLE_PROVIDERS = new Set(['tavily', 'lusha', 'apollo', 'anthropic']);

function TabLogs({
  row,
  ms,
  usageLogs,
  syncLogs,
  loading,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  loading: boolean;
}) {
  const budgetLogs = row.recentBudgetCheckLogs ?? [];
  const [showAllBudget, setShowAllBudget] = useState(false);
  const [showAllUsage, setShowAllUsage] = useState(false);
  const INITIAL_BUDGET = 5;
  const INITIAL_USAGE = 10;

  const visibleBudgetLogs = showAllBudget ? budgetLogs : budgetLogs.slice(0, INITIAL_BUDGET);
  const visibleUsageLogs = showAllUsage ? usageLogs : usageLogs.slice(0, INITIAL_USAGE);

  const syncedAt = row.quotaSyncedAt ? formatDateShort(row.quotaSyncedAt) : null;
  const syncError = row.quotaSyncError;

  const syncStatusLabel = syncError ? 'Error de sync' : syncedAt ? 'OK' : 'Sin sync';
  const syncStatusClass = syncError
    ? 'text-destructive'
    : syncedAt
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-muted-foreground/60';

  const hasSyncLogs = SYNC_CAPABLE_PROVIDERS.has(row.providerKey);

  return (
    <div className="space-y-5">
      {/* Status cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Estado de sync</p>
          <p className={`text-xs font-medium ${syncStatusClass}`}>{syncStatusLabel}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Última sync</p>
          <p className="text-xs font-medium text-foreground">{syncedAt ?? 'Sin registro'}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Evaluaciones</p>
          <p className="text-xs font-medium text-foreground">{budgetLogs.length}</p>
        </div>
      </div>

      {/* Actividad reciente (provider_usage_logs) */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Actividad reciente (usage logs)</p>
        {loading ? (
          <LoadingPlaceholder label="Cargando actividad..." />
        ) : ms === 'not_measured' ? (
          <EmptyBlock message="Este proveedor no genera actividad medida en SellUp." />
        ) : usageLogs.length === 0 ? (
          <EmptyBlock
            message="Sin actividad registrada para este proveedor."
            sub="Los registros aparecen después de la primera ejecución desde SellUp."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {['Fecha', 'Operación', 'Créditos', 'Costo USD', 'Estado'].map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground/70 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {visibleUsageLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/10">
                      <td className="px-3 py-2 text-muted-foreground/70 whitespace-nowrap">
                        {formatDateShort(log.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-foreground max-w-[140px] truncate">
                        {log.operationKey ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        {log.creditsUsed != null ? `${log.creditsUsed.toLocaleString()} cr` : '—'}
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        {log.estimatedCostUsd != null ? `$${log.estimatedCostUsd.toFixed(4)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground/70 capitalize">
                        {log.status ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {usageLogs.length > INITIAL_USAGE && (
              <button
                type="button"
                onClick={() => setShowAllUsage((v) => !v)}
                className="w-full text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1.5"
              >
                {showAllUsage
                  ? 'Contraer'
                  : `Mostrar ${usageLogs.length - INITIAL_USAGE} más`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Historial de sincronización (tool_quota_sync_logs) */}
      {hasSyncLogs && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Historial de sincronización</p>
          {loading ? (
            <LoadingPlaceholder label="Cargando historial de sync..." />
          ) : syncLogs.length === 0 ? (
            <EmptyBlock
              message="Sin sincronizaciones registradas."
              sub="Ejecuta un sync desde la tabla de proveedores para registrar actividad."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {['Fecha', 'Estado', 'Fuente', 'HTTP', 'Créditos ext.', 'Costo MTD', 'Error'].map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground/70 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {syncLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/10">
                      <td className="px-3 py-2 text-muted-foreground/70 whitespace-nowrap">
                        {formatDate(log.syncedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                            log.syncStatus === 'success'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-destructive/30 bg-destructive/10 text-destructive'
                          }`}
                        >
                          {log.syncStatus ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground/70">{log.source ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground/70">{log.httpStatus ?? '—'}</td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        {log.creditsRemainingExternal != null
                          ? `${log.creditsRemainingExternal.toLocaleString()} cr`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        {log.usdCostMtd != null ? `$${log.usdCostMtd.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-destructive text-[10px] max-w-[150px] truncate">
                        {log.errorMessage ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Evaluaciones de presupuesto (budget check logs) */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Evaluaciones de presupuesto</p>
        {ms === 'not_measured' ? (
          <EmptyBlock message="Este proveedor no genera evaluaciones de presupuesto." />
        ) : budgetLogs.length === 0 ? (
          <EmptyBlock message="Sin evaluaciones recientes." sub="Los eventos aparecen después de sincronizaciones o ejecuciones." />
        ) : (
          <>
            <div className="space-y-1.5">
              {visibleBudgetLogs.map((log) => {
                const parsed = parseBudgetCheck(log.budgetCheck);
                const outcomeBadge = parsed
                  ? (OUTCOME_BADGE[parsed.outcome] ?? OUTCOME_BADGE['unknown'])
                  : null;
                return (
                  <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-foreground font-medium truncate">
                        {log.operationKey ?? 'operación general'}
                      </span>
                      {outcomeBadge && (
                        <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${outcomeBadge.className}`}>
                          {outcomeBadge.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
                      {log.creditsUsed != null && <span>{log.creditsUsed.toLocaleString()} cr</span>}
                      {log.estimatedCostUsd != null && <span>${log.estimatedCostUsd.toFixed(4)}</span>}
                      {parsed?.scopeApplied && parsed.scopeApplied !== 'none' && (
                        <span>{SCOPE_LABEL[parsed.scopeApplied] ?? parsed.scopeApplied}</span>
                      )}
                      <span className="ml-auto">{formatDateShort(log.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {budgetLogs.length > INITIAL_BUDGET && (
              <button
                type="button"
                onClick={() => setShowAllBudget((v) => !v)}
                className="w-full text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1.5"
              >
                {showAllBudget
                  ? 'Contraer evaluaciones'
                  : `Mostrar ${budgetLogs.length - INITIAL_BUDGET} evaluación${budgetLogs.length - INITIAL_BUDGET !== 1 ? 'es' : ''} más`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProviderDetailSidepanelProps {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  initialTab?: SidepanelInitialTab;
  onClose: () => void;
  onConfigureAllowance: (row: AdminProviderBudgetRow) => void;
  allRules?: BudgetRuleRow[];
  providerConnectionStates?: Record<string, ProspectingConnectionPanelState>;
  aiProviderConnectionStates?: Record<string, AiConnectionPanelState>;
  /** Notified when the user switches tabs, so a parent can mirror it into the URL (Q3F-10E.1). Not called for the initialTab-driven sync. */
  onActiveTabChange?: (tab: SidepanelInitialTab) => void;
}

export function ProviderDetailSidepanel({
  provider,
  open,
  initialTab = 'resumen',
  onClose,
  onConfigureAllowance,
  allRules = [],
  providerConnectionStates,
  aiProviderConnectionStates,
  onActiveTabChange,
}: ProviderDetailSidepanelProps) {
  const ms: MeasurementStatus = provider?.measurementStatus ?? 'prepared';
  const opType = provider ? getProviderOperationalType(provider.providerKey) : null;
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];

  const [detailData, setDetailData] = useState<SidepanelDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<SidepanelInitialTab>(initialTab);

  const fetchDetail = useCallback(async (providerKey: string) => {
    setLoadingDetail(true);
    try {
      const data = await loadProviderDetailForPanel(providerKey);
      if (data) setDetailData(data);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!provider) {
      setDetailData(null);
      return;
    }
    setDetailData(null);
    fetchDetail(provider.providerKey);
  }, [provider?.providerKey, fetchDetail]);

  // Respect initialTab when provider or entry point changes
  useEffect(() => {
    setActiveTab(initialTab);
  }, [provider?.providerKey, initialTab]);

  const hasAttention = provider && (
    (provider.quotaSource === 'sync_error' && !provider.providerMonthlyCreditsAllowance && !provider.providerMonthlyUsdAllowance) ||
    (provider.remainingCredits != null && provider.remainingCredits <= 0) ||
    (provider.remainingUsd != null && provider.remainingUsd <= 0)
  );

  // Use lazy-loaded rules when available, fall back to filtered allRules
  const providerRules = detailData?.providerRules
    ?? (provider ? allRules.filter((r) => r.provider_key === provider.providerKey) : []);

  const usageLogs = detailData?.usageLogs ?? [];
  const syncLogs = detailData?.syncLogs ?? [];
  const formOptions = detailData?.formOptions ?? null;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      size="workspace"
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>{provider?.displayName ?? provider?.providerKey ?? 'Proveedor'}</span>
          {opType && (
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${OPERATIONAL_TYPE_BADGE[opType]}`}>
              {OPERATIONAL_TYPE_LABEL[opType]}
            </span>
          )}
          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${msBadge.className}`}>
            {MEASUREMENT_STATUS_LABEL[ms]}
          </span>
          {hasAttention && (
            <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              Atención
            </span>
          )}
        </div>
      }
      description={provider ? getProviderOperationalContext(provider.providerKey) : ''}
      icon={<Activity className="h-4 w-4 text-su-brand" />}
      footer={
        <div className="shrink-0 flex items-center justify-end border-t border-border/50 bg-muted/20 px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      {provider && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const tab = v as SidepanelInitialTab;
            setActiveTab(tab);
            onActiveTabChange?.(tab);
          }}
        >
          <TabsList className="w-full grid grid-cols-6 mb-5 h-auto">
            <TabsTrigger value="resumen" className="text-[11px] gap-1 py-1.5">
              <Activity className="h-3 w-3" />
              Resumen
            </TabsTrigger>
            <TabsTrigger value="configuracion" className="text-[11px] gap-1 py-1.5">
              <Settings className="h-3 w-3" />
              Config.
            </TabsTrigger>
            <TabsTrigger value="consumo" className="text-[11px] gap-1 py-1.5">
              <BarChart2 className="h-3 w-3" />
              Consumo
            </TabsTrigger>
            <TabsTrigger value="presupuesto" className="text-[11px] gap-1 py-1.5">
              <DollarSign className="h-3 w-3" />
              Presupuesto
            </TabsTrigger>
            <TabsTrigger value="efectividad" className="text-[11px] gap-1 py-1.5">
              <TrendingUp className="h-3 w-3" />
              Efectividad
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-[11px] gap-1 py-1.5">
              <ScrollText className="h-3 w-3" />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="resumen">
            <TabResumen
              row={provider}
              ms={ms}
              usageLogs={usageLogs}
              syncLogs={syncLogs}
              providerRules={providerRules}
              loadingDetail={loadingDetail}
              onNavigate={setActiveTab}
            />
          </TabsContent>

          <TabsContent value="configuracion">
            <TabConfiguracion
              row={provider}
              ms={ms}
              initialConnState={providerConnectionStates?.[provider.providerKey.toLowerCase()]}
              aiInitialConnState={aiProviderConnectionStates?.[provider.providerKey.toLowerCase()]}
            />
          </TabsContent>

          <TabsContent value="consumo">
            <TabConsumo row={provider} ms={ms} providerKey={provider.providerKey} isActive={activeTab === 'consumo'} />
          </TabsContent>

          <TabsContent value="presupuesto">
            <TabPresupuesto
              row={provider}
              providerRules={providerRules}
              formOptions={formOptions}
              loading={loadingDetail}
              onRefresh={() => fetchDetail(provider.providerKey)}
              onConfigureAllowance={onConfigureAllowance}
            />
          </TabsContent>

          <TabsContent value="efectividad">
            <TabEfectividad
              row={provider}
              usageLogs={usageLogs}
              syncLogs={syncLogs}
              loading={loadingDetail}
            />
          </TabsContent>

          <TabsContent value="logs">
            <TabLogs
              row={provider}
              ms={ms}
              usageLogs={usageLogs}
              syncLogs={syncLogs}
              loading={loadingDetail}
            />
          </TabsContent>
        </Tabs>
      )}
    </DrawerShell>
  );
}
