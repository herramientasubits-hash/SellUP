'use client';

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  APPROACH_DEFINITIONS,
  FIRST_CONTACT_APPROACHES,
  type FirstContactApproach,
} from '@/server/agents/first-call/approaches';

/** La versión principal se elige con esta clave; las demás, con su enfoque. */
export const MAIN_VERSION = 'main';

export interface MessageTypeOption {
  value: string;
  approach: FirstContactApproach | null;
  label: string;
  /** Para quién y por dónde funciona, o por qué no está escrito. */
  hint: string;
  written: boolean;
  recommended: boolean;
}

/**
 * Los 8 tipos de mensaje (dueña 18-10: «cada canal debería tener los 8 para elegir»):
 * el principal primero, luego los escritos y al final los que no se escribieron,
 * apagados y con el motivo.
 */
export function messageTypeOptions(
  mainApproach: FirstContactApproach | null,
  variants: readonly { approach: FirstContactApproach }[],
): MessageTypeOption[] {
  const written = new Set(variants.map((v) => v.approach));
  const main: MessageTypeOption = mainApproach
    ? { value: MAIN_VERSION, approach: mainApproach, label: APPROACH_DEFINITIONS[mainApproach].label, hint: APPROACH_DEFINITIONS[mainApproach].bestFor, written: true, recommended: true }
    : { value: MAIN_VERSION, approach: null, label: 'Principal', hint: 'La versión que escribió el agente.', written: true, recommended: true };
  const rest = FIRST_CONTACT_APPROACHES.filter((a) => a !== mainApproach).map(
    (a): MessageTypeOption => ({
      value: a,
      approach: a,
      label: APPROACH_DEFINITIONS[a].label,
      written: written.has(a),
      recommended: false,
      hint: written.has(a)
        ? APPROACH_DEFINITIONS[a].bestFor
        : APPROACH_DEFINITIONS[a].unavailableReason ??
          (a === 'referral'
            ? 'Necesita el nombre de quien refirió el contacto: pídela con «Otra versión».'
            : a === 'trigger'
              ? 'Sólo con una noticia de los últimos 90 días.'
              : 'No se escribió en esta preparación: pídela con «Otra versión».'),
    }),
  );
  return [main, ...rest.filter((o) => o.written), ...rest.filter((o) => !o.written)];
}

/**
 * El tipo de mensaje de una preparación, como un campo de selección en la cabecera
 * de la tarjeta: el mismo mensaje escrito con cada enfoque, para elegir cuál usar.
 */
export function MessageTypeSelect({
  options,
  value,
  onValueChange,
  isCall,
}: {
  options: readonly MessageTypeOption[];
  value: string;
  onValueChange: (value: string) => void;
  isCall: boolean;
}) {
  const id = React.useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const writtenCount = options.filter((o) => o.written).length;
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor={id} className="shrink-0 text-xs font-medium text-muted-foreground">
        Tipo de mensaje
      </label>
      <Select
        value={current.value}
        onValueChange={(next) => next && onValueChange(String(next))}
        items={options.map((o) => ({ value: o.value, label: o.recommended ? `${o.label} · recomendado` : o.label }))}
      >
        <SelectTrigger id={id} size="sm" className="w-full sm:w-80" aria-label={isCall ? 'Tipo de mensaje de la llamada' : 'Tipo de mensaje'}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-[min(24rem,calc(100vw-2rem))]">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={!o.written}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {o.label}
                  {o.recommended && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Recomendado</span>}
                </span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground sm:ml-auto">
        {writtenCount === 1 ? '1 de 8 escrito' : `${writtenCount} de 8 escritos`}
      </span>
    </div>
  );
}
