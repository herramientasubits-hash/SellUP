'use client';

import * as React from 'react';
import { Layers, Loader2 } from '@/icons';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { BulkSearchOption } from '@/modules/prospect-batches/bulk-search/bulk-search-engine';
import type { BulkSearchEstimate } from '@/modules/prospect-batches/bulk-search/bulk-search-estimate';

/** Lo que la pantalla ofrece de la búsqueda masiva (resuelto en el servidor). */
export interface BulkSearchSurface {
  options: BulkSearchOption[];
}

export type BulkLaunchOutcome =
  | { ok: true }
  | { ok: false; message: string; estimate?: BulkSearchEstimate };

const credits = (value: number) => Math.round(value).toLocaleString('es-CO');

/** «≈ 6–25 min» · «≈ 40 min–3,5 h». */
export function formatBulkDuration({ min, max }: { min: number; max: number }): string {
  const part = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace('.', ',')} h`;
  };
  if (min >= 60 && max >= 60) return `≈ ${part(min).replace(' h', '')}–${part(max)}`;
  if (min < 60 && max < 60) return `≈ ${min}–${part(max)}`;
  return `≈ ${part(min)}–${part(max)}`;
}

/**
 * Búsqueda masiva de Growth en el resumen del asistente (GROWTH-BULK-SEARCH-1 ·
 * PR 3): elegir «hasta N» empresas, ver el tope de créditos y confirmarlo.
 *
 * El tope que se ve es el que calculó el servidor, y el servidor lo vuelve a
 * calcular al crear: si cambió, lo dice y pide confirmar el número nuevo.
 */
export function BulkSearchLaunch({
  surface,
  onLaunch,
}: {
  surface: BulkSearchSurface;
  onLaunch: (targetCount: number, confirmedCreditCap: number) => Promise<BulkLaunchOutcome>;
}) {
  const groupId = React.useId();
  const [estimates, setEstimates] = React.useState<Record<number, BulkSearchEstimate>>({});
  const [selected, setSelected] = React.useState<number | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const options = surface.options.map((option) => ({
    ...option,
    estimate: estimates[option.targetCount] ?? option.estimate,
  }));
  const choice = options.find((option) => option.targetCount === selected) ?? null;

  const choose = (targetCount: number) => {
    setSelected(targetCount);
    setConfirmed(false);
    setError(null);
  };

  const launch = async () => {
    if (!choice || !confirmed || pending) return;
    setPending(true);
    setError(null);
    const outcome = await onLaunch(choice.targetCount, choice.estimate.creditCap);
    setPending(false);
    if (outcome.ok) return;
    setError(outcome.message);
    if (outcome.estimate) {
      // El servidor calculó otro tope: se muestra el suyo y se vuelve a confirmar.
      setEstimates((current) => ({ ...current, [choice.targetCount]: outcome.estimate! }));
      setConfirmed(false);
    }
  };

  return (
    <section aria-labelledby={`${groupId}-title`} className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Layers className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h4 id={`${groupId}-title`} className="text-sm font-semibold text-foreground">
            ¿Cuántas empresas quieres?
          </h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            SellUp busca por rondas hasta llegar a la cantidad, sin repetir empresas.
          </p>
        </div>
      </div>

      <div role="radiogroup" aria-labelledby={`${groupId}-title`} className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const isSelected = option.targetCount === selected;
          return (
            <label
              key={option.targetCount}
              title={option.blockedReason ?? undefined}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                'has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                isSelected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                !option.allowed && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              <input
                type="radio"
                name={groupId}
                value={option.targetCount}
                checked={isSelected}
                disabled={!option.allowed}
                onChange={() => choose(option.targetCount)}
                className="sr-only"
              />
              <span className={cn('text-sm font-semibold', isSelected ? 'text-primary' : 'text-foreground')}>
                {option.targetCount} empresas
              </span>
              <span className="text-xs text-muted-foreground">
                {option.allowed
                  ? `hasta ${credits(option.estimate.creditCap)} créditos · ${formatBulkDuration(option.estimate.minutes)}`
                  : option.blockedReason}
              </span>
            </label>
          );
        })}
      </div>

      {choice && (
        <div className="space-y-3 animate-su-tab-in">
          <dl className="space-y-1.5 rounded-lg bg-surface-subtle px-3 py-2.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Cantidad</dt>
              <dd className="font-medium text-foreground">Hasta {choice.targetCount} empresas</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Tope de créditos</dt>
              <dd className="font-medium text-foreground tabular-nums">
                Hasta {credits(choice.estimate.creditCap)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Desglose</dt>
              <dd className="text-right text-foreground tabular-nums">
                Apollo {credits(choice.estimate.breakdown.apollo)}
                {choice.estimate.breakdown.lusha > 0 && ` · Lusha ${credits(choice.estimate.breakdown.lusha)}`}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Tiempo</dt>
              <dd className="text-foreground">{formatBulkDuration(choice.estimate.minutes)} con SellUp abierto</dd>
            </div>
          </dl>

          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p>
              Se detiene al llegar a {choice.targetCount}, si ya no aparecen empresas nuevas o si se acaba el tope.
              Nunca gasta más de lo que confirmas.
            </p>
            <p>
              Si cierras SellUp se pausa y sigue cuando vuelvas. Las empresas llegan a «Por revisar» mientras avanza.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
              className="mt-0.5"
              aria-describedby={`${groupId}-title`}
            />
            <span>Confirmo hasta {credits(choice.estimate.creditCap)} créditos</span>
          </label>

          {error && (
            <Alert variant="warning" role="status">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <Button type="button" size="sm" className="w-full" disabled={!confirmed || pending} onClick={launch}>
            {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Layers className="size-3.5" aria-hidden />}
            Iniciar búsqueda masiva
          </Button>
        </div>
      )}
    </section>
  );
}
