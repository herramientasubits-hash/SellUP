'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/forms/field';
import { NumberField } from '@/components/forms/number-field';
import { ModalShell } from '@/components/shared/modal-shell';
import { addModelPricing } from '@/modules/ai-config/actions';

interface ModelPricingModalProps {
  modelId: string;
  modelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Las tarifas se cobran por millón de tokens y suelen tener cuatro decimales. */
const COST_STEP = 0.0001;

const toNumber = (value: string): number | null => (value === '' ? null : Number(value));
const toText = (value: number | null): string => (value === null ? '' : String(value));

/** Registra la tarifa vigente de un modelo: costo de entrada y de salida. */
export function ModelPricingModal({ modelId, modelName, open, onOpenChange }: ModelPricingModalProps) {
  const [inputCost, setInputCost] = useState('');
  const [outputCost, setOutputCost] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAddPricing = async () => {
    if (!inputCost || !outputCost) return;
    setLoading(true);
    const result = await addModelPricing(modelId, parseFloat(inputCost), parseFloat(outputCost));
    setLoading(false);
    if (result.success) {
      onOpenChange(false);
      setInputCost('');
      setOutputCost('');
      window.location.reload();
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Registrar nueva tarifa"
      description={`Lo que cobra el proveedor por cada millón de tokens de ${modelName}. Reemplaza a la tarifa vigente.`}
      size="md"
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleAddPricing} disabled={loading || !inputCost || !outputCost}>
            {loading ? 'Guardando...' : 'Guardar tarifa'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Costo de entrada" description="Por millón de tokens que se envían al modelo." required>
          <NumberField
            min={0}
            step={COST_STEP}
            placeholder="0.00"
            prefix="$"
            stepper="none"
            value={toNumber(inputCost)}
            onValueChange={(value) => setInputCost(toText(value))}
          />
        </Field>
        <Field label="Costo de salida" description="Por millón de tokens que responde el modelo." required>
          <NumberField
            min={0}
            step={COST_STEP}
            placeholder="0.00"
            prefix="$"
            stepper="none"
            value={toNumber(outputCost)}
            onValueChange={(value) => setOutputCost(toText(value))}
          />
        </Field>
      </div>
    </ModalShell>
  );
}
