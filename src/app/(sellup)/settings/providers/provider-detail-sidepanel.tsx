'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import {
  Activity, Settings, BarChart2, DollarSign, TrendingUp, ScrollText,
  ChevronDown, Cpu, Zap, Database, Bot, Plus, Pencil, Power, Trash2,
  Loader2,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
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
  type SidepanelDetailData,
  type ProviderUsageLogRow,
  type ProviderSyncLogRow,
} from './provider-detail-actions';

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
  const consumed = ms === 'active'
    ? formatAmount(row.consumedCredits, row.consumedUsd) || '0 cr'
    : '—';

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
          <InfoRow label="Consumo del mes" value={consumed} />
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

// ── Tab: Configuración IA ─────────────────────────────────────────────────────

function TabConfiguracionIA({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);

  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  const measurementUnit = row.providerMonthlyCreditsAllowance != null ? 'Créditos' : row.providerMonthlyUsdAllowance != null ? 'USD' : 'No definida';

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Estado del proveedor" />
        <SectionCard>
          <InfoRow
            label="Tipo operativo"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]} · LLM
              </span>
            }
          />
          <InfoRow
            label="Estado de medición"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            }
          />
          <InfoRow label="Descripción" value={<span className="text-muted-foreground">{MEASUREMENT_STATUS_DESCRIPTION[ms]}</span>} />
          {syncedAt && <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />}
          {row.quotaSyncError && (
            <InfoRow label="Error de sync" value={<span className="text-destructive text-[10px]">{row.quotaSyncError}</span>} />
          )}
        </SectionCard>
      </div>

      <div>
        <SectionHeader icon={<Cpu className="h-3.5 w-3.5" />} label="Modelos y tarifas" />
        <div className="space-y-2">
          <SectionCard>
            <InfoRow label="Cuota configurada" value={allowance} />
            <InfoRow label="Fuente de cuota" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
            {row.quotaOverrideManual && (
              <InfoRow label="Override manual" value={<span className="text-amber-600 dark:text-amber-400 text-[10px]">Activo — sync API no sobreescribe</span>} />
            )}
            {row.creditsRemainingExternal != null && (
              <InfoRow label="Disponible (API)" value={`${row.creditsRemainingExternal.toLocaleString()} cr`} />
            )}
            {row.usdCostMtd != null && (
              <InfoRow label="Costo MTD (API)" value={`$${row.usdCostMtd.toFixed(4)}`} />
            )}
          </SectionCard>
          <ConfigAccordion label="Gestión de modelos">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
              La edición de modelos activos, tarifas por token y configuración de conexión
              se conectará progresivamente dentro de este workspace del proveedor.
            </p>
          </ConfigAccordion>
        </div>
      </div>

      <div>
        <SectionHeader icon={<Database className="h-3.5 w-3.5" />} label="Medición y consumo" />
        <SectionCard>
          <InfoRow label="Modo de medición" value={MEASUREMENT_STATUS_LABEL[ms]} />
          <InfoRow label="Unidad de medición" value={<span className="text-muted-foreground">{measurementUnit}</span>} />
          <InfoRow label="Fuente de medición" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
          <ReadOnlyToggle
            label="Participa en reportes de consumo"
            checked={ms === 'active'}
            note="Activo cuando hay registros de uso medidos"
          />
        </SectionCard>
      </div>

      <div>
        <SectionHeader icon={<Bot className="h-3.5 w-3.5" />} label="Automatización / uso operativo" />
        <SectionCard>
          <ReadOnlyToggle
            label="Habilitado para agentes"
            checked={ms === 'active' || ms === 'connected'}
            note="Pendiente de configurar por agente"
          />
          <ReadOnlyToggle
            label="Solo lectura operativa"
            checked={ms === 'prepared' || ms === 'not_measured'}
            note="Sin ejecuciones registradas en SellUp"
          />
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

function TabConfiguracionNoIA({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const consumed = ms === 'active'
    ? formatAmount(row.consumedCredits, row.consumedUsd) || '0 cr'
    : '—';

  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  const measurementUnit = row.providerMonthlyCreditsAllowance != null ? 'Créditos'
    : row.providerMonthlyUsdAllowance != null ? 'USD'
    : 'No definida';

  const operationalUse = OPERATIONAL_USE_MAP[row.providerKey.toLowerCase()]
    ?? 'Uso operativo pendiente de documentar';

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Estado del proveedor" />
        <SectionCard>
          <InfoRow
            label="Tipo operativo"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]}
              </span>
            }
          />
          <InfoRow
            label="Estado de medición"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            }
          />
          <InfoRow label="Descripción" value={<span className="text-muted-foreground">{MEASUREMENT_STATUS_DESCRIPTION[ms]}</span>} />
          {syncedAt && <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />}
          {row.quotaSyncError && (
            <InfoRow label="Error de sync" value={<span className="text-destructive text-[10px]">{row.quotaSyncError}</span>} />
          )}
        </SectionCard>
      </div>

      <div>
        <SectionHeader icon={<Zap className="h-3.5 w-3.5" />} label="Cuota y medición" />
        <SectionCard>
          <InfoRow label="Cuota configurada" value={allowance} />
          <InfoRow label="Consumo del mes" value={consumed} />
          <InfoRow label="Fuente de cuota" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
          <InfoRow label="Unidad de medición" value={<span className="text-muted-foreground">{measurementUnit}</span>} />
          {row.creditsRemainingExternal != null && (
            <InfoRow label="Disponible (API)" value={`${row.creditsRemainingExternal.toLocaleString()} cr`} />
          )}
          <ReadOnlyToggle
            label="Participa en reportes de consumo"
            checked={ms === 'active'}
            note="Activo cuando hay registros de uso medidos"
          />
        </SectionCard>
      </div>

      <div>
        <SectionHeader icon={<Bot className="h-3.5 w-3.5" />} label="Uso operativo" />
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-xs text-foreground leading-relaxed">{operationalUse}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-2">
            Módulos: {opType === 'enriquecimiento' ? 'Enriquecimiento, Agente 2A' : opType === 'busqueda' ? 'Prospección, Agente 1' : 'Pendiente de mapear'}
          </p>
        </div>
      </div>

      <div>
        <SectionHeader icon={<Settings className="h-3.5 w-3.5" />} label="Edición progresiva" />
        <ConfigAccordion label="Configurar cuota / presupuesto">
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
            La edición de esta configuración se conectará progresivamente dentro del workspace del proveedor.
            Por ahora puedes revisar el estado configurado desde la tab Presupuesto.
          </p>
        </ConfigAccordion>
      </div>
    </div>
  );
}

// ── Tab: Configuración (dispatcher) ──────────────────────────────────────────

function TabConfiguracion({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const opType = getProviderOperationalType(row.providerKey);
  return opType === 'ia'
    ? <TabConfiguracionIA row={row} ms={ms} />
    : <TabConfiguracionNoIA row={row} ms={ms} />;
}

// ── Tab: Consumo ──────────────────────────────────────────────────────────────

function TabConsumo({
  row,
  ms,
  usageLogs,
  loading,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  usageLogs: ProviderUsageLogRow[];
  loading: boolean;
}) {
  const consumed =
    ms === 'active'
      ? formatAmount(row.consumedCredits, row.consumedUsd) || '0 cr'
      : '—';

  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
  const ruleLimit = hasGlobalRule
    ? formatAmount(row.globalLimitCredits, row.globalLimitUsd)
    : 'Sin regla';

  const totalCreditsUsed = usageLogs.reduce((s, l) => s + (l.creditsUsed ?? 0), 0);
  const totalCostUsd = usageLogs.reduce((s, l) => s + (l.estimatedCostUsd ?? 0), 0);
  const recentOps = usageLogs.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard>
          <InfoRow label="Consumo del mes" value={consumed} />
          <InfoRow label="Límite de regla" value={ruleLimit} />
          {hasGlobalRule && (
            <InfoRow
              label="Disponible por regla"
              value={formatAmount(row.remainingCredits, row.remainingUsd)}
            />
          )}
          {row.quotaSyncedAt && (
            <InfoRow
              label="Cuota disponible (API)"
              value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
            />
          )}
        </SectionCard>

        {ms !== 'active' ? (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-6 flex items-center justify-center">
            <p className="text-sm text-muted-foreground text-center">
              {ms === 'not_measured'
                ? 'Este proveedor no genera consumo medido en SellUp.'
                : 'Aún no hay consumo registrado. Los datos aparecerán después de la primera ejecución.'}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-3">Acumulado en logs</p>
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 text-muted-foreground/50 animate-spin" />
                <span className="text-[11px] text-muted-foreground/60">Cargando...</span>
              </div>
            ) : usageLogs.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {totalCreditsUsed.toLocaleString()} cr registrados
                </p>
                {totalCostUsd > 0 && (
                  <p className="text-[11px] text-muted-foreground/70">
                    ${totalCostUsd.toFixed(4)} costo estimado acumulado
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/50">
                  {usageLogs.length} operaciones registradas
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">Sin logs disponibles aún.</p>
            )}
          </div>
        )}
      </div>

      {ms === 'active' && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Últimas operaciones</p>
          {loading ? (
            <LoadingPlaceholder label="Cargando operaciones..." />
          ) : recentOps.length === 0 ? (
            <EmptyBlock
              message="Sin operaciones registradas para este proveedor."
              sub="Los datos aparecen después de la primera ejecución."
            />
          ) : (
            <div className="space-y-1.5">
              {recentOps.map((log) => (
                <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 flex items-center gap-3">
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
                  <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-auto">
                    {formatDateShort(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ProgressiveNote>
        Los filtros avanzados por rol, grupo, usuario, agente y cuenta se incorporarán progresivamente.
      </ProgressiveNote>
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
  const errorCount = usageLogs.filter(
    (l) => l.status != null && (l.status.toLowerCase().includes('error') || l.status.toLowerCase().includes('fail')),
  ).length;

  const totalOps = usageLogs.length;
  const successRate = totalOps > 0 ? Math.round(((totalOps - errorCount) / totalOps) * 100) : null;

  const latestSync = syncLogs[0];
  const syncOk = latestSync?.syncStatus === 'success';

  const costMtd = row.usdCostMtd;
  const totalCostLogs = usageLogs.reduce((s, l) => s + (l.estimatedCostUsd ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        {/* Calidad de resultados */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Calidad de resultados</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            Tasa de resultados útiles vs totales por agente.
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : successRate != null ? (
            <p className="text-sm font-medium text-foreground">
              {successRate}%
              <span className="text-[10px] text-muted-foreground/60 ml-1.5 font-normal">
                ({totalOps - errorCount} / {totalOps} ops)
              </span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic">Sin datos suficientes</p>
          )}
        </div>

        {/* Costo vs utilidad */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Costo vs utilidad</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            Costo estimado del período registrado.
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : costMtd != null ? (
            <p className="text-sm font-medium text-foreground">${costMtd.toFixed(4)} MTD (API)</p>
          ) : totalCostLogs > 0 ? (
            <p className="text-sm font-medium text-foreground">${totalCostLogs.toFixed(4)} estimado logs</p>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic">Sin datos suficientes</p>
          )}
        </div>

        {/* Errores por agente */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-1">Errores por agente</p>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2">
            Frecuencia de errores en logs registrados.
          </p>
          {loading ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
              <span className="text-[10px] text-muted-foreground/50">Cargando...</span>
            </div>
          ) : totalOps > 0 ? (
            <p className="text-sm font-medium text-foreground">
              {errorCount}
              <span className="text-[10px] text-muted-foreground/60 ml-1.5 font-normal">
                error{errorCount !== 1 ? 'es' : ''} en {totalOps} ops
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

      <ProgressiveNote>
        Efectividad cruzará costo, calidad, errores y utilidad una vez que haya ejecuciones históricas suficientes registradas para este proveedor.
      </ProgressiveNote>
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
}

export function ProviderDetailSidepanel({
  provider,
  open,
  initialTab = 'resumen',
  onClose,
  onConfigureAllowance,
  allRules = [],
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
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SidepanelInitialTab)}>
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
            <TabConfiguracion row={provider} ms={ms} />
          </TabsContent>

          <TabsContent value="consumo">
            <TabConsumo row={provider} ms={ms} usageLogs={usageLogs} loading={loadingDetail} />
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
