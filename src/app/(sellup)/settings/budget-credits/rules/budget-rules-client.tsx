'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, PowerOff, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { createBudgetRule, updateBudgetRule, toggleBudgetRuleStatus } from '@/modules/budgets/rule-actions';
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

// ─── Create dialog ────────────────────────────────────────────────────────────

function CreateDialog({
  options,
  open,
  onOpenChange,
}: {
  options: BudgetRuleFormOptions;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'scopeType') setForm((prev) => ({ ...prev, scopeType: value as BudgetScopeType, scopeId: '' }));
  }

  function reset() {
    setForm(DEFAULT_FORM);
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
    window.location.reload();
  }

  const scopeNeedsSelector = form.scopeType !== 'global';
  const canSubmit =
    !!form.providerKey &&
    (!scopeNeedsSelector || !!form.scopeId) &&
    (!!form.limitCredits || !!form.limitUsd) &&
    !loading;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva regla de presupuesto</DialogTitle>
          <DialogDescription>
            Define un límite por proveedor, alcance y período.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Proveedor */}
          <div className="space-y-1.5">
            <Label>Proveedor <span className="text-destructive">*</span></Label>
            <Select value={form.providerKey || undefined} onValueChange={(v) => set('providerKey', v ?? '')}>
              <SelectTrigger>
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
          </div>

          {/* Alcance */}
          <div className="space-y-1.5">
            <Label>Alcance <span className="text-destructive">*</span></Label>
            <Select value={form.scopeType} onValueChange={(v) => { setForm((prev) => ({ ...prev, scopeType: v as BudgetScopeType, scopeId: '' })); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCOPE_LABELS) as BudgetScopeType[]).map((k) => (
                  <SelectItem key={k} value={k}>{SCOPE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selector dinámico */}
          {form.scopeType === 'role' && (
            <div className="space-y-1.5">
              <Label>Rol <span className="text-destructive">*</span></Label>
              <Select value={form.scopeId || undefined} onValueChange={(v) => set('scopeId', v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {options.roles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.scopeType === 'group' && (
            <div className="space-y-1.5">
              <Label>Grupo <span className="text-destructive">*</span></Label>
              <Select value={form.scopeId || undefined} onValueChange={(v) => set('scopeId', v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar grupo" />
                </SelectTrigger>
                <SelectContent>
                  {options.groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.displayPath}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.scopeType === 'user' && (
            <div className="space-y-1.5">
              <Label>Usuario <span className="text-destructive">*</span></Label>
              <Select value={form.scopeId || undefined} onValueChange={(v) => set('scopeId', v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar usuario" />
                </SelectTrigger>
                <SelectContent>
                  {options.users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Período */}
          <div className="space-y-1.5">
            <Label>Período <span className="text-destructive">*</span></Label>
            <Select value={form.periodType} onValueChange={(v) => set('periodType', v as BudgetPeriodType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Mensual</SelectItem>
                <SelectItem value="quarterly">Trimestral</SelectItem>
                <SelectItem value="annual">Anual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Límites */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cr-credits">Límite créditos</Label>
              <Input
                id="cr-credits"
                type="number"
                min="1"
                placeholder="0"
                value={form.limitCredits}
                onChange={(e) => set('limitCredits', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-usd">Límite USD</Label>
              <Input
                id="cr-usd"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={form.limitUsd}
                onChange={(e) => set('limitUsd', e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-1">
            Al menos uno es obligatorio. Ambos pueden coexistir.
          </p>

          {/* Acción al superar */}
          <div className="space-y-1.5">
            <Label>Acción al superar <span className="text-destructive">*</span></Label>
            <Select value={form.onExceed} onValueChange={(v) => set('onExceed', v as BudgetOnExceed)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ON_EXCEED_LABELS) as BudgetOnExceed[]).map((k) => (
                  <SelectItem key={k} value={k}>{ON_EXCEED_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notas */}
          <div className="space-y-1.5">
            <Label htmlFor="cr-notes">Notas <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Textarea
              id="cr-notes"
              rows={2}
              placeholder="Contexto adicional..."
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="resize-none text-sm"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? 'Creando...' : 'Crear regla'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

function EditDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: BudgetRuleRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [limitCredits, setLimitCredits] = useState('');
  const [limitUsd, setLimitUsd] = useState('');
  const [onExceed, setOnExceed] = useState<BudgetOnExceed>('alert');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the rule prop changes
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
    window.location.reload();
  }

  const canSubmit = (!!limitCredits || !!limitUsd) && !loading;

  if (!rule) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar regla</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{rule.providerDisplayName}</span> · <span>{rule.scopeLabel}</span>
            <br />
            <span className="text-[11px] text-muted-foreground">El proveedor y el alcance no se pueden cambiar. Para modificarlos, desactiva esta regla y crea una nueva.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Límites */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-credits">Límite créditos</Label>
              <Input
                id="ed-credits"
                type="number"
                min="1"
                placeholder="0"
                value={limitCredits}
                onChange={(e) => setLimitCredits(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-usd">Límite USD</Label>
              <Input
                id="ed-usd"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={limitUsd}
                onChange={(e) => setLimitUsd(e.target.value)}
              />
            </div>
          </div>

          {/* Acción al superar */}
          <div className="space-y-1.5">
            <Label>Acción al superar</Label>
            <Select value={onExceed} onValueChange={(v) => setOnExceed(v as BudgetOnExceed)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ON_EXCEED_LABELS) as BudgetOnExceed[]).map((k) => (
                  <SelectItem key={k} value={k}>{ON_EXCEED_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notas */}
          <div className="space-y-1.5">
            <Label htmlFor="ed-notes">Notas <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Textarea
              id="ed-notes"
              rows={2}
              placeholder="Contexto adicional..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none text-sm"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    window.location.reload();
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings/budget-credits"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Créditos y presupuestos
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Reglas de presupuesto</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define límites por proveedor, usuario, grupo, rol o global.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva regla
        </Button>
      </div>

      {/* Table */}
      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Aún no hay reglas de presupuesto. Crea la primera con el botón Nueva regla.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                {['Proveedor', 'Alcance', 'Límite', 'Período', 'Acción', 'Estado', 'Actualizado', 'Acciones'].map(
                  (col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {rule.providerDisplayName}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {rule.scopeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {formatLimit(rule.limit_credits, rule.limit_usd)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {PERIOD_LABELS[rule.period_type]}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {ON_EXCEED_LABELS[rule.on_exceed]}
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
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">
                    {formatDate(rule.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
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
                        {rule.is_active ? (
                          <><PowerOff className="h-3 w-3" />Desactivar</>
                        ) : (
                          <><Power className="h-3 w-3" />Activar</>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateDialog options={options} open={showCreate} onOpenChange={setShowCreate} />
      <EditDialog rule={editRule} open={!!editRule} onOpenChange={(v) => { if (!v) setEditRule(null); }} />
    </>
  );
}
