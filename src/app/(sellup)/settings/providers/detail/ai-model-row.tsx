'use client';

/**
 * ai-model-row.tsx — una fila de «Modelos y tarifas»: el modelo, su tarifa
 * vigente y las acciones sobre él (activar, registrar tarifa, usar como base).
 */

import { useState, useTransition } from 'react';
import { Loader2 } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/forms/field';
import { NumberField } from '@/components/forms/number-field';
import type { AiModelWithPricing } from '@/modules/ai-config/provider-ai-detail-queries';
import {
  addAiModelPricingForPanel,
  setAiActiveConfigForPanel,
  updateAiModelStatusForPanel,
} from '../provider-detail-actions';
import { formatDateShort, type ActionFeedback } from './detail-format';
import { InlineFeedback, type StatusBadgeVariant } from './detail-shared';

const PRICE_STEP = 0.0001;

const MODEL_STATUS_BADGE: Record<string, { label: string; variant: StatusBadgeVariant }> = {
  active:   { label: 'Activo',   variant: 'positive' },
  inactive: { label: 'Inactivo', variant: 'neutral' },
  error:    { label: 'Error',    variant: 'negative' },
};

function ModelStatusBadge({ status }: { status: string }) {
  const cfg = MODEL_STATUS_BADGE[status] ?? { label: status, variant: 'neutral' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function formatPricePerMillion(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)} / 1M tok`;
}

/** El estado del formulario sigue siendo texto: se convierte solo en el borde del campo. */
const toFieldValue = (text: string) => (text === '' ? null : Number(text));
const fromFieldValue = (value: number | null) => (value === null ? '' : String(value));

interface PricingFormProps {
  isPending: boolean;
  inputCost: string;
  outputCost: string;
  onInputCostChange: (value: string) => void;
  onOutputCostChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function PricingForm({
  isPending,
  inputCost,
  outputCost,
  onInputCostChange,
  onOutputCostChange,
  onSave,
  onCancel,
}: PricingFormProps) {
  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs font-medium text-muted-foreground">Costo por millón de tokens (USD)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Entrada">
          <NumberField
            size="sm"
            stepper="none"
            step={PRICE_STEP}
            prefix="$"
            value={toFieldValue(inputCost)}
            onValueChange={(value) => onInputCostChange(fromFieldValue(value))}
            placeholder="0.00"
            aria-label="Costo de entrada por millón de tokens (USD)"
          />
        </Field>
        <Field label="Salida">
          <NumberField
            size="sm"
            stepper="none"
            step={PRICE_STEP}
            prefix="$"
            value={toFieldValue(outputCost)}
            onValueChange={(value) => onOutputCostChange(fromFieldValue(value))}
            placeholder="0.00"
            aria-label="Costo de salida por millón de tokens (USD)"
          />
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="xs" variant="outline" onClick={onCancel} type="button">
          Cancelar
        </Button>
        <Button size="xs" disabled={isPending || !inputCost || !outputCost} onClick={onSave} type="button">
          {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Guardar tarifa
        </Button>
      </div>
    </div>
  );
}

export interface AiModelRowProps {
  model: AiModelWithPricing;
  providerId: string;
  onRefresh: () => void;
}

export function AiModelRow({ model, providerId, onRefresh }: AiModelRowProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [showPricingForm, setShowPricingForm] = useState(false);
  const [inputCost, setInputCost] = useState('');
  const [outputCost, setOutputCost] = useState('');

  const closePricingForm = () => {
    setShowPricingForm(false);
    setInputCost('');
    setOutputCost('');
  };

  const handleToggleStatus = () => {
    const nextStatus = model.status === 'active' ? 'inactive' : 'active';
    setFeedback(null);
    startTransition(async () => {
      const r = await updateAiModelStatusForPanel(model.id, nextStatus);
      setFeedback({ ok: r.ok, msg: r.error ?? (r.ok ? 'Estado del modelo actualizado' : 'Error al actualizar estado') });
      if (r.ok) onRefresh();
    });
  };

  const handleSavePricing = () => {
    const input = parseFloat(inputCost);
    const output = parseFloat(outputCost);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return;
    setFeedback(null);
    startTransition(async () => {
      const r = await addAiModelPricingForPanel(model.id, input, output);
      setFeedback({ ok: r.ok, msg: r.error ?? (r.ok ? 'Tarifa registrada' : 'Error al registrar tarifa') });
      if (r.ok) {
        closePricingForm();
        onRefresh();
      }
    });
  };

  const handleUseAsGlobalBase = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await setAiActiveConfigForPanel(providerId, model.id);
      setFeedback({ ok: r.ok, msg: r.error ?? (r.ok ? 'Modelo base global actualizado' : 'Error al actualizar configuración global') });
      if (r.ok) onRefresh();
    });
  };

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{model.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{model.modelKey}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {model.isActiveGlobalModel && <Badge variant="brand">Activo global</Badge>}
          <ModelStatusBadge status={model.status} />
        </div>
      </div>
      {model.latestPricing ? (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
          <span>Entrada: {formatPricePerMillion(model.latestPricing.inputPerMillion, model.latestPricing.currency)}</span>
          <span>Salida: {formatPricePerMillion(model.latestPricing.outputPerMillion, model.latestPricing.currency)}</span>
          <span className="text-text-muted">Vigente desde {formatDateShort(model.latestPricing.effectiveFrom)}</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sin tarifa vigente configurada.</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled={isPending} onClick={handleToggleStatus} type="button">
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {model.status === 'active' ? 'Desactivar modelo' : 'Activar modelo'}
        </Button>
        <Button size="xs" variant="outline" disabled={isPending} onClick={() => setShowPricingForm((v) => !v)} type="button">
          {model.latestPricing ? 'Actualizar tarifa' : 'Agregar tarifa'}
        </Button>
        {!model.isActiveGlobalModel && (
          <Button size="xs" variant="outline" disabled={isPending} onClick={handleUseAsGlobalBase} type="button">
            Usar como modelo base global
          </Button>
        )}
      </div>

      {showPricingForm && (
        <PricingForm
          isPending={isPending}
          inputCost={inputCost}
          outputCost={outputCost}
          onInputCostChange={setInputCost}
          onOutputCostChange={setOutputCost}
          onSave={handleSavePricing}
          onCancel={closePricingForm}
        />
      )}

      <InlineFeedback feedback={feedback} />
    </li>
  );
}
