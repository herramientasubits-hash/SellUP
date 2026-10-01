'use client';

import { formatInAppZone } from '@/lib/format-date';
import { useState } from 'react';
import { Plus, Pencil, Power, ShieldAlert, Trash2 } from "@/icons";
import type { ColumnDef } from '@tanstack/react-table';
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type DataTableBulkAction,
  type DataTableContextMenuItem,
} from '@/components/data-table';
import { StatusBadge } from '@/components/data-display/status-badge';
import { SettingsPage } from '@/components/settings/settings-page';
import { LegacyCompatBanner } from '../../legacy-compat-banner';
import { Button } from '@/components/ui/button';
import { DrawerShell } from '@/components/shared/drawer-shell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createBudgetRule, updateBudgetRule, toggleBudgetRuleStatus, deleteBudgetRule } from '@/modules/budgets/rule-actions';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import type { BudgetOnExceed, BudgetPeriodType, BudgetScopeType } from '@/modules/usage-tracking/types';

// ─── Display helpers ──────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<BudgetPeriodType, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
  custom: 'Personalizado',
};

const ON_EXCEED_LABELS: Record<BudgetOnExceed, string> = {
  alert: 'Alertar',
  block: 'Bloquear',
  require_approval: 'Requiere aprobación',
};

const SCOPE_LABELS: Record<BudgetScopeType, string> = {
  global: 'Global',
  role: 'Rol',
  group: 'Grupo',
  user: 'Usuario',
};

function formatLimit(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString('es-CO')} ${credits === 1 ? 'crédito' : 'créditos'}`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)} USD`);
  return parts.join(' · ') || '—';
}

function formatDate(iso: string): string {
  return formatInAppZone(iso, { dateStyle: 'short' }, 'es-CO');
}

// ─── Shared form fields ───────────────────────────────────────────────────────

function FieldWrapper({ children }: { children: React.ReactNode }) {
  return <div className="w-full space-y-1.5">{children}</div>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  providerKey: string;
  scopeType: BudgetScopeType;
  scopeId: string;
  periodType: BudgetPeriodType;
  limitCredits: string;
  limitUsd: string;
  onExceed: BudgetOnExceed;
  notes: string;
}

const DEFAULT_FORM: FormState = {
  providerKey: '',
  scopeType: 'global',
  scopeId: '',
  periodType: 'monthly',
  limitCredits: '',
  limitUsd: '',
  onExceed: 'alert',
  notes: '',
};

// ─── Create drawer ────────────────────────────────────────────────────────────

export function CreateDrawer({
  options,
  open,
  onOpenChange,
  defaultProviderKey,
  onSuccess,
}: {
  options: BudgetRuleFormOptions;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultProviderKey?: string;
  onSuccess?: () => void;
}) {
  const makeInitial = (): FormState => ({
    ...DEFAULT_FORM,
    providerKey: defaultProviderKey ?? '',
  });

  const [form, setForm] = useState<FormState>(makeInitial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (key === 'scopeType') {
      setForm((prev) => ({ ...prev, scopeType: value as BudgetScopeType, scopeId: '' }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
  }

  function reset() {
    setForm(makeInitial());
    setError(null);
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    const credits = form.limitCredits ? parseFloat(form.limitCredits) : null;
    const usd = form.limitUsd ? parseFloat(form.limitUsd) : null;
    const result = await createBudgetRule({
      providerKey: form.providerKey,
      scopeType: form.scopeType,
      scopeId: form.scopeType === 'global' ? null : form.scopeId || null,
      periodType: form.periodType,
      limitCredits: credits,
      limitUsd: usd,
      onExceed: form.onExceed,
      notes: form.notes.trim() || null,
    });
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }
    reset();
    onOpenChange(false);
    if (onSuccess) onSuccess(); else window.location.reload();
  }

  const scopeNeedsSelector = form.scopeType !== 'global';
  const canSubmit =
    !!form.providerKey &&
    (!scopeNeedsSelector || !!form.scopeId) &&
    (!!form.limitCredits || !!form.limitUsd) &&
    !loading;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Nueva regla de presupuesto"
      description="Define un límite por proveedor, alcance y período."
      icon={<ShieldAlert className="h-4 w-4 text-primary" />}
      size="md"
      actions={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => { onOpenChange(false); reset(); }}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? 'Creando...' : 'Crear regla'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Proveedor */}
        <FieldWrapper>
          <Label>Proveedor <span className="text-destructive">*</span></Label>
          {defaultProviderKey ? (
            <div className="flex h-10 w-full items-center rounded-md border border-border/60 bg-surface-subtle px-3 text-sm text-muted-foreground">
              {options.providers.find((p) => p.providerKey === defaultProviderKey)?.displayName ?? defaultProviderKey}
            </div>
          ) : (
            <Select value={form.providerKey || undefined} onValueChange={(v) => set('providerKey', v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar proveedor" />
              </SelectTrigger>
              <SelectContent>
                {options.providers.map((p) => (
                  <SelectItem key={p.providerKey} value={p.providerKey}>
                    {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FieldWrapper>

        {/* Alcance */}
        <FieldWrapper>
          <Label>Alcance <span className="text-destructive">*</span></Label>
          <Select
            value={form.scopeType}
            onValueChange={(v) => set('scopeType', v as BudgetScopeType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SCOPE_LABELS) as BudgetScopeType[]).map((k) => (
                <SelectItem key={k} value={k}>{SCOPE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>

        {/* Selector dinámico */}
        {form.scopeType === 'role' && (
          <FieldWrapper>
            <Label>Rol <span className="text-destructive">*</span></Label>
            <Select value={form.scopeId || undefined} onValueChange={(v) => set('scopeId', v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {options.roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldWrapper>
        )}

        {form.scopeType === 'group' && (
          <FieldWrapper>
            <Label>Grupo <span className="text-destructive">*</span></Label>
            <Select value={form.scopeId || undefined} onValueChange={(v) => set('scopeId', v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar grupo" />
              </SelectTrigger>
              <SelectContent>
                {options.groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.displayPath}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldWrapper>
        )}

        {form.scopeType === 'user' && (
          <FieldWrapper>
            <Label>Usuario <span className="text-destructive">*</span></Label>
            <Select value={form.scopeId || undefined} onValueChange={(v) => set('scopeId', v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar usuario" />
              </SelectTrigger>
              <SelectContent>
                {options.users.length === 0 ? (
                  <SelectItem value="_empty" disabled>Sin usuarios activos</SelectItem>
                ) : (
                  options.users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </FieldWrapper>
        )}

        {/* Período */}
        <FieldWrapper>
          <Label>Período <span className="text-destructive">*</span></Label>
          <Select value={form.periodType} onValueChange={(v) => set('periodType', v as BudgetPeriodType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as BudgetPeriodType[]).filter(k => k !== 'custom').map((k) => (
                <SelectItem key={k} value={k}>{PERIOD_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>

        {/* Límites */}
        <div className="grid grid-cols-2 gap-3">
          <FieldWrapper>
            <Label htmlFor="cr-credits">Límite créditos</Label>
            <Input
              id="cr-credits"
              type="number"
              min="1"
              placeholder="0"
              className="w-full"
              value={form.limitCredits}
              onChange={(e) => set('limitCredits', e.target.value)}
            />
          </FieldWrapper>
          <FieldWrapper>
            <Label htmlFor="cr-usd">Límite USD</Label>
            <Input
              id="cr-usd"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              className="w-full"
              value={form.limitUsd}
              onChange={(e) => set('limitUsd', e.target.value)}
            />
          </FieldWrapper>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Al menos uno es obligatorio. Ambos pueden coexistir.
        </p>

        {/* Acción al superar */}
        <FieldWrapper>
          <Label>Acción al superar <span className="text-destructive">*</span></Label>
          <Select value={form.onExceed} onValueChange={(v) => set('onExceed', v as BudgetOnExceed)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ON_EXCEED_LABELS) as BudgetOnExceed[]).map((k) => (
                <SelectItem key={k} value={k}>{ON_EXCEED_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>

        {/* Notas */}
        <FieldWrapper>
          <Label htmlFor="cr-notes">
            Notas <span className="text-xs text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="cr-notes"
            rows={2}
            placeholder="Contexto adicional..."
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="w-full resize-none"
          />
        </FieldWrapper>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </DrawerShell>
  );
}

// ─── Edit drawer ──────────────────────────────────────────────────────────────

export function EditDrawer({
  rule,
  open,
  onOpenChange,
  onSuccess,
}: {
  rule: BudgetRuleRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
}) {
  const [limitCredits, setLimitCredits] = useState('');
  const [limitUsd, setLimitUsd] = useState('');
  const [onExceed, setOnExceed] = useState<BudgetOnExceed>('alert');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ruleId = rule?.id;
  const [lastRuleId, setLastRuleId] = useState<string | undefined>(undefined);
  if (ruleId !== lastRuleId) {
    setLastRuleId(ruleId);
    if (rule) {
      setLimitCredits(rule.limit_credits != null ? String(rule.limit_credits) : '');
      setLimitUsd(rule.limit_usd != null ? String(rule.limit_usd) : '');
      setOnExceed(rule.on_exceed);
      setNotes(rule.notes ?? '');
      setError(null);
    }
  }

  async function handleSubmit() {
    if (!rule) return;
    setLoading(true);
    setError(null);
    const credits = limitCredits ? parseFloat(limitCredits) : null;
    const usd = limitUsd ? parseFloat(limitUsd) : null;
    const result = await updateBudgetRule({
      id: rule.id,
      limitCredits: credits,
      limitUsd: usd,
      onExceed,
      notes: notes.trim() || null,
    });
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }
    onOpenChange(false);
    if (onSuccess) onSuccess(); else window.location.reload();
  }

  const canSubmit = (!!limitCredits || !!limitUsd) && !loading;

  if (!rule) return null;

  return (
    <DrawerShell
      open={open}
      onOpenChange={onOpenChange}
      title="Editar regla"
      description={
        <>
          <span className="font-medium text-foreground">{rule.providerDisplayName}</span>
          {' · '}
          <span>{rule.scopeLabel}</span>
          <br />
          <span className="text-xs">
            El proveedor y el alcance no se pueden cambiar. Para modificarlos, desactiva esta regla y crea una nueva.
          </span>
        </>
      }
      icon={<ShieldAlert className="h-4 w-4 text-primary" />}
      size="md"
      actions={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Límites */}
        <div className="grid grid-cols-2 gap-3">
          <FieldWrapper>
            <Label htmlFor="ed-credits">Límite créditos</Label>
            <Input
              id="ed-credits"
              type="number"
              min="1"
              placeholder="0"
              className="w-full"
              value={limitCredits}
              onChange={(e) => setLimitCredits(e.target.value)}
            />
          </FieldWrapper>
          <FieldWrapper>
            <Label htmlFor="ed-usd">Límite USD</Label>
            <Input
              id="ed-usd"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              className="w-full"
              value={limitUsd}
              onChange={(e) => setLimitUsd(e.target.value)}
            />
          </FieldWrapper>
        </div>

        {/* Acción al superar */}
        <FieldWrapper>
          <Label>Acción al superar</Label>
          <Select value={onExceed} onValueChange={(v) => setOnExceed(v as BudgetOnExceed)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ON_EXCEED_LABELS) as BudgetOnExceed[]).map((k) => (
                <SelectItem key={k} value={k}>{ON_EXCEED_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>

        {/* Notas */}
        <FieldWrapper>
          <Label htmlFor="ed-notes">
            Notas <span className="text-xs text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="ed-notes"
            rows={2}
            placeholder="Contexto adicional..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full resize-none"
          />
        </FieldWrapper>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </DrawerShell>
  );
}

// ─── Rules table ──────────────────────────────────────────────────────────────

interface RulesDataTableProps {
  rules: BudgetRuleRow[];
  onCreate: () => void;
  onEdit: (rule: BudgetRuleRow) => void;
  onToggle: (rule: BudgetRuleRow) => Promise<void>;
  /** Pide confirmación antes de eliminar: no borra por sí sola. */
  onArchive: (rule: BudgetRuleRow) => void;
  busyId: string | null;
  /** Dónde va «Crear regla»: como acción de la lista o en la cabecera de la pantalla. */
  showCreateAction?: boolean;
}

/** El tope que manda para ordenar: dólares si los hay, si no créditos. */
function limitSortValue(rule: BudgetRuleRow): number {
  if (rule.limit_usd != null && rule.limit_usd > 0) return rule.limit_usd;
  return rule.limit_credits ?? 0;
}

/**
 * Las reglas de presupuesto en una sola lista: se filtra por proveedor, alcance,
 * período, acción y estado desde el embudo de cada columna, y se ordena por
 * límite o fecha. Sustituye a las cuatro pestañas por alcance.
 */
function RulesDataTable({
  rules,
  onCreate,
  onEdit,
  onToggle,
  onArchive,
  busyId,
  showCreateAction = false,
}: RulesDataTableProps) {
  const rowMenuItems = (rule: BudgetRuleRow): DataTableContextMenuItem[] => [
    { id: 'edit', label: 'Editar', icon: Pencil, onClick: () => onEdit(rule) },
    {
      id: 'toggle',
      label: rule.is_active ? 'Desactivar' : 'Activar',
      icon: Power,
      disabled: busyId === rule.id,
      onClick: () => onToggle(rule),
    },
    {
      id: 'delete',
      label: 'Eliminar',
      icon: Trash2,
      variant: 'destructive',
      separator: true,
      disabled: busyId === rule.id,
      onClick: () => onArchive(rule),
    },
  ];

  const bulkActions: DataTableBulkAction<BudgetRuleRow>[] = [
    {
      id: 'editar',
      label: 'Editar',
      icon: Pencil,
      disabled: (rows) => rows.length !== 1,
      disabledLabel: (rows) => (rows.length !== 1 ? 'Marca una sola regla' : undefined),
      onClick: (rows) => { if (rows.length === 1) onEdit(rows[0]); },
    },
    {
      id: 'activar',
      label: 'Activar',
      icon: Power,
      disabled: (rows) => rows.every((r) => r.is_active),
      disabledLabel: (rows) => (rows.every((r) => r.is_active) ? 'Ya están activas' : undefined),
      onClick: async (rows) => {
        for (const r of rows.filter((r) => !r.is_active)) {
          await onToggle(r);
        }
      },
    },
    {
      id: 'desactivar',
      label: 'Desactivar',
      disabled: (rows) => rows.every((r) => !r.is_active),
      disabledLabel: (rows) => (rows.every((r) => !r.is_active) ? 'Ya están inactivas' : undefined),
      onClick: async (rows) => {
        for (const r of rows.filter((r) => r.is_active)) {
          await onToggle(r);
        }
      },
    },
    {
      id: 'eliminar',
      label: 'Eliminar',
      icon: Trash2,
      variant: 'destructive',
      disabled: (rows) => rows.length !== 1,
      disabledLabel: (rows) => (rows.length !== 1 ? 'Las reglas se eliminan de una en una' : undefined),
      // La confirmación la pide `onArchive` (un solo diálogo, no dos).
      onClick: (rows) => { if (rows.length === 1) onArchive(rows[0]); },
    },
  ];

  const unique = <T extends string>(values: T[]) => Array.from(new Set(values));

  const columns: ColumnDef<BudgetRuleRow, unknown>[] = [
    {
      id: 'provider',
      accessorKey: 'providerDisplayName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm font-medium text-foreground">
          {row.original.providerDisplayName}
        </span>
      ),
      size: 180,
      enableHiding: false,
      meta: {
        label: 'Proveedor',
        filterOptions: unique(rules.map((r) => r.providerDisplayName))
          .sort((a, b) => a.localeCompare(b, 'es'))
          .map((name) => ({ label: name, value: name })),
      },
    },
    {
      id: 'scope',
      accessorKey: 'scope_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Alcance" />,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="neutral">{SCOPE_LABELS[row.original.scope_type]}</Badge>
          {row.original.scope_type !== 'global' && (
            <span className="truncate text-sm text-muted-foreground" title={row.original.scopeLabel}>
              {row.original.scopeLabel}
            </span>
          )}
        </div>
      ),
      size: 220,
      meta: {
        label: 'Alcance',
        filterOptions: unique(rules.map((r) => r.scope_type)).map((scope) => ({
          label: SCOPE_LABELS[scope],
          value: scope,
        })),
      },
    },
    {
      id: 'limit',
      accessorFn: limitSortValue,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Límite" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm tabular-nums text-foreground">
          {formatLimit(row.original.limit_credits, row.original.limit_usd)}
        </span>
      ),
      sortDescFirst: true,
      size: 150,
      meta: { label: 'Límite', disableFilter: true },
    },
    {
      id: 'period',
      accessorKey: 'period_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Período" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {PERIOD_LABELS[row.original.period_type]}
        </span>
      ),
      size: 130,
      meta: {
        label: 'Período',
        filterOptions: unique(rules.map((r) => r.period_type)).map((period) => ({
          label: PERIOD_LABELS[period],
          value: period,
        })),
      },
    },
    {
      id: 'onExceed',
      accessorKey: 'on_exceed',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Al superar el límite" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {ON_EXCEED_LABELS[row.original.on_exceed]}
        </span>
      ),
      size: 180,
      meta: {
        label: 'Al superar el límite',
        filterOptions: unique(rules.map((r) => r.on_exceed)).map((action) => ({
          label: ON_EXCEED_LABELS[action],
          value: action,
        })),
      },
    },
    {
      id: 'status',
      accessorFn: (rule) => (rule.is_active ? 'active' : 'inactive'),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.is_active ? 'active' : 'inactive'}
          label={row.original.is_active ? 'Activa' : 'Inactiva'}
        />
      ),
      size: 120,
      meta: {
        label: 'Estado',
        filterOptions: [
          { label: 'Activa', value: 'active' },
          { label: 'Inactiva', value: 'inactive' },
        ],
      },
    },
    {
      id: 'updatedAt',
      accessorKey: 'updated_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Actualizada" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDate(row.original.updated_at)}
        </span>
      ),
      sortDescFirst: true,
      size: 130,
      meta: { label: 'Actualizada', disableFilter: true },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DataTableRowActions
            items={rowMenuItems(row.original)}
            rowLabel={`la regla de ${row.original.providerDisplayName}`}
          />
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
    <DataTable
      tableId="settings-budget-rules"
      noun="reglas"
      nounGender="f"
      title="Reglas de presupuesto"
      description="Por ahora las reglas solo avisan: no detienen ninguna operación."
      count={rules.length}
      columns={columns}
      data={rules}
      getRowId={(rule) => rule.id}
      getRowLabel={(rule) => `la regla de ${rule.providerDisplayName}`}
      enableRowSelection
      bulkActions={bulkActions}
      contextMenu={{ items: rowMenuItems }}
      actions={
        showCreateAction ? (
          <Button size="sm" variant="outline" onClick={onCreate}>
            <Plus />
            Crear regla
          </Button>
        ) : undefined
      }
      emptyState={
        <EmptyState
          variant="plain"
          icon={ShieldAlert}
          title="Todavía no hay reglas de presupuesto"
          description="Crea una regla para recibir un aviso cuando un proveedor, un grupo o una persona se acerque a su tope de gasto."
          action={
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus />
              Crear regla
            </Button>
          }
        />
      }
    />
  );
}

// ─── Estado compartido de la gestión de reglas ────────────────────────────────

interface RulesWorkspaceProps {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
  showCreate: boolean;
  onShowCreateChange: (open: boolean) => void;
  showCreateAction?: boolean;
}

/** La lista de reglas con sus paneles de crear/editar y la confirmación de borrado. */
function RulesWorkspace({ rules, options, showCreate, onShowCreateChange, showCreateAction }: RulesWorkspaceProps) {
  const [editRule, setEditRule] = useState<BudgetRuleRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<BudgetRuleRow | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    window.location.reload();
  }

  async function handleArchive(rule: BudgetRuleRow) {
    setArchiving(rule.id);
    setArchiveError(null);
    const result = await deleteBudgetRule(rule.id);
    if (!result.success) {
      setArchiveError(result.error ?? 'No se pudo eliminar la regla. Inténtalo de nuevo.');
      setArchiving(null);
      return;
    }
    setArchiving(null);
    setConfirmArchive(null);
    window.location.reload();
  }

  return (
    <>
      <RulesDataTable
        rules={rules}
        onCreate={() => onShowCreateChange(true)}
        onEdit={setEditRule}
        onToggle={handleToggle}
        onArchive={(rule) => { setArchiveError(null); setConfirmArchive(rule); }}
        busyId={toggling ?? archiving}
        showCreateAction={showCreateAction}
      />

      <CreateDrawer options={options} open={showCreate} onOpenChange={onShowCreateChange} />
      <EditDrawer rule={editRule} open={!!editRule} onOpenChange={(v) => { if (!v) setEditRule(null); }} />

      {/* Confirmación de borrado */}
      <Dialog open={!!confirmArchive} onOpenChange={(v) => { if (!v) setConfirmArchive(null); }}>
        {confirmArchive && (
          <DialogContent className="sm:max-w-sm" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>¿Eliminar esta regla?</DialogTitle>
              <DialogDescription>
                La regla de <span className="font-medium text-foreground">{confirmArchive.providerDisplayName}</span>{' '}
                ({confirmArchive.scopeLabel}) dejará de aplicarse. El consumo y los avisos ya registrados se conservan.
              </DialogDescription>
            </DialogHeader>
            {archiveError && (
              <Alert variant="destructive">
                <AlertDescription>{archiveError}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmArchive(null)}
                disabled={archiving === confirmArchive.id}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive-solid"
                disabled={archiving === confirmArchive.id}
                onClick={() => handleArchive(confirmArchive)}
              >
                {archiving === confirmArchive.id ? 'Eliminando...' : 'Eliminar regla'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// ─── Section (embedded in the budget-credits page) ────────────────────────────

interface TabbedSectionProps {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
}

/**
 * Las reglas dentro de otra pantalla. Conserva el nombre por compatibilidad:
 * ya no hay pestañas por alcance, el alcance se filtra desde su columna.
 */
export function BudgetRulesTabbedSection({ rules, options }: TabbedSectionProps) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <RulesWorkspace
      rules={rules}
      options={options}
      showCreate={showCreate}
      onShowCreateChange={setShowCreate}
      showCreateAction
    />
  );
}

// ─── Main client component ────────────────────────────────────────────────────

interface Props {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
}

export function BudgetRulesClient({ rules, options }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <SettingsPage
      title="Reglas de presupuesto"
      description="Fija un tope de gasto por proveedor para toda la empresa, un rol, un grupo o una persona."
      trail={[{ label: 'Proveedores y consumo', href: '/settings/providers' }]}
      actions={
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus />
          Nueva regla
        </Button>
      }
    >
      <LegacyCompatBanner
        message="También puedes gestionar las reglas de cada proveedor desde su detalle, en Proveedores y consumo."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers"
      />
      <RulesWorkspace
        rules={rules}
        options={options}
        showCreate={showCreate}
        onShowCreateChange={setShowCreate}
      />
    </SettingsPage>
  );
}
