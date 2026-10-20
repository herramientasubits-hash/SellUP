'use client';

import { Globe } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LOCAL_LANGUAGE_LABELS, type LocalLanguage } from '@/server/agents/first-call/pack-translation';

export type PackLanguage = 'es' | 'local';

/**
 * Brasil y EE. UU.: la preparación está en español y en el idioma del país (dueña 20-10).
 * Dos botones con `aria-pressed`: el vendedor lee en español y copia la que va a usar.
 */
export function LanguageSwitch({
  language,
  value,
  onValueChange,
}: {
  language: LocalLanguage;
  value: PackLanguage;
  onValueChange: (value: PackLanguage) => void;
}) {
  const options: Array<{ value: PackLanguage; label: string }> = [
    { value: 'es', label: 'Español' },
    { value: 'local', label: LOCAL_LANGUAGE_LABELS[language] },
  ];
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Globe className="size-3.5" aria-hidden="true" />
        Idioma
      </span>
      <div role="group" aria-label="Idioma de la preparación" className="flex w-fit items-center gap-1 rounded-md border border-border/60 bg-card p-0.5">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={value === option.value}
            className={cn(value === option.value && 'bg-primary/10 font-medium text-primary hover:bg-primary/15')}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground sm:ml-auto">
        {value === 'local' ? 'Lo que dices o envías, en el idioma del país.' : 'La versión que revisó el agente.'}
      </span>
    </div>
  );
}
