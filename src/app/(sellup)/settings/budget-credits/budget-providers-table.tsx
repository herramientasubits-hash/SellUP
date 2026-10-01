'use client';

import { formatAppDateTime, formatInAppZone } from '@/lib/format-date';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { RefreshCw, Settings, Activity, BarChart2, DollarSign, ScrollText, Eye, X, Layers } from "@/icons";
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { syncProviderQuota } from '@/modules/budgets';
import { deriveConsumedCell, deriveConsumedDisplay } from './budget-display';
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type DataTableBulkAction,
  type DataTableContextMenuItem,
} from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  OPERATIONAL_TYPE_LABEL,
  OPERATIONAL_TYPE_BADGE,
  type ProviderOperationalType,
} from '@/modules/budgets/provider-operational-type';
import { RowTitleButton } from '@/components/shared/table-cells';
import { SurfaceCard } from '@/components/shared/surface-card';
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
  return formatInAppZone(iso, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Cuándo se trajo por última vez la cuota del proveedor (o se revisó su presupuesto). */
function lastUpdatedAt(row: AdminProviderBudgetRow): string | null {
  return row.quotaSyncedAt ?? row.latestBudgetCheckLog?.createdAt ?? null;
}

const providerName = (row: AdminProviderBudgetRow) => row.displayName ?? row.providerKey;

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

const ATTENTION_BADGE: Record<Exclude<AttentionLevel, 'none'>, { label: string; variant: 'warning' | 'negative' }> = {
  quota_required: { label: 'Falta la cuota', variant: 'warning' },
  warning:        { label: 'Queda poco',     variant: 'warning' },
  exceeded:       { label: 'Cuota agotada',  variant: 'negative' },
};

const ATTENTION_FILTER_LABEL: Record<AttentionLevel, string> = {
  none: 'Sin alerta',
  quota_required: ATTENTION_BADGE.quota_required.label,
  warning: ATTENTION_BADGE.warning.label,
  exceeded: ATTENTION_BADGE.exceeded.label,
};

/** De más urgente a menos: así ordena la columna «Alerta». */
const ATTENTION_RANK: Record<AttentionLevel, number> = {
  exceeded: 3,
  quota_required: 2,
  warning: 1,
  none: 0,
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
    <SurfaceCard noPadding className="animate-su-fade-in">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <p className="text-xs font-medium text-foreground">
          {rows.length} proveedor{rows.length !== 1 ? 'es' : ''} seleccionado{rows.length !== 1 ? 's' : ''}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Cerrar revisión"
        >
          <X className="text-muted-foreground" />
        </Button>
      </div>
      <div className="p-4 space-y-1.5">
        {rows.map((row) => {
          const ms = row.measurementStatus;
          const opType = getProviderOperationalType(row.providerKey);
          const msBadge = MEASUREMENT_STATUS_BADGE[ms];
          const opBadge = OPERATIONAL_TYPE_BADGE[opType];
          const consumed = deriveConsumed(row, ms);
          return (
            <div key={row.providerKey} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
              <span className="min-w-0 max-w-40 shrink-0 truncate text-xs font-medium text-foreground" title={row.displayName ?? row.providerKey}>
                {row.displayName ?? row.providerKey}
              </span>
              <Badge variant="outline" className={opBadge}>
                {OPERATIONAL_TYPE_LABEL[opType]}
              </Badge>
              <Badge variant="outline" className={msBadge.className}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </Badge>
              <span
                className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                title={consumed.description}
              >
                {consumed.label}
              </span>
            </div>
          );
        })}
        {hasTotal && (
          <div className="flex items-center justify-between pt-1 text-xs font-medium">
            <span className="text-muted-foreground">Total consumo del mes</span>
            <span title={totalConsumed.description}>{totalConsumed.label}</span>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}

// ── Main table ─────────────────────────────────────────────────────────────────

const SYNC_CAPABLE_PROVIDERS = new Set(['tavily', 'lusha', 'apollo', 'anthropic']);

export function BudgetProvidersTable({ providers, resolvedAt, allRules = [], providerConnectionStates, aiProviderConnectionStates }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Las filas que se están revisando: se fijan al pulsar «Revisar selección».
  const [reviewRows, setReviewRows] = useState<AdminProviderBudgetRow[] | null>(null);
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

  const resolvedDate = formatAppDateTime(resolvedAt);

  // Sin filas marcadas no hay nada que revisar.
  const handleSelectionCount = useCallback((count: number) => {
    if (count === 0) setReviewRows(null);
  }, []);

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
              ? `${providerName(row)}: consumo actualizado (se conserva la cuota que fijaste a mano)`
              : `${providerName(row)}: cuota actualizada`,
          );
        } else {
          toast.error(`${providerName(row)}: ${result.error ?? 'no se pudo actualizar la cuota'}`);
        }
      }
      window.location.reload();
    } catch {
      toast.error('No se pudo actualizar la cuota. Inténtalo de nuevo.');
    } finally {
      setSyncingKeys(new Set());
    }
  }

  const bulkActions: DataTableBulkAction<AdminProviderBudgetRow>[] = [
    {
      id: 'revisar',
      label: 'Revisar selección',
      icon: Eye,
      onClick: (rows) => { setReviewRows((current) => (current ? null : rows)); },
    },
    {
      id: 'ver',
      label: 'Ver proveedor',
      icon: Activity,
      disabled: (rows) => rows.length !== 1,
      disabledLabel: (rows) => (rows.length !== 1 ? 'Marca un solo proveedor' : undefined),
      onClick: (rows) => { if (rows.length === 1) openSidepanel(rows[0]); },
    },
    {
      id: 'editar-cuota',
      label: 'Editar cuota',
      icon: Settings,
      disabled: (rows) => rows.length !== 1 || rows[0].measurementStatus === 'not_measured',
      disabledLabel: (rows) =>
        rows.length !== 1
          ? 'Marca un solo proveedor'
          : rows[0].measurementStatus === 'not_measured'
            ? 'El consumo de este proveedor no se mide desde SellUp'
            : undefined,
      onClick: (rows) => { if (rows.length === 1) setEditingProvider(rows[0]); },
    },
    {
      id: 'sync',
      label: syncingKeys.size > 0 ? 'Actualizando…' : 'Actualizar cuota',
      icon: RefreshCw,
      loading: syncingKeys.size > 0,
      disabled: (rows) => rows.every((r) => !SYNC_CAPABLE_PROVIDERS.has(r.providerKey)),
      disabledLabel: (rows) =>
        rows.every((r) => !SYNC_CAPABLE_PROVIDERS.has(r.providerKey))
          ? 'Estos proveedores no informan su cuota'
          : undefined,
      onClick: (rows) => { void handleSyncRows(rows); },
    },
  ];

  const rowMenuItems = (row: AdminProviderBudgetRow): DataTableContextMenuItem[] => {
    const items: DataTableContextMenuItem[] = [
      { id: 'resumen', label: 'Ver resumen', icon: Activity, onClick: () => openSidepanel(row, 'resumen') },
      { id: 'consumo', label: 'Ver consumo', icon: BarChart2, onClick: () => openSidepanel(row, 'consumo') },
      { id: 'presupuesto', label: 'Presupuesto y reglas', icon: DollarSign, onClick: () => openSidepanel(row, 'presupuesto') },
      { id: 'logs', label: 'Ver historial de uso', icon: ScrollText, onClick: () => openSidepanel(row, 'logs') },
      { id: 'configuracion', label: 'Ver configuración', icon: Settings, onClick: () => openSidepanel(row, 'configuracion') },
    ];
    if (row.measurementStatus !== 'not_measured') {
      items.push({
        id: 'cuota',
        label: 'Configurar cuota',
        icon: Settings,
        separator: true,
        onClick: () => setEditingProvider(row),
      });
    }
    return items;
  };

  const typeOptions = Array.from(new Set(providers.map((p) => getProviderOperationalType(p.providerKey))))
    .map((type) => ({ label: OPERATIONAL_TYPE_LABEL[type], value: type }));
  const statusOptions = Array.from(new Set(providers.map((p) => p.measurementStatus)))
    .map((status) => ({ label: MEASUREMENT_STATUS_LABEL[status], value: status }));
  const attentionOptions = Array.from(new Set(providers.map(deriveAttention)))
    .sort((a, b) => ATTENTION_RANK[b] - ATTENTION_RANK[a])
    .map((level) => ({ label: ATTENTION_FILTER_LABEL[level], value: level }));

  const columns: ColumnDef<AdminProviderBudgetRow, unknown>[] = [
    {
      id: 'provider',
      accessorFn: providerName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
      cell: ({ row }) => (
        <RowTitleButton onClick={() => openSidepanel(row.original)}>
          {providerName(row.original)}
        </RowTitleButton>
      ),
      size: 200,
      enableHiding: false,
      meta: { label: 'Proveedor', disableFilter: true },
    },
    {
      id: 'type',
      accessorFn: (row): ProviderOperationalType => getProviderOperationalType(row.providerKey),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      // Categoría en texto plano: el color queda para Estado y Alerta.
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {OPERATIONAL_TYPE_LABEL[getValue<ProviderOperationalType>()]}
        </span>
      ),
      size: 150,
      meta: { label: 'Tipo', filterOptions: typeOptions },
    },
    {
      id: 'status',
      accessorKey: 'measurementStatus',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const ms = row.original.measurementStatus;
        return (
          <Badge variant="outline" className={MEASUREMENT_STATUS_BADGE[ms].className}>
            {MEASUREMENT_STATUS_LABEL[ms]}
          </Badge>
        );
      },
      size: 180,
      meta: { label: 'Estado', filterOptions: statusOptions },
    },
    {
      id: 'consumed',
      // Se ordena por lo gastado en dólares y, a igualdad, por créditos. Lo
      // que no se mide va al final.
      accessorFn: (row) =>
        row.measurementStatus === 'active' ? row.consumedUsd * 1_000_000 + row.consumedCredits : -1,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Consumo del mes" />,
      cell: ({ row }) => {
        const consumed = deriveConsumedCell(row.original, row.original.measurementStatus === 'active');
        return (
          <div className="whitespace-nowrap tabular-nums" title={consumed.description}>
            <p className="text-sm font-medium text-foreground">{consumed.primary}</p>
            {consumed.secondary && <p className="text-xs text-muted-foreground">{consumed.secondary}</p>}
          </div>
        );
      },
      size: 170,
      sortDescFirst: true,
      meta: { label: 'Consumo del mes', disableFilter: true },
    },
    {
      id: 'attention',
      accessorFn: (row): AttentionLevel => deriveAttention(row),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Alerta" />,
      cell: ({ getValue }) => {
        const attention = getValue<AttentionLevel>();
        return attention !== 'none' ? (
          <Badge variant={ATTENTION_BADGE[attention].variant}>{ATTENTION_BADGE[attention].label}</Badge>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        );
      },
      sortingFn: (a, b, columnId) =>
        ATTENTION_RANK[a.getValue<AttentionLevel>(columnId)] - ATTENTION_RANK[b.getValue<AttentionLevel>(columnId)],
      sortDescFirst: true,
      size: 150,
      meta: { label: 'Alerta', filterOptions: attentionOptions },
    },
    {
      id: 'updatedAt',
      accessorFn: (row) => lastUpdatedAt(row) ?? '',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Última actualización" />,
      cell: ({ row }) => {
        const iso = lastUpdatedAt(row.original);
        return (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {iso ? formatDateShort(iso) : <span className="text-text-muted">Nunca</span>}
          </span>
        );
      },
      sortDescFirst: true,
      size: 170,
      meta: { label: 'Última actualización', disableFilter: true },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        // Abrir el menú no debe contar como clic en la fila.
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DataTableRowActions items={rowMenuItems(row.original)} rowLabel={providerName(row.original)} />
        </div>
      ),
      size: 56,
      enableSorting: false,
      enableHiding: false,
      enableColumnFilter: false,
      meta: { label: 'Acciones', disableFilter: true, disableSort: true },
    },
  ];

  return (
    <>
      <div className="space-y-3">
        <DataTable
          tableId="settings-providers"
          noun="proveedores"
          nounGender="m"
          title="Proveedores"
          description={`Consumo del mes en curso · Actualizado ${resolvedDate}`}
          count={providers.length}
          columns={columns}
          data={providers}
          getRowId={(row) => row.providerKey}
          getRowLabel={providerName}
          enableRowSelection
          bulkActions={bulkActions}
          onSelectionCountChange={handleSelectionCount}
          contextMenu={{ items: rowMenuItems }}
          rowClickable
          onRowClick={(row) => openSidepanel(row)}
          emptyState={
            <EmptyState
              variant="plain"
              icon={Layers}
              title="Todavía no hay proveedores"
              description="Cuando conectes un proveedor de datos o de IA aparecerá aquí con su consumo del mes."
            />
          }
        />

        {reviewRows && reviewRows.length > 0 && (
          <SelectionReviewPanel rows={reviewRows} onClose={() => setReviewRows(null)} />
        )}
      </div>

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
