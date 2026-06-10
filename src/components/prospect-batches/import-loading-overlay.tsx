'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

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

  return (
    <div className="flex-1 flex flex-col items-center justify-center animate-su-fade-in">
      {/* Gradient card */}
      <div
        className="w-full rounded-2xl p-8 flex flex-col items-center gap-5"
        style={{
          background: `linear-gradient(135deg, var(--su-ai-stop-1), var(--su-ai-stop-2), var(--su-ai-stop-3), var(--su-ai-stop-4), var(--su-ai-stop-5))`,
        }}
      >
        {/* Sparkle icon */}
        <div className="animate-su-float">
          <Sparkles className="h-10 w-10 text-white/80" strokeWidth={1.5} />
        </div>

        {/* Main label */}
        <div className="text-center space-y-1">
          <p className="text-base font-bold text-white">
            {STEPS[currentStep].label}
          </p>
          {total > 0 && (
            <p className="text-sm text-white/70">
              {total} candidato{total !== 1 ? 's' : ''} en proceso
            </p>
          )}
        </div>

        {/* Sub label */}
        <p className="text-xs text-white/60">
          {STEPS[currentStep].sub}
        </p>

        {/* Progress bar */}
        <div className="w-full max-w-[280px] space-y-2">
          <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-end text-xs font-bold text-white/80">
            {Math.round(progress)}%
          </div>
        </div>
      </div>
    </div>
  );
}
