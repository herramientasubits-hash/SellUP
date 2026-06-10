'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface ImportLoadingOverlayProps {
  /** Whether the overlay is visible */
  open: boolean;
  /** Total candidates being imported */
  total?: number;
  /** Current step label */
  stepLabel?: string;
}

const STEPS = [
  'Validando duplicados',
  'Creando lote de importación',
  'Registrando candidatos',
  'Enriquecimiento automático',
  'Finalizando',
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
    const stepDuration = 1200;

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

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center animate-su-fade-in">
      {/* Glass backdrop */}
      <div className="absolute inset-0 su-glass-overlay" />

      {/* Content */}
      <div className="relative flex flex-col items-center gap-6 z-10">
        {/* Gradient spinner ring with mirror shine */}
        <div className="relative">
          <div className="su-import-spinner-ring" />
          {/* Mirror shine sweep */}
          <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <div className="absolute inset-0 w-full h-full animate-su-mirror-shine bg-gradient-to-r from-transparent via-white/30 to-transparent -skew-x-15" />
          </div>
          {/* Center icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-su-float">
              <Loader2 className="h-7 w-7 text-su-brand animate-spin" />
            </div>
          </div>
        </div>

        {/* Main label */}
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Importando candidatos
          </p>
          {total > 0 && (
            <p className="text-xs text-muted-foreground">
              {total} candidato{total !== 1 ? 's' : ''} en proceso
            </p>
          )}
        </div>

        {/* Step list */}
        <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
          {STEPS.map((label, i) => {
            const isCompleted = completedSteps.includes(i);
            const isCurrent = i === currentStep;

            return (
              <div
                key={label}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs transition-all duration-300',
                  isCompleted && 'text-emerald-600 dark:text-emerald-400',
                  isCurrent && 'bg-su-brand-soft/50 text-su-brand font-medium',
                  !isCompleted && !isCurrent && 'text-muted-foreground/40'
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : isCurrent ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-current/20" />
                )}
                <span>{label}</span>
              </div>
            );
          })}
        </div>

        {/* Gradient progress bar */}
        <div className="w-full max-w-[260px]">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${((completedSteps.length + 1) / STEPS.length) * 100}%`,
                background: `linear-gradient(to right, var(--su-ai-stop-1), var(--su-ai-stop-2), var(--su-ai-stop-3), var(--su-ai-stop-4), var(--su-ai-stop-5))`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
