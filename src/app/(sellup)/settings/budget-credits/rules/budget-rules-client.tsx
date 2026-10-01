'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, ShieldAlert, Trash2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTableBulkActionBar } from '@/components/data-table/data-table-bulk-action-bar';
import type { DataTableBulkAction } from '@/components/data-table/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
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
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'short' });
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

// ─── Rules tab table (with checkbox + bulk actions) ───────────────────────────

interface RulesTabTableProps {
  rules: BudgetRuleRow[];
  emptyMessage: string;
  onEdit: (rule: BudgetRuleRow) => void;
  onToggle: (rule: BudgetRuleRow) => Promise<void>;
  onArchive: (rule: BudgetRuleRow) => void;
  togglingId: string | null;
}

function RulesTabTable({ rules, emptyMessage, onEdit, onToggle, onArchive, togglingId }: RulesTabTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedRows = rules.filter((r) => selectedIds.has(r.id));
  const allSelected = rules.length > 0 && selectedIds.size === rules.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rules.map((r) => r.id)));
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const bulkActions: DataTableBulkAction<BudgetRuleRow>[] = [
    {
      id: 'editar',
      label: 'Editar',
      icon: Pencil,
      disabled: (rows) => rows.length !== 1,
      onClick: (rows) => { if (rows.length === 1) onEdit(rows[0]); },
    },
    {
      id: 'activar',
      label: 'Activar seleccionadas',
      icon: Power,
      disabled: (rows) => rows.every((r) => r.is_active),
      onClick: async (rows) => {
        for (const r of rows.filter((r) => !r.is_active)) {
          await onToggle(r);
        }
        setSelectedIds(new Set());
      },
    },
    {
      id: 'desactivar',
      label: 'Desactivar seleccionadas',
      disabled: (rows) => rows.every((r) => !r.is_active),
      onClick: async (rows) => {
        for (const r of rows.filter((r) => r.is_active)) {
          await onToggle(r);
        }
        setSelectedIds(new Set());
      },
    },
    {
      id: 'eliminar',
      label: 'Eliminar',
      icon: Trash2,
      variant: 'destructive',
      disabled: (rows) => rows.length !== 1,
      confirm: {
        title: '¿Eliminar esta regla?',
        description: (rows) =>
          `La regla de ${rows[0]?.providerDisplayName ?? 'este proveedor'} (${rows[0]?.scopeLabel ?? ''}) dejará de aplicarse.`,
        confirmLabel: 'Eliminar regla',
      },
      onClick: (rows) => { if (rows.length === 1) onArchive(rows[0]); },
    },
  ];

  if (rules.length === 0) {
    return (
      <EmptyState title={emptyMessage} />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-surface-subtle">
              <th className="w-10 px-4 py-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Seleccionar todas las reglas"
                />
              </th>
              {['Proveedor', 'Alcance', 'Límite', 'Período', 'Acción', 'Estado', 'Actualizado'].map((col) => (
                <th key={col} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rules.map((rule) => {
              const isSelected = selectedIds.has(rule.id);
              return (
                <tr key={rule.id} className={`hover:bg-surface-muted transition-colors ${isSelected ? 'bg-surface-subtle' : ''}`}>
                  <td className="w-10 px-4 py-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRow(rule.id)}
                      aria-label={`Seleccionar regla de ${rule.providerDisplayName}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{rule.providerDisplayName}</td>
                  <td className="px-4 py-3">
                    <Badge variant="neutral">
                      {rule.scopeLabel}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{formatLimit(rule.limit_credits, rule.limit_usd)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{PERIOD_LABELS[rule.period_type]}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{ON_EXCEED_LABELS[rule.on_exceed]}</td>
                  <td className="px-4 py-3">
                    <Badge variant={rule.is_active ? 'positive' : 'neutral'}>
                      {rule.is_active ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(rule.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DataTableBulkActionBar
        selectedCount={selectedIds.size}
        selectedRows={selectedRows}
        actions={bulkActions}
        onClear={() => setSelectedIds(new Set())}
      />
    </>
  );
}

// ─── Tabbed section (embedded in main budget-credits page) ────────────────────

interface TabbedSectionProps {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
}

export function BudgetRulesTabbedSection({ rules, options }: TabbedSectionProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<BudgetRuleRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<BudgetRuleRow | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    window.location.reload();
  }

  async function handleArchive(rule: BudgetRuleRow) {
    setArchiving(rule.id);
    const result = await deleteBudgetRule(rule.id);
    if (!result.success) {
      alert(result.error ?? 'Error al eliminar la regla.');
      setArchiving(null);
      return;
    }
    setArchiving(null);
    setConfirmArchive(null);
    window.location.reload();
  }

  const globalRules = rules.filter((r) => r.scope_type === 'global');
  const roleRules   = rules.filter((r) => r.scope_type === 'role');
  const groupRules  = rules.filter((r) => r.scope_type === 'group');
  const userRules   = rules.filter((r) => r.scope_type === 'user');

  return (
    <>
      <div className="space-y-4">
        {/* Section header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">Reglas de presupuesto</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configura alertas por proveedor, operación y alcance. Estas reglas aún no bloquean ejecuciones.
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setShowCreate(true)}>
            <Plus />
            Crear regla
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="global">
          <TabsList>
            <TabsTrigger value="global">
              Globales
              {globalRules.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {globalRules.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="role">
              Por rol
              {roleRules.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {roleRules.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="group">
              Por grupo
              {groupRules.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {groupRules.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="user">
              Por usuario
              {userRules.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {userRules.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="global" className="mt-4">
            <RulesTabTable
              rules={globalRules}
              emptyMessage="No hay reglas globales configuradas."
              onEdit={setEditRule}
              onToggle={handleToggle}
              onArchive={setConfirmArchive}
              togglingId={toggling}
            />
          </TabsContent>

          <TabsContent value="role" className="mt-4">
            <RulesTabTable
              rules={roleRules}
              emptyMessage="No hay reglas por rol configuradas."
              onEdit={setEditRule}
              onToggle={handleToggle}
              onArchive={setConfirmArchive}
              togglingId={toggling}
            />
          </TabsContent>

          <TabsContent value="group" className="mt-4">
            <RulesTabTable
              rules={groupRules}
              emptyMessage="No hay reglas por grupo configuradas."
              onEdit={setEditRule}
              onToggle={handleToggle}
              onArchive={setConfirmArchive}
              togglingId={toggling}
            />
          </TabsContent>

          <TabsContent value="user" className="mt-4">
            <RulesTabTable
              rules={userRules}
              emptyMessage="No hay reglas por usuario configuradas."
              onEdit={setEditRule}
              onToggle={handleToggle}
              onArchive={setConfirmArchive}
              togglingId={toggling}
            />
          </TabsContent>
        </Tabs>
      </div>

      <CreateDrawer options={options} open={showCreate} onOpenChange={setShowCreate} />
      <EditDrawer rule={editRule} open={!!editRule} onOpenChange={(v) => { if (!v) setEditRule(null); }} />

      {/* Archive confirmation */}
      <Dialog open={!!confirmArchive} onOpenChange={(v) => { if (!v) setConfirmArchive(null); }}>
        {confirmArchive && (
          <DialogContent className="sm:max-w-sm" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>¿Eliminar esta regla?</DialogTitle>
              <DialogDescription>
                La regla de <span className="font-medium text-foreground">{confirmArchive.providerDisplayName}</span>{' '}
                ({confirmArchive.scopeLabel}) dejará de aplicarse.
              </DialogDescription>
            </DialogHeader>
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

// ─── Main client component ────────────────────────────────────────────────────

interface Props {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
}

export function BudgetRulesClient({ rules, options }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<BudgetRuleRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<BudgetRuleRow | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    window.location.reload();
  }

  async function handleArchive(rule: BudgetRuleRow) {
    setArchiving(rule.id);
    const result = await deleteBudgetRule(rule.id);
    if (!result.success) {
      alert(result.error ?? 'Error al eliminar la regla.');
      setArchiving(null);
      return;
    }
    setArchiving(null);
    setConfirmArchive(null);
    window.location.reload();
  }

  return (
    <>
      {/* Header */}
      <PageHeader
        className="pb-0"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              { label: 'Proveedores y consumo', href: '/settings/providers?tab=consumo' },
              'Reglas de presupuesto',
            ]}
          />
        }
        title="Reglas de presupuesto"
        description="Define límites por proveedor, usuario, grupo, rol o global."
        backHref="/settings/providers?tab=consumo"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus />
            Nueva regla
          </Button>
        }
      />

      {/* Table */}
      {rules.length === 0 ? (
        <EmptyState title="Aún no hay reglas de presupuesto. Crea la primera con el botón Nueva regla." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-surface-subtle">
                {['Proveedor', 'Alcance', 'Límite', 'Período', 'Acción', 'Estado', 'Actualizado', 'Acciones'].map(
                  (col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-surface-muted transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {rule.providerDisplayName}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="neutral">
                      {rule.scopeLabel}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {formatLimit(rule.limit_credits, rule.limit_usd)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {PERIOD_LABELS[rule.period_type]}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {ON_EXCEED_LABELS[rule.on_exceed]}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={rule.is_active ? 'positive' : 'neutral'}>
                      {rule.is_active ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(rule.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditRule(rule)}
                      >
                        <Pencil />
                        Editar
                      </Button>
                      {rule.is_active && (
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={toggling === rule.id || archiving === rule.id}
                          onClick={() => setConfirmArchive(rule)}
                        >
                          <Trash2 />
                          Eliminar
                        </Button>
                      )}
                      {!rule.is_active && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={toggling === rule.id}
                          onClick={() => handleToggle(rule)}
                        >
                          <Power />
                          Activar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateDrawer options={options} open={showCreate} onOpenChange={setShowCreate} />
      <EditDrawer rule={editRule} open={!!editRule} onOpenChange={(v) => { if (!v) setEditRule(null); }} />

      {/* Archive confirmation dialog */}
      <Dialog open={!!confirmArchive} onOpenChange={(v) => { if (!v) setConfirmArchive(null); }}>
        {confirmArchive && (
          <DialogContent className="sm:max-w-sm" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>¿Eliminar esta regla?</DialogTitle>
              <DialogDescription>
                La regla de <span className="font-medium text-foreground">{confirmArchive.providerDisplayName}</span>{' '}
                ({confirmArchive.scopeLabel}) dejará de aplicarse. No se eliminarán consumos ni evaluaciones históricas.
              </DialogDescription>
            </DialogHeader>
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
