'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import type { AdminProviderBudgetRow, BudgetCheckLogEntry } from '@/modules/budgets';
import {
  parseBudgetCheck,
  SCOPE_LABEL,
  ON_EXCEED_LABEL,
} from '@/modules/budgets';
import type { BudgetOnExceed } from '@/modules/usage-tracking/types';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_DESCRIPTION,
  MEASUREMENT_STATUS_BADGE,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';

interface Props {
  providers: AdminProviderBudgetRow[];
  resolvedAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatAmount(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

type BudgetStatus = 'no_rule' | 'ok' | 'warning' | 'exceeded';

function computeBudgetStatus(row: AdminProviderBudgetRow): BudgetStatus {
  if (row.activeRules === 0) return 'no_rule';
  const overCredits = row.remainingCredits != null && row.remainingCredits <= 0;
  const overUsd = row.remainingUsd != null && row.remainingUsd <= 0;
  if (overCredits || overUsd) return 'exceeded';
  const warnCredits =
    row.remainingCredits != null &&
    row.globalLimitCredits != null &&
    row.remainingCredits < row.globalLimitCredits * 0.2;
  const warnUsd =
    row.remainingUsd != null &&
    row.globalLimitUsd != null &&
    row.remainingUsd < row.globalLimitUsd * 0.2;
  if (warnCredits || warnUsd) return 'warning';
  return 'ok';
}

const BUDGET_STATUS_BADGE: Record<BudgetStatus, { label: string; className: string }> = {
  no_rule:  { label: 'Sin regla',    className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  ok:       { label: 'OK',           className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  warning:  { label: 'Advertencia',  className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  exceeded: { label: 'Excedido',     className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

const STATUS_BADGE_NOT_MEASURED = { label: 'No medido',  className: 'border-border/30 bg-muted/20 text-muted-foreground/60' };
const STATUS_BADGE_PREPARED    = { label: 'Preparado',  className: 'border-border/40 bg-muted/30 text-muted-foreground' };
const STATUS_BADGE_CONNECTED   = { label: 'Conectado',  className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };

const ACTION_LABEL: Record<BudgetOnExceed | 'none', string> = {
  alert:            'Alertar',
  block:            'Bloquear',
  require_approval: 'Requiere aprobación',
  none:             'No configurado',
};

const OUTCOME_BADGE: Record<string, { label: string; className: string }> = {
  allowed:        { label: 'Permitido',         className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  alerted:        { label: 'Alerta',            className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  would_block:    { label: 'Habría bloqueado',  className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  technical_error:{ label: 'Error técnico',     className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  missing_user:   { label: 'Sin usuario',       className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  unknown:        { label: 'Desconocido',       className: 'border-border/40 bg-muted/30 text-muted-foreground' },
};

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// ── Derived display values per measurement status ─────────────────────────────

interface RowDisplay {
  consumed: string;
  limit: string;
  available: string;
  statusBadge: { label: string; className: string };
  actionLabel: string;
  canViewEvals: boolean;
}

function deriveRowDisplay(row: AdminProviderBudgetRow, ms: MeasurementStatus): RowDisplay {
  if (ms === 'not_measured') {
    return {
      consumed:     '—',
      limit:        'No aplica',
      available:    'No aplica',
      statusBadge:  STATUS_BADGE_NOT_MEASURED,
      actionLabel:  'No aplica',
      canViewEvals: false,
    };
  }

  if (ms === 'prepared') {
    const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
    return {
      consumed:     '—',
      limit:        hasGlobalRule ? formatAmount(row.globalLimitCredits, row.globalLimitUsd) : 'Sin regla',
      available:    hasGlobalRule ? formatAmount(row.remainingCredits, row.remainingUsd) : 'No aplica',
      statusBadge:  STATUS_BADGE_PREPARED,
      actionLabel:  row.onExceed ? ACTION_LABEL[row.onExceed] : 'No configurado',
      canViewEvals: true,
    };
  }

  if (ms === 'connected') {
    const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
    return {
      consumed:     '—',
      limit:        hasGlobalRule ? formatAmount(row.globalLimitCredits, row.globalLimitUsd) : 'Sin regla',
      available:    hasGlobalRule ? formatAmount(row.remainingCredits, row.remainingUsd) : 'No aplica',
      statusBadge:  STATUS_BADGE_CONNECTED,
      actionLabel:  row.onExceed ? ACTION_LABEL[row.onExceed] : 'No configurado',
      canViewEvals: true,
    };
  }

  // active — explicitly show '0 cr' instead of '—' so the row doesn't look empty
  const rawConsumed = formatAmount(row.consumedCredits, row.consumedUsd);
  const consumed = rawConsumed === '—' ? '0 cr' : rawConsumed;

  const budgetStatus = computeBudgetStatus(row);
  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
  const hasSpecificRulesOnly = row.activeRules > 0 && !hasGlobalRule;

  const limit = hasGlobalRule
    ? formatAmount(row.globalLimitCredits, row.globalLimitUsd)
    : hasSpecificRulesOnly
      ? 'Reglas específicas'
      : 'Sin regla';

  const available = hasGlobalRule
    ? formatAmount(row.remainingCredits, row.remainingUsd)
    : hasSpecificRulesOnly
      ? 'Ver reglas'
      : 'No aplica';

  const actionKey: BudgetOnExceed | 'none' = hasSpecificRulesOnly
    ? 'none'
    : (row.onExceed as BudgetOnExceed) ?? 'none';

  const actionLabel = hasSpecificRulesOnly
    ? 'Por alcance'
    : ACTION_LABEL[actionKey];

  return {
    consumed,
    limit,
    available,
    statusBadge:  BUDGET_STATUS_BADGE[budgetStatus],
    actionLabel,
    canViewEvals: true,
  };
}

// ── Latest evaluation cell ─────────────────────────────────────────────────

function LatestEvalCell({ log }: { log: BudgetCheckLogEntry | null }) {
  if (!log) {
    return <span className="text-xs text-muted-foreground/60">Sin evaluaciones</span>;
  }

  const parsed = parseBudgetCheck(log.budgetCheck);
  if (!parsed) {
    return <span className="text-xs text-muted-foreground/60">Sin evaluaciones</span>;
  }

  const badge = OUTCOME_BADGE[parsed.outcome] ?? OUTCOME_BADGE['unknown'];

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
      >
        {badge.label}
      </span>
      <span className="text-[10px] text-muted-foreground/60">{formatDateShort(log.createdAt)}</span>
    </div>
  );
}

// ── Side panel — single log entry ─────────────────────────────────────────

function LogEntryCard({ log }: { log: BudgetCheckLogEntry }) {
  const parsed = parseBudgetCheck(log.budgetCheck);
  const outcomeBadge = parsed
    ? (OUTCOME_BADGE[parsed.outcome] ?? OUTCOME_BADGE['unknown'])
    : null;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-foreground">
            {log.operationKey ?? 'operación general'}
          </p>
          <p className="text-[10px] text-muted-foreground/70">{formatDateLong(log.createdAt)}</p>
        </div>
        {outcomeBadge && (
          <span
            className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${outcomeBadge.className}`}
          >
            {outcomeBadge.label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {log.creditsUsed != null && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Créditos usados</span>
            <p className="font-medium text-foreground">{log.creditsUsed.toLocaleString()} cr</p>
          </div>
        )}
        {log.estimatedCostUsd != null && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Costo estimado</span>
            <p className="font-medium text-foreground">${log.estimatedCostUsd.toFixed(4)}</p>
          </div>
        )}
        {parsed?.consumedCredits != null && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Consumido al momento</span>
            <p className="font-medium text-foreground">{parsed.consumedCredits.toLocaleString()} cr</p>
          </div>
        )}
        {parsed?.projectedCredits != null && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Proyectado</span>
            <p className="font-medium text-foreground">{parsed.projectedCredits.toLocaleString()} cr</p>
          </div>
        )}
        {parsed?.remainingCredits != null && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Restante</span>
            <p className="font-medium text-foreground">{parsed.remainingCredits.toLocaleString()} cr</p>
          </div>
        )}
        {parsed?.scopeApplied && parsed.scopeApplied !== 'none' && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Alcance</span>
            <p className="font-medium text-foreground">
              {SCOPE_LABEL[parsed.scopeApplied] ?? parsed.scopeApplied}
            </p>
          </div>
        )}
        {parsed?.onExceed && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Acción configurada</span>
            <p className="font-medium text-foreground">
              {ON_EXCEED_LABEL[parsed.onExceed] ?? parsed.onExceed}
            </p>
          </div>
        )}
        {log.status && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Estado log</span>
            <p className="font-medium text-foreground capitalize">{log.status}</p>
          </div>
        )}
      </div>

      {parsed?.reason && parsed.reason !== 'missing_user_id' && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-500/80 mb-1">Razón</p>
          <p className="text-xs text-amber-600 dark:text-amber-400 break-words">{parsed.reason}</p>
        </div>
      )}

      {parsed?.technicalError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-destructive/80 mb-1">Error técnico</p>
          <p className="text-xs text-destructive break-words">{parsed.technicalError}</p>
        </div>
      )}
    </div>
  );
}

// ── Side panel status header ──────────────────────────────────────────────────

function DrawerStatusHeader({
  row,
  ms,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
}) {
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
  const ruleLabel = row.activeRules === 0
    ? 'Ninguna'
    : hasGlobalRule
      ? 'Global'
      : 'Específicas (por alcance)';

  return (
    <div className="mb-5 rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Estado de medición</p>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${msBadge.className}`}
          >
            {MEASUREMENT_STATUS_LABEL[ms]}
          </span>
        </div>
        {ms === 'active' && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Regla en última evaluación</p>
            <p className="text-xs font-medium text-foreground">{ruleLabel}</p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        {ms === 'not_measured'
          ? 'Este proveedor no está siendo medido como consumo directo de SellUp por ahora.'
          : ms === 'prepared'
            ? 'Este proveedor todavía no tiene conexión configurada en SellUp.'
            : ms === 'connected'
              ? 'Este proveedor está configurado y conectado. SellUp todavía no registra consumo directo desde esta herramienta.'
              : 'Las evaluaciones se registran cuando el proveedor consume créditos desde SellUp.'}
      </p>
    </div>
  );
}

// ── Side panel ────────────────────────────────────────────────────────────────

function ProviderActivityDrawer({
  provider,
  open,
  onClose,
}: {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const ms = provider ? provider.measurementStatus : 'prepared';

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      size="lg"
      title={provider?.displayName ?? provider?.providerKey ?? 'Proveedor'}
      description="Últimas evaluaciones de presupuesto registradas para este proveedor."
      icon={<Activity className="h-4 w-4 text-su-brand" />}
      footer={
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border/50 bg-muted/20 px-7 py-4">
          <Link href="/settings/budget-credits/rules">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
              Gestionar reglas
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      {provider && (
        <div className="space-y-3">
          <DrawerStatusHeader row={provider} ms={ms} />

          {provider.recentBudgetCheckLogs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {ms === 'not_measured'
                  ? 'Este proveedor no genera evaluaciones de presupuesto en SellUp.'
                  : 'No hay evaluaciones de presupuesto registradas para este proveedor.'}
              </p>
              {ms !== 'not_measured' && (
                <p className="text-xs text-muted-foreground/60">
                  Las evaluaciones aparecen aquí después de la primera ejecución.
                </p>
              )}
            </div>
          ) : (
            provider.recentBudgetCheckLogs.map((log) => (
              <LogEntryCard key={log.id} log={log} />
            ))
          )}
        </div>
      )}
    </DrawerShell>
  );
}

// ── Main table ─────────────────────────────────────────────────────────────────

const COLUMNS = [
  'Proveedor',
  'Reglas activas',
  'Consumo del mes',
  'Límite por regla',
  'Disponible por regla',
  'Estado de presupuesto',
  'Última evaluación',
  'Acción configurada',
  '',
];

export function BudgetProvidersTable({ providers, resolvedAt }: Props) {
  const [selectedProvider, setSelectedProvider] = useState<AdminProviderBudgetRow | null>(null);

  const resolvedDate = new Date(resolvedAt).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Aún no hay reglas de presupuesto configuradas. Este panel ya puede mostrar consumo registrado por proveedor.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                {COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {providers.map((row) => {
                const ms = row.measurementStatus;
                const display = deriveRowDisplay(row, ms);
                const msBadge = MEASUREMENT_STATUS_BADGE[ms];

                return (
                  <tr
                    key={row.providerKey}
                    className="hover:bg-muted/10 transition-colors"
                  >
                    {/* Proveedor */}
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">
                          {row.displayName ?? row.providerKey}
                        </span>
                        <div>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}
                          >
                            {MEASUREMENT_STATUS_LABEL[ms]}
                          </span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground/50">
                            {MEASUREMENT_STATUS_DESCRIPTION[ms]}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Reglas activas */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {ms === 'not_measured' ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : row.activeRules > 0 ? (
                        row.activeRules
                      ) : (
                        '—'
                      )}
                    </td>

                    {/* Consumo del mes */}
                    <td className="px-4 py-3 text-foreground">{display.consumed}</td>

                    {/* Límite por regla */}
                    <td className="px-4 py-3 text-foreground text-xs">{display.limit}</td>

                    {/* Disponible por regla */}
                    <td className="px-4 py-3 text-foreground text-xs">{display.available}</td>

                    {/* Estado de presupuesto */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${display.statusBadge.className}`}
                      >
                        {display.statusBadge.label}
                      </span>
                    </td>

                    {/* Última evaluación */}
                    <td className="px-4 py-3">
                      {ms === 'not_measured' ? (
                        <span className="text-xs text-muted-foreground/40">No aplica</span>
                      ) : (
                        <LatestEvalCell log={row.latestBudgetCheckLog ?? null} />
                      )}
                    </td>

                    {/* Acción configurada */}
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {display.actionLabel}
                    </td>

                    {/* Ver evaluaciones */}
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                        onClick={() => display.canViewEvals && setSelectedProvider(row)}
                        disabled={!display.canViewEvals}
                        aria-label={`Ver evaluaciones de ${row.displayName ?? row.providerKey}`}
                      >
                        <Activity className="h-3 w-3 mr-1" />
                        Ver evaluaciones
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="px-1 text-[11px] text-muted-foreground/50">
          Datos del período mensual actual · Actualizado {resolvedDate}
        </p>
      </div>

      <ProviderActivityDrawer
        provider={selectedProvider}
        open={selectedProvider !== null}
        onClose={() => setSelectedProvider(null)}
      />
    </>
  );
}
