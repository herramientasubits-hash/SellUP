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

function computeStatus(row: AdminProviderBudgetRow): 'no_rule' | 'ok' | 'warning' | 'exceeded' {
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

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  no_rule:  { label: 'Sin regla',    className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  ok:       { label: 'OK',           className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  warning:  { label: 'Advertencia',  className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  exceeded: { label: 'Excedido',     className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

const ACTION_LABEL: Record<BudgetOnExceed | 'none', string> = {
  alert:            'Alertar',
  block:            'Bloquear',
  require_approval: 'Requiere aprobación',
  none:             'No configurado',
};

const OUTCOME_BADGE: Record<string, { label: string; className: string }> = {
  allowed:       { label: 'Permitido',         className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  alerted:       { label: 'Alerta',            className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  would_block:   { label: 'Habría bloqueado',  className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  technical_error:{ label: 'Error técnico',    className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  missing_user:  { label: 'Sin usuario',       className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  unknown:       { label: 'Desconocido',       className: 'border-border/40 bg-muted/30 text-muted-foreground' },
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

// ── Side panel ────────────────────────────────────────────────────────────

function ProviderActivityDrawer({
  provider,
  open,
  onClose,
}: {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  onClose: () => void;
}) {
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
          {provider.recentBudgetCheckLogs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No hay evaluaciones de presupuesto registradas para este proveedor.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Las evaluaciones aparecen aquí después de la primera ejecución.
              </p>
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

// ── Main table ────────────────────────────────────────────────────────────────

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
                {[
                  'Proveedor',
                  'Reglas activas',
                  'Consumido',
                  'Límite global',
                  'Disponible',
                  'Estado',
                  'Última evaluación',
                  'Acción configurada',
                  '',
                ].map((col) => (
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
                const status = computeStatus(row);
                const badge = STATUS_BADGE[status];
                const actionKey: BudgetOnExceed | 'none' = (row.onExceed as BudgetOnExceed) ?? 'none';
                const consumed = formatAmount(row.consumedCredits, row.consumedUsd);
                const limit = formatAmount(row.globalLimitCredits, row.globalLimitUsd);
                const available = formatAmount(row.remainingCredits, row.remainingUsd);

                return (
                  <tr
                    key={row.providerKey}
                    className="hover:bg-muted/10 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-foreground">
                          {row.displayName ?? row.providerKey}
                        </span>
                        <span className="ml-2 text-[10px] text-muted-foreground/60">
                          {row.providerKey}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.activeRules > 0 ? row.activeRules : '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground">{consumed}</td>
                    <td className="px-4 py-3 text-foreground">{limit}</td>
                    <td className="px-4 py-3 text-foreground">{available}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <LatestEvalCell log={row.latestBudgetCheckLog ?? null} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {ACTION_LABEL[actionKey]}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setSelectedProvider(row)}
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
