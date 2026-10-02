'use client';

import { useState } from 'react';
import { Gauge, ShieldAlert, Target } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/forms/field';
import { DrawerSection } from '@/components/shared/drawer-section';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { createBudgetRule, updateBudgetRule } from '@/modules/budgets/rule-actions';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import type { BudgetOnExceed, BudgetPeriodType, BudgetScopeType } from '@/modules/usage-tracking/types';
import { BudgetLimitFields } from './budget-limit-fields';
import { ON_EXCEED_LABELS, PERIOD_LABELS, SCOPE_LABELS } from './budget-rule-display';

// ─── Piezas comunes a crear y editar ──────────────────────────────────────────

const ON_EXCEED_KEYS = Object.keys(ON_EXCEED_LABELS) as BudgetOnExceed[];
const SCOPE_KEYS = Object.keys(SCOPE_LABELS) as BudgetScopeType[];
const PERIOD_KEYS = (Object.keys(PERIOD_LABELS) as BudgetPeriodType[]).filter((key) => key !== 'custom');

interface OnExceedFieldProps {
  value: BudgetOnExceed;
  onChange: (value: BudgetOnExceed) => void;
  required?: boolean;
}

function OnExceedField({ value, onChange, required }: OnExceedFieldProps) {
  return (
    <Field label="Al superar el límite" required={required}>
      <Select value={value} onValueChange={(next) => onChange(next as BudgetOnExceed)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ON_EXCEED_KEYS.map((key) => (
            <SelectItem key={key} value={key}>{ON_EXCEED_LABELS[key]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

interface NotesFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

function NotesField({ id, value, onChange }: NotesFieldProps) {
  return (
    <Field label="Notas (opcional)" description="Para qué existe esta regla o quién la pidió.">
      <Textarea
        id={id}
        rows={2}
        placeholder="Contexto adicional..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none"
      />
    </Field>
  );
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

export interface CreateDrawerProps {
  options: BudgetRuleFormOptions;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultProviderKey?: string;
  onSuccess?: () => void;
}

export function CreateDrawer({
  options,
  open,
  onOpenChange,
  defaultProviderKey,
  onSuccess,
}: CreateDrawerProps) {
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
        <DrawerSection
          title="A quién aplica"
          hint="El proveedor que se vigila y sobre quién cuenta el gasto."
          icon={Target}
          contentClassName="space-y-4"
        >
          {defaultProviderKey ? (
            <Field label="Proveedor" description="La regla se crea para el proveedor que estás viendo.">
              <Input
                readOnly
                value={options.providers.find((p) => p.providerKey === defaultProviderKey)?.displayName ?? defaultProviderKey}
              />
            </Field>
          ) : (
            <Field label="Proveedor" required>
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
            </Field>
          )}

          <Field label="Alcance" required>
            <Select
              value={form.scopeType}
              onValueChange={(v) => set('scopeType', v as BudgetScopeType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{SCOPE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {form.scopeType === 'role' && (
            <Field label="Rol" required>
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
            </Field>
          )}

          {form.scopeType === 'group' && (
            <Field label="Grupo" required>
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
            </Field>
          )}

          {form.scopeType === 'user' && (
            <Field label="Usuario" required>
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
            </Field>
          )}

          <Field label="Período" required>
            <Select value={form.periodType} onValueChange={(v) => set('periodType', v as BudgetPeriodType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{PERIOD_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </DrawerSection>

        <DrawerSection
          title="Límite y reacción"
          hint="Cuánto se puede gastar en el período y qué pasa al llegar al tope."
          icon={Gauge}
          tone="warning"
          contentClassName="space-y-4"
        >
          <BudgetLimitFields
            idPrefix="cr"
            limitCredits={form.limitCredits}
            limitUsd={form.limitUsd}
            onLimitCreditsChange={(value) => set('limitCredits', value)}
            onLimitUsdChange={(value) => set('limitUsd', value)}
          />
          <OnExceedField value={form.onExceed} onChange={(value) => set('onExceed', value)} required />
          <NotesField id="cr-notes" value={form.notes} onChange={(value) => set('notes', value)} />
        </DrawerSection>

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

export interface EditDrawerProps {
  rule: BudgetRuleRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
}

export function EditDrawer({ rule, open, onOpenChange, onSuccess }: EditDrawerProps) {
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
        <Alert variant="info">
          <AlertDescription>
            El proveedor y el alcance no se pueden cambiar. Para modificarlos, desactiva esta regla y crea una nueva.
          </AlertDescription>
        </Alert>

        <DrawerSection
          title="Límite y reacción"
          hint="Cuánto se puede gastar en el período y qué pasa al llegar al tope."
          icon={Gauge}
          tone="warning"
          contentClassName="space-y-4"
        >
          <BudgetLimitFields
            idPrefix="ed"
            limitCredits={limitCredits}
            limitUsd={limitUsd}
            onLimitCreditsChange={setLimitCredits}
            onLimitUsdChange={setLimitUsd}
          />
          <OnExceedField value={onExceed} onChange={setOnExceed} />
          <NotesField id="ed-notes" value={notes} onChange={setNotes} />
        </DrawerSection>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </DrawerShell>
  );
}
