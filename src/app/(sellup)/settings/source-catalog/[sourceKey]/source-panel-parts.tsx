'use client';

/**
 * Piezas compartidas de los paneles del detalle de una fuente (credencial,
 * prueba de conexión y pruebas en seco). Todos tienen la misma anatomía:
 * tarjeta con icono y título, avisos, un resumen de cifras, muestras que se
 * despliegan y una nota final de seguridad. Aquí vive una sola vez.
 *
 * Solo presentación: no llama acciones de servidor ni proveedores.
 */

import { useState, type ReactNode } from 'react';

import { ChevronDown, ChevronUp, ShieldCheck, type LucideIcon } from '@/icons';
import { cn } from '@/lib/utils';
import { withAppTimeZone } from '@/lib/format-date';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

// ─── Tarjeta ─────────────────────────────────────────────────────────────────

interface SourcePanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}

/** La tarjeta de un panel: chip del icono, título, descripción y cuerpo. */
export function SourcePanel({ icon: Icon, title, description, children }: SourcePanelProps) {
  return (
    <SurfaceCard>
      <div className="mb-5 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40"
        >
          <Icon className="h-4 w-4" />
        </span>
        <SurfaceCardHeader
          title={title}
          description={description}
          className="mb-0 min-w-0 flex-1 flex-wrap"
        />
      </div>
      <div className="space-y-4">{children}</div>
    </SurfaceCard>
  );
}

/** Nota final de seguridad: qué NO hace el panel. */
export function PanelDisclaimer({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Aviso para quien no es administrador: la acción existe, pero no para él. */
export function AdminOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <Alert>
      <AlertDescription className="text-xs">{children}</AlertDescription>
    </Alert>
  );
}

// ─── Resumen de cifras ───────────────────────────────────────────────────────

const SUMMARY_COLUMNS = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
} as const;

interface PanelSummaryProps {
  columns?: keyof typeof SUMMARY_COLUMNS;
  className?: string;
  children: ReactNode;
}

/** Rejilla de cifras del resultado, sobre fondo hundido y sin borde. */
export function PanelSummary({ columns = 4, className, children }: PanelSummaryProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-subtle px-4 py-3',
        SUMMARY_COLUMNS[columns],
        className,
      )}
    >
      {children}
    </dl>
  );
}

interface PanelSummaryItemProps {
  label: string;
  value: ReactNode;
  /** Ocupa toda la fila (una URL, una recomendación). */
  wide?: boolean;
  /** Dato técnico: letra monoespaciada y corte por carácter. */
  mono?: boolean;
}

export function PanelSummaryItem({ label, value, wide, mono }: PanelSummaryItemProps) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-full')}>
      <dt className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-sm text-foreground',
          mono ? 'break-all font-mono text-xs' : 'break-words font-medium tabular-nums',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Resultado de una prueba en seco ─────────────────────────────────────────

/** Lista de advertencias que devolvió la prueba. No pinta nada si no hay. */
export function PanelWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Alert variant="warning">
      <AlertTitle>
        {warnings.length === 1 ? '1 advertencia' : `${warnings.length} advertencias`}
      </AlertTitle>
      <AlertDescription className="text-xs">
        <ul className="space-y-0.5">
          {warnings.map((warning, index) => (
            <li key={index} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

interface PanelRunResultProps {
  /** Mensaje de error de la acción; si viene, es lo único que se muestra. */
  error?: string | null;
  /** Título del aviso de éxito. */
  successTitle?: string;
  /** El informe; solo se pinta cuando hay resultado. */
  children?: ReactNode;
}

/**
 * El desenlace de una ejecución: el error en un aviso, o el aviso de éxito
 * seguido del informe. Se anuncia a lectores de pantalla al aparecer.
 */
export function PanelRunResult({ error, successTitle = 'Prueba completada', children }: PanelRunResultProps) {
  if (error) {
    return <Alert variant="destructive">{error}</Alert>;
  }
  if (!children) return null;
  return (
    <div className="space-y-3">
      <Alert variant="success">
        <AlertTitle>{successTitle}</AlertTitle>
      </Alert>
      {children}
    </div>
  );
}

interface PanelSamplesProps {
  /** Texto del disparador cuando está plegado. */
  showLabel?: string;
  hideLabel?: string;
  children: ReactNode;
}

/** Las muestras del informe, plegadas hasta que se piden. */
export function PanelSamples({
  showLabel = 'Ver muestras',
  hideLabel = 'Ocultar muestras',
  children,
}: PanelSamplesProps) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button type="button" variant="ghost" size="xs" className="-ml-2" />}>
        {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        {open ? hideLabel : showLabel}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 space-y-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface PanelSampleListProps {
  title: string;
  count: number;
  children: ReactNode;
}

/** Una lista de muestras con su título y su cuenta. Sin caja: filas separadas por una línea. */
export function PanelSampleList({ title, count, children }: PanelSampleListProps) {
  if (count === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-foreground">
        {title} ({count})
      </p>
      <ul className="divide-y divide-border/50">{children}</ul>
    </div>
  );
}

export function PanelSampleItem({ children }: { children: ReactNode }) {
  return <li className="py-2 text-xs">{children}</li>;
}

interface PanelRunFooterProps {
  executedAt: string;
  /** Configuración regional del formato de fecha (por defecto `es-CO`). */
  locale?: string;
  /** Identificador técnico de la ejecución, a la derecha. */
  trailing: ReactNode;
}

/** Pie del informe: cuándo se ejecutó y sobre qué fuente. */
export function PanelRunFooter({ executedAt, locale = 'es-CO', trailing }: PanelRunFooterProps) {
  const formatted = new Intl.DateTimeFormat(
    locale,
    withAppTimeZone({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  ).format(new Date(executedAt));
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
      <span>Ejecutado: {formatted}</span>
      <span className="break-all font-mono">{trailing}</span>
    </div>
  );
}
