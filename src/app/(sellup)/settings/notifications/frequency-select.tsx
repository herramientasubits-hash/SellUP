'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FREQUENCY_OPTIONS } from './notification-settings-types';

// ============================================================
// Selector de frecuencia de boletín, con opciones extra al principio
// («Todas», «Sin boletín»…) cuando se usa como filtro.
// ============================================================

interface FrequencySelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Opciones que van antes de las cuatro frecuencias. */
  leading?: ReadonlyArray<{ value: T; label: string }>;
  /** Opciones que van después. */
  trailing?: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
  size?: 'sm' | 'default';
}

export function FrequencySelect<T extends string>({
  value,
  onChange,
  ariaLabel,
  leading = [],
  trailing = [],
  className = 'w-40',
  size = 'default',
}: FrequencySelectProps<T>) {
  const options = [...leading, ...FREQUENCY_OPTIONS.map((o) => ({ value: o.value as T, label: o.label })), ...trailing];
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger size={size} className={className} aria-label={ariaLabel}>
        <SelectValue>{options.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
