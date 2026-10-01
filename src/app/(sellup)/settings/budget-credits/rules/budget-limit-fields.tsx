'use client';

import { Field, FieldDescription } from '@/components/forms/field';
import { NumberField } from '@/components/forms/number-field';

interface BudgetLimitFieldsProps {
  /** Prefijo de los `id` de los dos campos (`cr`, `ed`). */
  idPrefix: string;
  /** Texto tal cual lo guarda el formulario; vacío = sin tope. */
  limitCredits: string;
  limitUsd: string;
  onLimitCreditsChange: (value: string) => void;
  onLimitUsdChange: (value: string) => void;
  disabled?: boolean;
}

const toNumber = (value: string): number | null => (value === '' ? null : Number(value));
const toText = (value: number | null): string => (value === null ? '' : String(value));

/**
 * Los dos topes de una regla: créditos y dólares. El formulario los guarda como
 * texto (así los envía hoy), y aquí se convierten solo en el borde del control.
 */
export function BudgetLimitFields({
  idPrefix,
  limitCredits,
  limitUsd,
  onLimitCreditsChange,
  onLimitUsdChange,
  disabled,
}: BudgetLimitFieldsProps) {
  const hintId = `${idPrefix}-limits-hint`;

  return (
    <div className="space-y-1.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Límite en créditos" disabled={disabled}>
          <NumberField
            id={`${idPrefix}-credits`}
            min={1}
            step={1}
            placeholder="0"
            suffix="créditos"
            stepper="none"
            aria-describedby={hintId}
            value={toNumber(limitCredits)}
            onValueChange={(value) => onLimitCreditsChange(toText(value))}
          />
        </Field>
        <Field label="Límite en USD" disabled={disabled}>
          <NumberField
            id={`${idPrefix}-usd`}
            min={0.01}
            step={0.01}
            placeholder="0.00"
            prefix="$"
            stepper="none"
            aria-describedby={hintId}
            value={toNumber(limitUsd)}
            onValueChange={(value) => onLimitUsdChange(toText(value))}
          />
        </Field>
      </div>
      <FieldDescription id={hintId}>
        Llena al menos uno; puedes usar los dos a la vez.
      </FieldDescription>
    </div>
  );
}
