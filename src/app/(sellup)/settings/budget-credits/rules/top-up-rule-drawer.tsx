'use client';

import { useState } from 'react';
import { Plus } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/forms/field';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { topUpBudgetRule } from '@/modules/budgets/approval-actions';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import { PERIOD_LABELS } from './budget-rule-display';

export interface TopUpRuleDrawerProps {
  /** La regla a recargar. `null` mantiene el panel cerrado. */
  rule: BudgetRuleRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

const PERIOD_NOUN: Record<BudgetRuleRow['period_type'], string> = {
  monthly: 'este mes',
  quarterly: 'este trimestre',
  annual: 'este año',
  custom: 'este período',
};

/**
 * «Agregar créditos este mes» a una regla: suma para todo el pozo de la regla
 * (todo el grupo, rol o persona) sólo en el período actual. Lo que no se use
 * pasa a la reserva del siguiente.
 */
export function TopUpRuleDrawer({ rule, onClose, onSuccess }: TopUpRuleDrawerProps) {
  const [credits, setCredits] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCredits('');
    setNote('');
    setError(null);
  }

  async function handleSubmit() {
    if (!rule) return;
    setLoading(true);
    setError(null);
    const result = await topUpBudgetRule({ ruleId: rule.id, credits: Number(credits), note });
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'No pudimos guardar la recarga.');
      return;
    }
    reset();
    onSuccess();
  }

  const period = rule ? PERIOD_NOUN[rule.period_type] : 'este mes';
  const amount = Number(credits);
  const canSubmit = Number.isInteger(amount) && amount > 0 && !loading;

  return (
    <DrawerShell
      open={rule !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
      title={`Agregar créditos ${period}`}
      description={rule ? `${rule.providerDisplayName} · ${rule.scopeLabel} · ${PERIOD_LABELS[rule.period_type]}` : undefined}
      icon={<Plus className="h-4 w-4 text-primary" />}
      size="sm"
      actions={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? 'Guardando…' : 'Agregar créditos'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="Créditos a agregar"
          required
          description={`Suman al límite de la regla sólo ${period}, para todos los que comparten esta regla. Lo que no se use pasa a la reserva del siguiente período.`}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="Ej. 500"
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
          />
        </Field>
        <Field label="Motivo (opcional)" description="Queda guardado con la recarga.">
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ej. campaña de fin de mes"
            className="w-full resize-none"
          />
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </DrawerShell>
  );
}
