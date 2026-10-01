'use client';

import * as React from 'react';
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';

interface ImportLoadingOverlayProps {
  /** Whether the overlay is visible */
  open: boolean;
  /** Total candidates being imported */
  total?: number;
  /** Current step label */
  stepLabel?: string;
}

const STEPS = [
  { label: 'Importando candidatos', sub: 'Validando duplicados y estructura' },
  { label: 'Buscando identificación fiscal', sub: 'Validando NIT / RUC / Cédula' },
  { label: 'Enriquecimiento automático', sub: 'Consultando fuentes externas' },
  { label: 'Registrando candidatos', sub: 'Guardando en base de datos' },
  { label: 'Finalizando', sub: 'Preparando resultados' },
];

export function ImportLoadingOverlay({
  open,
  total = 0,
  stepLabel,
}: ImportLoadingOverlayProps) {
  const [currentStep, setCurrentStep] = React.useState(0);
  const [completedSteps, setCompletedSteps] = React.useState<number[]>([]);

  React.useEffect(() => {
    if (!open) {
      setCurrentStep(0);
      setCompletedSteps([]);
      return;
    }

    const timers: NodeJS.Timeout[] = [];
    const stepDuration = 1400;

    STEPS.forEach((_, i) => {
      if (i > 0) {
        timers.push(
          setTimeout(() => {
            setCompletedSteps((prev) => [...prev, i - 1]);
            setCurrentStep(i);
          }, i * stepDuration)
        );
      }
    });

    return () => timers.forEach(clearTimeout);
  }, [open]);

  if (!open) return null;

  const progress = ((completedSteps.length + 1) / STEPS.length) * 100;

  const step = STEPS[currentStep];

  // El estado «la IA está trabajando» del sistema (`AiAnalyzingState` de Thema),
  // sobre un velo que tapa el formulario mientras se importa. El titular cambia
  // con cada paso y entra con un fundido; quien lo anuncia es la propia pieza.
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-background/90 p-6 backdrop-blur-sm">
      <AiAnalyzingState
        className="w-full max-w-md"
        title={stepLabel ?? step.label}
        progress={progress}
        detail={total > 0 ? `${total} candidato${total !== 1 ? 's' : ''} en proceso` : 'Importando'}
        caption={step.sub}
      />
    </div>
  );
}
