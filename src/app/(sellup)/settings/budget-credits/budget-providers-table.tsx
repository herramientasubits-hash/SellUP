'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { MoreHorizontal, RefreshCw, Settings, Activity, BarChart2, DollarSign, ScrollText, Eye, X } from 'lucide-react';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { syncProviderQuota } from '@/modules/budgets';
import { deriveConsumedDisplay } from './budget-display';
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
import type { ProspectingConnectionPanelState, AiConnectionPanelState } from '../providers/provider-detail-actions';
import {
  resolveProviderWorkspaceUrlState,
  buildProviderWorkspaceParams,
} from './provider-workspace-url-state';

interface Props {
  providers: AdminProviderBudgetRow[];
  resolvedAt: string;
  allRules?: BudgetRuleRow[];
  providerConnectionStates?: Record<string, ProspectingConnectionPanelState>;
  aiProviderConnectionStates?: Record<string, AiConnectionPanelState>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function deriveConsumed(
  row: AdminProviderBudgetRow,
  ms: MeasurementStatus,
): { label: string; description?: string } {
  if (ms !== 'active') return { label: '—' };
  const result = deriveConsumedDisplay(row.consumedCredits, row.consumedUsd, row.hasUnknownCost);
  return result.label === '—' ? { label: '0 cr' } : result;
}

// ── Selection review panel ────────────────────────────────────────────────────

function SelectionReviewPanel({
  rows,
  onClose,
}: {
  rows: AdminProviderBudgetRow[];
  onClose: () => void;
}) {
  const totalCredits = rows.reduce((s, r) => s + (r.consumedCredits ?? 0), 0);
  const totalUsd = rows.reduce((s, r) => s + (r.consumedUsd ?? 0), 0);
  const totalHasUnknownCost = rows.some((r) => r.hasUnknownCost);
  const hasTotal = totalCredits > 0 || totalUsd > 0 || totalHasUnknownCost;
  const totalConsumed = deriveConsumedDisplay(totalCredits, totalUsd, totalHasUnknownCost);

  return (
    <div className="rounded-lg border border-su-brand/20 bg-muted/10 animate-su-fade-in">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
        <p className="text-xs font-medium text-foreground">
          {rows.length} proveedor{rows.length !== 1 ? 'es' : ''} seleccionado{rows.length !== 1 ? 's' : ''}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-muted/60 transition-colors"
          aria-label="Cerrar revisión"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="p-4 space-y-1.5">
        {rows.map((row) => {
          const ms = row.measurementStatus;
          const opType = getProviderOperationalType(row.providerKey);
          const msBadge = MEASUREMENT_STATUS_BADGE[ms];
          const opBadge = OPERATIONAL_TYPE_BADGE[opType];
          const consumed = deriveConsumed(row, ms);
          return (
            <div key={row.providerKey} className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-0">
              <span className="text-xs font-medium text-foreground min-w-0 truncate shrink-0" style={{ maxWidth: '10rem' }}>
                {row.displayName ?? row.providerKey}
              </span>
              <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]}
              </span>
              <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
              <span
                className="ml-auto shrink-0 text-[11px] text-muted-foreground whitespace-nowrap"
                title={consumed.description}
              >
                {consumed.label}
              </span>
            </div>
          );
        })}
        {hasTotal && (
          <div className="flex items-center justify-between pt-1 text-xs font-medium">
            <span className="text-muted-foreground/70">Total consumo del mes</span>
            <span title={totalConsumed.description}>{totalConsumed.label}</span>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed pt-1">
          Las acciones masivas se conectarán progresivamente. Por ahora puedes revisar la selección y abrir proveedores individuales.
        </p>
      </div>
    </div>
  );
}

// ── Main table ─────────────────────────────────────────────────────────────────

const LIGHT_TABLE_COLUMNS = ['Proveedor', 'Tipo', 'Estado', 'Consumo del mes', 'Alerta', 'Última sync', 'Acciones'];

const SYNC_CAPABLE_PROVIDERS = new Set(['tavily', 'lusha', 'apollo', 'anthropic']);

export function BudgetProvidersTable({ providers, resolvedAt, allRules = [], providerConnectionStates, aiProviderConnectionStates }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AdminProviderBudgetRow | null>(null);
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // ── Provider workspace URL state (Q3F-10E.1) ────────────────────────────────
  // The URL is the source of truth for which provider workspace (if any) is
  // open and on which tab. Selection/review/allowance-editing state above
  // stays local — only the sidepanel is addressable.
  const validProviderKeys = useMemo(() => new Set(providers.map((p) => p.providerKey)), [providers]);
  const rawProvider = searchParams.get('provider');
  const rawPtab = searchParams.get('ptab');
  const workspaceState = resolveProviderWorkspaceUrlState({ provider: rawProvider, ptab: rawPtab }, validProviderKeys);
  const sidepanelProvider = workspaceState.providerKey
    ? providers.find((p) => p.providerKey === workspaceState.providerKey) ?? null
    : null;
  const sidepanelTab = workspaceState.tab;

  // Canonicalize invalid provider/ptab combinations (unknown key, orphan
  // ptab, unknown tab) by replacing them out of the URL. Runs only when the
  // resolved canonical params actually differ, so it cannot loop.
  useEffect(() => {
    const canonical = buildProviderWorkspaceParams(searchParams, {
      providerKey: sidepanelProvider ? workspaceState.providerKey : null,
      tab: sidepanelProvider ? workspaceState.tab : null,
    });
    if (canonical.toString() === searchParams.toString()) return;
    const query = canonical.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawProvider, rawPtab, sidepanelProvider, pathname]);

  function openSidepanel(row: AdminProviderBudgetRow, tab: SidepanelInitialTab = 'resumen') {
    const params = buildProviderWorkspaceParams(searchParams, { providerKey: row.providerKey, tab });
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function closeSidepanel() {
    const params = buildProviderWorkspaceParams(searchParams, { providerKey: null, tab: null });
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function handleActiveTabChange(tab: SidepanelInitialTab) {
    if (!sidepanelProvider) return;
    const params = buildProviderWorkspaceParams(searchParams, { providerKey: sidepanelProvider.providerKey, tab });
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
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
      id: 'revisar',
      label: 'Revisar selección',
      icon: Eye,
      onClick: () => { setReviewOpen((v) => !v); },
    },
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
                    <td className="px-4 py-3 text-xs text-foreground whitespace-nowrap" title={consumed.description}>
                      {consumed.label}
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
                          <DropdownMenuItem onClick={() => openSidepanel(row, 'configuracion')}>
                            <Settings className="mr-2 h-3.5 w-3.5" />
                            Ver configuración
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {reviewOpen && selectedRows.length > 0 && (
          <SelectionReviewPanel rows={selectedRows} onClose={() => setReviewOpen(false)} />
        )}

        <p className="px-1 text-[11px] text-muted-foreground/50">
          Datos del período mensual actual · Actualizado {resolvedDate}
        </p>
      </div>

      <DataTableBulkActionBar
        selectedCount={selectedKeys.size}
        selectedRows={selectedRows}
        actions={bulkActions}
        onClear={() => { setSelectedKeys(new Set()); setReviewOpen(false); }}
      />

      <ProviderDetailSidepanel
        provider={sidepanelProvider}
        open={sidepanelProvider !== null}
        initialTab={sidepanelTab}
        onClose={closeSidepanel}
        onActiveTabChange={handleActiveTabChange}
        onConfigureAllowance={(row) => { closeSidepanel(); setEditingProvider(row); }}
        allRules={allRules}
        providerConnectionStates={providerConnectionStates}
        aiProviderConnectionStates={aiProviderConnectionStates}
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
