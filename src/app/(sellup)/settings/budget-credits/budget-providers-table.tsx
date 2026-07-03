'use client';

import { useState, useTransition } from 'react';
import { MoreHorizontal, RefreshCw, Settings, Activity, BarChart2, DollarSign, ScrollText, ExternalLink } from 'lucide-react';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { syncProviderQuota } from '@/modules/budgets';
import { DataTableBulkActionBar } from '@/components/data-table/data-table-bulk-action-bar';
import type { DataTableBulkAction } from '@/components/data-table/data-table';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  OPERATIONAL_TYPE_LABEL,
  OPERATIONAL_TYPE_BADGE,
} from '@/modules/budgets/provider-operational-type';
import { ProviderAllowanceDrawer } from './provider-allowance-drawer';
import {
  ProviderDetailSidepanel,
  type SidepanelInitialTab,
} from '../providers/provider-detail-sidepanel';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';

interface Props {
  providers: AdminProviderBudgetRow[];
  resolvedAt: string;
  allRules?: BudgetRuleRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
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

// ── Attention badge derivation ────────────────────────────────────────────────

type AttentionLevel = 'none' | 'warning' | 'exceeded' | 'quota_required';

function deriveAttention(row: AdminProviderBudgetRow): AttentionLevel {
  const hasAllowance = row.providerMonthlyCreditsAllowance != null || row.providerMonthlyUsdAllowance != null;
  if (row.quotaSource === 'sync_error' && !hasAllowance) return 'quota_required';
  if (row.remainingCredits != null && row.remainingCredits <= 0) return 'exceeded';
  if (row.remainingUsd != null && row.remainingUsd <= 0) return 'exceeded';
  const warnCredits = row.remainingCredits != null && row.globalLimitCredits != null && row.remainingCredits < row.globalLimitCredits * 0.2;
  const warnUsd = row.remainingUsd != null && row.globalLimitUsd != null && row.remainingUsd < row.globalLimitUsd * 0.2;
  if (warnCredits || warnUsd) return 'warning';
  return 'none';
}

const ATTENTION_BADGE: Record<Exclude<AttentionLevel, 'none'>, { label: string; className: string }> = {
  quota_required: { label: 'Cuota requerida', className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  warning:        { label: 'Advertencia',      className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  exceeded:       { label: 'Excedido',         className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

// ── Consumed display ──────────────────────────────────────────────────────────

function deriveConsumed(row: AdminProviderBudgetRow, ms: MeasurementStatus): string {
  if (ms !== 'active') return '—';
  const raw = formatAmount(row.consumedCredits, row.consumedUsd);
  return raw === '—' ? '0 cr' : raw;
}

// ── Main table ─────────────────────────────────────────────────────────────────

const LIGHT_TABLE_COLUMNS = ['Proveedor', 'Tipo', 'Estado', 'Consumo del mes', 'Alerta', 'Última sync', 'Acciones'];

const SYNC_CAPABLE_PROVIDERS = new Set(['tavily', 'lusha', 'apollo', 'anthropic']);

export function BudgetProvidersTable({ providers, resolvedAt, allRules = [] }: Props) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sidepanelProvider, setSidepanelProvider] = useState<AdminProviderBudgetRow | null>(null);
  const [sidepanelTab, setSidepanelTab] = useState<SidepanelInitialTab>('resumen');
  const [editingProvider, setEditingProvider] = useState<AdminProviderBudgetRow | null>(null);
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function openSidepanel(row: AdminProviderBudgetRow, tab: SidepanelInitialTab = 'resumen') {
    setSidepanelTab(tab);
    setSidepanelProvider(row);
  }

  const resolvedDate = new Date(resolvedAt).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const selectedRows = providers.filter((p) => selectedKeys.has(p.providerKey));
  const allSelected = providers.length > 0 && selectedKeys.size === providers.length;
  const someSelected = selectedKeys.size > 0 && !allSelected;

  function toggleAll() {
    setSelectedKeys(allSelected ? new Set() : new Set(providers.map((p) => p.providerKey)));
  }

  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleAllowanceSaved() {
    startTransition(() => { window.location.reload(); });
  }

  async function handleSyncRows(rows: AdminProviderBudgetRow[]) {
    const syncable = rows.filter((r) => SYNC_CAPABLE_PROVIDERS.has(r.providerKey));
    if (syncable.length === 0) return;
    setSyncingKeys(new Set(syncable.map((r) => r.providerKey)));
    try {
      for (const row of syncable) {
        const result = await syncProviderQuota(row.providerKey);
        if (result.success) {
          toast.success(
            result.skippedAllowance
              ? `${row.displayName ?? row.providerKey}: dato externo actualizado (cuota manual preservada)`
              : `${row.displayName ?? row.providerKey}: cuota sincronizada`,
          );
        } else {
          toast.error(`${row.displayName ?? row.providerKey}: ${result.error ?? 'No se pudo sincronizar'}`);
        }
      }
      window.location.reload();
    } catch {
      toast.error('No se pudo sincronizar');
    } finally {
      setSyncingKeys(new Set());
    }
  }

  const bulkActions: DataTableBulkAction<AdminProviderBudgetRow>[] = [
    {
      id: 'ver',
      label: 'Ver proveedor',
      icon: Activity,
      disabled: (rows) => rows.length !== 1,
      onClick: (rows) => { if (rows.length === 1) openSidepanel(rows[0]); },
    },
    {
      id: 'editar-cuota',
      label: 'Editar cuota',
      icon: Settings,
      disabled: (rows) => rows.length !== 1 || rows[0].measurementStatus === 'not_measured',
      onClick: (rows) => { if (rows.length === 1) setEditingProvider(rows[0]); },
    },
    {
      id: 'sync',
      label: syncingKeys.size > 0 ? 'Sincronizando…' : 'Sync',
      icon: RefreshCw,
      loading: syncingKeys.size > 0,
      disabled: (rows) => rows.every((r) => !SYNC_CAPABLE_PROVIDERS.has(r.providerKey)),
      onClick: (rows) => { void handleSyncRows(rows); },
    },
  ];

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
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Seleccionar todos los proveedores"
                  />
                </th>
                {LIGHT_TABLE_COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {providers.map((row) => {
                const ms = row.measurementStatus;
                const msBadge = MEASUREMENT_STATUS_BADGE[ms];
                const opType = getProviderOperationalType(row.providerKey);
                const isSelected = selectedKeys.has(row.providerKey);
                const attention = deriveAttention(row);
                const consumed = deriveConsumed(row, ms);

                const syncedAt = row.quotaSyncedAt
                  ? formatDateShort(row.quotaSyncedAt)
                  : row.latestBudgetCheckLog?.createdAt
                    ? formatDateShort(row.latestBudgetCheckLog.createdAt)
                    : null;

                return (
                  <tr
                    key={row.providerKey}
                    className={`hover:bg-muted/10 transition-colors ${isSelected ? 'bg-muted/20' : ''}`}
                  >
                    {/* Checkbox — selecting does NOT open sidepanel */}
                    <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(row.providerKey)}
                        aria-label={`Seleccionar ${row.displayName ?? row.providerKey}`}
                      />
                    </td>

                    {/* Proveedor — name click opens sidepanel */}
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => openSidepanel(row)}
                          className="font-medium text-foreground hover:text-su-brand transition-colors text-left whitespace-nowrap focus-visible:outline-none focus-visible:underline"
                        >
                          {row.displayName ?? row.providerKey}
                        </button>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${OPERATIONAL_TYPE_BADGE[opType]}`}>
                        {OPERATIONAL_TYPE_LABEL[opType]}
                      </span>
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                        {MEASUREMENT_STATUS_LABEL[ms]}
                      </span>
                    </td>

                    {/* Consumo del mes */}
                    <td className="px-4 py-3 text-xs text-foreground whitespace-nowrap">
                      {consumed}
                    </td>

                    {/* Alerta */}
                    <td className="px-4 py-3">
                      {attention !== 'none' ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${ATTENTION_BADGE[attention].className}`}>
                          {ATTENTION_BADGE[attention].label}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Última sync */}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {syncedAt ?? <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border">
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          <span className="sr-only">Acciones</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => openSidepanel(row, 'resumen')}>
                            <Activity className="mr-2 h-3.5 w-3.5" />
                            Ver resumen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openSidepanel(row, 'consumo')}>
                            <BarChart2 className="mr-2 h-3.5 w-3.5" />
                            Ver consumo
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openSidepanel(row, 'presupuesto')}>
                            <DollarSign className="mr-2 h-3.5 w-3.5" />
                            Presupuesto y reglas
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openSidepanel(row, 'logs')}>
                            <ScrollText className="mr-2 h-3.5 w-3.5" />
                            Ver logs
                          </DropdownMenuItem>
                          {row.measurementStatus !== 'not_measured' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setEditingProvider(row)}>
                                <Settings className="mr-2 h-3.5 w-3.5" />
                                Configurar cuota
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => { window.location.href = `/settings/providers/${row.providerKey}`; }}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            Abrir página completa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      <DataTableBulkActionBar
        selectedCount={selectedKeys.size}
        selectedRows={selectedRows}
        actions={bulkActions}
        onClear={() => setSelectedKeys(new Set())}
      />

      <ProviderDetailSidepanel
        provider={sidepanelProvider}
        open={sidepanelProvider !== null}
        initialTab={sidepanelTab}
        onClose={() => setSidepanelProvider(null)}
        onConfigureAllowance={(row) => { setSidepanelProvider(null); setEditingProvider(row); }}
        allRules={allRules}
      />

      <ProviderAllowanceDrawer
        provider={editingProvider}
        open={editingProvider !== null}
        onClose={() => setEditingProvider(null)}
        onSaved={handleAllowanceSaved}
      />
    </>
  );
}
